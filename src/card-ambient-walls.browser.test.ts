import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { Area, FloorplanCardConfig } from "./types";

afterEach(() => { document.body.innerHTML = ""; });
const rectangle = (x: number, width: number): Area["points"] => [
  { x, y: 20 }, { x: x + width, y: 20 }, { x: x + width, y: 320 }, { x, y: 320 },
];
const config = (): FloorplanCardConfig => ({
  type: "custom:easy-floorplan-card", width: 440, height: 340,
  ambientDaylight: true, sunlight: false,
  walls: [
    { id: "top", x1: 20, y1: 20, x2: 420, y2: 20 },
    { id: "right", x1: 420, y1: 20, x2: 420, y2: 320 },
    { id: "bottom", x1: 420, y1: 320, x2: 20, y2: 320 },
    { id: "left", x1: 20, y1: 320, x2: 20, y2: 20 },
  ],
  openings: [{ id: "outside", type: "window", x: 20, y: 170, length: 70, angle: 90 }],
  areas: [], items: [], furniture: [], texts: [], trackers: [],
});
async function mount(c: FloorplanCardConfig): Promise<FloorplanCard> {
  const card = document.createElement("easy-floorplan-card");
  card.setConfig(c);
  card.hass = { states: {
    "sun.sun": { state: "above_horizon", attributes: { elevation: 30, azimuth: 90 } },
    "binary_sensor.door": { state: "on", attributes: { device_class: "door" } },
  }, entities: {} } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  return card;
}

// Query the browser's actual SVG geometry and every applied ancestor clip.
// This catches a correct visibility calculation that the renderer never uses.
function reaches(card: FloorplanCard, x: number, y: number): boolean {
  const patch = card.shadowRoot!.querySelector<SVGPolygonElement>(".fp-ambient-daylight-patch");
  if (!patch || !patch.isPointInFill(new DOMPoint(x, y))) return false;
  for (let element = patch.parentElement; element; element = element.parentElement) {
    const id = element.getAttribute("clip-path")?.match(/^url\(#(.+)\)$/)?.[1];
    if (!id) continue;
    const polygon = card.shadowRoot!.getElementById(id)?.querySelector<SVGPolygonElement>("polygon");
    if (polygon && !polygon.isPointInFill(new DOMPoint(x, y))) return false;
  }
  return true;
}

it("renders from walls without Areas and stops the blurred wash at an internal wall", async () => {
  const c = config();
  c.walls!.push({ id: "partition", x1: 180, y1: 20, x2: 180, y2: 320 });
  const card = await mount(c);
  expect(reaches(card, 120, 170)).toBe(true);
  expect(reaches(card, 200, 170)).toBe(false);
  const patch = card.shadowRoot!.querySelector(".fp-ambient-daylight-patch")!;
  expect(patch.getAttribute("filter")).toMatch(/^url\(#/);
  expect(patch.parentElement!.getAttribute("clip-path")).toMatch(/^url\(#/);
});

it("keeps light identical when an open floor is relabelled or split into Areas", async () => {
  const c = config();
  c.areas = [{ id: "whole", points: rectangle(20, 400) }];
  const card = await mount(c);
  const before = card.shadowRoot!.querySelector(".fp-ambient-daylight")!.outerHTML;
  c.areas = [{ id: "left", name: "Lounge", points: rectangle(20, 160) },
    { id: "right", name: "Kitchen", points: rectangle(180, 240) }];
  card.setConfig(c);
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector(".fp-ambient-daylight")!.outerHTML).toBe(before);
  expect(reaches(card, 240, 170)).toBe(true);
});

it("lights an unlabelled porch and passes its outside light through the kitchen door", async () => {
  const c = config();
  c.walls!.push({ id: "partition", x1: 180, y1: 20, x2: 180, y2: 320 });
  c.areas = [{ id: "kitchen", points: rectangle(180, 240) }];
  c.openings!.push({ id: "inside", type: "door", x: 180, y: 170, length: 70, angle: 90, entity: "binary_sensor.door" });
  const card = await mount(c);
  const sources = [...card.shadowRoot!.querySelectorAll(".fp-ambient-daylight-patch")]
    .map(p => p.getAttribute("data-opening-id"));
  expect(sources).toEqual(["outside"]);
  expect(reaches(card, 120, 170)).toBe(true);
  expect(reaches(card, 220, 170)).toBe(true);
  expect(reaches(card, 220, 60)).toBe(false);
});

it("uses generated room walls as blockers while letting light cross dividers", async () => {
  const c = config();
  c.areas = [{ id: "right", points: rectangle(180, 240), sideWalls: { left: "wall" } }];
  const card = await mount(c);
  expect(reaches(card, 220, 170)).toBe(false);
  c.areas[0]!.sideWalls = { left: "divider" };
  card.setConfig(c);
  await card.updateComplete;
  expect(reaches(card, 220, 170)).toBe(true);
});

it("still clips the Area fallback against walls when no closed outline exists", async () => {
  const c = config();
  c.walls = [{ id: "partition", x1: 180, y1: 20, x2: 180, y2: 320 }];
  c.areas = [{ id: "whole", points: rectangle(20, 400) }];
  const card = await mount(c);
  expect(reaches(card, 120, 170)).toBe(true);
  expect(reaches(card, 220, 170)).toBe(false);
});
