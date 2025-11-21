import assert from "node:assert/strict";
import { test } from "node:test";
import { changedSlices, detach, NodeFactory, transform } from "./pmNodes.ts";
import { Node } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";

function checkNotNull<T>(val: T, msg?: string): NonNullable<T> {
  if (val == null) throw new Error(msg || "Unexpected null value");
  return val as NonNullable<T>;
}

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

test("detach", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);

  // Between doc2 and doc, there is no text deleted.
  assert.deepEqual(detach(pmNodes, docs[0]), []);

  assert.deepEqual(detach(pmNodes, docs[1]), [
    { from: 0, to: 14, nodeType: "paragraph" },
  ]);
});

test("changedSlices", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);

  let ans = changedSlices(pmNodes, docs[1]);
  assert.deepEqual(ans, [{ startPos: 7, endPos: 14 }]);

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
    { startPos: 0, endPos: 4 },
    { startPos: 6, endPos: 10 },
  ]);
});

test("transform", () => {
  const pmNodes = new NodeFactory();
  const docs = createTextFixture(pmNodes);

  /*
    Positions *before* the indicated character:

    doc(paragraph("Hello"), paragraph("world"))
        ^          ^        ^          ^
        0          1        7          8
   */
  const [step] = transform(pmNodes, docs[0], docs[1]);
  let result = step.apply(docs[0]);
  assert.equal(`${result.doc}`, `${docs[1]}`);

  let doc: Node = checkNotNull(docs[1]);
  const steps = transform(pmNodes, docs[1], docs[2]);

  for (const step of transform(pmNodes, docs[1], docs[2])) {
    doc = checkNotNull(step.apply(doc).doc);
  }
  assert.equal(`${doc}`, `${docs[2]}`);
});
