import { For } from "solid-js";

export const TreePreview = (props: { node: any; title: string }) => {
  return (
    <div
      style={{
        flex: 1,
        border: "1px solid #ccc",
        padding: "10px",
        overflow: "auto",
      }}
    >
      <h4>{props.title}</h4>
      {props.node ? <TreeNode node={props.node} /> : <div>(empty)</div>}
    </div>
  );
};

const TreeNode = (props: { node: any }) => {
  return (
    <div style={{ "font-family": "monospace" }}>
      {props.node.type.name === "text" ? (
        <div style={{ "margin-left": "20px" }}>"{props.node.text}"</div>
      ) : (
        <div>
          <div>{props.node.type.name}</div>
          <div style={{ "margin-left": "20px" }}>
            <For each={props.node.children}>
              {(child) => <TreeNode node={child} />}
            </For>
          </div>
        </div>
      )}
    </div>
  );
};
