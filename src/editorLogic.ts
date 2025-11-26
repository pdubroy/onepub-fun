import * as ohm from "ohm-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { schema } from "./schema.ts";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { NodeFactory, transform } from "./pmNodes.ts";

export interface EditOp {
  startIdx: number;
  endIdx: number;
  str: string;
  desc: string;
}

export const edits: EditOp[] = [
  {
    startIdx: 0,
    endIdx: 0,
    str: "= Title\n\nHello world\n\n!",
    desc: "Initialize",
  },
  { startIdx: 0, endIdx: 0, str: "", desc: "Fake Edit" },
  {
    startIdx: 15,
    endIdx: 20,
    str: "universe",
    desc: "Replace 'world' with 'universe'",
  },
  { startIdx: 0, endIdx: 26, str: "", desc: "Clear all" },
];

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

const semantics = g.createSemantics();

export function createEditor(
  rootElement: HTMLElement,
  onDocChange: (doc: any) => void,
) {
  let state = EditorState.create({
    schema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo }),
      keymap(baseKeymap),
    ],
  });

  const view = new EditorView(rootElement, {
    state,
    dispatchTransaction(transaction) {
      let newState = view.state.apply(transaction);
      view.updateState(newState);
      onDocChange(newState.doc);
    },
  });

  onDocChange(view.state.doc);

  const nf = new NodeFactory();

  // pmNodes represents the ProseMirror representation of the parse tree.
  // Ideally we would walk the AST here, not the CST.
  semantics.addAttribute("pmNodes", {
    document(iterNl: any, optHeader: any, body: any) {
      const children = [
        ...(optHeader.children.length > 0 ? [optHeader.child(0).pmNodes] : []),
        ...body.pmNodes,
      ];
      // The ProseMirror basic schema requires at least one paragraph in the document.
      if (children.length === 0) {
        children.push(nf.create("paragraph", []));
      }
      return nf.create("doc", children);
    },
    header(title_content: any) {
      return nf.create("paragraph", [
        nf.create("text", title_content.sourceString),
      ]);
    },
    body(iterSectionBlock: any, optNl: any) {
      // No gen info, b/c there's no associated pmNode.
      return iterSectionBlock.children.flatMap((c: any) => c.pmNodes);
    },
    section_block(iterNl: any, para: any) {
      return para.pmNodes;
    },
    paragraph(line: any) {
      return nf.create("paragraph", [line.pmNodes]);
    },
    line(iterAny: any) {
      return nf.create("text", this.sourceString);
    },
    _default(...children: any[]) {
      return children.flatMap((c) => c.pmNodes);
    },
    _terminal() {
      return nf.create("text", this.sourceString);
    },
  });

  let docs: any[] = []; // ProseMirror Nodes
  const m = g.matcher();

  const updateState = () => {
    const initialTr = view.state.tr;

    const prevDoc = docs.at(-2);
    const currDoc = docs.at(-1);

    const steps = transform(nf, prevDoc, currDoc);
    const tr = steps.reduce((tr, step) => tr.step(step), initialTr);

    view.dispatch(tr);
  };

  const previewEdit = (edit: EditOp) => {
    const { startIdx, endIdx, str } = edit;
    m.replaceInputRange(startIdx, endIdx, str);
    const ans = semantics(m.match()).pmNodes;
    nf.currGenId += 1;
    return ans;
  };

  const commitEdit = (newDoc: any) => {
    docs.push(newDoc);
    updateState();
  };

  const getCurrentDoc = () => (docs.length > 0 ? docs[docs.length - 1] : null);

  const destroy = () => {
    view.destroy();
  };

  return { previewEdit, commitEdit, getCurrentDoc, destroy };
}
