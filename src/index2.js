import * as ohm from "ohm-js";

import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { ReplaceStep } from "prosemirror-transform";
import { Fragment } from "prosemirror-model";

let state, view;
if (typeof document !== "undefined") {
  state = EditorState.create({
    schema,
    plugins: [
      history(),
      keymap({ "Mod-z": undo, "Mod-y": redo }),
      keymap(baseKeymap),
    ],
  });
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
    document = "\n"* header? body
    header = title_content
    body = section_block* "\n"?
    section_block = "\n"* paragraph
    paragraph = line
    title_content = line
    line = (~eol any)+
    eol = "\n" | end
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

const semantics = g.createSemantics().addAttribute("ast", {
  _nonterminal: handleNonterminal,
  _terminal() {
    return this.sourceString;
  },
  _iter(...children) {
    return {
      // _node: this._node,
      type: this.ctorName,
      genId: currGenId,
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
      key,
      children: [this.sourceString],
      startIdx: this.source.startIdx,
      endIdx: this.source.endIdx,
    };
  },
  document(iterNl, optHeader, body) {
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
});

function handleNonterminal(...children) {
  const key = checkNotNull(id[this.ctorName]);
  return {
    // _node: this._node,
    type: this.ctorName,
    genId: currGenId,
    key,
    children: children.map((c) => c.ast),
    startIdx: this.source.startIdx,
    endIdx: this.source.endIdx,
  };
}

const toAst = (result) => {
  currGenId += 1;
  return semantics(result).ast;
};

semantics.addAttribute("pmNodes", {
  _default(...children) {
    return children.flatMap(c => c.pmNodes);
  },
  _terminal() {
    return schema.text(this.sourceString);
  },
  header(title_content) {
    return schema.node("paragraph", null, [
      schema.text(title_content.sourceString)
    ]);
  },
  document(iterNl, optHeader, body) {
    console.log(optHeader.child(0)?.pmNodes);
    console.log('^^^');
    return schema.node("doc", null, [
      ...([optHeader.child(0)?.pmNodes] ?? []),
      ...body.pmNodes,
    ]);
  },
  body(iterSectionBlock, optNl) {
    return iterSectionBlock.children.flatMap(c => c.pmNodes);
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
});

semantics.addOperation("pmEdit(offset)", {
  _nonterminal(...children) {
    let { offset } = this.args;
    const ans = [];
    for (const child of this.children) {
      offset += child.pmEdit(offset).length;
    }
    return ans;
  },
  section_block(iterNl, para) {},
  paragraph(line) {},
  line(iterAny) {
    // return new ReplaceStep();
  },
});

const r = g.match("= Title\n\nHello world");
console.log(toAst(r));
console.log(semantics(r).pmNodes);
if (view) {
  // view.dispatch(view.state.tr.replace(0, view.state.doc.content.size, semantics(r).pmFrag));
  const node = schema.text('hello world');
  view.dispatch(
    view.state.tr.replaceWith(0, view.state.doc.content.size, node))
  console.log(view.state.doc === node);
}
