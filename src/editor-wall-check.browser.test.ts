/**
 * The plan check on the editor canvas (issue #403), in a real browser.
 *
 * A wall end 4 units short of the next wall hides inside that wall's stroke.
 * The editor marks it and offers Join; Join must go through the normal
 * config-change path, so one Undo puts the gap back. A plan with nothing to
 * flag must render no marker and no notice at all.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Wall } from "./types";

const ROOM: Wall[] = [
  { id: "top", x1: 100, y1: 100, x2: 700, y2: 100 },
  { id: "right", x1: 700, y1: 100, x2: 700, y2: 500 },
  { id: "bottom", x1: 700, y1: 500, x2: 100, y2: 500 },
  { id: "left", x1: 100, y1: 500, x2: 100, y2: 100 },
];

function config(walls: Wall[]): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 800,
    height: 600,
    grid: 20,
    floors: [{
      id: "f1", name: "Floor 1", walls, openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [],
    }],
  };
}

async function mount(walls: Wall[]) {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config(walls));
  host.appendChild(ed);
  await ed.updateComplete;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });
  const root = ed.shadowRoot!;
  return { host, ed, root, emitted };
}

let mounted: HTMLElement | undefined;
afterEach(() => {
  mounted?.remove();
  mounted = undefined;
});

describe("editor plan check (#403)", () => {
  it("marks nothing on a plan without findings", async () => {
    const { host, root } = await mount([...ROOM, { id: "mid", x1: 100, y1: 300, x2: 700, y2: 300 }]);
    mounted = host;
    expect(root.querySelector(".wall-check")).toBeNull();
    expect(root.querySelector(".wall-check-bar")).toBeNull();
  });

  it("marks a near-miss, joins it, and undo restores the gap", async () => {
    const short: Wall = { id: "mid", x1: 100, y1: 300, x2: 696, y2: 300 };
    const { host, ed, root, emitted } = await mount([...ROOM, short]);
    mounted = host;

    const mark = root.querySelector<SVGCircleElement>(".wall-check-mark.current circle");
    expect(mark).not.toBeNull();
    expect([mark!.getAttribute("cx"), mark!.getAttribute("cy")]).toEqual(["696", "300"]);
    // Inert: it must not take the pointer from the wall underneath.
    expect(getComputedStyle(root.querySelector(".wall-check")!).pointerEvents).toBe("none");
    const bar = root.querySelector(".wall-check-bar")!;
    expect(bar.textContent).toContain("4 units short");

    bar.querySelector<HTMLButtonElement>(".wall-check-apply")!.click();
    await ed.updateComplete;
    const joined = emitted[emitted.length - 1]!.floors![0]!.walls.find((w) => w.id === "mid")!;
    expect([joined.x2, joined.y2]).toEqual([700, 300]);
    expect(root.querySelector(".wall-check")).toBeNull();
    expect(root.querySelector(".wall-check-bar")).toBeNull();

    root.querySelector<HTMLButtonElement>('button[aria-label="Undo"]')!.click();
    await ed.updateComplete;
    expect(emitted[emitted.length - 1]!.floors![0]!.walls.find((w) => w.id === "mid")).toEqual(short);
    expect(root.querySelector(".wall-check-bar")!.textContent).toContain("4 units short");
  });

  it("removes a duplicate wall in one step", async () => {
    const { host, ed, root, emitted } = await mount([...ROOM, { ...ROOM[0]!, id: "copy" }]);
    mounted = host;
    const apply = root.querySelector<HTMLButtonElement>(".wall-check-apply")!;
    expect(apply.textContent).toContain("Remove duplicate");
    apply.click();
    await ed.updateComplete;
    expect(emitted[emitted.length - 1]!.floors![0]!.walls.map((w) => w.id)).toEqual(ROOM.map((w) => w.id));
  });

  it("steps through several findings", async () => {
    const { host, ed, root } = await mount([
      ...ROOM,
      { id: "mid", x1: 100, y1: 300, x2: 696, y2: 300 },
      { ...ROOM[0]!, id: "copy" },
    ]);
    mounted = host;
    expect(root.querySelector(".wall-check-count")!.textContent).toBe("1 of 2");
    root.querySelector<HTMLButtonElement>('.wall-check-step[aria-label="Next plan check"]')!.click();
    await ed.updateComplete;
    expect(root.querySelector(".wall-check-count")!.textContent).toBe("2 of 2");
    expect(root.querySelector(".wall-check-apply")!.textContent).toContain("Remove duplicate");
    expect(root.querySelectorAll(".wall-check-mark")).toHaveLength(2);
  });
});
