# About

This repo contains an exploration of incremental semantic actions for Ohm, and specifically, how we can incrementally update ProseMirror state after an incremental parse.

The basic idea is as follows —

The `pmNodes` attribute (defined in `editorLogic.ts`) represents the desired state of the ProseMirror doc. It builds on the default memoization strategy used by Ohm's original incremental parsing algorithm: each time the top-level attribute is evaluated, we only re-run the actions for CST nodes that were directly affected by the edit.

In the `pmNodes` actions, when we create a new ProseMirror node, we don't do it directly — instead, we do it via the `NodeFactory` (defined in `pmNodes.ts`). This allows us to maintain some extra information about the nodes.

For each ProseMirror node, we record three things:

1. What generation it was created in (each edit in the doc begins a new generation) - the `genId`.
2. The minimum generation of any of its descendants (`minGenId`).
3. The generation of the node's current parent.

Then, whenever there is an edit, we evaluate the `pmNodes` attribute to get the new (desired) tree. But, we need to figure out what edits will turn the current ProseMirror doc into the desired one. We call `transform(nodeFact, oldDoc, newDoc)` which returns a list of ReplaceSteps that should be applied to the current doc, to produce the new doc.

## Determining the ReplaceSteps

The info in the `GenInfo` allows us to efficiently walk only the parts of the two trees that are different:

- First, in `detach`, we begin walking from the root of the old doc. At each node, we look at the `parentGenId`.
  * If it is _newer_ than the genId of the old document root, that means the node is now part of the new tree. It is alive, so we don't need to visit it.
  * Otherwise, the node is dead. We walk its children and build up a list of ranges that need to be deleted. The base case is dead text nodes: those represent specific ranges of text that need to be removed.
- Then, we use `getAdditions` to walk the _desired_ doc, and determine which nodes are _new_. In a way, it's the dual of `detach`:
  * `detach` begins with the assumption that the root of the old doc is dead, and walks from there to find the "dead" regions.
  * `getAdditions` begins with the assumption that the root of desired doc is _new_, and walks from there to find boundaries of the new regions. We use `minGenId`, which tells us which parts of the tree have some reused nodes, and are therefore on the boundary of the old/new.
- Both functions avoid recursing into parts of the tree that were not affected by the change.

Note that combination of deletions and additions is not necessarily minimal, but it should be correct — i.e., it should leave the actual ProseMirror doc in the desired state.

## Running demo, tests, etc.

- `npm run dev`: run the demo, which lets you step through a few test changes and see the old & new trees computed by `pmNodes`.
- `npm test`: run the tests (just a few small ones).

## Notes

- There is some difficulty related to empty docs. ProseMirror doesn't allow a completely empty doc — it must contain an empty paragraph. In the current implementation of `transform`, if the entire doc is replaced, it will produce a deletion step that removes everything, and then an addition step that adds the new content. However, because the intermediate state is illegal, I tried to work around it — but in the demo we end up with a stray paragraph node after such edits.
- In theory, it should be possible to interleave the two algorithms (`detach` + `getAdditions`) to avoid temporarily putting the doc into an illegal state.
