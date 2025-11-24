import { createSignal, onMount, onCleanup, For, Show } from "solid-js";
import { createEditor, edits } from "./editorLogic.ts";
import { TreePreview } from "./TreePreview.tsx";

export default function App() {
  let pmRoot!: HTMLDivElement;
  let editor: ReturnType<typeof createEditor> | undefined;

  const [step, setStep] = createSignal(0);
  const [previewDoc, setPreviewDoc] = createSignal<any>(null);
  const [currentDoc, setCurrentDoc] = createSignal<any>(null);
  const [pmDoc, setPmDoc] = createSignal<any>(null);

  onMount(() => {
    if (pmRoot) {
      editor = createEditor(pmRoot, setPmDoc);
      setCurrentDoc(editor.getCurrentDoc());
    }
  });

  onCleanup(() => {
    editor?.destroy();
  });

  const applyNext = () => {
    if (step() < edits.length) {
      if (previewDoc()) {
        editor?.commitEdit(previewDoc());
        setCurrentDoc(editor?.getCurrentDoc());
        setPreviewDoc(null);
        setStep((s) => s + 1);
      } else {
        const edit = edits[step()];
        const newDoc = editor?.previewEdit(edit);
        setPreviewDoc(newDoc);
      }
    }
  };

  return (
    <div style={{ padding: "20px", "max-width": "1200px", margin: "0 auto" }}>
      <h1>Ohm + ProseMirror incremental parsing</h1>
      <div style={{ "margin-bottom": "10px" }}>
        <button
          onClick={applyNext}
          disabled={step() >= edits.length && !previewDoc()}
          style={{ "font-size": "16px", padding: "5px 10px" }}
        >
          {step() >= edits.length
            ? "Done"
            : previewDoc()
              ? `Commit Edit #${step() + 1}`
              : `Preview Edit #${step() + 1}`}
        </button>
        <span style={{ "margin-left": "10px" }}>
          Step: {step()} / {edits.length}
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: "20px",
          "align-items": "flex-start",
          "margin-bottom": "20px",
        }}
      >
        <div style={{ flex: 1 }}>
          <h3>Upcoming Edits:</h3>
          <div
            style={{
              border: "1px solid #ccc",
              "max-height": "300px",
              overflow: "auto",
              padding: "10px",
            }}
          >
            <ul style={{ "padding-left": "20px", margin: 0 }}>
              <For each={edits}>
                {(edit, i) => (
                  <li
                    style={{
                      color: i() < step() ? "gray" : "black",
                      "text-decoration": i() < step() ? "line-through" : "none",
                      "margin-bottom": "5px",
                    }}
                  >
                    <strong>#{i() + 1}:</strong> {edit.desc} <br />
                    <code style={{ "font-size": "0.9em" }}>
                      {edit.startIdx}-{edit.endIdx}: "
                      {edit.str.replace(/\n/g, "\\n")}"
                    </code>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <h3>pmNodes:</h3>
          <div style={{ display: "flex", gap: "10px" }}>
            <TreePreview
              node={currentDoc()}
              title={previewDoc() ? "Old Tree" : "Current Tree"}
            />
            <TreePreview node={previewDoc()} title="New Tree" />
          </div>
        </div>
      </div>

      <h3>Editor View:</h3>
      <div
        ref={pmRoot}
        id="pm-root"
        style={{
          border: "1px solid #ccc",
          padding: "10px",
          "min-height": "100px",
        }}
      ></div>

      <h3 style={{ "margin-top": "20px" }}>Current Document Tree:</h3>
      <TreePreview node={pmDoc()} title="Document Tree" />
    </div>
  );
}
