import type { Node } from "prosemirror-model";
import { Slice } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { ReplaceStep } from "prosemirror-transform";

function assert(cond: boolean, message?: string): asserts cond {
  if (!cond) throw new Error(message || "Assertion failed");
}

assert.equal = (a, b) => {
  if (a !== b) {
    throw new Error(`Assertion failed: ${a} !== ${b}`);
  }
};

function checkNotNull<T>(val: T, msg?: string): NonNullable<T> {
  if (val == null) throw new Error(msg || "Unexpected null value");
  return val as NonNullable<T>;
}

export interface GenInfo {
  genId: number;
  minGenId: number;
  parentGenId: number;
}

const genInfo = (
  genId: number,
  minGenId: number,
  parentGenId: number,
): GenInfo => ({ genId, minGenId, parentGenId });

// Constructs ProseMirror nodes, and keeps track of what generation they belong to.
export class NodeFactory {
  currGenId: number = 0;
  #genInfo: WeakMap<Node, GenInfo> = new WeakMap();

  getGenInfo(key: Node) {
    return checkNotNull(this.#genInfo.get(key));
  }

  setGenInfo(key: Node, value: GenInfo) {
    this.#genInfo.set(key, value);
  }

  create(
    nodeType: string,
    textOrChildren: Node[] | string,
  ): ReturnType<typeof schema.node> {
    let ans: Node;
    if (nodeType === "text") {
      assert(typeof textOrChildren === "string");
      ans = schema.text(textOrChildren);
    } else {
      assert(Array.isArray(textOrChildren));
      ans = schema.node(nodeType, null, textOrChildren);
    }
    const genId = this.currGenId;

    // It's not clear we actually need minGenId for anything!
    // I think it may just be that the current way of generating a ReplaceStep doesn't handle the
    // boundary case correctly.
    let minGenId = this.currGenId;

    if (nodeType !== "text") {
      assert(Array.isArray(textOrChildren));
      ans.children.forEach((c, i) => {
        this.getGenInfo(c).parentGenId = genId;
      });
      minGenId = Math.min(...ans.children.map((c) => this.getGenInfo(c).genId));
    }
    this.setGenInfo(ans, {
      genId,
      minGenId,
      parentGenId: genId, // Only the root node won't have this overridden.
    });

    return ans;
  }
}

// Return a ProseMirror document position that represents the boundary between the
// old and new content in the doc — where "old" and "new" are defined by the generation
// IDs tracked by the NodeFactory.
export function firstChangedPos(nodeFact: NodeFactory, doc: Node) {
  const currGenId = nodeFact.getGenInfo(doc).genId;

  function firstChangedImpl(n: Node, initialPos = -1, depth = 0) {
    const log = (str: string) => {
      // console.log("  ".repeat(depth) + str);
    };

    log(`firstChanged(${n}, ${initialPos}, ${depth})`);
    let pos = initialPos;
    const { genId } = nodeFact.getGenInfo(n);
    log(`- type=${n.type.name}, genId=${genId}, currGenId=${currGenId}`);

    if (genId < currGenId) return -1; // Nothing changed in this subtree.

    if (n.type.name === "text") return pos; // Found the first change!

    // Not a text node, and something changed in this subtree.
    for (const child of n.children) {
      // pos + 1 to account for the opening of _this_ node.
      const ans = firstChangedImpl(child, pos + 1, depth + 1);
      if (ans !== -1) return ans; // Found it!
      pos += child.nodeSize;
    }
    assert.equal(n.children.length, 0);
    return pos;
  }
  // Per ProseMirror docs, "The start of the document, right before the first content, is position 0".
  // But that is *inside* the doc node. So you should start with initialPos = -1, because we will add 1
  // when we enter the doc node.
  return firstChangedImpl(doc, -1);
}

// Given the given node which is known to be dead, walk its subtrees
// and find other nodes that are also dead.
export function detach(nodeFact: NodeFactory, doc: Node): [number, number][] {
  const oldGenId = nodeFact.getGenInfo(doc).genId;

  function detachNode(node: Node, pos: number, depth = 0) {
    const log = (str: string) => {
      // console.log("  ".repeat(depth) + str);
    };
    log(`[${node.type.name}] ${node} @ ${pos}`);
    const { parentGenId, genId } = nodeFact.getGenInfo(node);
    log(`genId=${genId}, parentGenId=${parentGenId}, oldGenId=${oldGenId}`);
    if (parentGenId <= oldGenId) {
      if (node.type.name === "text") {
        return [[pos, pos + node.nodeSize]]; // Return the range(s) that are dead.
      }
      return node.children.flatMap((c) => {
        const ans = detachNode(c, pos + 1, depth + 1);
        pos += c.nodeSize;
        return ans;
      });
    }
    return []; // Nothing is dead.
  }
  return detachNode(doc, -1);
}

export function changedSlices(
  nodeFact: NodeFactory,
  doc: Node,
): { startPos: number; endPos: number }[] {
  const currGenId = nodeFact.getGenInfo(doc).genId;

  let startPos = -1;
  const ans: { startPos: number; endPos: number }[] = [];

  // `leftmostDepth` is used to ensure that startPos is pulled as high as possible.
  // Consider the following example:
  //     paragraph("Hello")
  //     ^ 0        ^ 1
  // If the text "Hello" is new, we don't want to use pos 1 as the startPos — we
  // want to lift it into the parent and use pos 0.
  // So, we use `leftmostDepth` to track how many levels the position could be
  // lifted, if we detect a change at the very beginning of `n`.
  function walk(
    n: Node,
    initialPos: number,
    leftmostDepth = -1,
    depth = 0,
  ): void {
    const log = (str: string) => {
      // console.log("  ".repeat(depth) + str);
    };

    log(
      `walk(${n}, initialPos: ${initialPos}, leftmostDepth: ${leftmostDepth}, depth: ${depth})`,
    );
    let pos = initialPos;
    const { genId, minGenId } = nodeFact.getGenInfo(n);
    log(`- type=${n.type.name}, genId=${genId}, currGenId=${currGenId}`);

    // If we haven't found the start, we try to find the lowest-most node from the
    // current generation. Once we've found the start, we look for the first
    // node from an older generation.
    if (
      (startPos === -1 && genId < currGenId) ||
      (startPos !== -1 && minGenId === currGenId)
    ) {
      return; // We don't care about this subtree.
    }

    // At this point, we know that this node or one of its descendants is relevant.

    // If it has no children (maybe it's a text node), it marks the start/end.
    if (n.children.length === 0) {
      if (startPos === -1) {
        startPos = pos - leftmostDepth;
        log(`set start to ${startPos}`);
        ans.push({ startPos, endPos: -1 });
      } else {
        checkNotNull(ans.at(-1)).endPos = pos;
        log(`set end to ${pos}`);
        startPos = -1;
      }
      return;
    }

    // Not a text node, but one of its descendants is relevant.
    for (const child of n.children) {
      // pos + 1 to account for the opening of _this_ node.
      walk(child, pos + 1, leftmostDepth + 1, depth + 1);

      // The goal is to pass this node's leftmostDepth + 1 to the first child, and
      // 0 to subsequent children. Setting it to -1 here achieves that.
      leftmostDepth = -1;

      pos += child.nodeSize;
    }
  }
  walk(doc, -1);
  if (startPos !== -1) {
    const last = checkNotNull(ans.at(-1));
    if (last.endPos === -1) last.endPos = doc.content.size;
  }
  return ans;
}

export function transform(nodeFact: NodeFactory, oldDoc: Node, newDoc: Node) {
  const deletions = detach(nodeFact, oldDoc)
    .reverse()
    .map(([from, to]) => new ReplaceStep(from, to, Slice.empty));
  const additions = changedSlices(nodeFact, newDoc).map(
    ({ startPos, endPos }) =>
      new ReplaceStep(startPos, startPos, newDoc.slice(startPos, endPos)),
  );
  return [...deletions, ...additions];
}
