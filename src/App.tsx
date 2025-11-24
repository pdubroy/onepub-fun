import { createSignal, onMount, onCleanup, For } from "solid-js";
import { createEditor, edits } from "./editorLogic.ts";

export default function App() {
  let pmRoot!: HTMLDivElement;
  let editor: ReturnType<typeof createEditor> | undefined;
  
  const [step, setStep] = createSignal(0);

  onMount(() => {
    if (pmRoot) {
      editor = createEditor(pmRoot);
    }
  });
  
  onCleanup(() => {
    editor?.destroy();
  });

  const applyNext = () => {
    if (step() < edits.length) {
      const edit = edits[step()];
      editor?.applyEdit(edit);
      setStep(s => s + 1);
    }
  };

  return (
    <div style={{ padding: "20px" }}>
      <h1>Ohm + ProseMirror incremental parsing</h1>
      <div style={{ "margin-bottom": "10px" }}>
        <button 
            onClick={applyNext} 
            disabled={step() >= edits.length}
            style={{ "font-size": "16px", padding: "5px 10px" }}
        >
            {step() < edits.length ? `Apply Edit #${step() + 1}` : "Done"}
        </button>
        <span style={{ "margin-left": "10px" }}>
            Step: {step()} / {edits.length}
        </span>
      </div>
      
      <div>
        <h3>Upcoming Edits:</h3>
        <ul>
            <For each={edits}>
                {(edit, i) => (
                    <li style={{ 
                        color: i() < step() ? "gray" : "black",
                        "text-decoration": i() < step() ? "line-through" : "none"
                    }}>
                        <strong>#{i() + 1}:</strong> {edit.desc} <br/>
                        <code>start: {edit.startIdx}, end: {edit.endIdx}, content: "{edit.str.replace(/\n/g, '\\n')}"</code>
                    </li>
                )}
            </For>
        </ul>
      </div>

      <h3>Editor View:</h3>
      <div ref={pmRoot} id="pm-root" style={{ border: "1px solid #ccc", padding: "10px", "min-height": "100px" }}></div>
    </div>
  );
}
