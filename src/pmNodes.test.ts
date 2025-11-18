import assert from "node:assert/strict";
import { test } from "node:test";
import { NodeFactory, firstChangedPos } from "./pmNodes.ts";

test("firstChangedPos", () => {
  const pmNodes = new NodeFactory();
  const par1 = pmNodes.create("paragraph", [pmNodes.create("text", "Hello")]);
  pmNodes.create("doc", [par1]); // doc1
  pmNodes.currGenId++;
  const doc2 = pmNodes.create("doc", [
    par1,
    pmNodes.create("paragraph", [pmNodes.create("text", "world")]),
  ]);
  /*
    Positions *before* the indicated character:

    doc(paragraph("Hello"), paragraph("world"))
        ^          ^        ^          ^
        0          1        7          8
   */
  assert.equal(firstChangedPos(pmNodes, doc2), 8);

  pmNodes.currGenId++;
  const doc3 = pmNodes.create("doc", [pmNodes.create("paragraph", [])]);
  // pos 0 is inside the doc, right before first child
  assert.equal(firstChangedPos(pmNodes, doc3), 0);
});
