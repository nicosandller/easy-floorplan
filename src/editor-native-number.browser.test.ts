import { afterEach, describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FormField } from "./editor-forms";
import type { FloorplanCardConfig } from "./types";

// HA's number selector emits on every keystroke and receives new data when
// the editor renders. Reproduce that contract with a real shadow input.
class NumberForm extends LitElement {
  static properties = { data: {}, schema: {} };
  data: Record<string, unknown> = {};
  schema: FormField[] = [];
  render() {
    return html`${this.schema.filter((field) => "number" in field.selector).map((field) => html`
      <input aria-label=${field.name} type="number" .value=${String(this.data[field.name] ?? "")}
        @input=${(event: Event) => {
          const input = event.target as HTMLInputElement;
          this.dispatchEvent(new CustomEvent("value-changed", { detail: {
            value: { ...this.data, [field.name]: input.value === "" ? undefined : input.valueAsNumber },
          }, bubbles: true, composed: true }));
        }} />`)}`;
  }
}
customElements.define("ha-form", NumberForm);

async function settle(editor: FloorplanCardEditor) {
  await editor.updateComplete;
  for (const form of editor.shadowRoot!.querySelectorAll<NumberForm>("ha-form")) await form.updateComplete;
}

async function mount() {
  const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  editor.style.width = "1300px";
  editor.setConfig({ type: "custom:easy-floorplan-card", width: 1000, height: 720,
    floors: [{ id: "floor", name: "Ground", walls: [], openings: [], items: [], texts: [], trackers: [], areas: [],
      furniture: [{ id: "stairs", type: "stairs", x: 200, y: 200, w: 80, h: 140 }] }],
  });
  document.body.append(editor);
  (editor as unknown as { _selection: unknown[] })._selection = [{ kind: "furniture", id: "stairs" }];
  await settle(editor);
  const form = [...editor.shadowRoot!.querySelectorAll<NumberForm>("ha-form")].find((f) => f.schema[0]?.name === "w")!;
  const input = form.shadowRoot!.querySelector("input")!;
  const saved: FloorplanCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => saved.push((event as CustomEvent).detail.config));
  input.focus();
  return { editor, form, input, saved, async type(value: string) {
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(editor);
  } };
}

afterEach(() => { document.body.innerHTML = ""; });

describe("native number editing", () => {
  it("allows 96 to be typed without the minimum changing its first digit", async () => {
    const t = await mount();
    await t.type("9");
    expect(t.input.value).toBe("9");
    expect(t.saved[t.saved.length - 1]!.floors![0].furniture[0].w).toBe(10);
    // State updates from HA must not replace an unfinished input either.
    t.editor.requestUpdate();
    await settle(t.editor);
    expect(t.input.value).toBe("9");
    await t.type(t.input.value + "6");
    expect(t.input.value).toBe("96");
    expect(t.saved[t.saved.length - 1]!.floors![0].furniture[0].w).toBe(96);
    t.input.blur();
    await settle(t.editor);
    expect(t.input.value).toBe("96");
  });

  it("normalizes an unfinished value on blur and restores empty required fields", async () => {
    const t = await mount();
    await t.type("9");
    t.input.blur();
    await settle(t.editor);
    expect(t.input.value).toBe("10");
    t.input.focus();
    await t.type("");
    expect(t.input.value).toBe("");
    t.input.blur();
    await settle(t.editor);
    expect(t.input.value).toBe("10");
    expect(t.saved[t.saved.length - 1]!.floors![0].furniture[0].w).toBe(10);
  });
});
