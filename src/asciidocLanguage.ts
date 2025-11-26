import * as ohm from "ohm-js";
import { NodeFactory } from "./pmNodes.ts";

export const g = ohm.grammar(String.raw`
  asciidocBlock {
    document = nl* header? body
    header = title_content
    body = section_block* nl?
    section_block = nl* paragraph
    paragraph = line
    title_content = line
    line = (~eol any)+
    eol = nl | end

    // We need this b/c we need a memoization boundary.
    // Terminals and iters aren't memoized, so something like "\n"*
    // will always appear to be a changed node.
    nl = "\n"
  }`);

export function createSemantics(nf: NodeFactory) {
  const semantics = g.createSemantics();
  semantics.addAttribute("pmNodes", {
    document(iterNl: any, optHeader: any, body: any) {
      const children = [
        ...(optHeader.children.length > 0 ? [optHeader.child(0).pmNodes] : []),
        ...body.pmNodes,
      ];
      return nf.create("doc", children);
    },
    header(title_content: any) {
      return nf.create("paragraph", [
        nf.create("text", title_content.sourceString),
      ]);
    },
    body(iterSectionBlock: any, optNl: any) {
      // No gen info, b/c there's no associated pmNode.
      return iterSectionBlock.children.flatMap((c: any) => c.pmNodes);
    },
    section_block(iterNl: any, para: any) {
      return para.pmNodes;
    },
    paragraph(line: any) {
      return nf.create("paragraph", [line.pmNodes]);
    },
    line(iterAny: any) {
      return nf.create("text", this.sourceString);
    },
    _default(...children: any[]) {
      return children.flatMap((c) => c.pmNodes);
    },
    _terminal() {
      return nf.create("text", this.sourceString);
    },
  });
  return semantics;
}
