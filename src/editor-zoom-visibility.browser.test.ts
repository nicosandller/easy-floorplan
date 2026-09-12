/**
 * "Only show when zoomed" surviving an unrelated edit, in the real editor
 * (issue #222).
 *
 * The node suite can check what `itemGroup7aForm.toPatch` returns, and does.
 * What it cannot check is the part that made the bug: the editor hands
 * `toPatch` only the keys that changed, and merges the result over the item
 * with a spread — so a key that is merely *present* and undefined erases what
 * the config had. Both halves are the editor's, so the whole chain has to run
 * for the test to mean anything.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorItem, FloorplanCardConfig } from "./types";

function config(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
        items: [
          { id: "i1", x: 300, y: 250, entity: "sensor.a", kind: "sensor", showOnlyWhenZoomed: true },
        ],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

async function mountWithItemSelected() {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config());
  host.appendChild(ed);
  await ed.updateComplete;

  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });

  // Selecting on the canvas is a drag test's job; this one is about the form.
  (ed as unknown as { _selection: unknown[] })._selection = [{ kind: "item", id: "i1" }];
  ed.requestUpdate();
  await ed.updateComplete;

  const root = () => ed.shadowRoot!;
  const group = [...root().querySelectorAll<HTMLButtonElement>("button.cfg-group-title")].find(
    (b) => b.textContent?.trim().startsWith("Visibility")
  )!;
  group.click();
  await ed.updateComplete;

  return {
    ed,
    emitted,
    /** The fallback checkbox for a field, by the label it is drawn under. */
    async toggle(label: string) {
      const box = [...root().querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
        (i) => i.closest("label,div")?.textContent?.trim().startsWith(label)
      )!;
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change", { bubbles: true }));
      await ed.updateComplete;
    },
    item: () => emitted[emitted.length - 1]!.floors![0]!.items[0] as FloorItem,
  };
}

describe("editing one visibility field does not disturb the others", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps showOnlyWhenZoomed when a different field in the group changes", async () => {
    // Group 7a holds two dozen fields. Pruning the flag on every patch rather
    // than only on its own meant switching on "Hide by condition" silently
    // switched "Only show when zoomed" back off, with nothing on screen saying
    // so — the device simply reappeared at full zoom.
    const t = await mountWithItemSelected();
    await t.toggle("Hide by condition");
    expect(t.emitted.length).toBeGreaterThan(0);
    expect(t.item().enableHideByEntity).toBe(true);
    expect(t.item().showOnlyWhenZoomed).toBe(true);
  });

  it("still turns it off when it is the field being toggled", async () => {
    const t = await mountWithItemSelected();
    await t.toggle("Only show when zoomed");
    expect(t.item().showOnlyWhenZoomed).toBeUndefined();
  });
});
