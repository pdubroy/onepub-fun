import type { Node } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";

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
      textOrChildren.forEach((c) =>
        console.log(`child: ${c}, in map? ${this.#genInfo.has(c)}`),
      );
      ans.children.forEach((c, i) => {
        console.log(`-> ${c}, in map? ${this.#genInfo.has(c)}`);
        if (!this.#genInfo.has(c))
          throw new Error(`child ${i} (${c}) missing genInfo`);
        this.getGenInfo(c).parentGenId = genId;
      });
      minGenId = Math.min(...ans.children.map((c) => this.getGenInfo(c).genId));
    }
    console.log(`setting geninfo for ${ans}`);
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
export function firstChangedPos(nodeFact: NodeFactory, startNode: Node) {
  function firstChangedImpl(n: Node, initialPos = -1, depth = 0) {
    const log = (str: string) => {
      // console.log("  ".repeat(depth) + str);
    };

    log(`firstChanged(${n}, ${initialPos}, ${depth})`);
    let pos = initialPos;
    const { genId } = nodeFact.getGenInfo(n);
    log(
      `- type=${n.type.name}, genId=${genId}, currGenId=${nodeFact.currGenId}`,
    );

    if (genId < nodeFact.currGenId) return -1; // Nothing changed in this subtree.

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
  return firstChangedImpl(startNode, -1);
}

// Given the given node which is known to be dead, walk its subtrees
// and find other nodes that are also dead.
export function detach(nodeFact: NodeFactory, doc: Node) {
  function detachNode(node: Node, pos: number, depth = 0) {
    const log = (str: string) => {
      console.log("  ".repeat(depth) + str);
    };
    log(`[${node.type.name}] ${node} @ ${pos}`);
    const { parentGenId, genId } = nodeFact.getGenInfo(node);
    log(
      `genId=${genId}, parentGenId=${parentGenId}, currGenId=${nodeFact.currGenId}`,
    );
    if (parentGenId < nodeFact.currGenId) {
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
  console.log("---- detach");
  return detachNode(doc, -1);
}
