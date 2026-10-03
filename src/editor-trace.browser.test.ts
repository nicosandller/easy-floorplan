/** Trace gestures and wall-tool preferences through the rendered editor. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig } from "./types";

const THICKNESS_KEY = "easy-floorplan:wall-thickness";
let savedThickness: string | null;

async function mountEditor() {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig({
    type: "custom:easy-floorplan-card", width: 1000, height: 600, grid: 20, snap: 0,
    floors: [{ id: "f1", name: "Ground floor", walls: [], openings: [], items: [],
      texts: [], furniture: [], trackers: [], areas: [] }],
  });
  host.appendChild(ed);
  await ed.updateComplete;
  const root = ed.shadowRoot!;
  const svg = root.querySelector<SVGSVGElement>("svg")!;
  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });

  function pointer(target: Element, type: string, id: number, x: number, y: number, pointerType = "pen") {
    const p = new DOMPoint(x, y).matrixTransform(svg.getScreenCTM()!);
    target.dispatchEvent(new PointerEvent(type, {
      clientX: p.x, clientY: p.y, pointerId: id, pointerType, button: 0,
      buttons: type === "pointerup" || type === "pointercancel" ? 0 : 1,
      bubbles: true, composed: true, cancelable: true,
    }));
  }

  async function button(selector: string) {
    root.querySelector<HTMLButtonElement>(selector)!.click();
    await ed.updateComplete;
  }

  return {
    ed, host, root, svg, emitted, pointer, button,
    async loadTrace() {
      await button(".panel .section-toggle");
      const group = [...root.querySelectorAll<HTMLButtonElement>(".cfg-group-title")]
        .find((b) => b.textContent?.includes("Trace template"))!;
      group.click();
      await ed.updateComplete;
      const input = root.querySelector<HTMLInputElement>("input.trace-file")!;
      const transfer = new DataTransfer();
      transfer.items.add(new File([
        '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600"><path d="M100 100H900V500H100Z" fill="none" stroke="black"/></svg>',
      ], "plan.svg", { type: "image/svg+xml" }));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await expect.poll(() => root.querySelector("g.trace image")).not.toBeNull();
      await ed.updateComplete;
      expect(emitted).toHaveLength(0);
    },
    async traceMode(mode: "move" | "calibrate") {
      await button(mode === "move"
        ? 'button[title="Drag the template on the canvas"]'
        : 'button[title^="Click both ends"]');
      return root.querySelector<SVGRectElement>(".trace-sheet")!;
    },
    translation() {
      return root.querySelector<SVGGElement>("g.trace")!.transform.baseVal.getItem(0).matrix.e;
    },
    async drawWall() {
      pointer(svg, "pointerdown", 21, 100, 200);
      pointer(svg, "pointermove", 21, 300, 200);
      pointer(svg, "pointerup", 21, 300, 200);
      await ed.updateComplete;
      const walls = emitted[emitted.length - 1]?.floors![0].walls ?? [];
      return walls[walls.length - 1];
    },
  };
}

beforeEach(() => {
  savedThickness = localStorage.getItem(THICKNESS_KEY);
  localStorage.removeItem(THICKNESS_KEY);
});

afterEach(() => {
  for (const ed of document.querySelectorAll("easy-floorplan-card-editor")) {
    const src = ed.shadowRoot?.querySelector("g.trace image")?.getAttribute("href");
    if (src) URL.revokeObjectURL(src);
  }
  document.body.innerHTML = "";
  if (savedThickness === null) localStorage.removeItem(THICKNESS_KEY);
  else localStorage.setItem(THICKNESS_KEY, savedThickness);
});

describe("trace template gestures", () => {
  it("keeps the first pointer in charge until release, then accepts a new drag", async () => {
    const t = await mountEditor();
    await t.loadTrace();
    const sheet = await t.traceMode("move");
    t.pointer(sheet, "pointerdown", 1, 100, 100);
    t.pointer(sheet, "pointermove", 1, 140, 100);
    // Two touches enter the wrap's pinch handler. A touch during a pen drag
    // reaches the trace sheet instead, and must not take over that drag.
    t.pointer(sheet, "pointerdown", 2, 500, 300, "touch");
    t.pointer(sheet, "pointermove", 2, 650, 300, "touch");
    await t.ed.updateComplete;
    expect(t.translation()).toBeCloseTo(40);
    t.pointer(sheet, "pointerup", 2, 650, 300, "touch");
    t.pointer(sheet, "pointermove", 1, 200, 100);
    await t.ed.updateComplete;
    expect(t.translation()).toBeCloseTo(100);
    t.pointer(sheet, "pointerup", 1, 200, 100);
    t.pointer(sheet, "pointermove", 1, 250, 100);
    await t.ed.updateComplete;
    expect(t.translation()).toBeCloseTo(100);
    t.pointer(sheet, "pointerdown", 3, 300, 100);
    t.pointer(sheet, "pointermove", 3, 340, 100);
    t.pointer(sheet, "pointerup", 3, 340, 100);
    await t.ed.updateComplete;
    expect(t.translation()).toBeCloseTo(140);
    expect(t.emitted).toHaveLength(0);
  });

  it("accepts a new trace drag after the editor is reparented mid-gesture", async () => {
    const t = await mountEditor();
    await t.loadTrace();
    let sheet = await t.traceMode("move");
    t.pointer(sheet, "pointerdown", 1, 100, 100);
    t.pointer(sheet, "pointermove", 1, 140, 100);
    await t.ed.updateComplete;
    t.ed.remove();
    t.host.appendChild(t.ed);
    await t.ed.updateComplete;
    sheet = t.root.querySelector<SVGRectElement>(".trace-sheet")!;
    t.pointer(sheet, "pointerdown", 2, 100, 100);
    t.pointer(sheet, "pointermove", 2, 160, 100);
    t.pointer(sheet, "pointerup", 2, 160, 100);
    await t.ed.updateComplete;
    expect(t.translation()).toBeCloseTo(100);
    expect(t.emitted).toHaveLength(0);
  });

  it.each(["move", "calibrate"] as const)("leaves %s mode when a drawing tool is selected", async (mode) => {
    const t = await mountEditor();
    await t.loadTrace();
    const sheet = await t.traceMode(mode);
    t.pointer(sheet, "pointerdown", 1, 100, 100);
    t.pointer(sheet, "pointerup", 1, 100, 100);
    await t.ed.updateComplete;
    await t.button('button[title="Wall"]');
    expect(t.root.querySelector(".trace-sheet")).toBeNull();
    expect(t.root.querySelector(".ctx-label")?.textContent).toBe("Wall");
    const wall = await t.drawWall();
    expect(wall?.x1).toBeCloseTo(100);
    expect(wall?.y1).toBeCloseTo(200);
    expect(wall?.x2).toBeCloseTo(300);
    expect(wall?.y2).toBeCloseTo(200);
    expect(t.emitted).toHaveLength(1);
    expect(JSON.stringify(t.emitted[0])).not.toMatch(/blob:|plan\.svg|trace/i);
    await t.traceMode("calibrate");
    expect(t.root.querySelectorAll(".trace-mark")).toHaveLength(0);
  });
});

describe("wall thickness preference", () => {
  it.each([undefined, 6])("keeps thickness %s when its field is cleared", async (thickness) => {
    const t = await mountEditor();
    await t.button('button[title="Wall"]');
    const input = t.root.querySelector<HTMLInputElement>(".context-bar input.num")!;
    if (thickness !== undefined) {
      input.value = String(thickness);
      input.dispatchEvent(new Event("change", { bubbles: true }));
      await t.ed.updateComplete;
    }
    input.value = "";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;
    expect(input.value).toBe(String(thickness ?? 8));
    expect(localStorage.getItem(THICKNESS_KEY)).toBe(thickness === undefined ? null : String(thickness));
    expect((await t.drawWall())?.thickness).toBe(thickness);
    const reopened = await mountEditor();
    await reopened.button('button[title="Wall"]');
    expect(reopened.root.querySelector<HTMLInputElement>(".context-bar input.num")!.value)
      .toBe(String(thickness ?? 8));
  });
});
