import * as ohm from "ohm-js";

import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { Fragment, Slice } from "prosemirror-model";

const assert = {
  equal(a, b) {
    if (a !== b) {
      throw new Error(`Assertion failed: ${a} !== ${b}`);
    }
  },
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

const semantics = g.createSemantics().addAttribute(
  "ast",
  (() => {
    function handleNonterminal(...children) {
      // const key = checkNotNull(id[this.ctorName]);
      return {
        // _node: this._node,
        type: this.ctorName,
        genId: currGenId,
        minGenId: Math.min(...children.map((c) => c.ast.minGenId)),
        // key,
        children: children.map((c) => c.ast),
        startIdx: this.source.startIdx,
        endIdx: this.source.endIdx,
      };
    }

    return {
      _nonterminal: handleNonterminal,
      _terminal() {
        // console.log(this.ctorName, JSON.stringify(this.sourceString), `@${this.source.startIdx}`);
        return {
          value: this.sourceString,
          minGenId: currGenId,
          genId: currGenId,
        };
      },
      _iter(...children) {
        // console.log(this.ctorName, JSON.stringify(this.sourceString), `@${this.source.startIdx}`);

        // Because _iter actions aren't memoized (only non-terminal actions are), we don't want to get the new genId
        // unless the children have changed.
        const genId = Math.max(-1, ...children.map((c) => c.ast.genId));
        return {
          // _node: this._node,
          type: this.ctorName,
          genId,
          minGenId: Math.min(currGenId, ...children.map((c) => c.ast.minGenId)),
          children: children.map((c) => c.ast),
          startIdx: this.source.startIdx,
          endIdx: this.source.endIdx,
        };
      },
      line(iterAny) {
        const key = checkNotNull(id[this.ctorName]);
        return {
          // _node: this._node,
          type: this.ctorName,
          genId: currGenId,
          minGenId: currGenId,
          key,
          children: [this.sourceString],
          startIdx: this.source.startIdx,
          endIdx: this.source.endIdx,
        };
      },
      document(iterNl, optHeader, body) {
        console.log({ currGenId });
        const ans = handleNonterminal.call(this, iterNl, optHeader, body);
        ans.children[0].key = "i";
        ans.children[1].key = "j";
        return ans;
      },
      body(iterSectionBlock, optNl) {
        const ans = handleNonterminal.call(this, iterSectionBlock, optNl);
        ans.children[0].key = "k";
        ans.children[1].key = "l";
        return ans;
      },
      section_block(iterNl, para) {
        const ans = handleNonterminal.call(this, iterNl, para);
        ans.children[0].key = "m";
        return ans;
      },
    };
  })(),
);

// pmNodes represents the ProseMirror representation of the parse tree.
// Ideally we would walk the AST here, not the CST.
semantics.addAttribute("pmNodes", {
  document(iterNl, optHeader, body) {
    return [...([optHeader.child(0)?.pmNodes] ?? []), ...body.pmNodes];
  },
  header(title_content) {
    return schema.node("paragraph", null, [
      schema.text(title_content.sourceString),
    ]);
  },
  body(iterSectionBlock, optNl) {
    return iterSectionBlock.children.flatMap((c) => c.pmNodes);
  },
  section_block(iterNl, para) {
    return para.pmNodes;
  },
  paragraph(line) {
    return schema.node("paragraph", null, line.pmNodes);
  },
  line(iterAny) {
    return schema.text(this.sourceString);
  },
  _default(...children) {
    return children.flatMap((c) => c.pmNodes);
  },
  _terminal() {
    return schema.text(this.sourceString);
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
    const { minGenId, genId } = this.ast;
    console.log({ minGenId, currGenId });
    if (genId < currGenId) {
      console.log("doc hasn't changed");
      return [];
    } else if (minGenId === currGenId) {
      return [
        new ReplaceStep(
          offset,
          maxOffset,
          new Slice(Fragment.from(this.pmNodes), 0, 0),
        ),
      ];
    } else {
      console.log("doc is partially changed");
      const fc = firstChanged(this.children, 0);
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

function firstChanged(nodes, initialPos, depth) {
  console.log("  ".repeat(depth) + `firstChanged(${initialPos}`);
  let pos = initialPos;
  for (const n of nodes) {
    if (n.ast.genId === currGenId) {
      return n.ctorName === "_terminal"
        ? pos
        : firstChanged(n.children, pos + 1, depth+1);
    }
    pos += pmSize(n.pmNodes);
  }
  throw new Error("impossible");
}

// function changedSlice(nodes) {
//   let startPos = -1;
//   let endPos = -1;

//   // Note: We shouldn't be walking the CST here, but the pmNodes tree.
//   // But, since they map 1-to-1 right now, this is fine.
//   function walk(nodes, pos) {
//     for (const n of nodes) {
//       if (n.ctorName === "_terminal") {
//         if (startPos === -1 && n.ast.genId === currGenId) {
//           startPos = pos;
//         } else if (startPos > -1 && n.ast.genId !== currGenId) {
//           endPos = pos;
//           return true; // Done
//         }
//       } else if (walk(n.children, pos + 1)) {
//         break;
//       }
//       offset += pmSize(n.pmNodes);
//     }
//     return startPos !== -1 && endPos
//   }

//   return walk(nodes, 0);
// }

let m = g.matcher();
const makeEdit = (startIdx, endIdx, str) => {
  m.replaceInputRange(startIdx, endIdx, str);
  currGenId += 1;
  return semantics(m.match());
};

let root = makeEdit(0, 0, "= Title\n\nHello world");
console.log(root.ast);
console.log(root.pmNodes);

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

console.log("REAL EDIT ----");
root = makeEdit(15, 20, "universe");
// console.log(changedSlice([root]));
// updateView();
if (view)
  // This is the correct edit - replace `world` with `universe`.
  view.dispatch(
    view.state.tr.replaceRange(
      16,
      22,
      new Slice(Fragment.from(schema.text("universe")), 0, 0),
    ),
  );
assert.equal(firstChanged([root], -1), 16);
