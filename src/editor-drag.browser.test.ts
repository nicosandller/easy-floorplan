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

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
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
    })
  );
}

function frame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function center(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
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
});
