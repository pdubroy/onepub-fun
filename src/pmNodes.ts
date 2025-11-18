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

export class DocumentState {
  currGenId: number = 0;
  #genInfo: WeakMap<Node, GenInfo> = new WeakMap();

  getGenInfo(key: Node) {
    return checkNotNull(this.#genInfo.get(key));
  }

  setGenInfo(key: Node, value: GenInfo) {
    this.#genInfo.set(key, value);
  }

  pmNode(
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
      ans.children.forEach((c) => {
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
