/**
 * Placing and picking a passage, in a real browser (issue #309).
 *
 * A passage draws nothing on the card — the gap in the wall is the whole
 * symbol — so in the editor it is the one opening whose own drawing gives the
 * pointer nothing to land on. The editor-only mark is what makes it placeable
 * and selectable at all, and "can I click it again once it is placed" is a
 * question only a real hit test answers: Chromium, for the same reason as the
 * skylight and drag tests, since placement maps the pointer through the SVG's
 * live `getScreenCTM()`.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Opening } from "./types";

const WALL = { id: "w1", x1: 0, y1: 300, x2: 1000, y2: 300 };

function config(openings: Opening[] = []): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    grid: 20,
    snap: 0,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [WALL],
        openings,
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      pointerId: 5,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      composed: true,
      cancelable: true,
    })
  );
}

async function mountEditor(openings: Opening[] = []) {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config(openings));
  host.appendChild(ed);
  await ed.updateComplete;

  const root = ed.shadowRoot!;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });
  const svg = () => root.querySelector<SVGSVGElement>("svg")!;
  /** Plan coordinates to the client point the pointer would be at. */
  const client = (x: number, y: number) => {
    const r = svg().getBoundingClientRect();
    return { cx: r.left + (x / 1000) * r.width, cy: r.top + (y / 600) * r.height };
  };

  return {
    ed,
    root,
    client,
    async tool(label: string) {
      root.querySelector<HTMLButtonElement>(`button[title="${label}"]`)!.click();
      await ed.updateComplete;
    },
    async click(x: number, y: number) {
      const { cx, cy } = client(x, y);
      pointer(svg(), "pointerdown", cx, cy);
      pointer(svg(), "pointerup", cx, cy);
      await ed.updateComplete;
    },
    openings: () => (emitted[emitted.length - 1]?.floors![0].openings ?? []) as Opening[],
  };
}

describe("placing a passage", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("snaps onto the wall like a door, at the length set before placing", async () => {
    const t = await mountEditor();
    await t.tool("Passage");
    const length = t.root.querySelector<HTMLInputElement>(".context-bar input.num")!;
    length.value = "110";
    length.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    await t.click(400, 292);
    const [o] = t.openings();
    expect(o?.type).toBe("passage");
    expect(o!.y).toBe(WALL.y1);
    expect(o!.length).toBe(110);
  });

  it("can be picked up again, though the card draws nothing there", async () => {
    // Left of centre: the test page's viewport is narrower than the canvas,
    // and hit testing only sees what is on screen.
    const placed = { id: "arch", type: "passage", x: 200, y: 300, length: 100, angle: 0 } as Opening;
    const t = await mountEditor([placed]);
    // What is under the pointer in the middle of the gap is the editor's own
    // mark — without it, the floor.
    const { cx, cy } = t.client(200, 300);
    const hit = t.root.elementFromPoint(cx, cy);
    expect(hit?.classList.contains("passage-hit") || hit?.classList.contains("passage-mark")).toBe(true);

    // Pressed where a user would press: on whatever the hit test found.
    pointer(hit!, "pointerdown", cx, cy);
    pointer(hit!, "pointerup", cx, cy);
    await t.ed.updateComplete;
    expect(t.root.querySelector(".context-bar")?.textContent).toContain("1 selected");
    // Selected, the mark takes the selection colour as a door's symbol does.
    const mark = t.root.querySelector(".passage-mark")!;
    expect(mark.getAttribute("stroke")).toContain("--primary-color");
  });
});
