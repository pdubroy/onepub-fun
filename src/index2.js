import * as ohm from "ohm-js";

import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { Fragment, Slice } from "prosemirror-model";

const DeletionType = {
  MANUAL: 0,
  TRACING: 1,
  REF_COUNTING: 2,
};
const deletionType = DeletionType.REF_COUNTING;

function assert(cond, message) {
  if (!cond) throw new Error(message || "Assertion failed");
}

assert.equal = (a, b) => {
  if (a !== b) {
    throw new Error(`Assertion failed: ${a} !== ${b}`);
  }
};

let state = EditorState.create({
  schema,
  plugins: [
    history(),
    keymap({ "Mod-z": undo, "Mod-y": redo }),
    keymap(baseKeymap),
  ],
});

let view;
if (typeof document !== "undefined") {
  view = new EditorView(document.querySelector("#pm-root"), {
    state,
    dispatchTransaction(transaction) {
      console.log(
        "Document size went from",
        transaction.before.content.size,
        "to",
        transaction.doc.content.size,
      );
      let newState = view.state.apply(transaction);
      view.updateState(newState);
    },
  });
}

const g = ohm.grammar(String.raw`
  asciidocBlock {
    document = nl* header? body
    header = title_content
    body = section_block* nl?
    section_block = nl* paragraph
    paragraph = line
    title_content = line
    line = (~eol any)+
    eol = nl | end

    // We need this b/c we need a memoization boundary.
    // Terminals and iters aren't memoized, so something like "\n"*
    // will always appear to be a changed node.
    nl = "\n"
  }`);

let currGenId = 0;

const id = {
  document: "a",
  header: "b",
  body: "c",
  section_block: "d",
  paragraph: "e",
  title_content: "f",
  line: "g",
  line2: "h",
};

function checkNotNull(val, msg) {
  if (val == null) throw new Error(msg || "Unexpected null value");
  return val;
}

// An attribute that helps us figure out which parts of the CST are totally new, partially new,
// or totally reused.
const semantics = g.createSemantics().addAttribute("genInfo", {
  _default(...children) {
    return {
      type: this.ctorName,
      genId: currGenId,
      minGenId: Math.min(...children.map((c) => c.genInfo.minGenId)),
    };
  },
  _iter(...children) {
    // Because _iter actions aren't memoized (only non-terminal actions are), we don't want to get the new genId
    // unless the children have changed.
    const genId = Math.max(-1, ...children.map((c) => c.genInfo.genId));
    return {
      genId,
      minGenId: Math.min(currGenId, ...children.map((c) => c.genInfo.minGenId)),
    };
  },
});

let nodeInfo = new WeakMap();
let parentInfo = new WeakMap();
let refCounts = new WeakMap();

// Helper to create a ProseMirror node, and store generation info and parent info
// in the WeakMaps.
function pmNode(ohmNode, nodeType, childrenOrContent) {
  const ans =
    nodeType === "text"
      ? schema.text(childrenOrContent)
      : schema.node(nodeType, null, childrenOrContent);
  nodeInfo.set(ans, {
    genId: ohmNode.genInfo.genId,
    minGenId: ohmNode.genInfo.minGenId,
  });
  if (nodeType === "text") return ans;

  const children = Array.isArray(childrenOrContent)
    ? childrenOrContent
    : [childrenOrContent];
  children.forEach((c) => {
    refCounts.set(c, (refCounts.get(c) ?? 0) + 1);
  });

  // if (Array.isArray(childrenOrContent)) {
  //   childrenOrContent.forEach((c) => {
  //     // We maintain a list of all observed parents of a given node.
  //     const arr = parentInfo.get(c) || [];
  //     arr.push(ans);
  //     parentInfo.set(c, arr);
  //   });
  // }
  return ans;
}

