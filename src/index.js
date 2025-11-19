import * as ohm from "ohm-js";

import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { Fragment, Slice } from "prosemirror-model";

import { NodeFactory, changedSlices, detach, firstChangedPos } from "./pmNodes.ts";

const DeletionType = {
  MANUAL: 0,
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

const pmNodes = new NodeFactory();

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

const semantics = g.createSemantics();

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
      children.push(create("paragraph", []));
    }
    return pmNodes.create("doc", children);
  },
  header(title_content) {
    return pmNodes.create(
      "paragraph",
      [pmNodes.create("text", title_content.sourceString)],
    );
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
    return pmNodes.create("paragraph", [line.pmNodes]);
  },
  line(iterAny) {
    return pmNodes.create("text", this.sourceString);
  },
  _default(...children) {
    return children.flatMap((c) => c.pmNodes);
  },
  _terminal() {
    return pmNodes.create("text", this.sourceString);
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
    const { minGenId, genId } = pmNodes.getGenInfo(this.pmNodes);
    if (genId < pmNodes.currGenId) {
      console.log("doc hasn't changed");
      return [];
    } else if (minGenId === pmNodes.currGenId) {
      const doc = this.pmNodes;
      return [
        new ReplaceStep(offset, maxOffset, doc.slice(0, doc.content.size)),
      ];
    } else {
      // console.log("doc is partially changed");
      // const fc = firstChangedPos(this.pmNodes, 0);
      // console.log("first changed", fc.node, fc.offset);
      // return [];
    }
  },
  _default(...children) {
    let { offset, maxOffset } = this.args;
    return children.flatMap((c) => c.pmEdit(offset, maxOffset));
  },
});

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

let docs = [];

let m = g.matcher();
const makeEdit = (startIdx, endIdx, str) => {
  m.replaceInputRange(startIdx, endIdx, str);
  pmNodes.currGenId += 1;
  const ans = semantics(m.match());
  docs.push(ans.pmNodes); // Whenever we make an edit, record the doc.
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
let changedPos = firstChangedPos(pmNodes, root.pmNodes);
let changedNode = root.pmNodes.nodeAt(changedPos);

/*
  Positions *before* the indicated character:

  doc(paragraph("= Title"), paragraph("Hello universe"), paragraph("!"))
      ^          ^          ^          ^     ^           ^          ^
      0          1          9          10    16          25         26
 */

const slices = changedSlices(pmNodes, root.pmNodes);
assert.equal(slices.length, 1);
const chSlice = slices[0];
assert.equal(`${changedNode}`, '"Hello universe"');
assert.equal(chSlice.startPos, 16 - "Hello ".length);
assert.equal(chSlice.endPos, 26); // Arguably could be 24 too.

if (deletionType === DeletionType.REF_COUNTING) {
  const oldDoc = docs.at(-2);

  const dead = detach(pmNodes, oldDoc, -1);
  assert(dead.length === 1);

  if (view) {
    const [from, to] = dead[0];
    const slice = root.pmNodes.slice(chSlice.startPos, chSlice.endPos, true);
    // Not sure the best way to make sure that the open depths are correct.
    // Randomly adding a +2 here fixed it.
    const step = new ReplaceStep(from, to + 2, slice);
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
