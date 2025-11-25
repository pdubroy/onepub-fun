import { memoize } from "micro-memoize";
import assert from "node:assert/strict";
import { test } from "node:test";
import * as ohm from "ohm-js";
import type { NonterminalNode } from "ohm-js";

/*
  This file demonstrates how we can do incremental transformation of an AST,
  not just a CST.

  The idea is simple: since at attribute will always return a stable value
  for nodes that aren't affected by an edit, then if we have a function
  the computes some derived value from an AST node, it can simply use
  memoization based on the identity of its arguments.
 */

const g = ohm.grammar(String.raw`
  asciidocBlockNano {
    document = body
    body = section_block*
    section_block = nl* paragraph
    paragraph = (~eol any)+
    eol = nl | end
    nl = "\n"
  }`);

type AstNode =
  | { type: "document"; content: AstNode[] }
  | { type: "paragraph"; text: string };

const semantics = g.createSemantics().addAttribute("ast", {
  document(body) {
    return {
      type: "document",
      content: body.ast,
    };
  },
  body(iterSectionBlocks) {
    return iterSectionBlocks.children.map((sb: NonterminalNode) => sb.ast);
  },
  section_block(_nls, paragraph) {
    return paragraph.ast;
  },
  paragraph(chars) {
    return {
      type: "paragraph",
      text: chars.sourceString,
    };
  },
});

test("incremental transformation", () => {
  const m = g.matcher();
  m.setInput("Hello\n\nfriends");

  let visted: string[] = [];

  const memoized = (fn: (...args: any[]) => any) =>
    memoize(fn, { maxSize: Number.MAX_SAFE_INTEGER });

  // An "operation" that adds up the length of all the text nodes in an AST.
  const textLen = memoized((astNode: AstNode): number => {
    // Every time we execute this function, record the type of the node we visited.
    visted.push(astNode.type);

    switch (astNode.type) {
      case "document":
        return astNode.content.reduce((sum, child) => sum + textLen(child), 0);
      case "paragraph":
        return astNode.text.length;
    }
  });

  let { ast } = semantics(m.match());
  assert.equal(textLen(ast), 12);
  assert.deepEqual(visted, ["document", "paragraph", "paragraph"]);

  m.replaceInputRange(14, 14, "!");
  ast = semantics(m.match()).ast;
  assert.equal(textLen(ast), 13);

  // Recalculating textLen only visits the one paragraph that changed.
  assert.deepEqual(visted, [
    "document",
    "paragraph",
    "paragraph",
    "document",
    "paragraph",
  ]);
});
