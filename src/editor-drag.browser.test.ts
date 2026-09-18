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

    const [edge] = ed.shadowRoot!.querySelectorAll<SVGLineElement>(".area-edge-hit");
    expect(edge).toBeTruthy();

    const from = center(edge!);
    pointer(edge!, "pointerdown", from.x, from.y);
    pointer(edge!, "pointermove", from.x + 10, from.y);
    pointer(edge!, "pointerup", from.x + 10, from.y);
    await ed.updateComplete;

    expect((ed as any)._floor().areas[0].points[1].x).toBe(20);
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
});