// pmNodes represents the ProseMirror representation of the parse tree.
// Ideally we would walk the AST here, not the CST.
semantics.addAttribute("pmNodes", {
  document(iterNl, optHeader, body) {
    const children = [
      ...(optHeader.children.length > 0 ? [optHeader.child(0).pmNodes] : []),
      ...body.pmNodes,
    ];
    // The ProseMirror basic schema requires at least one paragraph in the document.
    if (children.length === 0) {
      children.push(pmNode(this, "paragraph", []));
    }
    return pmNode(this, "doc", children);
  },
  header(title_content) {
    return pmNode(this, "paragraph", [
      pmNode(title_content, "text", title_content.sourceString),
    ]);
  },
  body(iterSectionBlock, optNl) {
    // No gen info, b/c there's no associated pmNode.
    return iterSectionBlock.children.flatMap((c) => c.pmNodes);
  },
  section_block(iterNl, para) {
    // No gen info, b/c there's no associated pmNode.
    return para.pmNodes;
  },
  paragraph(line) {
    return pmNode(this, "paragraph", line.pmNodes);
  },
  line(iterAny) {
    return pmNode(this, "text", this.sourceString);
  },
  _default(...children) {
    return children.flatMap((c) => c.pmNodes);
  },
  _terminal() {
    return pmNode(this, "text", this.sourceString);
  },
});

// The idea here is to walk the tree, and recurse only into nodes
// that have changed since the last time we did this (using genId).
// - For a node that has fully changed (i.e., is totally new) we don't need to recurse,
//   we can just insert its pmNodes.
// - For a node that has NOT changed, we don't need to recurse.
// - We only need to recurse into nodes that have some changed content, and some
//   reused content. For those we need to produce a slice representing the new content.
semantics.addOperation("pmEdit(offset, maxOffset)", {
  document(iterNl, optHeader, body) {
    const { offset, maxOffset } = this.args;
    const { minGenId, genId } = this.genInfo;
    console.log({ minGenId, currGenId });
    if (genId < currGenId) {
      console.log("doc hasn't changed");
      return [];
    } else if (minGenId === currGenId) {
      const doc = this.pmNodes;
      return [
        new ReplaceStep(offset, maxOffset, doc.slice(0, doc.content.size)),
      ];
    } else {
      console.log("doc is partially changed");
      const fc = firstChanged(this.pmNodes, 0);
      console.log("first changed", fc.node, fc.offset);
      return [];
    }
  },
  _default(...children) {
    let { offset, maxOffset } = this.args;
    return children.flatMap((c) => c.pmEdit(offset, maxOffset));
  },
});

// Ugh…would be better if we didn't have to do this. Probably pmNodes should always return a proper
// ProseMirror Node.
function pmSize(nodeOrArray) {
  return Array.isArray(nodeOrArray)
    ? nodeOrArray.reduce((sum, n) => sum + pmSize(n), 0)
    : nodeOrArray.nodeSize;
}

// Per ProseMirror docs, "The start of the document, right before the first content, is position 0".
// But that is *inside* the doc node. So you should start with initialPos = -1, because we will add 1
// when we enter the doc node.
function firstChanged(n, initialPos, depth = 0) {
  const log = (str) => {
    // console.log("  ".repeat(depth) + str);
  };

  log(`firstChanged(${n}, ${initialPos}, ${depth})`);
  let pos = initialPos;
  const { genId, minGenId } = checkNotNull(nodeInfo.get(n));
  log(
    `- type=${n.type.name}, genId=${genId}, minGenId=${minGenId}, currGenId=${currGenId}`,
  );

  if (genId < currGenId) return -1; // Nothing changed in this subtree.

  if (n.type.name === "text") return pos; // Found the first change!

  // Not a text node, and something changed in this subtree.
  // pos += 1; // Account for the opening of this node.

  for (const child of n.children) {
    // pos + 1 to account for the opening of _this_ node.
    const ans = firstChanged(child, pos + 1, depth + 1);
    if (ans !== -1) return ans; // Found it!
    pos += child.nodeSize;
  }
  assert.equal(n.children.length, 0);
  return pos;
}

