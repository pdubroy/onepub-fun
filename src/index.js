import * as ohm from "ohm-js";

import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { Fragment, Slice } from "prosemirror-model";

import {
  NodeFactory,
  transform,
} from "./pmNodes.ts";

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
      children.push(pmNodes.create("paragraph", []));
    }
    return pmNodes.create("doc", children);
  },
  header(title_content) {
    return pmNodes.create("paragraph", [
      pmNodes.create("text", title_content.sourceString),
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

const updateState = () => {
  const initialTr = view ? view.state.tr : state.tr;
  const steps = transform(pmNodes, docs.at(-2), docs.at(-1));
  const tr = steps.reduce((tr, step) => tr.step(step), initialTr);
  if (view) {
    view.dispatch(tr);
  } else {
    state = state.apply(tr);
  }
};
updateState();

console.log("FAKE EDIT ----");
root = makeEdit(0, 0, "");
updateState();

console.log("REAL EDIT #1 ----");
root = makeEdit(15, 20, "universe");
updateState();

console.log("REAL EDIT #2 ----");
root = makeEdit(0, 26, "");
updateState();
