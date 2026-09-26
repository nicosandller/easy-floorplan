import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

afterEach(() => { document.body.innerHTML = ""; });

it.each([0, 90, 180, 270])("retains railing kind, weight and half height in 3D at rotation %s", async rotation => {
  const card = document.createElement("easy-floorplan-card");
  const config = {
    type: "custom:easy-floorplan-card", width: 300, height: 300, view: "3d", wallHeight: 80,
    wallOpacity: 0.45, rotation,
    walls: [
      { id: "solid", x1: 20, y1: 80, x2: 220, y2: 80, thickness: 10 },
      { id: "rail", x1: 20, y1: 160, x2: 220, y2: 160, thickness: 10, kind: "railing" },
    ], areas: [], openings: [], furniture: [], items: [], texts: [], trackers: [],
  } as FloorplanCardConfig;
  card.setConfig(config);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  const root = card.shadowRoot!;
  const rail = root.querySelector('.fp-iso-railing[data-id="rail"]');
  expect(rail).not.toBeNull();
  expect(root.querySelector('.fp-iso-wall[data-id="rail"]')).toBeNull();
  expect(getComputedStyle(rail!).opacity).toBe("0.45");
  const size = (selector: string) => {
    const ps = [...root.querySelectorAll<SVGPolygonElement>(selector)].flatMap(p => [...p.points]);
    return { x: Math.max(...ps.map(p => p.x)) - Math.min(...ps.map(p => p.x)),
      y: Math.max(...ps.map(p => p.y)) - Math.min(...ps.map(p => p.y)) };
  };
  const wallTop = size('.fp-iso-wall .fp-iso-top');
  const railTop = size('.fp-iso-railing .fp-iso-top');
  const axis = rotation % 180 === 0 ? "y" : "x";
  expect(railTop[axis]).toBeCloseTo(wallTop[axis] * 0.4);
  const face = rail!.querySelector<SVGPolygonElement>(".fp-iso-face")!;
  // Each vertical edge moves by (-height,-height) before the common projection.
  expect(Math.abs(face.points[0]!.x - face.points[3]!.x)).toBeCloseTo(40);
  expect(Math.abs(face.points[0]!.y - face.points[3]!.y)).toBeCloseTo(40);
  card.setConfig({ ...config, wallHeight: 0 });
  await card.updateComplete;
  expect(root.querySelector(".fp-iso-railing")).toBeNull();
  expect(root.querySelector('.fp-wall.railing[data-id="rail"]')).not.toBeNull();
});
