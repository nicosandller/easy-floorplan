/**
 * A door, window or passage clicked down out of reach of every wall
 * (issue #428).
 *
 * The tool's hint promises the opening snaps onto the wall, but a click more
 * than the snap reach from any wall used to create it where it was clicked,
 * at angle 0, with no word said — and the 3D view drew it as a free-standing
 * leaf. Now nothing is placed, the tool stays active and the context bar says
 * why. Chromium, like the passage and skylight tests, because placement maps
 * the pointer through the SVG's live `getScreenCTM()`.
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
  const client = (x: number, y: number) => {
    const r = svg().getBoundingClientRect();
    return { cx: r.left + (x / 1000) * r.width, cy: r.top + (y / 600) * r.height };
  };

  return {
    ed,
    root,
    emitted,
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
    label: () => root.querySelector(".context-bar .ctx-label")?.textContent?.trim(),
    hint: () => root.querySelector(".context-bar .ctx-hint:not(.snap-hint)")?.textContent?.trim(),
    openings: () => (emitted[emitted.length - 1]?.floors![0].openings ?? []) as Opening[],
  };
}

describe("an opening clicked down away from every wall", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  for (const [label, type] of [
    ["Door", "door"],
    ["Window", "window"],
    ["Passage", "passage"],
  ] as const) {
    it(`places no ${type}, keeps the tool and says why`, async () => {
      const t = await mountEditor();
      await t.tool(label);
      // 100 units above the wall: well outside the 35-unit snap reach.
      await t.click(400, 200);

      expect(t.emitted).toHaveLength(0);
      expect(t.label()).toBe(label);
      expect(t.hint()).toBe(`No wall within reach there — click on a wall to drop a ${type}.`);
      expect(t.root.querySelector(".context-bar .ctx-hint.miss")).not.toBeNull();

      // The tool is still armed: the next click on the wall places it, and
      // the message goes with the placement.
      await t.click(400, 292);
      const [o] = t.openings();
      expect(o?.type).toBe(type);
      expect(o!.y).toBe(WALL.y1);
      expect(t.root.querySelector(".context-bar")?.textContent).not.toContain("No wall within reach");
      expect(t.root.querySelector(".context-bar .ctx-hint.miss")).toBeNull();
    });
  }

  it("drops the message when the tool changes", async () => {
    const t = await mountEditor();
    await t.tool("Door");
    await t.click(400, 200);
    expect(t.hint()).toContain("No wall within reach");

    await t.tool("Window");
    expect(t.hint()).toBe("Click on a wall to drop a window; it snaps onto the wall.");
    await t.tool("Door");
    expect(t.hint()).toBe("Click on a wall to drop a door; it snaps onto the wall.");
  });

  it("still picks up and drags a saved door that floats off the wall", async () => {
    // Plans saved before the fix can hold floating openings, and dragging one
    // off a wall leaves it floating: neither is the click that creates, so
    // both keep working as before.
    const floating = { id: "d1", type: "door", x: 200, y: 150, length: 60, angle: 0 } as Opening;
    const t = await mountEditor([floating]);
    const hit = t.root.querySelector(".opening-hit")!;
    const r = hit.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    pointer(hit, "pointerdown", cx, cy);
    await t.ed.updateComplete;
    // 60 plan units to the right, in a few frames like a hand would.
    const dx = t.client(260, 150).cx - t.client(200, 150).cx;
    for (let i = 1; i <= 4; i++) {
      pointer(hit, "pointermove", cx + (dx * i) / 4, cy);
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      await t.ed.updateComplete;
    }
    pointer(hit, "pointerup", cx + dx, cy);
    await t.ed.updateComplete;

    const [o] = t.openings();
    expect(o?.id).toBe("d1");
    expect(o!.x).toBeCloseTo(260, 0);
    expect(o!.y).toBeCloseTo(150, 0);
    expect(o!.angle).toBe(0);
  });
});
