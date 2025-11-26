import * as ohm from "ohm-js";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";

import { schema } from "./schema.ts";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { NodeFactory, transform } from "./pmNodes.ts";
import { createSemantics, g } from "./asciidocLanguage.ts";

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
  const semantics = createSemantics(nf);

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
