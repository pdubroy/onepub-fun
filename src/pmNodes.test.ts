import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NodeFactory,
  changedSlices,
  detach,
  firstChangedPos,
} from "./pmNodes.ts";
import { Node } from "prosemirror-model";

function createTextFixture(nf: NodeFactory) {
  const par1 = nf.create("paragraph", [nf.create("text", "Hello")]);
  const ans: Node[] = [];

  ans.push(nf.create("doc", [par1]));

  nf.currGenId++;
  ans.push(
    nf.create("doc", [
      par1,
      nf.create("paragraph", [nf.create("text", "world")]),
    ]),
  );

  nf.currGenId++;
  ans.push(nf.create("doc", [nf.create("paragraph", [])]));

  return ans;
}

test("firstChangedPos", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);
  /*
    Positions *before* the indicated character:

    doc(paragraph("Hello"), paragraph("world"))
        ^          ^        ^          ^
        0          1        7          8
   */
  assert.equal(firstChangedPos(pmNodes, docs[1]), 8);

  // pos 0 is inside the doc, right before first child
  assert.equal(firstChangedPos(pmNodes, docs[2]), 0);
});

test("detach", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);

  // Between doc2 and doc, there is no text deleted.
  assert.deepEqual(detach(pmNodes, docs[0]), []);

  // Open question: should these be merged? Arguably we should return
  // [0, 14] instead.
  assert.deepEqual(detach(pmNodes, docs[1]), [
    [1, 6], // "Hello"
    [8, 13], // "world"
  ]);
});

// - recurse into nodes that are from the current generation.
// - don't recurse into things from the old gen.
// - find the beginning of the text.
// - then, use minGenId:
//   * only recurse into nodes whose minGenId is < currGenId
//   * find the first node whose genId is < currGenId
test("changedSlices", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);

  let ans = changedSlices(pmNodes, docs[1]);
  assert.deepEqual(ans, [{ startPos: 8, endPos: 14 }]);

  ans = changedSlices(pmNodes, docs[2]);
  // 0..2 fully surrounds the new, empty paragraph node.
  assert.deepEqual(ans, [{ startPos: 0, endPos: 2 }]);

  const oldPara = docs[2].children[0];
  pmNodes.currGenId++;
  const doc4 = pmNodes.create("doc", [
    pmNodes.create("paragraph", [pmNodes.create("text", "[]")]),
    oldPara,
    pmNodes.create("paragraph", [pmNodes.create("text", "{}")]),
  ]);

  ans = changedSlices(pmNodes, doc4);
  /*
    doc(paragraph("[]"), paragraph(), paragraph("{}"))
        ^          ^     ^         ^  ^          ^   ^
        0          1     4         5  6          7   10
  */
  assert.deepEqual(ans, [
    { startPos: 1, endPos: 4 },
    { startPos: 7, endPos: 10 },
  ]);
});
