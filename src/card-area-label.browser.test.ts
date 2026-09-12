import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";

afterEach(() => { document.body.innerHTML = ""; });
it.each([0, 90, 180, 270] as const)("renders the area-weighted label anchor at rotation %s", async (rotation) => {
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  // A rectangle with an extra vertex on its top edge: its floor centre remains (50, 30).
  card.setConfig({
    type: "custom:easy-floorplan-card", width: 200, height: 100, rotation,
    floors: [{ id: "ground", name: "Ground", walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [],
      areas: [{ id: "room", name: "Room", points: [
        { x: 0, y: 0 }, { x: 20, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 },
      ] }],
    }],
  } as FloorplanCardConfig);
  card.hass = { states: {}, entities: {} } as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  const label = card.shadowRoot!.querySelector(".area-label") as HTMLElement;
  const expected = { 0: [25, 30], 90: [70, 25], 180: [75, 70], 270: [30, 75] }[rotation]!;
  expect(parseFloat(label.style.left)).toBeCloseTo(expected[0]!, 2);
  expect(parseFloat(label.style.top)).toBeCloseTo(expected[1]!, 2);
});
