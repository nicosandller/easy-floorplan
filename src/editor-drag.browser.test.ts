/**
 * Editor gesture wiring, in a real browser.
 *
 * These tests exist because the node suite cannot see this code: a drag maps
 * pointer positions through the SVG's live `getScreenCTM()`, and a DOM shim
 * either lacks that method (jsdom) or returns the identity matrix from a
 * canvas that can never scroll (happy-dom). Either way a regression test for
 * a CTM bug would pass against the bug. So: real Chromium, real layout, real
 * scrolling (issue #233).
 *
 * The pointer events are synthetic — dispatched from the page, not sent by a
 * mouse — because the bugs under test do not depend on where an event comes
 * from, only on when its coordinates are resolved. Dispatching from the page
 * also lets a test scroll *between* a move and the frame that applies it,
 * which a real pointer could not time.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import { signedArea } from "./dead-space";
import type { FloorplanCardConfig } from "./types";

const ITEM_START = { x: 300, y: 200 };

function config(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    grid: 20,
    // Free placement, so a drag lands exactly where the pointer maps to and
    // the assertions need no snapping arithmetic.
    snap: 0,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [{ id: "lamp", kind: "light", entity: "light.lamp", ...ITEM_START }],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

const POINTER_ID = 7;

function pointer(
  target: Element,
  type: string,
  clientX: number,
  clientY: number,
  detail = 1
): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      pointerId: POINTER_ID,
      pointerType: "mouse",
      isPrimary: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      bubbles: true,
      composed: true,
      cancelable: true,
      detail,
    })
  );
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function expectAxisAligned(points: Array<{ x: number; y: number }>): void {
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    const dx = Math.abs(a.x - b.x);
    const dy = Math.abs(a.y - b.y);
    expect(dx < 1e-6 || dy < 1e-6).toBe(true);
  }
}

function expectFloorplanRectilinear(areas: Array<{ points: Array<{ x: number; y: number }> }>): void {
  for (const area of areas) {
    expectAxisAligned(area.points);
  }
}

function expectAreaRectangular(points: Array<{ x: number; y: number }>): void {
  expect(points).toHaveLength(4);
  expectAxisAligned(points);
}

function expectSharedWall(
  areaA: { points: Array<{ x: number; y: number }> },
  sideA: "left" | "right" | "top" | "bottom",
  areaB: { points: Array<{ x: number; y: number }> },
  sideB: "left" | "right" | "top" | "bottom"
): void {
  expect(boundaryValue(areaA.points, sideA)).toBeCloseTo(boundaryValue(areaB.points, sideB), 6);
}

function expectPolygonGeometry(points: Array<{ x: number; y: number }>): void {
  expect(points.length).toBeGreaterThanOrEqual(4);
  expectAxisAligned(points);
}

function boundaryValue(points: Array<{ x: number; y: number }>, side: "left" | "right" | "top" | "bottom"): number {
  if (side === "left") return Math.min(...points.map((p) => p.x));
  if (side === "right") return Math.max(...points.map((p) => p.x));
  if (side === "top") return Math.min(...points.map((p) => p.y));
  return Math.max(...points.map((p) => p.y));
}

function findAreaEdge(
  ed: FloorplanCardEditor,
  areaId: string,
  side: "left" | "right" | "top" | "bottom",
  near?: { x: number; y: number }
): SVGLineElement {
  const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")].filter(
    (edge) => edge.dataset.areaId === areaId && edge.dataset.edgeSide === side
  );
  if (!edges.length) throw new Error(`No edge found for ${areaId}:${side}`);
  if (!near || edges.length === 1) return edges[0]!;
  return edges
    .map((edge) => ({ edge, mid: center(edge) }))
    .sort((a, b) => Math.hypot(a.mid.x - near.x, a.mid.y - near.y) - Math.hypot(b.mid.x - near.x, b.mid.y - near.y))[0]!
    .edge;
}

function oppositeSide(side: "left" | "right" | "top" | "bottom"): "left" | "right" | "top" | "bottom" {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  return "top";
}

function rotateCW(
  p: { x: number; y: number },
  turns: 0 | 1 | 2 | 3
): { x: number; y: number } {
  if (turns === 0) return { ...p };
  if (turns === 1) return { x: p.y, y: -p.x };
  if (turns === 2) return { x: -p.x, y: -p.y };
  return { x: -p.y, y: p.x };
}

function rotateSideCW(
  side: "left" | "right" | "top" | "bottom",
  turns: 0 | 1 | 2 | 3
): "left" | "right" | "top" | "bottom" {
  const map = {
    top: "left",
    left: "bottom",
    bottom: "right",
    right: "top",
  } as const;
  let out = side;
  for (let i = 0; i < turns; i++) out = map[out];
  return out;
}

function screenPoint(svg: SVGSVGElement, x: number, y: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM()!;
  return { x: ctm.e + ctm.a * x, y: ctm.f + ctm.d * y };
}

async function mountEditor() {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  // The editor only reads `states` and `entities` off hass; nothing here binds
  // an entity, so empty registries are enough.
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config());
  host.appendChild(ed);
  await ed.updateComplete;

  const root = ed.shadowRoot!;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });

  return {
    ed,
    host,
    emitted,
    wrap: root.querySelector<HTMLElement>(".canvas-wrap")!,
    svg: root.querySelector<SVGSVGElement>("svg")!,
    item: () => root.querySelector<HTMLElement>(".edit-item")!,
    async zoomIn(times: number) {
      const btn = root.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]')!;
      for (let i = 0; i < times; i++) btn.click();
      await ed.updateComplete;
    },
  };
}

function itemPosition(cfg: FloorplanCardConfig): { x: number; y: number } {
  const it = cfg.floors![0].items[0];
  return { x: it.x, y: it.y };
}

describe("editor drag", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves a queued move against the CTM at queue time, not at frame time", async () => {
    const t = await mountEditor();
    // Zoom until the stage overflows the wrap, so the wrap can scroll. The
    // scroll amount below is the one from #232's review: 150px mid-drag.
    await t.zoomIn(3);
    const scrollable = t.wrap.scrollHeight - t.wrap.clientHeight;
    // If this fails the harness is wrong, not the editor — a canvas that
    // cannot scroll cannot reproduce the bug, and the test would pass vacuously.
    expect(scrollable).toBeGreaterThanOrEqual(150);

    const ctm = t.svg.getScreenCTM()!;
    const from = center(t.item());
    const movePx = { x: 40, y: 30 };
    const expected = {
      x: ITEM_START.x + movePx.x / ctm.a,
      y: ITEM_START.y + movePx.y / ctm.d,
    };

    pointer(t.item(), "pointerdown", from.x, from.y);
    pointer(t.item(), "pointermove", from.x + movePx.x, from.y + movePx.y);
    // The move is queued for the next animation frame. Scroll before that
    // frame runs: the SVG's screen CTM now differs from the one the move was
    // reported against.
    const before = t.wrap.scrollTop;
    t.wrap.scrollTop = before + 150;
    expect(t.wrap.scrollTop - before).toBe(150);

    await frame();
    await frame();
    await t.ed.updateComplete;
    pointer(t.item(), "pointerup", from.x + movePx.x, from.y + movePx.y);

    expect(t.emitted).toHaveLength(1);
    const pos = itemPosition(t.emitted[0]);
    expect(pos.x).toBeCloseTo(expected.x, 0);
    expect(pos.y).toBeCloseTo(expected.y, 0);
  });

  it("does not tell the host anything while the drag is live", async () => {
    const t = await mountEditor();
    const from = center(t.item());

    pointer(t.item(), "pointerdown", from.x, from.y);
    for (let i = 1; i <= 5; i++) {
      pointer(t.item(), "pointermove", from.x + 10 * i, from.y + 8 * i);
      await frame();
      await t.ed.updateComplete;
    }

    expect(t.emitted).toHaveLength(0);
    // The canvas itself did follow the pointer — the host is the only thing
    // kept waiting.
    const drawn = center(t.item());
    expect(drawn.x).toBeCloseTo(from.x + 50, 0);
    expect(drawn.y).toBeCloseTo(from.y + 40, 0);
  });

  it("emits one config-changed per gesture, on release, at the final position", async () => {
    const t = await mountEditor();
    const ctm = t.svg.getScreenCTM()!;
    const from = center(t.item());

    pointer(t.item(), "pointerdown", from.x, from.y);
    for (let i = 1; i <= 5; i++) {
      pointer(t.item(), "pointermove", from.x + 10 * i, from.y + 8 * i);
      await frame();
      await t.ed.updateComplete;
    }
    pointer(t.item(), "pointerup", from.x + 50, from.y + 40);

    expect(t.emitted).toHaveLength(1);
    const pos = itemPosition(t.emitted[0]);
    expect(pos.x).toBeCloseTo(ITEM_START.x + 50 / ctm.a, 0);
    expect(pos.y).toBeCloseTo(ITEM_START.y + 40 / ctm.d, 0);
  });

  it("keeps a click on Area as a polygon vertex", async () => {
    const t = await mountEditor();
    t.ed.shadowRoot!.querySelector<HTMLButtonElement>('button[title="Area"]')!.click();
    await t.ed.updateComplete;

    const first = screenPoint(t.svg, 100, 100);
    pointer(t.svg, "pointerdown", first.x, first.y);
    pointer(t.svg, "pointerup", first.x, first.y);
    await t.ed.updateComplete;

    expect((t.ed as any)._floor().areas).toEqual([]);
    expect((t.ed as any)._draftArea.points[0].x).toBeCloseTo(100);
    expect((t.ed as any)._draftArea.points[0].y).toBeCloseTo(100);
  });

  it("shows the polygon edge from the last point to the moving cursor", async () => {
    const t = await mountEditor();
    t.ed.shadowRoot!.querySelector<HTMLButtonElement>('button[title="Area"]')!.click();
    await t.ed.updateComplete;

    const first = screenPoint(t.svg, 100, 100);
    const cursor = screenPoint(t.svg, 180, 140);
    pointer(t.svg, "pointerdown", first.x, first.y);
    pointer(t.svg, "pointerup", first.x, first.y);
    pointer(t.svg, "pointermove", cursor.x, cursor.y);
    await t.ed.updateComplete;

    expect(t.ed.shadowRoot!.querySelector(".area-draft-hover")).not.toBeNull();
  });

  it("stays in polygon mode when dragging after the first Area click", async () => {
    const t = await mountEditor();
    t.ed.shadowRoot!.querySelector<HTMLButtonElement>('button[title="Area"]')!.click();
    await t.ed.updateComplete;

    const first = screenPoint(t.svg, 100, 100);
    const second = screenPoint(t.svg, 240, 220);
    pointer(t.svg, "pointerdown", first.x, first.y);
    pointer(t.svg, "pointerup", first.x, first.y);
    pointer(t.svg, "pointerdown", second.x, second.y);
    pointer(t.svg, "pointermove", second.x + 80, second.y + 80);
    await delay(220);
    pointer(t.svg, "pointerup", second.x + 80, second.y + 80);
    await t.ed.updateComplete;

    expect((t.ed as any)._floor().areas).toEqual([]);
    expect((t.ed as any)._draftArea.points).toHaveLength(2);
    expect((t.ed as any)._tool).toBe("area");
  });

  it("turns an Area press-drag into a rectangle instead of a polygon point", async () => {
    const t = await mountEditor();
    t.ed.shadowRoot!.querySelector<HTMLButtonElement>('button[title="Area"]')!.click();
    await t.ed.updateComplete;

    const start = screenPoint(t.svg, 100, 100);
    const end = screenPoint(t.svg, 240, 220);
    pointer(t.svg, "pointerdown", start.x, start.y);
    pointer(t.svg, "pointermove", end.x, end.y);
    await frame();
    await t.ed.updateComplete;
    expect((t.ed as any)._draftArea).toBeNull();
    await delay(220);
    await t.ed.updateComplete;
    expect((t.ed as any)._draftArea).not.toBeNull();
    const final = screenPoint(t.svg, 260, 240);
    pointer(t.svg, "pointermove", final.x, final.y);
    await t.ed.updateComplete;
    pointer(t.svg, "pointerup", final.x, final.y);
    await t.ed.updateComplete;

    const points = (t.ed as any)._floor().areas[0].points;
    expect(points).toHaveLength(4);
    expect(points[0].x).toBeCloseTo(100);
    expect(points[0].y).toBeCloseTo(100);
    expect(points[1].x).toBeCloseTo(260);
    expect(points[1].y).toBeCloseTo(100);
    expect(points[2].x).toBeCloseTo(260);
    expect(points[2].y).toBeCloseTo(240);
    expect(points[3].x).toBeCloseTo(100);
    expect(points[3].y).toBeCloseTo(240);
    expect((t.ed as any)._draftArea).toBeNull();
    expect((t.ed as any)._tool).toBe("select");
  });

  it("keeps a sub-slop jitter on Area a polygon vertex, not an (empty) rectangle", async () => {
    const t = await mountEditor();
    t.ed.shadowRoot!.querySelector<HTMLButtonElement>('button[title="Area"]')!.click();
    await t.ed.updateComplete;

    const start = screenPoint(t.svg, 100, 100);
    // Moves under DRAG_SLOP (4) — the jitter a real press produces — must not
    // arm the rectangle hold-timer, even when the pointer then holds still.
    const wobble = screenPoint(t.svg, 102, 101);
    pointer(t.svg, "pointerdown", start.x, start.y);
    pointer(t.svg, "pointermove", wobble.x, wobble.y);
    await delay(220);
    pointer(t.svg, "pointerup", wobble.x, wobble.y);
    await t.ed.updateComplete;

    // Still a click, so still polygon mode with one vertex placed — not a
    // (tiny) committed rectangle and a flip back to the Select tool.
    expect((t.ed as any)._floor().areas).toEqual([]);
    expect((t.ed as any)._draftArea?.points).toHaveLength(1);
    expect((t.ed as any)._tool).toBe("area");
  });

  it("drags a rectangle room corner handle", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const [corner] = ed.shadowRoot!.querySelectorAll<SVGCircleElement>("circle.handle");
    expect(corner).toBeTruthy();

    const from = center(corner!);
    const to = screenPoint(ed.shadowRoot!.querySelector("svg")!, 70, 70);

    pointer(corner!, "pointerdown", from.x, from.y);
    pointer(corner!, "pointermove", to.x, to.y);
    await frame();
    await ed.updateComplete;
    pointer(corner!, "pointerup", to.x, to.y);
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 70, y: 70 },
      { x: 200, y: 70 },
      { x: 200, y: 200 },
      { x: 70, y: 200 },
    ]);
    document.body.innerHTML = "";
  });

  it("drags a plain polygon room corner handle", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 220, y: 100 },
                { x: 220, y: 220 },
                { x: 150, y: 150 },
                { x: 100, y: 220 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const [corner] = ed.shadowRoot!.querySelectorAll<SVGCircleElement>("circle.handle");
    expect(corner).toBeTruthy();

    const from = center(corner!);
    const to = screenPoint(ed.shadowRoot!.querySelector("svg")!, 40, 60);

    pointer(corner!, "pointerdown", from.x, from.y);
    pointer(corner!, "pointermove", to.x, to.y);
    await frame();
    await ed.updateComplete;
    pointer(corner!, "pointerup", to.x, to.y);
    await ed.updateComplete;

    const moved = (ed as any)._floor().areas[0].points[0];
    expect(moved.x).toBeCloseTo(40, 5);
    expect(moved.y).toBeCloseTo(60, 5);
    expect((ed as any)._floor().areas[0].points.slice(1)).toEqual([
      { x: 220, y: 100 },
      { x: 220, y: 220 },
      { x: 150, y: 150 },
      { x: 100, y: 220 },
    ]);
    document.body.innerHTML = "";
  });

  it("rejects a corner resize that collapses a rectangle without moving the coupled neighbour", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "room2",
              points: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    // Corner 1 (top-right, 200,100) shares side "right" with room2. Drag it
    // onto the opposite corner (100,200) — the resize collapses, so the whole
    // move is rejected: room2 must not be left displaced against a primary
    // that snapped back to its old edge.
    const corner = ed.shadowRoot!.querySelectorAll<SVGCircleElement>("circle.handle")[1];
    expect(corner).toBeTruthy();
    const from = center(corner!);
    const to = screenPoint(ed.shadowRoot!.querySelector("svg")!, 100, 200);
    pointer(corner!, "pointerdown", from.x, from.y);
    pointer(corner!, "pointermove", to.x, to.y);
    await frame();
    await ed.updateComplete;
    pointer(corner!, "pointerup", to.x, to.y);
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
    ]);
    expect((ed as any)._floor().areas[1].points).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 200, y: 200 },
    ]);
    document.body.innerHTML = "";
  });

  it("drags and toggles a selected area's edge segment away from the endpoints", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const edge = ed.shadowRoot!.querySelector<SVGLineElement>(".area-edge-hit")!;
    expect(edge).not.toBeNull();

    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x, from.y + 40);
    pointer(edge, "pointerup", from.x, from.y + 40);
    await ed.updateComplete;

    const areaAfterDrag = (ed as any)._floor().areas[0];
    expect(areaAfterDrag.points[0].y).toBeGreaterThan(100);

    edge.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].sideWalls?.top).toBe("wall");
    document.body.innerHTML = "";
  });

  it("toggles the same edge through wall → divider → none from a segment hit, not only a midpoint", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const [edgeTop] = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    expect(edgeTop).toBeTruthy();
    edgeTop!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.top).toBe("wall");

    edgeTop!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.top).toBe("divider");

    edgeTop!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;
    expect((ed as any)._floor().areas[0].sideWalls?.top).toBeUndefined();

    document.body.innerHTML = "";
  });

  it("double-clicking an edge renders a visible generated side wall, not only a stored state", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const [edgeTop] = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    expect(edgeTop).toBeTruthy();
    edgeTop!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].sideWalls?.top).toBe("wall");
    expect(ed.shadowRoot!.querySelectorAll(".wall-hit.side-wall-edge").length).toBeGreaterThan(0);
    expect(ed.shadowRoot!.querySelector(".wall.side-wall-edge")).not.toBeNull();

    document.body.innerHTML = "";
  });

  it("marks a rectilinear polygon edge midpoint with the active wall state instead of leaving it white", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
                { x: 200, y: 300 },
                { x: 100, y: 300 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const topEdge = Array.from(ed.shadowRoot!.querySelectorAll<SVGCircleElement>(".area-edge-handle")).find((handle) => {
      const side = handle.getAttribute("data-edge-side");
      return side === "top";
    });
    expect(topEdge).toBeTruthy();

    topEdge!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, composed: true, cancelable: true }));
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].sideWalls?.top).toBe("wall");
    expect(topEdge!.classList.contains("wall")).toBe(true);
    expect(topEdge!.classList.contains("divider")).toBe(false);

    document.body.innerHTML = "";
  });

  it("ctrl-clicking an edge turns it into a wall segment without replacing the rest of the edge", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
              sideWalls: { top: [{ start: 0, end: 0.5, state: "wall" }] },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const edgeTop = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")[0]!;
    edgeTop.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, ctrlKey: true })
    );
    await ed.updateComplete;

    const sideWalls = (ed as any)._floor().areas[0].sideWalls?.top;
    expect(Array.isArray(sideWalls)).toBe(true);
    expect(sideWalls).toEqual([
      { start: 0, end: 0.5, state: "wall" },
      { start: 0.5, end: 1, state: "wall" },
    ]);

    document.body.innerHTML = "";
  });

  it("shift-clicking an edge with an existing wall converts it to a movable segment instead of joining", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
              sideWalls: { top: "wall" },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const edgeTop = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")[0]!;
    const box = edgeTop.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    edgeTop.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        shiftKey: true,
        clientX: x,
        clientY: y,
      })
    );
    await ed.updateComplete;

    const sideWalls = (ed as any)._floor().areas[0].sideWalls?.top;
    expect(Array.isArray(sideWalls)).toBe(true);
    expect(sideWalls).toHaveLength(1);
    expect(sideWalls[0].state).toBe("wall");
    expect(sideWalls[0].start).toBeGreaterThan(0);
    expect(sideWalls[0].end).toBeLessThan(1);

    document.body.innerHTML = "";
  });

  it("double-clicking an uncovered part of a segmented edge adds another wall segment", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
              sideWalls: {
                top: [{ start: 0.4, end: 0.6, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    const edgeTop = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")[0]!;
    const box = edgeTop.getBoundingClientRect();
    const leftX = box.left + box.width * 0.1;
    const y = box.top + box.height / 2;
    edgeTop.dispatchEvent(
      new MouseEvent("dblclick", {
        bubbles: true,
        composed: true,
        cancelable: true,
        clientX: leftX,
        clientY: y,
      })
    );
    await ed.updateComplete;

    const sideWalls = (ed as any)._floor().areas[0].sideWalls?.top;
    expect(Array.isArray(sideWalls)).toBe(true);
    expect(sideWalls.length).toBeGreaterThanOrEqual(2);
    expect(sideWalls.every((segment: any) => segment.state === "wall" || segment.state === "divider")).toBe(true);
    expect(sideWalls.some((segment: any) => segment.start < 0.2)).toBe(true);
    expect(sideWalls.some((segment: any) => segment.start > 0.35 && segment.end < 0.65)).toBe(true);

    document.body.innerHTML = "";
  });

  it("ctrl-click locks a polygon side-wall segment into a persistent wall selection and delete removes it", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
                { x: 200, y: 300 },
                { x: 100, y: 300 },
              ],
              sideWalls: {
                top: [{ start: 0.2, end: 0.4, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    (ed as any)._areaEdgeModifier = "split";
    await ed.updateComplete;

    const segmentWall = ed.shadowRoot!.querySelector<SVGLineElement>(".wall-hit.side-wall-edge");
    expect(segmentWall).toBeTruthy();

    const wallCenter = center(segmentWall!);
    segmentWall!.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        composed: true,
        cancelable: true,
        ctrlKey: true,
        clientX: wallCenter.x,
        clientY: wallCenter.y,
      })
    );
    await ed.updateComplete;

    expect((ed as any)._selectedWallSegment).toEqual({ areaId: "room1", side: "top", edgeIndex: 0, segmentIndex: 0 });

    const before = (ed as any)._floor().areas[0].sideWalls.top[0];
    const from = wallCenter;
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: from.x,
        clientY: from.y,
      })
    );
    segmentWall!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await frame();
    await ed.updateComplete;
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await ed.updateComplete;

    const afterDrag = (ed as any)._floor().areas[0].sideWalls.top[0];
    expect(afterDrag.start).toBeGreaterThan(before.start);
    expect(afterDrag.end).toBeGreaterThan(before.end);

    ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, composed: true }));
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].sideWalls?.top).toBeUndefined();

    document.body.innerHTML = "";
  });

  it("delete key removes a wall-only selected generated wall segment without requiring a room selection", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
                { x: 200, y: 300 },
                { x: 100, y: 300 },
              ],
              sideWalls: {
                top: [{ start: 0.2, end: 0.4, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [];
    (ed as any)._selectedWallSegment = { areaId: "room1", side: "top", edgeIndex: 0, segmentIndex: 0 };
    await ed.updateComplete;

    ed.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, composed: true }));
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].sideWalls?.top).toBeUndefined();
    expect((ed as any)._selectedWallSegment).toBeNull();

    document.body.innerHTML = "";
  });

  it("ctrl/shift dragging a side-wall segment moves the whole segment along the same edge", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
              sideWalls: {
                top: [{ start: 0.2, end: 0.4, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    (ed as any)._areaEdgeModifier = "split";
    await ed.updateComplete;

    const before = (ed as any)._floor().areas[0].sideWalls.top[0];
    const segmentWall = ed.shadowRoot!.querySelector<SVGLineElement>(".wall-hit.side-wall-edge");
    expect(segmentWall).toBeTruthy();

    const from = center(segmentWall!);
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: from.x,
        clientY: from.y,
      })
    );
    segmentWall!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await frame();
    await ed.updateComplete;
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        shiftKey: true,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await ed.updateComplete;

    const after = (ed as any)._floor().areas[0].sideWalls.top[0];
    expect(after.start).toBeGreaterThan(before.start);
    expect(after.end).toBeGreaterThan(before.end);
    expect(after.end - after.start).toBeCloseTo(before.end - before.start, 3);

    document.body.innerHTML = "";
  });

  it("ctrl/shift dragging a polygon side-wall segment moves the whole segment along the same edge", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
                { x: 200, y: 300 },
                { x: 100, y: 300 },
              ],
              sideWalls: {
                top: [{ start: 0.2, end: 0.4, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    (ed as any)._areaEdgeModifier = "split";
    await ed.updateComplete;

    const before = (ed as any)._floor().areas[0].sideWalls.top[0];
    const segmentWall = ed.shadowRoot!.querySelector<SVGLineElement>(".wall-hit.side-wall-edge");
    expect(segmentWall).toBeTruthy();

    const from = center(segmentWall!);
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: from.x,
        clientY: from.y,
      })
    );
    segmentWall!.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        shiftKey: true,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await frame();
    await ed.updateComplete;
    segmentWall!.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        shiftKey: true,
        clientX: from.x + 24,
        clientY: from.y,
      })
    );
    await ed.updateComplete;

    const after = (ed as any)._floor().areas[0].sideWalls.top[0];
    expect(after.start).toBeGreaterThan(before.start);
    expect(after.end).toBeGreaterThan(before.end);
    expect(after.end - after.start).toBeCloseTo(before.end - before.start, 3);

    document.body.innerHTML = "";
  });

  it("ctrl/shift dragging a side-wall segment endpoint moves just that endpoint along the edge", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
              sideWalls: {
                top: [{ start: 0.3, end: 0.6, state: "wall" }],
              },
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    (ed as any)._areaEdgeModifier = "split";
    await ed.updateComplete;

    const before = (ed as any)._floor().areas[0].sideWalls.top[0];
    const handles = [...ed.shadowRoot!.querySelectorAll<SVGCircleElement>(".side-wall-segment-handle")];
    expect(handles).toHaveLength(2);
    const first = handles.sort((a, b) => Number(a.getAttribute("cx")) - Number(b.getAttribute("cx")))[0]!;
    const from = center(first);

    first.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        ctrlKey: true,
        clientX: from.x,
        clientY: from.y,
      })
    );
    first.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 1,
        ctrlKey: true,
        clientX: from.x - 18,
        clientY: from.y,
      })
    );
    await frame();
    await ed.updateComplete;
    first.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        composed: true,
        cancelable: true,
        pointerId: POINTER_ID,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: 0,
        ctrlKey: true,
        clientX: from.x - 18,
        clientY: from.y,
      })
    );
    await ed.updateComplete;

    const after = (ed as any)._floor().areas[0].sideWalls.top[0];
    expect(after.start).toBeLessThan(before.start);
    expect(after.end).toBeCloseTo(before.end, 2);
    expect(after.start).toBeGreaterThanOrEqual(0);

    document.body.innerHTML = "";
  });

  it("shift-clicking a shared edge between matching rectangles joins them into one rectilinear polygon", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    await ed.updateComplete;

    const edges = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    const shared = [...edges].find((el) => Number.parseFloat(el.getAttribute("x1") ?? "0") >= 20) ?? edges[0];
    shared.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, shiftKey: true })
    );
    await ed.updateComplete;

    expect((ed as any)._floor().areas).toHaveLength(1);
    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ]);

    document.body.innerHTML = "";
  });

  it("shift-clicking a shared edge still joins when the selected room is on the right", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "right" }];
    await ed.updateComplete;

    const edges = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    const shared = [...edges].find((el) => Number.parseFloat(el.getAttribute("x1") ?? "0") <= 20) ?? edges[0];
    shared.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, shiftKey: true })
    );
    await ed.updateComplete;

    expect((ed as any)._floor().areas).toHaveLength(1);
    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ]);

    document.body.innerHTML = "";
  });

  it("joins on a partial shared edge and keeps the merged shape as a rectilinear L shape", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 10 },
                { x: 0, y: 10 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 5 },
                { x: 40, y: 5 },
                { x: 40, y: 15 },
                { x: 20, y: 15 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    await ed.updateComplete;

    const edges = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    const shared = [...edges].find((el) => el.dataset.edgeSide === "right") ?? edges[0];
    shared.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, shiftKey: true })
    );
    await ed.updateComplete;

    expect((ed as any)._floor().areas).toHaveLength(1);
    expect(Math.abs(signedArea((ed as any)._floor().areas[0].points))).toBeGreaterThan(0);
    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 5 },
      { x: 40, y: 5 },
      { x: 40, y: 15 },
      { x: 20, y: 15 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ]);

    document.body.innerHTML = "";
  });

  it("prefers the actual shared-side match when the chosen area is on the right side of the pair", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "right" }];
    await ed.updateComplete;

    const right = (ed as any)._floor().areas.find((area: any) => area.id === "right");
    expect(right).toBeTruthy();

    (ed as any)._mergeRectAreaSide(right, 3);
    await ed.updateComplete;

    expect((ed as any)._floor().areas).toHaveLength(1);
    expect((ed as any)._floor().areas[0].id).toBe("right");
    expect((ed as any)._floor().areas[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 0, y: 20 },
    ]);

    document.body.innerHTML = "";
  });

  it("shows a ready join cursor on the shared left edge when the selected room is on the right", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "right" }];
    (ed as any)._areaEdgeModifier = "join";
    await ed.updateComplete;

    const right = (ed as any)._floor().areas.find((area: any) => area.id === "right");
    expect((ed as any)._rectAreaEdgeModifierClass(right, 3)).toBe("modifier-ready");

    const leftEdge = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")].find(
      (el) => el.dataset.edgeSide === "left"
    );
    expect(leftEdge).toBeTruthy();
    expect(leftEdge?.classList.contains("modifier-ready")).toBe(true);

    document.body.innerHTML = "";
  });

  it("shows a ready join cursor when a rectangle borders a rectilinear polygon edge", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "rectangle",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "polygon",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 30, y: 20 },
                { x: 30, y: 10 },
                { x: 20, y: 10 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "rectangle" }];
    (ed as any)._areaEdgeModifier = "join";
    await ed.updateComplete;

    const rectangle = (ed as any)._floor().areas.find((area: any) => area.id === "rectangle");
    expect((ed as any)._rectAreaEdgeModifierClass(rectangle, 1)).toBe("modifier-ready");

    document.body.innerHTML = "";
  });

  it("keeps a merged rectilinear polygon edge drag aligned after the join", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    await ed.updateComplete;

    const edges = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    const shared = [...edges].find((el) => Number.parseFloat(el.getAttribute("x1") ?? "0") >= 20) ?? edges[0];
    shared.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, cancelable: true, shiftKey: true })
    );
    await ed.updateComplete;

    const merged = (ed as any)._floor().areas[0];
    (ed as any)._selection = [{ kind: "area", id: merged.id }];
    await ed.updateComplete;

    const dragEdge = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")[0]!;
    const from = center(dragEdge);
    pointer(dragEdge, "pointerdown", from.x, from.y);
    pointer(dragEdge, "pointermove", from.x, from.y + 15);
    pointer(dragEdge, "pointerup", from.x, from.y + 15);
    await ed.updateComplete;

    const moved = (ed as any)._floor().areas[0].points;
    expect(moved.some((p: { x: number; y: number }) => p.y >= 20)).toBe(true);
    expect(moved[0].x).toBeLessThanOrEqual(40);

    document.body.innerHTML = "";
  });

  it("drags only the selected wall segment of an L-shaped room, not every collinear edge on that axis", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 5 },
                { x: 40, y: 5 },
                { x: 40, y: 15 },
                { x: 20, y: 15 },
                { x: 20, y: 10 },
                { x: 0, y: 10 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room" }];
    await ed.updateComplete;

    const edge = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")].find(
      (el) =>
        Number.parseFloat(el.getAttribute("x1") ?? "") === 40 &&
        Number.parseFloat(el.getAttribute("y1") ?? "") === 15 &&
        Number.parseFloat(el.getAttribute("x2") ?? "") === 20 &&
        Number.parseFloat(el.getAttribute("y2") ?? "") === 15
    )!;
    expect(edge).toBeTruthy();

    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x, from.y + 20);
    pointer(edge, "pointerup", from.x, from.y + 20);
    await ed.updateComplete;

    const points = (ed as any)._floor().areas[0].points;
    expect(points).toHaveLength(8);
    expect(points[4]).toMatchObject({ x: 40, y: expect.any(Number) });
    expect(points[5]).toMatchObject({ x: 20, y: expect.any(Number) });
    expect(points[4].y).toBeGreaterThan(15);
    expect(points[5].y).toBeGreaterThan(15);
    expect(points[2]).toMatchObject({ x: 20, y: 5 });
    expect(points[6]).toMatchObject({ x: 20, y: 10 });

    document.body.innerHTML = "";
  });

  it("shows valid and invalid join cursors while the shift modifier is active", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              haArea: "shared",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "right",
              haArea: "shared",
              points: [
                { x: 20, y: 0 },
                { x: 40, y: 0 },
                { x: 40, y: 20 },
                { x: 20, y: 20 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    window.dispatchEvent(new KeyboardEvent("keydown", { shiftKey: true, bubbles: true }));
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const shared = edges.find((el) => Number.parseFloat(el.getAttribute("x1") ?? "0") >= 20) ?? edges[0];
    const invalid = edges.find((el) => Number.parseFloat(el.getAttribute("x1") ?? "0") < 10) ?? edges[0];

    expect(shared.classList.contains("modifier-ready")).toBe(true);
    expect(invalid.classList.contains("modifier-invalid")).toBe(true);

    document.body.innerHTML = "";
  });

  it("ignores wall toggles on a locked room", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              locked: true,
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    const area = (ed as any)._floor().areas[0];
    expect(area.sideWalls?.top).toBeUndefined();

    (ed as any)._toggleRectAreaSide(area, 0);
    expect((ed as any)._floor().areas[0].sideWalls?.top).toBeUndefined();

    (ed as any)._toggleRectAreaSide(area, 0);
    expect((ed as any)._floor().areas[0].sideWalls?.top).toBeUndefined();

    document.body.innerHTML = "";
  });

  it("does not trigger a shared-edge coupling when the edges do not match even if a nearby rectangle is present", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room1",
              points: [
                { x: 0, y: 0 },
                { x: 20, y: 0 },
                { x: 20, y: 20 },
                { x: 0, y: 20 },
              ],
            },
            {
              id: "room2",
              points: [
                { x: 30, y: 5 },
                { x: 50, y: 5 },
                { x: 50, y: 25 },
                { x: 30, y: 25 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room1" }];
    await ed.updateComplete;

    // The vertical right edge (index 1): a horizontal-edge move only consumes
    // the y coordinate, so an x-only nudge would leave the room unchanged and
    // make the coupling assertions below vacuous.
    const edge = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")[1];
    expect(edge).toBeTruthy();

    const from = center(edge!);
    // Move toward — but not onto — room2's left edge (x=30): far enough to
    // register as a drag (DRAG_SLOP is 4), close enough to prove the geometry
    // genuinely changed.
    const to = screenPoint(ed.shadowRoot!.querySelector("svg")!, 25, 15);
    pointer(edge!, "pointerdown", from.x, from.y);
    pointer(edge!, "pointermove", to.x, to.y);
    await ed.updateComplete;
    pointer(edge!, "pointerup", to.x, to.y);
    await ed.updateComplete;

    // The right edge actually moved, and the mismatched neighbor did not couple.
    expect((ed as any)._floor().areas[0].points[1].x).toBeCloseTo(25, 5);
    expect((ed as any)._floor().areas[1].points[0].x).toBe(30);
    document.body.innerHTML = "";
  });

  it("keeps a shared wall coincident on every frame while resizing a room", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "left",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "right",
              points: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rightEdge = edges.find((edge) => edge.getAttribute("x1") === "200" && edge.getAttribute("x2") === "200");
    expect(rightEdge).toBeTruthy();

    const from = center(rightEdge!);
    pointer(rightEdge!, "pointerdown", from.x, from.y);
    for (const distance of [10, 20, 30, 40]) {
      pointer(rightEdge!, "pointermove", from.x + distance, from.y);
      await frame();
      await ed.updateComplete;
      const areas = (ed as any)._floor().areas;
      expect(areas[0].points[1].x).toBeCloseTo(areas[1].points[0].x, 6);
      expect(areas[0].points[2].x).toBeCloseTo(areas[1].points[3].x, 6);
      expect(areas[1].points[1].x).toBe(300);
    }
    pointer(rightEdge!, "pointerup", from.x + 40, from.y);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    expect(areas[0].points[1].x).toBeGreaterThan(200);
    expect(areas[0].points[1].x).toBeCloseTo(areas[1].points[0].x, 6);
    expect(areas[1].points[0].x).toBeCloseTo(areas[1].points[3].x, 6);
    document.body.innerHTML = "";
  });

  it("pushes a long shared edge against two shorter rooms without separating them", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "long",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 300 },
                { x: 100, y: 300 },
              ],
            },
            {
              id: "upper",
              points: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
              ],
            },
            {
              id: "lower",
              points: [
                { x: 200, y: 200 },
                { x: 300, y: 200 },
                { x: 300, y: 300 },
                { x: 200, y: 300 },
              ],
            },
            {
              id: "far",
              points: [
                { x: 300, y: 120 },
                { x: 380, y: 120 },
                { x: 380, y: 260 },
                { x: 300, y: 260 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "long" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rightEdge = edges.find((edge) => edge.getAttribute("x1") === "200" && edge.getAttribute("x2") === "200");
    expect(rightEdge).toBeTruthy();

    const from = center(rightEdge!);
    pointer(rightEdge!, "pointerdown", from.x, from.y);
    pointer(rightEdge!, "pointermove", from.x + 30, from.y);
    await frame();
    await ed.updateComplete;
    pointer(rightEdge!, "pointerup", from.x + 30, from.y);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    expect(areas[0].points[1].x).toBeGreaterThan(200);
    expect(areas[0].points[1].x).toBeCloseTo(areas[1].points[0].x, 6);
    expect(areas[0].points[2].x).toBeCloseTo(areas[2].points[3].x, 6);
    expect(areas[1].points[1].x).toBe(300);
    expect(areas[2].points[2].x).toBe(300);
    expect(areas[3].points[0].x).toBe(300);
    document.body.innerHTML = "";
  });

  it("resizes an unrelated edge without coupling a perpendicular neighbor", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "room",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "neighbor",
              points: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 200 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "room" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const topEdge = edges.find(
      (edge) => edge.getAttribute("x1") === "100" && edge.getAttribute("x2") === "200" && edge.getAttribute("y1") === "100"
    );
    expect(topEdge).toBeTruthy();

    const from = center(topEdge!);
    pointer(topEdge!, "pointerdown", from.x, from.y);
    pointer(topEdge!, "pointermove", from.x, from.y - 20);
    await frame();
    await ed.updateComplete;
    pointer(topEdge!, "pointerup", from.x, from.y - 20);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    expect(areas[0].points[0].y).toBeLessThan(100);
    expect(areas[0].points[1].y).toBeLessThan(100);
    expect(areas[1].points).toEqual([
      { x: 200, y: 100 },
      { x: 300, y: 100 },
      { x: 300, y: 200 },
      { x: 200, y: 200 },
    ]);
    document.body.innerHTML = "";
  });

  it("does not move a rectangle touching the opposite edge during a resize", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "center",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "left",
              points: [
                { x: 0, y: 100 },
                { x: 100, y: 100 },
                { x: 100, y: 200 },
                { x: 0, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "center" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rightEdge = edges.find((edge) => edge.getAttribute("x1") === "200" && edge.getAttribute("x2") === "200");
    expect(rightEdge).toBeTruthy();

    const from = center(rightEdge!);
    pointer(rightEdge!, "pointerdown", from.x, from.y);
    pointer(rightEdge!, "pointermove", from.x + 40, from.y);
    await frame();
    await ed.updateComplete;
    pointer(rightEdge!, "pointerup", from.x + 40, from.y);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    const centerRoom = areas.find((area: any) => area.id === "center");
    const leftRoom = areas.find((area: any) => area.id === "left");
    expect(centerRoom.points[1].x).toBeGreaterThan(200);
    expect(leftRoom.points).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ]);
    document.body.innerHTML = "";
  });

  it("stops a shared-wall group before it overlaps a newly encountered room", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "primary",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "shared",
              points: [
                { x: 200, y: 100 },
                { x: 300, y: 100 },
                { x: 300, y: 150 },
                { x: 200, y: 150 },
              ],
            },
            {
              id: "new-obstacle",
              points: [
                { x: 250, y: 160 },
                { x: 280, y: 160 },
                { x: 280, y: 220 },
                { x: 250, y: 220 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "primary" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rightEdge = edges.find((edge) => edge.getAttribute("x1") === "200" && edge.getAttribute("x2") === "200");
    expect(rightEdge).toBeTruthy();

    const from = center(rightEdge!);
    pointer(rightEdge!, "pointerdown", from.x, from.y);
    pointer(rightEdge!, "pointermove", from.x + 80, from.y);
    await frame();
    await ed.updateComplete;
    pointer(rightEdge!, "pointerup", from.x + 80, from.y);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    const primary = areas.find((area: any) => area.id === "primary");
    const shared = areas.find((area: any) => area.id === "shared");
    const obstacle = areas.find((area: any) => area.id === "new-obstacle");
    expect(primary.points[1].x).toBeLessThanOrEqual(250.001);
    expect(primary.points[2].x).toBeLessThanOrEqual(250.001);
    expect(shared.points[0].x).toBeCloseTo(primary.points[1].x, 6);
    expect(shared.points[3].x).toBeCloseTo(primary.points[2].x, 6);
    expect(obstacle.points).toEqual([
      { x: 250, y: 160 },
      { x: 280, y: 160 },
      { x: 280, y: 220 },
      { x: 250, y: 220 },
    ]);
    document.body.innerHTML = "";
  });

  it("allows either room to push its shared edge without crossing the other room's boundary", async () => {
    const createEditor = () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);

      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [
          {
            ...config().floors![0],
            areas: [
              {
                id: "rectangle",
                points: [
                  { x: 0, y: 0 },
                  { x: 20, y: 0 },
                  { x: 20, y: 20 },
                  { x: 0, y: 20 },
                ],
              },
              {
                id: "polygon",
                points: [
                  { x: 20, y: 0 },
                  { x: 40, y: 0 },
                  { x: 40, y: 20 },
                  { x: 30, y: 20 },
                  { x: 30, y: 10 },
                  { x: 20, y: 10 },
                ],
              },
            ],
          },
        ],
      });
      host.appendChild(ed);
      return { host, ed };
    };

    const { ed: polygonEd } = createEditor();
    await polygonEd.updateComplete;
    (polygonEd as any)._selection = [{ kind: "area", id: "polygon" }];
    await polygonEd.updateComplete;

    const polygonEdges = [...polygonEd.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const polygonShared = polygonEdges.find(
      (edge) =>
        edge.dataset.areaId === "polygon" &&
        edge.dataset.edgeSide === "left" &&
        Number.parseFloat(edge.getAttribute("x1") ?? "") === 20 &&
        Number.parseFloat(edge.getAttribute("x2") ?? "") === 20
    );
    expect(polygonShared).toBeTruthy();

    const polygonFrom = center(polygonShared!);
    pointer(polygonShared!, "pointerdown", polygonFrom.x, polygonFrom.y);
    pointer(polygonShared!, "pointermove", polygonFrom.x - 60, polygonFrom.y);
    await frame();
    await polygonEd.updateComplete;
    pointer(polygonShared!, "pointerup", polygonFrom.x - 60, polygonFrom.y);
    await polygonEd.updateComplete;

    const rectangleAfterPolygonPush = (polygonEd as any)._floor().areas.find((area: any) => area.id === "rectangle");
    const polygonAfterPolygonPush = (polygonEd as any)._floor().areas.find((area: any) => area.id === "polygon");
    expect(rectangleAfterPolygonPush).toBeDefined();
    expect(polygonAfterPolygonPush).toBeDefined();
    expect(polygonAfterPolygonPush.points[0].x).toBeLessThan(20);
    expect(polygonAfterPolygonPush.points[5].x).toBeLessThan(20);
    expect(rectangleAfterPolygonPush.points[1].x).toBeCloseTo(polygonAfterPolygonPush.points[0].x, 6);
    expect(rectangleAfterPolygonPush.points[2].x).toBeCloseTo(polygonAfterPolygonPush.points[5].x, 6);
    document.body.innerHTML = "";

    const { ed: rectEd } = createEditor();
    await rectEd.updateComplete;
    (rectEd as any)._selection = [{ kind: "area", id: "rectangle" }];
    await rectEd.updateComplete;

    const rectEdges = [...rectEd.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rectShared = rectEdges.find(
      (edge) =>
        edge.dataset.areaId === "rectangle" &&
        edge.dataset.edgeSide === "right" &&
        Number.parseFloat(edge.getAttribute("x1") ?? "") === 20 &&
        Number.parseFloat(edge.getAttribute("x2") ?? "") === 20
    );
    expect(rectShared).toBeTruthy();

    const rectFrom = center(rectShared!);
    pointer(rectShared!, "pointerdown", rectFrom.x, rectFrom.y);
    pointer(rectShared!, "pointermove", rectFrom.x + 50, rectFrom.y);
    await frame();
    await rectEd.updateComplete;
    pointer(rectShared!, "pointerup", rectFrom.x + 50, rectFrom.y);
    await rectEd.updateComplete;

    const rectangleAfterRectPush = (rectEd as any)._floor().areas.find((area: any) => area.id === "rectangle");
    const polygonAfterRectPush = (rectEd as any)._floor().areas.find((area: any) => area.id === "polygon");
    expect(rectangleAfterRectPush).toBeDefined();
    expect(polygonAfterRectPush).toBeDefined();
    expect(rectangleAfterRectPush.points[1].x).toBeGreaterThan(20);
    expect(rectangleAfterRectPush.points[2].x).toBeCloseTo(rectangleAfterRectPush.points[1].x, 6);
    expect(polygonAfterRectPush.points[0].x).toBeCloseTo(rectangleAfterRectPush.points[1].x, 6);
    expect(polygonAfterRectPush.points[5].x).toBeCloseTo(rectangleAfterRectPush.points[1].x, 6);
    document.body.innerHTML = "";
  });

  it("keeps a pushed shared neighbor from collapsing and disappearing", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [
        {
          ...config().floors![0],
          areas: [
            {
              id: "primary",
              points: [
                { x: 100, y: 100 },
                { x: 200, y: 100 },
                { x: 200, y: 200 },
                { x: 100, y: 200 },
              ],
            },
            {
              id: "neighbor",
              points: [
                { x: 200, y: 100 },
                { x: 220, y: 100 },
                { x: 220, y: 200 },
                { x: 200, y: 200 },
              ],
            },
          ],
        },
      ],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "primary" }];
    await ed.updateComplete;

    const edges = [...ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit")];
    const rightEdge = edges.find((edge) => edge.getAttribute("x1") === "200" && edge.getAttribute("x2") === "200");
    expect(rightEdge).toBeTruthy();

    const from = center(rightEdge!);
    pointer(rightEdge!, "pointerdown", from.x, from.y);
    pointer(rightEdge!, "pointermove", from.x + 200, from.y);
    await frame();
    await ed.updateComplete;
    pointer(rightEdge!, "pointerup", from.x + 200, from.y);
    await ed.updateComplete;

    const areas = (ed as any)._floor().areas;
    const primary = areas.find((area: any) => area.id === "primary");
    const neighbor = areas.find((area: any) => area.id === "neighbor");
    expect(neighbor).toBeDefined();
    expect(neighbor.points[1].x - neighbor.points[0].x).toBeGreaterThanOrEqual(1);
    expect(neighbor.points[0].x).toBeCloseTo(primary.points[1].x, 6);
    expect(neighbor.points[3].x).toBeCloseTo(primary.points[2].x, 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for full-overlap rectangle/rectangle left-right drags", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "left", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }] },
          { id: "right", points: [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 40 }, { x: 20, y: 40 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "left" }];
    await ed.updateComplete;

    const rightEdge = findAreaEdge(ed, "left", "right");
    const from = center(rightEdge);
    pointer(rightEdge, "pointerdown", from.x, from.y);
    pointer(rightEdge, "pointermove", from.x + 12, from.y);
    await frame();
    await ed.updateComplete;
    pointer(rightEdge, "pointerup", from.x + 12, from.y);
    await ed.updateComplete;

    let left = (ed as any)._floor().areas.find((a: any) => a.id === "left");
    let right = (ed as any)._floor().areas.find((a: any) => a.id === "right");
    expectAxisAligned(left.points);
    expectAxisAligned(right.points);
    expect(boundaryValue(left.points, "right")).toBeCloseTo(boundaryValue(right.points, "left"), 6);

    (ed as any)._selection = [{ kind: "area", id: "right" }];
    await ed.updateComplete;
    const leftEdge = findAreaEdge(ed, "right", "left");
    const from2 = center(leftEdge);
    pointer(leftEdge, "pointerdown", from2.x, from2.y);
    pointer(leftEdge, "pointermove", from2.x - 10, from2.y);
    await frame();
    await ed.updateComplete;
    pointer(leftEdge, "pointerup", from2.x - 10, from2.y);
    await ed.updateComplete;

    left = (ed as any)._floor().areas.find((a: any) => a.id === "left");
    right = (ed as any)._floor().areas.find((a: any) => a.id === "right");
    expectAxisAligned(left.points);
    expectAxisAligned(right.points);
    expect(boundaryValue(left.points, "right")).toBeCloseTo(boundaryValue(right.points, "left"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for full-overlap rectangle/rectangle up-down drags", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "top", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] },
          { id: "bottom", points: [{ x: 0, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }, { x: 0, y: 40 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "top" }];
    await ed.updateComplete;

    const bottomEdge = findAreaEdge(ed, "top", "bottom");
    const from = center(bottomEdge);
    pointer(bottomEdge, "pointerdown", from.x, from.y);
    pointer(bottomEdge, "pointermove", from.x, from.y + 8);
    await frame();
    await ed.updateComplete;
    pointer(bottomEdge, "pointerup", from.x, from.y + 8);
    await ed.updateComplete;

    let top = (ed as any)._floor().areas.find((a: any) => a.id === "top");
    let bottom = (ed as any)._floor().areas.find((a: any) => a.id === "bottom");
    expectAxisAligned(top.points);
    expectAxisAligned(bottom.points);
    expect(boundaryValue(top.points, "bottom")).toBeCloseTo(boundaryValue(bottom.points, "top"), 6);

    (ed as any)._selection = [{ kind: "area", id: "bottom" }];
    await ed.updateComplete;
    const topEdge = findAreaEdge(ed, "bottom", "top");
    const from2 = center(topEdge);
    pointer(topEdge, "pointerdown", from2.x, from2.y);
    pointer(topEdge, "pointermove", from2.x, from2.y - 6);
    await frame();
    await ed.updateComplete;
    pointer(topEdge, "pointerup", from2.x, from2.y - 6);
    await ed.updateComplete;

    top = (ed as any)._floor().areas.find((a: any) => a.id === "top");
    bottom = (ed as any)._floor().areas.find((a: any) => a.id === "bottom");
    expectAxisAligned(top.points);
    expectAxisAligned(bottom.points);
    expect(boundaryValue(top.points, "bottom")).toBeCloseTo(boundaryValue(bottom.points, "top"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for top-partial rectangle/polygon overlap", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "rect", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }] },
          { id: "poly", points: [{ x: 20, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 10 }, { x: 20, y: 10 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "rect" }];
    await ed.updateComplete;
    const edge = findAreaEdge(ed, "rect", "right", screenPoint(ed.shadowRoot!.querySelector("svg")!, 20, 5));
    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x + 10, from.y);
    await frame();
    await ed.updateComplete;
    pointer(edge, "pointerup", from.x + 10, from.y);
    await ed.updateComplete;

    const rect = (ed as any)._floor().areas.find((a: any) => a.id === "rect");
    const poly = (ed as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(rect.points);
    expectAxisAligned(poly.points);
    expect(poly.points[0].x).toBeCloseTo(poly.points[5].x, 6);
    expect(poly.points[0].x).toBeCloseTo(boundaryValue(rect.points, "right"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for middle-partial rectangle/polygon overlap", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "rect", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }] },
          { id: "poly", points: [{ x: 20, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 20 }, { x: 20, y: 20 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "rect" }];
    await ed.updateComplete;
    const edge = findAreaEdge(ed, "rect", "right", screenPoint(ed.shadowRoot!.querySelector("svg")!, 20, 15));
    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x + 11, from.y);
    await frame();
    await ed.updateComplete;
    pointer(edge, "pointerup", from.x + 11, from.y);
    await ed.updateComplete;

    const rect = (ed as any)._floor().areas.find((a: any) => a.id === "rect");
    const poly = (ed as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(rect.points);
    expectAxisAligned(poly.points);
    expect(poly.points[0].x).toBeCloseTo(poly.points[5].x, 6);
    expect(poly.points[0].x).toBeCloseTo(boundaryValue(rect.points, "right"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for tiny-fraction rectangle/polygon overlap", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "rect", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }] },
          { id: "poly", points: [{ x: 20, y: 15 }, { x: 40, y: 15 }, { x: 40, y: 40 }, { x: 30, y: 40 }, { x: 30, y: 18 }, { x: 20, y: 18 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "rect" }];
    await ed.updateComplete;
    const edge = findAreaEdge(ed, "rect", "right", screenPoint(ed.shadowRoot!.querySelector("svg")!, 20, 16));
    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x + 9, from.y);
    await frame();
    await ed.updateComplete;
    pointer(edge, "pointerup", from.x + 9, from.y);
    await ed.updateComplete;

    const rect = (ed as any)._floor().areas.find((a: any) => a.id === "rect");
    const poly = (ed as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(rect.points);
    expectAxisAligned(poly.points);
    expect(poly.points[0].x).toBeCloseTo(poly.points[5].x, 6);
    expect(poly.points[0].x).toBeCloseTo(boundaryValue(rect.points, "right"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked for middle-partial up/down rectangle/polygon overlap", async () => {
    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);

    const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    ed.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "top", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] },
          { id: "poly", points: [{ x: 10, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 40 }, { x: 40, y: 40 }, { x: 40, y: 30 }, { x: 10, y: 30 }] },
        ],
      }],
    });
    host.appendChild(ed);
    await ed.updateComplete;

    (ed as any)._selection = [{ kind: "area", id: "top" }];
    await ed.updateComplete;
    const edge = findAreaEdge(ed, "top", "bottom", screenPoint(ed.shadowRoot!.querySelector("svg")!, 15, 20));
    const from = center(edge);
    pointer(edge, "pointerdown", from.x, from.y);
    pointer(edge, "pointermove", from.x, from.y + 7);
    await frame();
    await ed.updateComplete;
    pointer(edge, "pointerup", from.x, from.y + 7);
    await ed.updateComplete;

    const top = (ed as any)._floor().areas.find((a: any) => a.id === "top");
    const poly = (ed as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(top.points);
    expectAxisAligned(poly.points);
    expect(poly.points[0].y).toBeCloseTo(poly.points[1].y, 6);
    expect(poly.points[0].y).toBeCloseTo(boundaryValue(top.points, "bottom"), 6);
    document.body.innerHTML = "";
  });

  it("keeps shared-edge pushes axis-locked when the polygon side is pushed into a rectangle (left and up)", async () => {
    const makeHorizontal = async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "rect", points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 40 }, { x: 0, y: 40 }] },
            { id: "poly", points: [{ x: 20, y: 10 }, { x: 40, y: 10 }, { x: 40, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 20 }, { x: 20, y: 20 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;
      return ed;
    };

    const hEd = await makeHorizontal();
    (hEd as any)._selection = [{ kind: "area", id: "poly" }];
    await hEd.updateComplete;
    const hEdge = findAreaEdge(hEd, "poly", "left", screenPoint(hEd.shadowRoot!.querySelector("svg")!, 20, 15));
    const hFrom = center(hEdge);
    pointer(hEdge, "pointerdown", hFrom.x, hFrom.y);
    pointer(hEdge, "pointermove", hFrom.x - 8, hFrom.y);
    await frame();
    await hEd.updateComplete;
    pointer(hEdge, "pointerup", hFrom.x - 8, hFrom.y);
    await hEd.updateComplete;
    const hRect = (hEd as any)._floor().areas.find((a: any) => a.id === "rect");
    const hPoly = (hEd as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(hRect.points);
    expectAxisAligned(hPoly.points);
    expect(boundaryValue(hRect.points, "right")).toBeCloseTo(boundaryValue(hPoly.points, "left"), 6);
    document.body.innerHTML = "";

    const host = document.createElement("div");
    host.style.width = "900px";
    document.body.appendChild(host);
    const vEd = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
    vEd.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
    vEd.setConfig({
      ...config(),
      floors: [{
        ...config().floors![0],
        areas: [
          { id: "rect", points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 20 }, { x: 0, y: 20 }] },
          { id: "poly", points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }, { x: 20, y: 40 }, { x: 20, y: 30 }, { x: 10, y: 30 }] },
        ],
      }],
    });
    host.appendChild(vEd);
    await vEd.updateComplete;

    (vEd as any)._selection = [{ kind: "area", id: "poly" }];
    await vEd.updateComplete;
    const vEdge = findAreaEdge(vEd, "poly", "top", screenPoint(vEd.shadowRoot!.querySelector("svg")!, 15, 20));
    const vFrom = center(vEdge);
    pointer(vEdge, "pointerdown", vFrom.x, vFrom.y);
    pointer(vEdge, "pointermove", vFrom.x, vFrom.y - 7);
    await frame();
    await vEd.updateComplete;
    pointer(vEdge, "pointerup", vFrom.x, vFrom.y - 7);
    await vEd.updateComplete;

    const vRect = (vEd as any)._floor().areas.find((a: any) => a.id === "rect");
    const vPoly = (vEd as any)._floor().areas.find((a: any) => a.id === "poly");
    expectAxisAligned(vRect.points);
    expectAxisAligned(vPoly.points);
    expect(boundaryValue(vRect.points, "bottom")).toBeCloseTo(boundaryValue(vPoly.points, "top"), 6);
    document.body.innerHTML = "";
  });

  describe("shared-edge push then pull regression", () => {
    const dragAreaEdge = async (
      ed: FloorplanCardEditor,
      areaId: string,
      side: "left" | "right" | "top" | "bottom",
      nearWorld: { x: number; y: number },
      delta: { dx: number; dy: number }
    ) => {
      const svg = ed.shadowRoot!.querySelector("svg") as SVGSVGElement;
      const edge = findAreaEdge(ed, areaId, side, screenPoint(svg, nearWorld.x, nearWorld.y));
      const from = center(edge);
      pointer(edge, "pointerdown", from.x, from.y);
      pointer(edge, "pointermove", from.x + delta.dx, from.y + delta.dy);
      await frame();
      await ed.updateComplete;
      pointer(edge, "pointerup", from.x + delta.dx, from.y + delta.dy);
      await ed.updateComplete;
    };

    const rotations: Array<{ turns: 0 | 1 | 2 | 3; label: string }> = [
      { turns: 0, label: "0deg" },
      { turns: 1, label: "90deg" },
      { turns: 2, label: "180deg" },
      { turns: 3, label: "270deg" },
    ];

    for (const rotation of rotations) {
      it(`keeps both polygons axis-aligned when a shared edge is pushed then pulled (${rotation.label})`, async () => {
        const rectBase = [
          { x: 220, y: 240 },
          { x: 400, y: 240 },
          { x: 400, y: 380 },
          { x: 220, y: 380 },
        ];
        const polyBase = [
          { x: 400, y: 200 },
          { x: 840, y: 200 },
          { x: 840, y: 300 },
          { x: 680, y: 300 },
          { x: 680, y: 360 },
          { x: 400, y: 360 },
        ];

        const rotRect = rectBase.map((p) => rotateCW(p, rotation.turns));
        const rotPoly = polyBase.map((p) => rotateCW(p, rotation.turns));
        const all = [...rotRect, ...rotPoly];
        const minX = Math.min(...all.map((p) => p.x));
        const minY = Math.min(...all.map((p) => p.y));
        const offset = { x: 120 - minX, y: 120 - minY };
        const toWorld = (p: { x: number; y: number }) => ({ x: p.x + offset.x, y: p.y + offset.y });

        const rect = rotRect.map(toWorld);
        const poly = rotPoly.map(toWorld);

        const host = document.createElement("div");
        host.style.width = "900px";
        document.body.appendChild(host);

        const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
        ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
        ed.setConfig({
          ...config(),
          floors: [{
            ...config().floors![0],
            areas: [
              { id: "rect", points: rect },
              { id: "poly", points: poly },
            ],
          }],
        });
        host.appendChild(ed);
        await ed.updateComplete;

        const side = rotateSideCW("right", rotation.turns);
        const push = rotateCW({ x: 20, y: 0 }, rotation.turns);
        const pull = rotateCW({ x: -20, y: 0 }, rotation.turns);
        const near = toWorld(rotateCW({ x: 400, y: 340 }, rotation.turns));

        (ed as any)._selection = [{ kind: "area", id: "rect" }];
        await ed.updateComplete;

        await dragAreaEdge(ed, "rect", side, near, { dx: push.x, dy: push.y });
        let afterPushRect = (ed as any)._floor().areas.find((a: any) => a.id === "rect").points;
        let afterPushPoly = (ed as any)._floor().areas.find((a: any) => a.id === "poly").points;
        expectAxisAligned(afterPushRect);
        expectAxisAligned(afterPushPoly);
        expect(boundaryValue(afterPushRect, side)).toBeCloseTo(boundaryValue(afterPushPoly, oppositeSide(side)), 6);

        await dragAreaEdge(ed, "rect", side, near, { dx: pull.x, dy: pull.y });
        const afterPullRect = (ed as any)._floor().areas.find((a: any) => a.id === "rect").points;
        const afterPullPoly = (ed as any)._floor().areas.find((a: any) => a.id === "poly").points;
        expectAxisAligned(afterPullRect);
        expectAxisAligned(afterPullPoly);
        expect(boundaryValue(afterPullRect, side)).toBeCloseTo(boundaryValue(afterPullPoly, oppositeSide(side)), 6);

        const rectStartBoundary = boundaryValue(rect, side);
        const rectEndBoundary = boundaryValue(afterPullRect, side);
        expect(rectEndBoundary).toBeCloseTo(rectStartBoundary, 3);
        document.body.innerHTML = "";
      });
    }
  });

  describe("logged rectangle-L pullback regression", () => {
    const setupLoggedPair = async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);

      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            {
              id: "area_jdo1krr",
              points: [
                { x: 220, y: 240 },
                { x: 400, y: 240 },
                { x: 400, y: 380 },
                { x: 220, y: 380 },
              ],
            },
            {
              id: "area_6x30lu6",
              points: [
                { x: 400, y: 200 },
                { x: 840, y: 200 },
                { x: 840, y: 300 },
                { x: 680, y: 300 },
                { x: 680, y: 360 },
                { x: 400, y: 360 },
              ],
            },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;
      return ed;
    };

    const dragRightEdgeBy = async (ed: FloorplanCardEditor, dx: number) => {
      (ed as any)._selection = [{ kind: "area", id: "area_jdo1krr" }];
      await ed.updateComplete;
      const svg = ed.shadowRoot!.querySelector("svg") as SVGSVGElement;
      const edge = findAreaEdge(ed, "area_jdo1krr", "right", screenPoint(svg, 400, 340));
      const from = center(edge);
      pointer(edge, "pointerdown", from.x, from.y);
      pointer(edge, "pointermove", from.x + dx, from.y);
      await frame();
      await ed.updateComplete;
      pointer(edge, "pointerup", from.x + dx, from.y);
      await ed.updateComplete;
    };

    it("keeps the neighbor polygon rectilinear when pushing the shared edge right", async () => {
      const ed = await setupLoggedPair();

      await dragRightEdgeBy(ed, 20);

      const rect = (ed as any)._floor().areas.find((a: any) => a.id === "area_jdo1krr");
      const poly = (ed as any)._floor().areas.find((a: any) => a.id === "area_6x30lu6");
      expectAxisAligned(rect.points);
      expectAxisAligned(poly.points);
      // The neighbor boundary segment that includes y=240..360 moves as a segment,
      // not as one endpoint, so no diagonal can appear.
      expect(poly.points[0].x).toBeCloseTo(poly.points[5].x, 3);
      expect(poly.points[5].x).toBeCloseTo(boundaryValue(rect.points, "right"), 3);
      document.body.innerHTML = "";
    });

    it("stays rectilinear after push right then pull back left", async () => {
      const ed = await setupLoggedPair();

      await dragRightEdgeBy(ed, 20);
      await dragRightEdgeBy(ed, -20);

      const rect = (ed as any)._floor().areas.find((a: any) => a.id === "area_jdo1krr");
      const poly = (ed as any)._floor().areas.find((a: any) => a.id === "area_6x30lu6");
      expectAxisAligned(rect.points);
      expectAxisAligned(poly.points);
      expect(poly.points[0].x).toBeCloseTo(poly.points[5].x, 3);
      expect(boundaryValue(rect.points, "right")).toBeCloseTo(400, 3);
      expect(poly.points[5].x).toBeCloseTo(400, 3);
      document.body.innerHTML = "";
    });
  });

  describe("logged duplicate-vertex top-edge regression", () => {
    const setupLoggedDuplicatePair = async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);

      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            {
              id: "area_pg3h1on",
              points: [
                { x: 380, y: 300 },
                { x: 540, y: 300 },
                { x: 540, y: 300 },
                { x: 700, y: 300 },
                { x: 700, y: 440 },
                { x: 380, y: 440 },
              ],
            },
            {
              id: "area_k9ywq25",
              points: [
                { x: 600, y: 180 },
                { x: 880, y: 180 },
                { x: 880, y: 300 },
                { x: 700, y: 300 },
                { x: 700, y: 300 },
                { x: 600, y: 300 },
              ],
            },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;
      return ed;
    };

    const dragAreaEdgeAt = async (
      ed: FloorplanCardEditor,
      areaId: string,
      side: "left" | "right" | "top" | "bottom",
      nearWorld: { x: number; y: number },
      delta: { dx: number; dy: number }
    ) => {
      (ed as any)._selection = [{ kind: "area", id: areaId }];
      await ed.updateComplete;
      const svg = ed.shadowRoot!.querySelector("svg") as SVGSVGElement;
      const edge = findAreaEdge(ed, areaId, side, screenPoint(svg, nearWorld.x, nearWorld.y));
      const from = center(edge);
      pointer(edge, "pointerdown", from.x, from.y);
      pointer(edge, "pointermove", from.x + delta.dx, from.y + delta.dy);
      await frame();
      await ed.updateComplete;
      pointer(edge, "pointerup", from.x + delta.dx, from.y + delta.dy);
      await ed.updateComplete;
    };

    it("stays unchanged and rectilinear after repeated zero-delta drags on the duplicate top edge", async () => {
      const ed = await setupLoggedDuplicatePair();

      for (let i = 0; i < 4; i++) {
        await dragAreaEdgeAt(ed, "area_pg3h1on", "top", { x: 680, y: 300 }, { dx: 0, dy: 0 });
      }

      const primary = (ed as any)._floor().areas.find((a: any) => a.id === "area_pg3h1on");
      const other = (ed as any)._floor().areas.find((a: any) => a.id === "area_k9ywq25");
      expectFloorplanRectilinear((ed as any)._floor().areas);
      expect(primary.points).toEqual([
        { x: 380, y: 300 },
        { x: 540, y: 300 },
        { x: 540, y: 300 },
        { x: 700, y: 300 },
        { x: 700, y: 440 },
        { x: 380, y: 440 },
      ]);
      expect(other.points).toEqual([
        { x: 600, y: 180 },
        { x: 880, y: 180 },
        { x: 880, y: 300 },
        { x: 700, y: 300 },
        { x: 700, y: 300 },
        { x: 600, y: 300 },
      ]);
      expectPolygonGeometry(primary.points);
      expectPolygonGeometry(other.points);
      document.body.innerHTML = "";
    });

    it("keeps the neighbor polygon axis-aligned when pushing the duplicate top edge down", async () => {
      const ed = await setupLoggedDuplicatePair();

      await dragAreaEdgeAt(ed, "area_pg3h1on", "top", { x: 680, y: 300 }, { dx: 0, dy: 20 });

      const primary = (ed as any)._floor().areas.find((a: any) => a.id === "area_pg3h1on");
      const other = (ed as any)._floor().areas.find((a: any) => a.id === "area_k9ywq25");
      expectFloorplanRectilinear((ed as any)._floor().areas);
      expectPolygonGeometry(primary.points);
      expectPolygonGeometry(other.points);
      // Shared top segment on the primary (x=600..700) should still sit on the
      // moved boundary, and the neighbor must remain orthogonal.
      const movedBoundary = primary.points[2].y;
      expect(primary.points[3].y).toBeCloseTo(movedBoundary, 6);
      expect(other.points[4].y).toBeCloseTo(movedBoundary, 6);
      expect(other.points[5].y).toBeCloseTo(movedBoundary, 6);
      // The duplicated vertex should preserve a vertical kink at x=700 instead
      // of turning the whole 880..700 edge diagonal.
      expect(other.points[3].y).toBeLessThan(other.points[4].y - 0.5);
      document.body.innerHTML = "";
    });

    it("stays stable after push-down, repeated zero-delta drags on the new bottom edge, then pull-up", async () => {
      const ed = await setupLoggedDuplicatePair();

      await dragAreaEdgeAt(ed, "area_pg3h1on", "top", { x: 680, y: 300 }, { dx: 0, dy: 20 });
      for (let i = 0; i < 3; i++) {
        await dragAreaEdgeAt(ed, "area_pg3h1on", "bottom", { x: 680, y: 320 }, { dx: 0, dy: 0 });
      }
      await dragAreaEdgeAt(ed, "area_pg3h1on", "bottom", { x: 680, y: 320 }, { dx: 0, dy: -20 });

      const primary = (ed as any)._floor().areas.find((a: any) => a.id === "area_pg3h1on");
      const other = (ed as any)._floor().areas.find((a: any) => a.id === "area_k9ywq25");
      expectFloorplanRectilinear((ed as any)._floor().areas);
      expectPolygonGeometry(primary.points);
      expectPolygonGeometry(other.points);
      expect(primary.points).toEqual([
        { x: 380, y: 300 },
        { x: 540, y: 300 },
        { x: 540, y: 300 },
        { x: 700, y: 300 },
        { x: 700, y: 440 },
        { x: 380, y: 440 },
      ]);
      expect(other.points[5].y).toBeCloseTo(300, 3);
      document.body.innerHTML = "";
    });
  });

  describe("deterministic coupling fixtures", () => {
    const dragSharedEdge = async (
      ed: FloorplanCardEditor,
      areaId: string,
      side: "left" | "right" | "top" | "bottom",
      nearWorld: { x: number; y: number },
      delta: { dx: number; dy: number }
    ) => {
      (ed as any)._selection = [{ kind: "area", id: areaId }];
      await ed.updateComplete;
      const svg = ed.shadowRoot!.querySelector("svg") as SVGSVGElement;
      const edge = findAreaEdge(ed, areaId, side, screenPoint(svg, nearWorld.x, nearWorld.y));
      const from = center(edge);
      pointer(edge, "pointerdown", from.x, from.y);
      pointer(edge, "pointermove", from.x + delta.dx, from.y + delta.dy);
      await frame();
      await ed.updateComplete;
      pointer(edge, "pointerup", from.x + delta.dx, from.y + delta.dy);
      await ed.updateComplete;
    };

    const pointsChanged = (
      before: Array<{ x: number; y: number }>,
      after: Array<{ x: number; y: number }>,
      eps = 1e-3
    ) => {
      if (before.length !== after.length) return true;
      for (let i = 0; i < before.length; i++) {
        if (Math.abs(before[i]!.x - after[i]!.x) > eps || Math.abs(before[i]!.y - after[i]!.y) > eps) return true;
      }
      return false;
    };

    it("three-room row: moving A/B shared wall changes A and B only", async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "A", points: [{ x: 100, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 220 }, { x: 100, y: 220 }] },
            { id: "B", points: [{ x: 220, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 220 }, { x: 220, y: 220 }] },
            { id: "C", points: [{ x: 340, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 220 }, { x: 340, y: 220 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;

      const beforeA = (ed as any)._floor().areas.find((a: any) => a.id === "A").points.map((p: any) => ({ ...p }));
      const beforeB = (ed as any)._floor().areas.find((a: any) => a.id === "B").points.map((p: any) => ({ ...p }));
      const beforeC = (ed as any)._floor().areas.find((a: any) => a.id === "C").points.map((p: any) => ({ ...p }));

      await dragSharedEdge(ed, "A", "right", { x: 220, y: 160 }, { dx: 24, dy: 0 });

      const areaA = (ed as any)._floor().areas.find((a: any) => a.id === "A");
      const areaB = (ed as any)._floor().areas.find((a: any) => a.id === "B");
      const areaC = (ed as any)._floor().areas.find((a: any) => a.id === "C");
      expect(pointsChanged(beforeA, areaA.points)).toBe(true);
      expect(pointsChanged(beforeB, areaB.points)).toBe(true);
      expect(pointsChanged(beforeC, areaC.points)).toBe(false);
      expectAreaRectangular(areaA.points);
      expectAreaRectangular(areaB.points);
      expectAreaRectangular(areaC.points);
      expectFloorplanRectilinear((ed as any)._floor().areas);
      expectSharedWall(areaA, "right", areaB, "left");
      document.body.innerHTML = "";
    });

    it("three-room row: moving B/C shared wall changes B and C only", async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "A", points: [{ x: 100, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 220 }, { x: 100, y: 220 }] },
            { id: "B", points: [{ x: 220, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 220 }, { x: 220, y: 220 }] },
            { id: "C", points: [{ x: 340, y: 100 }, { x: 460, y: 100 }, { x: 460, y: 220 }, { x: 340, y: 220 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;

      const beforeA = (ed as any)._floor().areas.find((a: any) => a.id === "A").points.map((p: any) => ({ ...p }));
      const beforeB = (ed as any)._floor().areas.find((a: any) => a.id === "B").points.map((p: any) => ({ ...p }));
      const beforeC = (ed as any)._floor().areas.find((a: any) => a.id === "C").points.map((p: any) => ({ ...p }));

      await dragSharedEdge(ed, "B", "right", { x: 340, y: 160 }, { dx: -20, dy: 0 });

      const areaA = (ed as any)._floor().areas.find((a: any) => a.id === "A");
      const areaB = (ed as any)._floor().areas.find((a: any) => a.id === "B");
      const areaC = (ed as any)._floor().areas.find((a: any) => a.id === "C");
      expect(pointsChanged(beforeA, areaA.points)).toBe(false);
      expect(pointsChanged(beforeB, areaB.points)).toBe(true);
      expect(pointsChanged(beforeC, areaC.points)).toBe(true);
      expectAreaRectangular(areaA.points);
      expectAreaRectangular(areaB.points);
      expectAreaRectangular(areaC.points);
      expectFloorplanRectilinear((ed as any)._floor().areas);
      expectSharedWall(areaB, "right", areaC, "left");
      document.body.innerHTML = "";
    });

    const fourRoomCase = async (
      selectedId: "A" | "B" | "C" | "D",
      side: "left" | "right" | "top" | "bottom",
      nearWorld: { x: number; y: number },
      delta: { dx: number; dy: number },
      changed: ["A" | "B" | "C" | "D", "A" | "B" | "C" | "D"]
    ) => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "A", points: [{ x: 100, y: 100 }, { x: 220, y: 100 }, { x: 220, y: 220 }, { x: 100, y: 220 }] },
            { id: "B", points: [{ x: 220, y: 100 }, { x: 340, y: 100 }, { x: 340, y: 220 }, { x: 220, y: 220 }] },
            { id: "C", points: [{ x: 100, y: 220 }, { x: 220, y: 220 }, { x: 220, y: 340 }, { x: 100, y: 340 }] },
            { id: "D", points: [{ x: 220, y: 220 }, { x: 340, y: 220 }, { x: 340, y: 340 }, { x: 220, y: 340 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;

      const before = Object.fromEntries(
        (ed as any)._floor().areas.map((a: any) => [a.id, a.points.map((p: any) => ({ ...p }))])
      ) as Record<string, Array<{ x: number; y: number }>>;

      await dragSharedEdge(ed, selectedId, side, nearWorld, delta);

      const areas = (ed as any)._floor().areas;
      const ids = ["A", "B", "C", "D"];
      for (const id of ids) {
        const area = areas.find((a: any) => a.id === id);
        const shouldChange = changed.includes(id as any);
        expect(pointsChanged(before[id], area.points)).toBe(shouldChange);
        expectAreaRectangular(area.points);
      }
      expectFloorplanRectilinear(areas);
      document.body.innerHTML = "";
    };

    it("four-room grid: A/B wall moves independently", async () => {
      await fourRoomCase("A", "right", { x: 220, y: 160 }, { dx: 18, dy: 0 }, ["A", "B"]);
    });

    it("four-room grid: C/D wall moves independently", async () => {
      await fourRoomCase("C", "right", { x: 220, y: 280 }, { dx: 18, dy: 0 }, ["C", "D"]);
    });

    it("four-room grid: A/C wall moves independently", async () => {
      await fourRoomCase("A", "bottom", { x: 160, y: 220 }, { dx: 0, dy: 16 }, ["A", "C"]);
    });

    it("four-room grid: B/D wall moves independently", async () => {
      await fourRoomCase("B", "bottom", { x: 280, y: 220 }, { dx: 0, dy: 16 }, ["B", "D"]);
    });

    it("T-junction: moving vertical B/C wall keeps all polygons rectilinear", async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "A", points: [{ x: 100, y: 80 }, { x: 340, y: 80 }, { x: 340, y: 180 }, { x: 100, y: 180 }] },
            { id: "B", points: [{ x: 100, y: 180 }, { x: 220, y: 180 }, { x: 220, y: 320 }, { x: 100, y: 320 }] },
            { id: "C", points: [{ x: 220, y: 180 }, { x: 340, y: 180 }, { x: 340, y: 320 }, { x: 220, y: 320 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;

      await dragSharedEdge(ed, "B", "right", { x: 220, y: 250 }, { dx: 20, dy: 0 });

      const areas = (ed as any)._floor().areas;
      const areaA = areas.find((a: any) => a.id === "A");
      const areaB = areas.find((a: any) => a.id === "B");
      const areaC = areas.find((a: any) => a.id === "C");
      expectFloorplanRectilinear(areas);
      expectAreaRectangular(areaA.points);
      expectAreaRectangular(areaB.points);
      expectAreaRectangular(areaC.points);
      expectSharedWall(areaB, "right", areaC, "left");
      document.body.innerHTML = "";
    });

    it("rotated T-junction: moving horizontal B/C wall keeps all polygons rectilinear", async () => {
      const host = document.createElement("div");
      host.style.width = "900px";
      document.body.appendChild(host);
      const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
      ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
      ed.setConfig({
        ...config(),
        floors: [{
          ...config().floors![0],
          areas: [
            { id: "A", points: [{ x: 80, y: 100 }, { x: 180, y: 100 }, { x: 180, y: 340 }, { x: 80, y: 340 }] },
            { id: "B", points: [{ x: 180, y: 100 }, { x: 320, y: 100 }, { x: 320, y: 220 }, { x: 180, y: 220 }] },
            { id: "C", points: [{ x: 180, y: 220 }, { x: 320, y: 220 }, { x: 320, y: 340 }, { x: 180, y: 340 }] },
          ],
        }],
      });
      host.appendChild(ed);
      await ed.updateComplete;

      await dragSharedEdge(ed, "B", "bottom", { x: 250, y: 220 }, { dx: 0, dy: 18 });

      const areas = (ed as any)._floor().areas;
      const areaA = areas.find((a: any) => a.id === "A");
      const areaB = areas.find((a: any) => a.id === "B");
      const areaC = areas.find((a: any) => a.id === "C");
      expectFloorplanRectilinear(areas);
      expectAreaRectangular(areaA.points);
      expectAreaRectangular(areaB.points);
      expectAreaRectangular(areaC.points);
      expectSharedWall(areaB, "bottom", areaC, "top");
      document.body.innerHTML = "";
    });
  });

  describe("L-shape stiff-wall matrix", () => {
    type Pt = { x: number; y: number };
    type DragCase = {
      selectedId: "a" | "b";
      side: "left" | "right" | "top" | "bottom";
      delta: { dx: number; dy: number };
    };
    type Layout = {
      name: string;
      a: Pt[];
      b: Pt[];
      sharedMid: Pt;
      drags: [DragCase, DragCase];
    };

    const layouts: Layout[] = [
      {
        name: "partial-upper-vertical",
        a: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 10 },
          { x: 20, y: 10 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        b: [
          { x: 30, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 10 },
          { x: 30, y: 10 },
        ],
        sharedMid: { x: 30, y: 5 },
        drags: [
          { selectedId: "a", side: "right", delta: { dx: 8, dy: 0 } },
          { selectedId: "b", side: "left", delta: { dx: -8, dy: 0 } },
        ],
      },
      {
        name: "partial-lower-vertical",
        a: [
          { x: 0, y: 0 },
          { x: 30, y: 0 },
          { x: 30, y: 20 },
          { x: 20, y: 20 },
          { x: 20, y: 10 },
          { x: 0, y: 10 },
        ],
        b: [
          { x: 30, y: 10 },
          { x: 50, y: 10 },
          { x: 50, y: 30 },
          { x: 40, y: 30 },
          { x: 40, y: 20 },
          { x: 30, y: 20 },
        ],
        sharedMid: { x: 30, y: 15 },
        drags: [
          { selectedId: "a", side: "right", delta: { dx: 7, dy: 0 } },
          { selectedId: "b", side: "left", delta: { dx: -7, dy: 0 } },
        ],
      },
      {
        name: "full-vertical-overlap",
        a: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 10, y: 20 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
        b: [
          { x: 20, y: 0 },
          { x: 40, y: 0 },
          { x: 40, y: 10 },
          { x: 30, y: 10 },
          { x: 30, y: 20 },
          { x: 20, y: 20 },
        ],
        sharedMid: { x: 20, y: 10 },
        drags: [
          { selectedId: "a", side: "right", delta: { dx: 6, dy: 0 } },
          { selectedId: "b", side: "left", delta: { dx: -6, dy: 0 } },
        ],
      },
    ];

    const rotations: Array<{ turns: 0 | 1 | 2 | 3; label: string }> = [
      { turns: 0, label: "0deg" },
      { turns: 1, label: "90deg" },
      { turns: 2, label: "180deg" },
      { turns: 3, label: "270deg" },
    ];

    for (const layout of layouts) {
      for (const rotation of rotations) {
        for (const dragCase of layout.drags) {
          it(`keeps L-shape walls axis-locked (${layout.name}, ${rotation.label}, ${dragCase.selectedId}->${dragCase.side})`, async () => {
            const rotA = layout.a.map((p) => rotateCW(p, rotation.turns));
            const rotB = layout.b.map((p) => rotateCW(p, rotation.turns));
            const rotMid = rotateCW(layout.sharedMid, rotation.turns);
            const rotDelta = rotateCW({ x: dragCase.delta.dx, y: dragCase.delta.dy }, rotation.turns);
            const side = rotateSideCW(dragCase.side, rotation.turns);

            const all = [...rotA, ...rotB];
            const minX = Math.min(...all.map((p) => p.x));
            const minY = Math.min(...all.map((p) => p.y));
            const offset = { x: 80 - minX, y: 80 - minY };
            const toWorld = (p: Pt): Pt => ({ x: p.x + offset.x, y: p.y + offset.y });
            const aWorld = rotA.map(toWorld);
            const bWorld = rotB.map(toWorld);
            const midWorld = toWorld(rotMid);

            const host = document.createElement("div");
            host.style.width = "900px";
            document.body.appendChild(host);

            const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
            ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
            ed.setConfig({
              ...config(),
              floors: [{
                ...config().floors![0],
                areas: [
                  { id: "a", points: aWorld },
                  { id: "b", points: bWorld },
                ],
              }],
            });
            host.appendChild(ed);
            await ed.updateComplete;

            const selectedId = dragCase.selectedId;
            const otherId = selectedId === "a" ? "b" : "a";
            (ed as any)._selection = [{ kind: "area", id: selectedId }];
            await ed.updateComplete;

            const svg = ed.shadowRoot!.querySelector("svg") as SVGSVGElement;
            const near = screenPoint(svg, midWorld.x, midWorld.y);
            const edge = findAreaEdge(ed, selectedId, side, near);
            const from = center(edge);
            pointer(edge, "pointerdown", from.x, from.y);
            pointer(edge, "pointermove", from.x + rotDelta.x, from.y + rotDelta.y);
            await frame();
            await ed.updateComplete;
            pointer(edge, "pointerup", from.x + rotDelta.x, from.y + rotDelta.y);
            await ed.updateComplete;

            const selBefore = selectedId === "a" ? aWorld : bWorld;
            const otherBefore = otherId === "a" ? aWorld : bWorld;
            const selAfter = (ed as any)._floor().areas.find((area: any) => area.id === selectedId).points;
            const otherAfter = (ed as any)._floor().areas.find((area: any) => area.id === otherId).points;

            expectAxisAligned(selAfter);
            expectAxisAligned(otherAfter);

            const selBeforeBoundary = boundaryValue(selBefore, side);
            const selAfterBoundary = boundaryValue(selAfter, side);
            const movedAmount = Math.abs(selAfterBoundary - selBeforeBoundary);
            expect(movedAmount).toBeGreaterThan(0.25);

            const otherOpp = oppositeSide(side);
            const otherBeforeBoundary = boundaryValue(otherBefore, otherOpp);
            const otherAfterBoundary = boundaryValue(otherAfter, otherOpp);
            const otherMoved = Math.abs(otherAfterBoundary - otherBeforeBoundary);
            expect(otherMoved).toBeGreaterThan(0.25);

            expect(selAfterBoundary).toBeCloseTo(otherAfterBoundary, 6);

            document.body.innerHTML = "";
          });
        }
      }
    }
  });
});
