import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NodeFactory,
  changedSlices,
  detach,
  firstChangedPos,
} from "./pmNodes.ts";
import { Node } from "prosemirror-model";

function* genFixtures(): Generator<[NodeFactory, Node]> {
  const nodes = new NodeFactory();
  const par1 = nodes.create("paragraph", [nodes.create("text", "Hello")]);
  let doc = nodes.create("doc", [par1]);
  yield [nodes, doc];

  nodes.currGenId++;
  doc = nodes.create("doc", [
    par1,
    nodes.create("paragraph", [nodes.create("text", "world")]),
  ]);
  yield [nodes, doc];

  nodes.currGenId++;
  doc = nodes.create("doc", [nodes.create("paragraph", [])]);
  yield [nodes, doc];
}

test("firstChangedPos", () => {
  const fixtures = genFixtures();
  let [pmNodes, doc] = fixtures.next().value; // Ignore the first value.
  [pmNodes, doc] = fixtures.next().value;
  /*
    Positions *before* the indicated character:

    doc(paragraph("Hello"), paragraph("world"))
        ^          ^        ^          ^
        0          1        7          8
   */
  assert.equal(firstChangedPos(pmNodes, doc), 8);

  [pmNodes, doc] = fixtures.next().value;

  // pos 0 is inside the doc, right before first child
  assert.equal(firstChangedPos(pmNodes, doc), 0);
});

test("detach", () => {
  const fixtures = genFixtures();
  let [pmNodes, doc] = fixtures.next().value;
  let [_, doc2] = fixtures.next().value;

  // Between doc2 and doc, there is no text deleted.
  assert.deepEqual(detach(pmNodes, doc), []);

  fixtures.next();

  // Open question: should these be merged? Arguably we should return
  // [0, 14] instead.
  assert.deepEqual(detach(pmNodes, doc2), [
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
  const fixtures = genFixtures();
  let [pmNodes, doc] = fixtures.next().value;
  let [_, doc2] = fixtures.next().value;

  let ans = changedSlices(pmNodes, doc2);
  assert.deepEqual(ans, [{ startPos: 8, endPos: 14 }]);

  let [_2, doc3] = fixtures.next().value;
  ans = changedSlices(pmNodes, doc3);
  assert.deepEqual(ans, []);
});