// Find the node that immediately precedes a given resolved position.
function findPrecedingNode(rpos) {
  if (rpos.nodeBefore) return rpos.nodeBefore; // No search necessary.

  // Walk up the tree, looking for a preceding sibling at each level.
  for (let depth = rpos.depth; depth >= 0; depth--) {
    const idx = rpos.index(depth);

    // Is there a preceding sibling at this level?
    if (idx > 0) {
      const parent = depth > 0 ? rpos.node(depth - 1) : rpos.doc;
      return parent.child(idx - 1);
    }
  }

  return null;
}

function changedSlice(doc) {
  let startPos = firstChanged(doc, -1);
  let endPos = -1;

  if (startPos !== -1) {
    // TODO: Find a better way to do this. This will keep walking the children of any internal
    // nodes on the path to the first reused node. But, the code is simpler for now.
    doc.nodesBetween(startPos, doc.content.size, (node, pos) => {
      if (endPos !== -1) return false; // already found, stop recursing into any nodes.

      const { minGenId, genId } = checkNotNull(nodeInfo.get(node));

      // This condition is a bit tricky. Ideally we want the lowest position that
      // fully encompasses the change. If we find the first leaf node that is reused,
      // we can subtract at least 1 (returning to the parent), and we can keep subtracting
      // 1 as long as long as that would take us up to the parent.
      // But, it's unclear whether that is required, or whether ProseMirror will handle
      // the stitching automatically.

      // There is a reused node in here.
      if (minGenId !== currGenId && node.type.name === "text") {
        endPos = pos - 1; // Found it!
      }
    });
    if (endPos === -1) endPos = doc.content.size;
  }
  return { startPos, endPos };
}

function oldPos(node, prevParent) {
  // Walk the parent chain and determine the position the given node had in the old doc.
  let pos = 0;
  while (prevParent) {
    assert(checkNotNull(nodeInfo.get(prevParent)).genId < currGenId);
    pos += 1; // +1 to account for entering the current node.
    for (const c of prevParent.children) {
      if (c === node) {
        return pos;
      }
      pos += c.nodeSize;
    }
    prevParent = parentInfo.get(prevParent)?.at(-1);
  }
  return -1;
}

let docs = [];

let m = g.matcher();
const makeEdit = (startIdx, endIdx, str) => {
  m.replaceInputRange(startIdx, endIdx, str);
  currGenId += 1;
  const ans = semantics(m.match());
  docs.push(ans.pmNodes); // Whenever we make an edit, record the doc.
  refCounts.set(ans.pmNodes, 1); // Top-level doc always has ref count 1.
  return ans;
};

let root = makeEdit(0, 0, "= Title\n\nHello world\n\n!");
console.log(`${docs.at(-1)}`);

const intoTr = (edits) =>
  edits.reduce((tr, step) => {
    return tr.step(step);
  }, state.tr);

const updateView = () => {
  if (view) view.dispatch(intoTr(root.pmEdit(0, view.state.doc.content.size)));
};

updateView();

console.log("FAKE EDIT ----");
// m.replaceInputRange(15, 20, "universe");
root = makeEdit(0, 0, "");
// updateView();

console.log("REAL EDIT #1 ----");
root = makeEdit(15, 20, "universe");
// updateView();
if (view && deletionType === DeletionType.MANUAL)
  // This is the correct, minimal edit - replace `world` with `universe`.
  view.dispatch(
    view.state.tr.replaceRange(
      16,
      22,
      new Slice(Fragment.from(schema.text("universe")), 0, 0),
    ),
  );

// We should find the position just before the "Hello universe" text node.
let changedPos = firstChanged(root.pmNodes, -1);
let changedNode = root.pmNodes.nodeAt(changedPos);

