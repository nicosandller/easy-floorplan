import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig, Opening } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

/**
 * The card, not just `wallSolids`: the card hands the wall its openings as a
 * projection of its own, and a sill left out of that hand-off drew the
 * default parapet under a floor-to-ceiling window whatever the config said.
 */
async function render(rotation: number, window: Partial<Opening>) {
  const card = document.createElement("easy-floorplan-card");
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 300, height: 300, view: "3d", wallHeight: 100,
    rotation,
    walls: [{ id: "w", x1: 20, y1: 150, x2: 280, y2: 150, thickness: 10 }],
    openings: [{ id: "win", type: "window", motion: "fixed", x: 150, y: 150, angle: 0, length: 60, ...window }],
    areas: [], furniture: [], items: [], texts: [], trackers: [],
  } as FloorplanCardConfig);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  return card.shadowRoot!;
}

/** Screen height of the tallest sill piece, 0 when there is none. */
const sillHeight = (root: ShadowRoot) => {
  const faces = [...root.querySelectorAll<SVGPolygonElement>(".fp-iso-sill .fp-iso-face")];
  return Math.max(0, ...faces.map((f) => {
    const ys = [...f.points].map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  }));
};

it.each([0, 90, 180, 270])("stands a floor-to-ceiling window on no sill at rotation %s", async (rotation) => {
  const root = await render(rotation, { sill: 0 });
  expect(root.querySelector(".fp-iso-sill")).toBeNull();
  // The pane itself still stands in the gap, from the floor.
  expect(root.querySelector('.fp-iso-panel[data-id="win"]')).not.toBeNull();
});

it.each([0, 90, 180, 270])("raises a window's sill with its own value at rotation %s", async (rotation) => {
  const standard = sillHeight(await render(rotation, {}));
  document.body.innerHTML = "";
  const high = sillHeight(await render(rotation, { sill: 0.7 }));
  expect(standard).toBeGreaterThan(0);
  expect(high).toBeGreaterThan(standard);
});
