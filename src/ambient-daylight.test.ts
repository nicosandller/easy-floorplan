import { describe, expect, it } from "vitest";
import type { Area, Opening } from "./types";
import {
  DEFAULT_AMBIENT_DAYLIGHT_DEPTH,
  DEFAULT_AMBIENT_DAYLIGHT_SPREAD,
  DEFAULT_AMBIENT_DAYLIGHT_STRENGTH,
  ambientDaylightAtPoint,
  ambientDaylightDayFactor,
  ambientOpeningSources,
  ambientOpeningTransmission,
  openingAdjacentAreas,
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

describe("ambient daylight prototype", () => {
  it("derives an exterior source from an opening touching exactly one room", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const win = opening("north-window", 200, 0);

    expect(openingAdjacentAreas(win, [room])).toHaveLength(1);
    const sources = ambientOpeningSources([room], [win]);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.openingId).toBe("north-window");
    expect(sources[0]?.areaId).toBe("bedroom");
    expect(sources[0]?.inwardX).toBeCloseTo(0, 12);
    expect(sources[0]?.inwardY).toBeCloseTo(1, 12);
  });

  it("does not turn an opening shared by two rooms into a second sky source", () => {
    const left = rect("left", 0, 0, 200, 300);
    const right = rect("right", 200, 0, 400, 300);
    const innerDoor = opening("inner-door", 200, 150, { type: "door", angle: 90 });

    expect(openingAdjacentAreas(innerDoor, [left, right])).toHaveLength(2);
    expect(ambientOpeningSources([left, right], [innerDoor])).toEqual([]);
  });

  it("brightens a room through a north-side window without any sun-bearing input", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const win = opening("north-window", 200, 0);
    const sources = ambientOpeningSources([room], [win]);

    // There deliberately is no azimuth/bearing argument: diffuse skylight is
    // independent of whether direct sun currently reaches this facade.
    const light = ambientDaylightAtPoint(room, sources, { x: 200, y: 90 }, 35);
    expect(light).toBeGreaterThan(0);
    expect(light).toBeLessThanOrEqual(1);
  });

  it("clips the field to the room polygon", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);

    expect(ambientDaylightAtPoint(room, sources, { x: 200, y: 100 }, 20)).toBeGreaterThan(0);
    expect(ambientDaylightAtPoint(room, sources, { x: 200, y: -1 }, 20)).toBe(0);
    expect(ambientDaylightAtPoint(room, sources, { x: 401, y: 100 }, 20)).toBe(0);
  });

  it("fades smoothly with depth instead of drawing a hard ray", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);

    const near = ambientDaylightAtPoint(room, sources, { x: 200, y: 40 }, 20);
    const middle = ambientDaylightAtPoint(room, sources, { x: 200, y: 130 }, 20);
    const far = ambientDaylightAtPoint(room, sources, { x: 200, y: 240 }, 20);
    expect(near).toBeGreaterThan(middle);
    expect(middle).toBeGreaterThan(far);
    expect(far).toBeGreaterThanOrEqual(0);
  });

  it("fans sideways as it travels into the room", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0, { length: 60 })]);

    const centre = ambientDaylightAtPoint(room, sources, { x: 200, y: 120 }, 20);
    const shoulder = ambientDaylightAtPoint(room, sources, { x: 300, y: 120 }, 20);
    const outsidePool = ambientDaylightAtPoint(room, sources, { x: 390, y: 120 }, 20);
    expect(centre).toBeGreaterThan(shoulder);
    expect(shoulder).toBeGreaterThan(outsidePool);
  });

  it("uses civil twilight for a smooth day/night factor", () => {
    expect(ambientDaylightDayFactor(-7)).toBe(0);
    expect(ambientDaylightDayFactor(-6)).toBe(0);
    expect(ambientDaylightDayFactor(0)).toBeCloseTo(0.5);
    expect(ambientDaylightDayFactor(6)).toBe(1);
    expect(ambientDaylightDayFactor(30)).toBe(1);
    expect(ambientDaylightDayFactor("unavailable")).toBe(0);
    expect(ambientDaylightDayFactor(undefined)).toBe(0);
    expect(ambientDaylightDayFactor(Number.NaN)).toBe(0);
  });

  it("fails dark instead of coercing missing or non-numeric elevations to zero", () => {
    expect(ambientDaylightDayFactor(null)).toBe(0);
    expect(ambientDaylightDayFactor("")).toBe(0);
    expect(ambientDaylightDayFactor(" ")).toBe(0);
    expect(ambientDaylightDayFactor([])).toBe(0);
  });

  it("disappears at night even with a valid exterior window", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    expect(ambientDaylightAtPoint(room, sources, { x: 200, y: 80 }, -10)).toBe(0);
  });

  it("combines two windows without exceeding normalized brightness", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const one = ambientOpeningSources([room], [opening("w1", 120, 0)]);
    const two = ambientOpeningSources([room], [opening("w1", 120, 0), opening("w2", 280, 0)]);

    const oneLight = ambientDaylightAtPoint(room, one, { x: 200, y: 80 }, 20);
    const twoLight = ambientDaylightAtPoint(room, two, { x: 200, y: 80 }, 20);
    expect(twoLight).toBeGreaterThan(oneLight);
    expect(twoLight).toBeLessThanOrEqual(1);
  });

  it("models glazing, physical opening and shutters independently", () => {
    expect(ambientOpeningTransmission({ type: "window" }, 0, 1)).toBe(1);
    expect(ambientOpeningTransmission({ type: "window", glazed: false }, 0, 1)).toBe(0);
    expect(ambientOpeningTransmission({ type: "window", glazed: false }, 0.5, 1)).toBe(0.5);
    expect(ambientOpeningTransmission({ type: "door" }, 0, 1)).toBe(0);
    expect(ambientOpeningTransmission({ type: "door" }, 0.7, 1)).toBeCloseTo(0.7);
    expect(ambientOpeningTransmission({ type: "door", glazed: true }, 0, 1)).toBe(1);
    expect(ambientOpeningTransmission({ type: "window" }, 0, 0.25)).toBeCloseTo(0.25);
    expect(ambientOpeningTransmission({ type: "window", sunlight: false }, 1, 1)).toBe(0);
  });

  it("lets callers supply real opening/shutter transmission without coupling to HA", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    const full = ambientDaylightAtPoint(room, sources, { x: 200, y: 80 }, 20, () => 1);
    const quarter = ambientDaylightAtPoint(room, sources, { x: 200, y: 80 }, 20, () => 0.25);
    const blocked = ambientDaylightAtPoint(room, sources, { x: 200, y: 80 }, 20, () => 0);

    expect(full).toBeGreaterThan(quarter);
    expect(quarter).toBeGreaterThan(blocked);
    expect(blocked).toBe(0);
  });

  it("normalizes unusable prototype options back to safe defaults", () => {
    const room = rect("bedroom", 0, 0, 400, 300);
    const sources = ambientOpeningSources([room], [opening("window", 200, 0)]);
    const point = { x: 200, y: 80 };

    const normal = ambientDaylightAtPoint(room, sources, point, 20, () => 1, {
      strength: DEFAULT_AMBIENT_DAYLIGHT_STRENGTH,
      depth: DEFAULT_AMBIENT_DAYLIGHT_DEPTH,
      spread: DEFAULT_AMBIENT_DAYLIGHT_SPREAD,
    });
    const invalid = ambientDaylightAtPoint(room, sources, point, 20, () => 1, {
      strength: Number.NaN,
      depth: -5,
      spread: 0,
      openingEps: Number.NaN,
    });

    expect(invalid).toBeCloseTo(normal, 12);
  });
});