/*
  Positions *before* the indicated character:

  doc(paragraph("= Title"), paragraph("Hello universe"), paragraph("!"))
      ^          ^          ^          ^     ^           ^          ^
      0          1          9          10    16          25         26
 */

const chSlice = changedSlice(root.pmNodes);
assert.equal(`${changedNode}`, '"Hello universe"');
assert.equal(chSlice.startPos, 16 - "Hello ".length);
assert.equal(chSlice.endPos, 25); // Arguably could be 24 too.

if (deletionType === DeletionType.TRACING) {
  const firstReused = root.pmNodes.nodeAt(chSlice.endPos);
  const parents = checkNotNull(parentInfo.get(firstReused));

  // Most recent parent must be from the current generation, and the previous parent
  // from a previous generation.
  assert.equal(checkNotNull(nodeInfo.get(parents.at(-1))).genId, currGenId);
  let prevParent = parents.at(-2);
  assert(checkNotNull(nodeInfo.get(prevParent)).genId < currGenId);

  console.log(`${root.pmNodes}`);
  console.log(root.pmNodes.resolve(chSlice.startPos));

  const lastReusedNode = findPrecedingNode(
    root.pmNodes.resolve(chSlice.startPos),
  );
  const lrnPrevParent = parentInfo.get(lastReusedNode)?.at(-2);
  assert(checkNotNull(nodeInfo.get(lrnPrevParent)).genId < currGenId);

  const editPos = {
    from: oldPos(lastReusedNode, lrnPrevParent) + lastReusedNode.nodeSize,
    to: oldPos(firstReused, prevParent) - 1,
  };
  console.log("pos in old doc", editPos);
  const slice = root.pmNodes.slice(chSlice.startPos, chSlice.endPos, true);
  const step = new ReplaceStep(editPos.from, editPos.to, slice);
  if (view) {
    view.dispatch(view.state.tr.step(step));
  }
} else if (deletionType === DeletionType.REF_COUNTING) {
  const oldDoc = docs.at(-2);

  const nonDeletions = [];

  // Decrement the ref count of the given node, and determine the extents
  // of any nodes that are no longer referenced.
  function detach(node, pos, depth = 0) {
    const log = (str) => {
      console.log("  ".repeat(depth) + str);
    };
    log(`[${node.type.name}] ${node} @ ${pos}`);
    const newCount = checkNotNull(refCounts.get(node)) - 1;
    if (newCount === 0) {
      // It's not strictly necessary to remove the item from the map, since it should
      // be GC'd anyway. But it doesn't hurt.
      refCounts.delete(node);

      if (node.type.name === "text") {
        return [[pos, pos + node.nodeSize]]; // Return the range(s) that are dead.
      }
      return node.children.flatMap((c) => {
        const ans = detach(c, pos + 1, depth + 1);
        pos += c.nodeSize;
        return ans;
      });
    }
    refCounts.set(node, newCount);
    return []; // Nothing is dead.
  }
  const dead = detach(oldDoc, -1);
  assert(dead.length === 1);

  if (view) {
    const [from, to] = dead[0];
    const slice = root.pmNodes.slice(chSlice.startPos, chSlice.endPos, true);
    // Not sure the best way to make sure that the open depths are correct.
    // Randomly adding a +1 here fixed it.
    const step = new ReplaceStep(from, to + 1, slice);
    if (view) {
      view.dispatch(view.state.tr.step(step));
    }
  }
}

/*
console.log("REAL EDIT #2 ----");
root = makeEdit(0, 26, "");
// updateView();
if (view)
  // This is the correct edit - replace the whole text.
  view.dispatch(
    view.state.tr.replaceRange(0, root.pmNodes.content.size, Slice.empty),
  );

// We should find the position just before the "Hello universe" text node.
changedPos = firstChanged(root.pmNodes, -1);
changedNode = root.pmNodes.nodeAt(0);
assert.equal(`${changedNode}`, "paragraph");
*/
