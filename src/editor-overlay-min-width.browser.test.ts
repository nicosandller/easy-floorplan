/**
 * overlayMinWidth in the real editor (PR #301 review).
 *
 * The node suite checks what projectDisplayForm produces. Two things it cannot
 * see are the editor's: whether the Display group's slice names the field, and
 * whether the canvas preview clamps --fp-u the way the card does.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig } from "./types";

function config(extra: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    overlayScale: "plan",
    overlayMinWidth: 800,
    floors: [
      { id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [], items: [] },
    ],
    ...extra,
  } as unknown as FloorplanCardConfig;
}

async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "500px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config(extra));
  host.appendChild(ed);
  await ed.updateComplete;
  const root = ed.shadowRoot!;
  return {
    ed,
    root,
    stageWidth: () => root.querySelector(".stage")!.getBoundingClientRect().width,
    /** A whole canvas width measured in --fp-u, as a badge inside .items would be. */
    unitWidth: () => {
      const probe = document.createElement("div");
      probe.style.cssText = "position:absolute; width: calc(var(--fp-u) * 1000)";
      root.querySelector(".stage .items")!.appendChild(probe);
      const w = probe.getBoundingClientRect().width;
      probe.remove();
      return w;
    },
  };
}

describe("overlayMinWidth in the editor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("previews the clamped unit on a canvas narrower than the minimum", async () => {
    const t = await mount();
    expect(t.stageWidth()).toBeLessThan(800);
    expect(t.unitWidth()).toBeCloseTo(800, 0);
  });

  it("previews normal scaling once the minimum is cleared", async () => {
    const t = await mount({ overlayMinWidth: undefined });
    expect(t.unitWidth()).toBeCloseTo(t.stageWidth(), 0);
  });

  it("shows the control under Project → View & scale", async () => {
    const t = await mount();
    // In the Project tab, under Display.
    const ed = t.ed as unknown as { _projectOpen: boolean; _projectPage: string };
    ed._projectOpen = true;
    ed._projectPage = "view";
    t.ed.requestUpdate();
    await t.ed.updateComplete;
    expect(t.root.textContent).toContain("Stop shrinking below");
  });
});
