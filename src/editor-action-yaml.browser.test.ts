import { afterEach, describe, expect, it } from "vitest";
import { LitElement } from "lit";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig } from "./types";

// HA's ha-yaml-editor: takes `defaultValue` once, then reports each parsed
// edit as `value-changed` with `{ value, isValid }`. The test plays the user.
class YamlEditor extends LitElement {
  static properties = { defaultValue: {} };
  defaultValue: unknown;
  edit(value: unknown, isValid = true) {
    this.dispatchEvent(new CustomEvent("value-changed", {
      detail: { value, isValid }, bubbles: true, composed: true,
    }));
  }
}
customElements.define("ha-yaml-editor", YamlEditor);

type Internals = { _selection: unknown[]; _selectionPage: string };

const root = (editor: FloorplanCardEditor) => editor.shadowRoot!;
const yaml = (editor: FloorplanCardEditor) => root(editor).querySelector<YamlEditor>("ha-yaml-editor");
const error = (editor: FloorplanCardEditor) => root(editor).querySelector(".action-yaml-error");

async function select(editor: FloorplanCardEditor, id: string) {
  (editor as unknown as Internals)._selection = [{ kind: "item", id }];
  await editor.updateComplete;
  (editor as unknown as Internals)._selectionPage = "actions";
  await editor.updateComplete;
}

async function mount() {
  const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  editor.style.width = "1300px";
  editor.setConfig({ type: "custom:easy-floorplan-card", width: 1000, height: 720,
    floors: [{ id: "floor", name: "Ground", walls: [], openings: [], texts: [], trackers: [], areas: [], furniture: [],
      items: [
        { id: "lamp", entity: "light.lamp", kind: "light", x: 200, y: 200 },
        { id: "fan", entity: "fan.ceiling", kind: "fan", x: 400, y: 200 },
      ] }],
  } as FloorplanCardConfig);
  document.body.append(editor);
  await select(editor, "lamp");
  const saved: FloorplanCardConfig[] = [];
  editor.addEventListener("config-changed", (event) => saved.push((event as CustomEvent).detail.config));
  return { editor, saved, item: (id: string) => saved[saved.length - 1]?.floors![0].items.find((i) => i.id === id) };
}

async function openCode(editor: FloorplanCardEditor) {
  const toggle = root(editor).querySelector<HTMLButtonElement>(".cfg-group-mode")!;
  expect(toggle.textContent).toContain("Show code editor");
  toggle.click();
  await editor.updateComplete;
  return toggle;
}

afterEach(() => { document.body.innerHTML = ""; });

describe("Behavior code editor (issue #314)", () => {
  it("swaps the action fields for ha-yaml-editor and back", async () => {
    const { editor } = await mount();
    expect(yaml(editor)).toBeNull();
    const toggle = await openCode(editor);
    expect(yaml(editor)).not.toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(toggle.textContent).toContain("Show visual editor");
    toggle.click();
    await editor.updateComplete;
    expect(yaml(editor)).toBeNull();
  });

  it("writes a valid edit to tap_action, extra keys included", async () => {
    const t = await mount();
    await openCode(t.editor);
    const action = { action: "fire-dom-event", browser_mod: { service: "browser_mod.popup" } };
    yaml(t.editor)!.edit({ tap_action: action });
    await t.editor.updateComplete;
    expect(t.item("lamp")?.tap_action).toEqual(action);
    expect(error(t.editor)).toBeNull();
  });

  it("leaves the config untouched when an edit is refused", async () => {
    const t = await mount();
    await openCode(t.editor);
    yaml(t.editor)!.edit({ bogus: 1 });
    await t.editor.updateComplete;
    expect(t.saved).toHaveLength(0);
    expect(error(t.editor)?.textContent).toContain("bogus");
    // A half-typed document HA could not parse is ignored outright.
    yaml(t.editor)!.edit(undefined, false);
    await t.editor.updateComplete;
    expect(t.saved).toHaveLength(0);
  });

  it("drops a stale error when another element is selected", async () => {
    const t = await mount();
    await openCode(t.editor);
    yaml(t.editor)!.edit({ bogus: 1 });
    await t.editor.updateComplete;
    expect(error(t.editor)).not.toBeNull();
    await select(t.editor, "fan");
    expect(yaml(t.editor)).not.toBeNull();
    expect(error(t.editor)).toBeNull();
  });
});
