import { schema } from "prosemirror-schema-basic";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { Slice } from "prosemirror-model";
import { ReplaceStep } from "prosemirror-transform";
import { undo, redo, history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";

import * as ohm from "ohm-js";

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

function checkNotNull<T>(val: T | null, msg?: string): T {
  if (val == null) throw new Error(msg || "Unexpected null value");
  return val;
}

function handleNonterminal(...children) {
  const key = checkNotNull(id[this.ctorName]);
  return {
    _node: this._node,
    type: this.ctorName,
    key,
    children: children.map((c) => c.rawCst()),
    startIdx: this.source.startIdx,
    endIdx: this.source.endIdx,
  };
}

const g = ohm.grammar(String.raw`
  asciidocBlock {
    document = "\n"* header? body
    header = title_content
    body = section_block* "\n"?
    section_block = "\n"* paragraph
    paragraph = line
    title_content = line2
    line = (~eol any)+
    line2 = (~eol any)+
    eol = "\n" | end
  }`);
const semantics = g.createSemantics().addOperation("rawCst()", {
  _nonterminal: handleNonterminal,
  _terminal() {
    return this.sourceString;
  },
  _iter(...children) {
    return {
      _node: this._node,
      type: this.ctorName,
      children: children.map((c) => c.rawCst()),
      startIdx: this.source.startIdx,
      endIdx: this.source.endIdx,
    };
  },
  line(iterAny) {
    const key = checkNotNull(id[this.ctorName]);
    return {
      _node: this._node,
      type: this.ctorName,
      key,
      children: [this.sourceString],
      startIdx: this.source.startIdx,
      endIdx: this.source.endIdx,
    };
  },
  line2(iterAny) {
    const key = checkNotNull(id[this.ctorName]);
    return {
      _node: this._node,
      type: this.ctorName,
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

let stateMap = new Map();

function runCleanup(newNodes) {
  const oldNodes = liveNodes;
  liveNodes = new Set(semantics(result).allNodes());
  [...oldNodes]
    .filter((n) => !liveNodes.has(n))
    .toReversed()
    .forEach((n) => {
      if (stateMap.has(n)) {
        const { cleanupFn } = stateMap.get(n);
        console.log("disposing", `${n.ctorName}`);
        if (cleanupFn) {
          console.log("calling cleanup");
          cleanupFn();
        }
        stateMap.delete(n);
      }
    });
}

function useState(ctx, create) {
  let val;
  const k = ctx._node;
  if (stateMap.has(ctx._node)) {
    val = stateMap.get(k).val;
  } else {
    let cleanupFn;
    const onCleanup = (cb) => {
      cleanupFn = cb;
    };
    val = create(onCleanup);
    stateMap.set(k, { val, cleanupFn });
  }
  return val;
}

semantics.addOperation("allNodes()", {
  _default(...children) {
    return [this._node, ...children.flatMap((c) => c.allNodes())];
  },
  _iter(...children) {
    return [...children.flatMap((c) => c.allNodes())];
  },
});

semantics.addAttribute("render", {
  document(iterNl, optHeader, body) {
    const el = useState(this, (onCleanup) => {
      const div = document.createElement("div");
      div.className = "document";
      onCleanup(() => {
        div.classList.add("disposed");
        div.remove();
      });
      return div;
    });
    const h = optHeader.child(0)?.render;
    if (h) {
      el.appendChild(h);
    }
    el.appendChild(body.render);
    return el;
  },
  line(x) {
    return document.createTextNode(this.sourceString);
  },
  line2(x) {
    return document.createTextNode(this.sourceString);
  },
  body(sectionBlockIter, optNl) {
    const el = useState(this, () => {
      const div = document.createElement("div");
      div.className = "body";
      return div;
    });
    sectionBlockIter.children.forEach((sb) => {
      el.appendChild(sb.render);
    });
    return el;
  },
  section_block(iterNl, para) {
    const el = useState(this, () => {
      const div = document.createElement("div");
      div.className = "section-block";
      return div;
    });
    el.appendChild(para.render);
    return el;
  },
});

const nodeLabel = (n) => `${n.type} :: ${n.startIdx}..${n.endIdx}`;

function printTree(node, depth = 1, idx = undefined) {
  if (typeof node === "string") {
    console.log("  ".repeat(depth) + JSON.stringify(node));
    return;
  }
  const prefix =
    "  ".repeat(depth - 1) +
    (typeof idx === "number" ? `- [${idx}]` : `  (${checkNotNull(node.key)})`);
  console.log(`${prefix}: ${nodeLabel(node)}`);
  node.children.forEach((c, i) => {
    const idx = node.type === "_iter" ? i : undefined;
    printTree(c, depth + 1, idx);
  });
}
let m = g.matcher();
m.setInput("= MyTitle\nhello world\n");
const cst = (m: Matcher) => semantics(m.match()).rawCst();

const db = new Map();
const seen = new Set();

const isSameNode = (node, oldNode) => node._node === oldNode._node;

function patchNode(node, oldNode = null, keyPath = []) {
  const k = keyPath.join("");
  const indent = "  ".repeat(keyPath.length);
  const { _node, type, startIdx, endIdx } = node;
  const childLen = node.children.length;
  if (oldNode) {
    // patch db
    const diff = [];
    if (type !== oldNode.type) diff.push(`type: ${oldNode.type} -> ${type}`);
    if (startIdx !== oldNode.startIdx)
      diff.push(`startIdx: ${oldNode.startIdx} -> ${startIdx}`);
    if (endIdx !== oldNode.endIdx)
      diff.push(`endIdx: ${oldNode.endIdx} -> ${endIdx}`);
    if (childLen !== oldNode.childLen)
      diff.push(`children: ${oldNode.childLen} -> ${childLen}`);

    const matchType = _node === oldNode._node ? "exact" : "soft";
    console.log(
      `${indent}update ${k}: ${nodeLabel(node)} (${matchType} match)`,
    );
    if (seen.has(_node)) {
      console.log(`${indent}ℹ Note: we've seen this node before.`);
    }
    if (diff.length > 0) diff.forEach((d) => console.log(`${indent}▸${d}`));

    oldNode.type = type;
    oldNode.startIdx = startIdx;
    oldNode.endIdx = endIdx;
    oldNode.childLen = childLen;
  } else {
    seen.add(_node);
    console.log(`${indent}mount ${k}: ${nodeLabel(node)}`);

    // Create node
    db.set(k, {
      _node,
      type,
      startIdx,
      endIdx,
      childLen,
    });
  }
  if (type === "_iter") {
    const childKey = (i) => [...keyPath, `[${i}]`].join("");
    const oldChildren = [];
    for (let i = 0; ; i++) {
      const key = childKey(i);
      const oldNode = db.get(key);
      if (!oldNode) break;
      oldChildren.push({ key, oldNode });
    }
    if (node.children.length > 0) {
      const mapping = new Array(node.children.length);
      let maxI = Math.min(oldChildren.length, node.children.length);
      for (let i = 0; i < maxI; i++) {
        if (!isSameNode(node.children[i], oldChildren[i].oldNode)) break;
        mapping.push(oldChildren[i]);
      }
      for (
        let j = node.children.length, k = oldChildren.length;
        j-- > 0 && k-- > 0;

      ) {
        if (!isSameNode(node.children[j], oldChildren[k].oldNode)) break;
        mapping[j] = oldChildren[k];
      }
      for (const [i, info] of mapping.entries()) {
        if (typeof node.children[i] === "string") return; // Don't recurse into terminals.
        const newKeyPath = [...keyPath, `[${i}]`];
        patchNode(node.children[i], info?.oldNode ?? null, newKeyPath);
      }
    }
  } else {
    node.children.forEach((c, i) => {
      if (typeof c === "string") return; // Don't recurse into terminals.
      const newKeyPath = [...keyPath, `/${checkNotNull(c.key)}`];
      patchNode(c, db.get(newKeyPath.join("")), newKeyPath);
    });
  }
}

const root = document.querySelector("#root");
const cst1 = cst(m);
printTree(cst1);
root.innerHTML = "";
let result = m.match();
root.appendChild(semantics(result).render);

let liveNodes = new Set(semantics(result).allNodes());

m.replaceInputRange(10, 10, "ONE-Pub\n");

const cst2 = cst(m);
printTree(cst2);
// root.innerHTML = "";
result = m.match();
runCleanup();
root.appendChild(semantics(result).render);

m.replaceInputRange(10, 30, "ONE-Pub\n");

// const cst3 = cst(m);
// printTree(cst3);
// root.innerHTML = "";
result = m.match();
runCleanup();
root.appendChild(semantics(result).render);

// ProseMirror stuff begins here

m = g.matcher();
m.setInput("= MyTitle\nhello world\n");

let state = EditorState.create({
  schema,
  plugins: [
    history(),
    keymap({ "Mod-z": undo, "Mod-y": redo }),
    keymap(baseKeymap),
  ],
});
let view = new EditorView(document.querySelector("#pm-root"), {
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

stateMap = new Map();
liveNodes = new Set(semantics(result).allNodes());

let nextTr;

semantics.addAttribute("renderPM", {
  document(iterNl, optHeader, body) {
    // const el = useState(this, (onCleanup) => {
    // });
    nextTr = view.state.tr;
    const h = optHeader.child(0)?.renderPM;
    body.renderPM;
    const docBefore = view.state.doc;
    let inverted = nextTr.steps.map((step, i) => step.invert(nextTr.docs[i]));
    view.dispatch(nextTr);
    useState(this, (onCleanup) => {
      onCleanup(() => {
        const tr = state.tr;
        let i = 0;
        for (let step of inverted.reverse()) {
          console.log("step", i);
          tr.step(step);
        }
        view.dispatch(tr);
      });
    });
  },
  line(x) {
    nextTr = nextTr.insertText(this.sourceString, this.source.startIdx);
  },
  line2(x) {
    nextTr = nextTr.insertText(this.sourceString, this.source.startIdx);
  },
  body(sectionBlockIter, optNl) {
    // const el = useState(this, () => {
    //   const div = document.createElement("div");
    //   div.className = "body";
    //   return div;
    // });
    sectionBlockIter.children.forEach((sb) => {
      sb.renderPM;
    });
  },
  section_block(iterNl, para) {
    // const el = useState(this, () => {
    //   const div = document.createElement("div");
    //   div.className = "section-block";
    //   return div;
    // });
    para.renderPM;
  },
  header(titleContent) {
    titleContent.renderPM;
  },
});

m.replaceInputRange(10, 10, "ONE-Pub\n");

result = m.match();
console.log("cleanup1");
runCleanup();
semantics(result).renderPM;

// m.replaceInputRange(10, 30, "ONE-Pub\n");

// result = m.match();
// console.log("cleanup2");
// runCleanup();
// semantics(result).renderPM;
