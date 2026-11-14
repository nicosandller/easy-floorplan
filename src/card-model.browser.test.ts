import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";
async function mount(extra: Partial<FloorplanCardConfig> = {}) {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.style.width = "800px";
  card.setConfig({ type: "custom:easy-floorplan-card", width: 400, height: 400, view: "3d", wallHeight: 120, furniture3d: true,
    walls: [], openings: [], items: [], furniture: [{ id: "shelf", type: "cornerShelf", x: 200, y: 200, w: 60, h: 60 }], ...extra } as FloorplanCardConfig);
  document.body.append(card);
  await card.updateComplete;
  return card.shadowRoot!;
}
afterEach(() => { document.body.innerHTML = ""; });
it.each([0, 90, 180, 270] as const)("renders three visible shelf levels and three supports at rotation %s", async rotation => {
  const root = await mount({ rotation });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(6);
  const tops = Array.from(root.querySelectorAll('.fp-iso-furniture .fp-iso-top'));
  expect(tops.filter(p => p.getAttribute("points")!.split(" ").length === 5)).toHaveLength(3);
  for (const p of tops) expect(p.getAttribute("points")).not.toMatch(/NaN|Infinity/);
  expect(root.querySelector('.fp-furniture-cornerShelf')).toBeNull();
});
it("keeps the old block fallback for invalid custom model data", async () => {
  const root = await mount({ symbols: { cornerShelf: { id: "cornerShelf", parts: [{ rect: [0, 0, 100, 100] }], model3d: { version: 999 } } } });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(1);
});
it.each([{ view: "2d" }, { wallHeight: 0 }] as Partial<FloorplanCardConfig>[])("keeps plan geometry when not standing: %j", async extra => {
  const root = await mount(extra);
  expect(root.querySelectorAll('.fp-iso-furniture')).toHaveLength(0);
  expect(root.querySelector('.fp-furniture')).not.toBeNull();
});

it("keeps the configured section height when a tall wall expands the frame", async () => {
  const root = await mount({ wallHeight: 120, furniture3d: true, walls: [{ id: "tall", x1: 10, y1: 10, x2: 390, y2: 10, height: 300 }] });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(6);
});
it("renders a newly added 2D-only symbol with the block fallback", async () => {
  const root = await mount({ furniture: [{ id: "palm", type: "awning", x: 200, y: 200, w: 40, h: 40 }] });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="palm"]')).toHaveLength(1);
});

it.each([undefined, false])("keeps existing plans on block furniture: %s", async furniture3d => {
  const root = await mount({ furniture3d, furnitureSeparateSection: true, furnitureSectionHeight: 200 });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(1);
  expect(root.querySelector('.fp-furniture-cornerShelf')).not.toBeNull();
});
it("changes the furniture cut without changing the walls", async () => {
  const config = { wallHeight: 60, furnitureSeparateSection: true, furnitureSectionHeight: 180,
    walls: [{ id: "wall", x1: 10, y1: 10, x2: 390, y2: 10 }] };
  const root = await mount(config);
  const wall = root.querySelector('.fp-iso-wall')!.innerHTML;
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(7);
  const card = root.host as FloorplanCard;
  card.setConfig({ type: "custom:easy-floorplan-card", width: 400, height: 400, view: "3d",
    furniture3d: true, furniture: [{ id: "shelf", type: "cornerShelf", x: 200, y: 200, w: 60, h: 60 }],
    ...config, furnitureSectionHeight: 60 });
  await card.updateComplete;
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(5);
  expect(root.querySelector('.fp-iso-wall')!.innerHTML).toBe(wall);
});
it("ignores a saved separate height when the separate cut is disabled", async () => {
  const root = await mount({ wallHeight: 60, furnitureSeparateSection: false, furnitureSectionHeight: 200 });
  expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]')).toHaveLength(5);
});
it("keeps tall furniture within the canvas with low walls", async () => {
  const root = await mount({ wallHeight: 60, furnitureSeparateSection: true, furnitureSectionHeight: 200 });
  const bounds = root.querySelector('.plan')!.getBoundingClientRect();
  for (const face of root.querySelectorAll<SVGPolygonElement>('.fp-iso-furniture polygon')) {
    for (const p of Array.from(face.points)) {
      const screen = new DOMPoint(p.x, p.y).matrixTransform(face.getScreenCTM()!);
      expect(screen.y).toBeGreaterThanOrEqual(bounds.top - 1);
      expect(screen.y).toBeLessThanOrEqual(bounds.bottom + 1);
    }
  }
});

it("scales the model before cutting so a shorter shelf retains all five levels", async () => {
  const root = await mount({ furniture: [{ id: "shelf", type: "cornerShelf", x: 200, y: 200, w: 60, h: 60, height3d: 100 }] });
  const tops = Array.from(root.querySelectorAll('.fp-iso-furniture .fp-iso-top'));
  expect(tops.filter(p => p.getAttribute("points")!.split(" ").length === 5)).toHaveLength(5);
  for (const p of tops) expect(p.getAttribute("points")).not.toMatch(/NaN|Infinity/);
});

it("removes and restores cached 3D furniture when visibility changes", async () => {
  const root = await mount({ furniture: [{ id: "shelf", type: "cornerShelf", x: 200, y: 200, w: 60, h: 60,
    showIcon: false, tap_action: { action: "fire-dom-event" },
    visibility: [{ condition: "state", entity: "input_boolean.show_shelf", state: "on" }] }] });
  const card = root.host as FloorplanCard;
  for (const state of ["on", "off", "on"]) {
    card.hass = { states: { "input_boolean.show_shelf": { entity_id: "input_boolean.show_shelf", state, attributes: {} } }, entities: {} } as unknown as FloorplanCard["hass"];
    await card.updateComplete;
    expect(root.querySelectorAll('.fp-iso-furniture[data-id="shelf"]').length).toBe(state === "on" ? 6 : 0);
    expect(root.querySelectorAll('.fp-furniture-hit[role="button"]').length).toBe(state === "on" ? 1 : 0);
  }
});
