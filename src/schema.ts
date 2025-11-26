import { schema as schemaBasic } from "prosemirror-schema-basic";
import { Schema } from "prosemirror-model";

export const schema = new Schema({
  nodes: schemaBasic.spec.nodes.update("doc", {
    ...schemaBasic.spec.nodes.get("doc"),
    content: "block*", // Change from "block+" to "block*"
  }),
  marks: schemaBasic.spec.marks,
});
