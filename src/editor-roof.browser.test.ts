import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Roof } from "./types";

function config(): FloorplanCardConfig {
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
        walls: [],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [
          {
            id: "living_room",
            name: "Living Room",
            points: [
              { x: 100, y: 100 },
              { x: 500, y: 100 },
              { x: 500, y: 500 },
              { x: 100, y: 500 },
            ],
          },
        ],
        roofs: [],
      },
    ],
  };
}

function pointer(target: Element, type: string, clientX: number, clientY: number): void {
  target.dispatchEvent(
    new PointerEvent(type, {
      clientX,
      clientY,
      pointerId: 1,
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

async function mountEditor() {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "600px";
  document.body.appendChild(host);

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
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
    root,
    emitted,
    async tool(label: string) {
      root.querySelector<HTMLButtonElement>(`button[title="${label}"]`)!.click();
      await ed.updateComplete;
    },
    async drag(x0: number, y0: number, x1: number, y1: number) {
      const svg = root.querySelector<SVGSVGElement>("svg")!;
      const r = svg.getBoundingClientRect();
      const p0 = { x: r.left + (x0 / 1000) * r.width, y: r.top + (y0 / 600) * r.height };
      const p1 = { x: r.left + (x1 / 1000) * r.width, y: r.top + (y1 / 600) * r.height };
      pointer(svg, "pointerdown", p0.x, p0.y);
      await ed.updateComplete;
      pointer(svg, "pointermove", p1.x, p1.y);
      // Wait past AREA_DRAG_HOLD_MS (200ms)
      await new Promise((resolve) => setTimeout(resolve, 250));
      pointer(svg, "pointermove", p1.x, p1.y);
      await ed.updateComplete;
      pointer(svg, "pointerup", p1.x, p1.y);
      await ed.updateComplete;
    },
    roofs: (): Roof[] =>
      (emitted[emitted.length - 1]?.floors![0].roofs ?? []) as Roof[],
  };
}

describe("Roof tool in editor", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws a roof by dragging a rectangle and selects it", async () => {
    const t = await mountEditor();
    await t.tool("Roof");
    await t.drag(80, 80, 520, 520);

    const roofs = t.roofs();
    expect(roofs.length).toBe(1);
    const r = roofs[0]!;
    expect(r.type).toBe("gable");
    expect(r.points.length).toBe(4);

    // Inspector should now be showing the Roof form with Living Room listed under it
    await t.ed.updateComplete;
    const livingChip = [...t.root.querySelectorAll<HTMLButtonElement>(".chip-btn")].find((btn) =>
      btn.textContent?.includes("Living Room")
    );
    expect(livingChip).toBeDefined();

    // Clicking Living Room chip selects the room
    livingChip!.click();
    await t.ed.updateComplete;

    // Room inspector now shows the roof chip above it
    const roofChip = [...t.root.querySelectorAll<HTMLButtonElement>(".chip-btn")].find((btn) =>
      btn.textContent?.includes("Roof")
    );
    expect(roofChip).toBeDefined();

    // Clicking the roof chip selects the roof again
    roofChip!.click();
    await t.ed.updateComplete;
    const livingChipAgain = [...t.root.querySelectorAll<HTMLButtonElement>(".chip-btn")].find((btn) =>
      btn.textContent?.includes("Living Room")
    );
    expect(livingChipAgain).toBeDefined();
  });

  it("creates a roof from room via button in area inspector", async () => {
    const t = await mountEditor();
    // Select the living room area
    (t.ed as any)._selection = [{ kind: "area", id: "living_room" }];
    await t.ed.updateComplete;

    const createBtn = [...t.root.querySelectorAll<HTMLButtonElement>("button")].find((btn) =>
      btn.textContent?.includes("Create Roof from Room")
    );
    expect(createBtn).toBeDefined();
    createBtn!.click();
    await t.ed.updateComplete;

    const roofs = t.roofs();
    expect(roofs.length).toBe(1);
    expect(roofs[0]!.type).toBe("gable");
    expect(roofs[0]!.points.length).toBe(4);

    // Inspector should now be showing the newly created roof with Living Room under it
    const chip = [...t.root.querySelectorAll<HTMLButtonElement>(".chip-btn")].find((btn) =>
      btn.textContent?.includes("Living Room")
    );
    expect(chip).toBeDefined();
  });

  it("nudges a selected roof with arrow keys", async () => {
    const t = await mountEditor();
    const roof: Roof = {
      id: "roof1",
      type: "gable",
      points: [
        { x: 100, y: 100 },
        { x: 300, y: 100 },
        { x: 300, y: 300 },
        { x: 100, y: 300 },
      ],
      height: 30,
    };
    (t.ed as any)._commitFloor({ roofs: [roof] });
    (t.ed as any)._selection = [{ kind: "roof", id: "roof1" }];
    await t.ed.updateComplete;

    t.ed.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true })
    );
    await t.ed.updateComplete;

    const roofs = t.roofs();
    expect(roofs[0]!.points[0]!.x).toBe(101);
    expect(roofs[0]!.points[1]!.x).toBe(301);

    // Locked roof does not move
    (t.ed as any)._commitFloor({ roofs: [{ ...roofs[0]!, locked: true }] });
    await t.ed.updateComplete;
    t.ed.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, composed: true, cancelable: true })
    );
    await t.ed.updateComplete;
    expect(t.roofs()[0]!.points[0]!.x).toBe(101);
  });

  it("prioritizes area over roof on first click and cycles to roof", async () => {
    const t = await mountEditor();
    const roof: Roof = {
      id: "roof_over",
      type: "gable",
      points: [
        { x: 50, y: 50 },
        { x: 550, y: 50 },
        { x: 550, y: 550 },
        { x: 50, y: 550 },
      ],
      height: 30,
    };
    (t.ed as any)._commitFloor({ roofs: [roof] });
    (t.ed as any)._tool = "select";
    await t.ed.updateComplete;

    // Both living_room (100..500) and roof_over (50..550) cover (300, 300)
    const svg = t.root.querySelector<SVGSVGElement>("svg")!;
    const r = svg.getBoundingClientRect();
    const px = r.left + (300 / 1000) * r.width;
    const py = r.top + (300 / 600) * r.height;

    const hit = t.root.querySelector<SVGPolygonElement>(".roof-hit .area-hit-shape")!;
    // First click on the spot: area is picked first
    pointer(hit, "pointerdown", px, py);
    pointer(hit, "pointerup", px, py);
    await t.ed.updateComplete;
    expect((t.ed as any)._selection).toEqual([{ kind: "area", id: "living_room" }]);

    // Second click on the exact same spot: cycles to roof
    pointer(hit, "pointerdown", px, py);
    pointer(hit, "pointerup", px, py);
    await t.ed.updateComplete;
    expect((t.ed as any)._selection).toEqual([{ kind: "roof", id: "roof_over" }]);
  });
});
