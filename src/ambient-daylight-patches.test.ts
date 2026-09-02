import { describe, expect, it } from "vitest";
import type { Area, Opening } from "./types";
import {
  DEFAULT_AMBIENT_DAYLIGHT_STRENGTH,
  ambientDaylightDayFactor,
  ambientDaylightPatches,
  ambientOpeningSources,
} from "./ambient-daylight";

function rect(id: string, x1: number, y1: number, x2: number, y2: number): Area {
  return {
    id,
    points: [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ],
  };
}

function opening(id: string, x: number, y: number, overrides: Partial<Opening> = {}): Opening {
  return {
    id,
    type: "window",
    x,
    y,
    length: 100,
    angle: 0,
    ...overrides,
  };
}

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("ambient daylight render patches", () => {
  it("uses smooth civil-twilight easing rather than a linear ramp", () => {
    expect(ambientDaylightDayFactor(-6)).toBe(0);
    expect(ambientDaylightDayFactor(-3)).toBeCloseTo(0.15625, 12);
    expect(ambientDaylightDayFactor(0)).toBeCloseTo(0.5, 12);
    expect(ambientDaylightDayFactor(3)).toBeCloseTo(0.84375, 12);
    expect(ambientDaylightDayFactor(6)).toBe(1);
  });

  it("builds one broad inward patch for a north-side exterior window", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("north-window", 200, 0)]);
    const patches = ambientDaylightPatches(room, sources, 25);

    expect(patches).toHaveLength(1);
    const patch = patches[0]!;
    expect(patch.openingId).toBe("north-window");
    expect(patch.areaId).toBe("bedroom");
    expect(patch.opacity).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_STRENGTH, 12);
    expect(patch.gradientStart.x).toBeCloseTo(200, 12);
    expect(patch.gradientStart.y).toBeCloseTo(0, 12);
    expect(patch.gradientEnd.x).toBeCloseTo(200, 12);
    expect(patch.gradientEnd.y).toBeGreaterThan(0);
  });

  it("starts at the opening width and fans wider toward the room", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0, { length: 80 })]);
    const patch = ambientDaylightPatches(room, sources, 25)[0]!;

    const nearWidth = distance(patch.points[0], patch.points[1]);
    const farWidth = distance(patch.points[2], patch.points[3]);
    expect(nearWidth).toBeCloseTo(80, 12);
    expect(farWidth).toBeGreaterThan(nearWidth);
  });

  it("returns no patch at night", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    expect(ambientDaylightPatches(room, sources, -10)).toEqual([]);
  });

  it("returns no patch when opening transmission is zero", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    expect(ambientDaylightPatches(room, sources, 25, () => 0)).toEqual([]);
  });

  it("scales patch opacity by opening transmission", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    const full = ambientDaylightPatches(room, sources, 25, () => 1)[0]!;
    const quarter = ambientDaylightPatches(room, sources, 25, () => 0.25)[0]!;

    expect(full.opacity).toBeCloseTo(DEFAULT_AMBIENT_DAYLIGHT_STRENGTH, 12);
    expect(quarter.opacity).toBeCloseTo(full.opacity * 0.25, 12);
  });

  it("does not create a patch for an opening shared by two rooms", () => {
    const left = rect("left", 0, 0, 200, 300);
    const right = rect("right", 200, 0, 400, 300);
    const innerDoor = opening("inner-door", 200, 150, { type: "door", angle: 90 });
    const sources = ambientOpeningSources([left, right], [innerDoor]);

    expect(sources).toEqual([]);
    expect(ambientDaylightPatches(left, sources, 25)).toEqual([]);
    expect(ambientDaylightPatches(right, sources, 25)).toEqual([]);
  });

  it("keeps patch geometry renderer-agnostic and leaves Area clipping to SVG", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0, { length: 100 })]);
    const patch = ambientDaylightPatches(room, sources, 25)[0]!;

    // The broad far edge intentionally extends beyond the room in this setup.
    // The later SVG renderer must clip the patch with the exact Area polygon.
    expect(patch.points.some((p) => p.x < 0 || p.x > 400 || p.y < 0 || p.y > 300)).toBe(true);
  });
});
