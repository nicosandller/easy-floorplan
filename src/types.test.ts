import { describe, it, expect } from "vitest";
import {
  emptyConfig,
  makeFloor,
  getFloors,
  resolveSnap,
  snapToGridPercent,
  gridPercentToSnap,
  trackerAxisFraction,
  trackerPresenceDetected,
  haFloorsOf,
  uid,
  configsEqual,
} from "./types";
import type { FloorplanCardConfig, TrackerSensor } from "./types";

describe("resolveSnap", () => {
  it("falls back to the grid when snap is unset (the new default)", () => {
    expect(resolveSnap(undefined, 20)).toBe(20);
    expect(resolveSnap(null, 20)).toBe(20);
  });

  it("returns 0 for free placement when snap is explicitly 0", () => {
    expect(resolveSnap(0, 20)).toBe(0);
  });

  it("returns the custom step when snap is a positive number", () => {
    expect(resolveSnap(5, 20)).toBe(5);
    expect(resolveSnap(25, 20)).toBe(25);
  });
});

describe("snapToGridPercent / gridPercentToSnap", () => {
  it("expresses a snap step as a percentage of the grid", () => {
    expect(snapToGridPercent(10, 20)).toBe(50);
    expect(snapToGridPercent(20, 20)).toBe(100);
    expect(snapToGridPercent(40, 20)).toBe(200); // coarser than the grid
    expect(snapToGridPercent(5, 20)).toBe(25);
  });

  it("converts a percentage of the grid back into an absolute step", () => {
    expect(gridPercentToSnap(50, 20)).toBe(10);
    expect(gridPercentToSnap(100, 20)).toBe(20);
    expect(gridPercentToSnap(200, 20)).toBe(40);
  });

  it("clamps the resulting step to at least 1 unit", () => {
    expect(gridPercentToSnap(1, 20)).toBe(1); // 0.2 -> clamped
    expect(gridPercentToSnap(0, 20)).toBe(1);
  });

  it("round-trips common values", () => {
    for (const pct of [25, 50, 100, 200]) {
      expect(snapToGridPercent(gridPercentToSnap(pct, 20), 20)).toBe(pct);
    }
  });

  it("guards against a zero grid", () => {
    expect(snapToGridPercent(10, 0)).toBe(100);
  });
});

describe("emptyConfig", () => {
  it("produces a blank, valid single-floor config", () => {
    const c = emptyConfig("custom:easy-floorplan-card");
    expect(c.type).toBe("custom:easy-floorplan-card");
    expect(c.width).toBe(1000);
    expect(c.height).toBe(600);
    expect(c.grid).toBe(20);
    expect(c.walls).toEqual([]);
    expect(c.openings).toEqual([]);
    expect(c.items).toEqual([]);
    expect(c.trackers).toEqual([]);
  });
});

describe("trackerAxisFraction", () => {
  const s: TrackerSensor = { entity: "sensor.x", min: 0, max: 5 };

  it("maps the reading linearly into 0..1 across [min, max]", () => {
    expect(trackerAxisFraction(s, 0)).toBe(0);
    expect(trackerAxisFraction(s, 5)).toBe(1);
    expect(trackerAxisFraction(s, 2.5)).toBe(0.5);
  });

  it("clamps readings outside [min, max] into the unit interval", () => {
    expect(trackerAxisFraction(s, -10)).toBe(0);
    expect(trackerAxisFraction(s, 999)).toBe(1);
  });

  it("respects invert by flipping the fraction", () => {
    expect(trackerAxisFraction({ ...s, invert: true }, 0)).toBe(1);
    expect(trackerAxisFraction({ ...s, invert: true }, 5)).toBe(0);
  });

  it("returns null for missing sensor, missing reading, NaN, or zero span", () => {
    expect(trackerAxisFraction(undefined, 1)).toBeNull();
    expect(trackerAxisFraction(s, null)).toBeNull();
    expect(trackerAxisFraction(s, undefined)).toBeNull();
    expect(trackerAxisFraction(s, NaN)).toBeNull();
    expect(trackerAxisFraction({ entity: "sensor.x", min: 3, max: 3 }, 3)).toBeNull();
  });

  it("supports min greater than max via the negative span", () => {
    const reversed: TrackerSensor = { entity: "sensor.x", min: 5, max: 0 };
    expect(trackerAxisFraction(reversed, 5)).toBe(0);
    expect(trackerAxisFraction(reversed, 0)).toBe(1);
  });
});

describe("trackerPresenceDetected", () => {
  const states = {
    "binary_sensor.occ": { state: "on" },
    "binary_sensor.clear": { state: "off" },
    "binary_sensor.detected": { state: "detected" },
    "binary_sensor.open": { state: "open" },
    "binary_sensor.dead": { state: "unavailable" },
    "binary_sensor.unknown": { state: "unknown" },
  };

  it("returns null when no presence gate is configured (caller treats as ungated)", () => {
    expect(trackerPresenceDetected(states, undefined)).toBeNull();
    expect(trackerPresenceDetected(states, null)).toBeNull();
  });

  it("maps common detected states to true", () => {
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.occ" })).toBe(true);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.detected" })).toBe(true);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.open" })).toBe(true);
  });

  it("maps clear / off to false", () => {
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.clear" })).toBe(false);
  });

  it("fails closed on unavailable / unknown / missing entity", () => {
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.dead" })).toBe(false);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.unknown" })).toBe(false);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.missing" })).toBe(false);
    expect(trackerPresenceDetected(undefined, { entity: "binary_sensor.occ" })).toBe(false);
  });

  it("honors invert for on/off mapping", () => {
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.occ", invert: true })).toBe(false);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.clear", invert: true })).toBe(true);
  });

  it("never inverts unavailable / unknown — those always gate the marker off", () => {
    // 'unknown' shouldn't ever resolve to 'detected' just because invert is set —
    // we genuinely don't know whether anyone's there.
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.dead", invert: true })).toBe(false);
    expect(trackerPresenceDetected(states, { entity: "binary_sensor.missing", invert: true })).toBe(false);
  });
});

describe("makeFloor", () => {
  it("creates a named floor with a unique id and empty element arrays", () => {
    const f = makeFloor("Upstairs");
    expect(f.name).toBe("Upstairs");
    expect(f.id).toMatch(/^floor_/);
    expect(f.walls).toEqual([]);
    expect(f.openings).toEqual([]);
    expect(f.trackers).toEqual([]);
  });

  it("seeds the floor with the provided walls", () => {
    const walls = [{ id: "w1", x1: 0, y1: 0, x2: 10, y2: 0 }];
    expect(makeFloor("F", walls).walls).toBe(walls);
  });

  it("gives each floor a distinct id", () => {
    expect(makeFloor("a").id).not.toBe(makeFloor("b").id);
  });
});

describe("getFloors", () => {
  it("returns the floors when present and non-empty (normalized copies)", () => {
    const floors = [makeFloor("A"), makeFloor("B")];
    const c = { ...emptyConfig("x"), floors } as FloorplanCardConfig;
    expect(getFloors(c)).toStrictEqual(floors);
  });

  it("wraps a legacy flat config into a single implicit floor", () => {
    const c = {
      ...emptyConfig("x"),
      walls: [{ id: "w1", x1: 0, y1: 0, x2: 10, y2: 0 }],
    } as FloorplanCardConfig;
    const floors = getFloors(c);
    expect(floors).toHaveLength(1);
    expect(floors[0].id).toBe("floor_main");
    expect(floors[0].walls).toEqual(c.walls);
  });

  it("treats an empty floors array as legacy (wraps flat arrays)", () => {
    const c = { ...emptyConfig("x"), floors: [] } as FloorplanCardConfig;
    expect(getFloors(c)).toHaveLength(1);
  });

  it("backfills element arrays missing from hand-written floors", () => {
    // A minimal hand-written multi-floor config: only walls provided. Every
    // other element array must come back as [] so render paths can map over
    // them without crashing.
    const c = {
      ...emptyConfig("x"),
      floors: [
        {
          id: "f1",
          name: "Hand-written",
          walls: [{ id: "w1", x1: 0, y1: 0, x2: 10, y2: 0 }],
        } as unknown,
      ],
    } as FloorplanCardConfig;
    const [f] = getFloors(c);
    expect(f.walls).toHaveLength(1);
    expect(f.openings).toEqual([]);
    expect(f.items).toEqual([]);
    expect(f.texts).toEqual([]);
    expect(f.furniture).toEqual([]);
    expect(f.trackers).toEqual([]);
  });

  it("preserves extra floor fields (image, opacity) while backfilling", () => {
    const c = {
      ...emptyConfig("x"),
      floors: [{ id: "f1", name: "F", image: "/local/plan.png", imageOpacity: 0.5 } as unknown],
    } as FloorplanCardConfig;
    const [f] = getFloors(c);
    expect(f.image).toBe("/local/plan.png");
    expect(f.imageOpacity).toBe(0.5);
    expect(f.trackers).toEqual([]);
  });
});

describe("haFloorsOf", () => {
  const hass = {
    floors: {
      up: { floor_id: "up", name: "Upstairs", level: 1 },
      ground: { floor_id: "ground", name: "Ground floor", level: 0 },
      cellar: { floor_id: "cellar", name: "Cellar", level: -1 },
    },
  };

  it("lists HA floors sorted by level then name", () => {
    expect(haFloorsOf(hass).map((f) => f.floor_id)).toEqual(["cellar", "ground", "up"]);
  });

  it("sorts same-level floors by name and tolerates a missing level", () => {
    const h = {
      floors: {
        b: { floor_id: "b", name: "B wing" },
        a: { floor_id: "a", name: "A wing" },
      },
    };
    expect(haFloorsOf(h).map((f) => f.name)).toEqual(["A wing", "B wing"]);
  });

  it("returns [] for hass objects without a floor registry (older HA, dev harness)", () => {
    expect(haFloorsOf({})).toEqual([]);
    expect(haFloorsOf(undefined)).toEqual([]);
    expect(haFloorsOf(null)).toEqual([]);
    expect(haFloorsOf({ floors: "bogus" })).toEqual([]);
  });

  it("drops malformed registry entries", () => {
    expect(haFloorsOf({ floors: { x: { floor_id: "x" }, ok: { floor_id: "ok", name: "Ok" } } })).toEqual([
      { floor_id: "ok", name: "Ok" },
    ]);
  });
});

describe("uid", () => {
  it("prefixes the id and stays unique", () => {
    expect(uid("wall")).toMatch(/^wall_/);
    expect(uid("x")).not.toBe(uid("x"));
  });
});

describe("configsEqual", () => {
  it("treats missing key and undefined value as equal", () => {
    expect(configsEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });

  it("compares nested arrays/objects structurally", () => {
    expect(configsEqual({ f: [{ x: 1 }] }, { f: [{ x: 1 }] })).toBe(true);
    expect(configsEqual({ f: [{ x: 1 }] }, { f: [{ x: 2 }] })).toBe(false);
  });

  it("detects added/removed keys and length changes", () => {
    expect(configsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(configsEqual({ f: [1] }, { f: [1, 2] })).toBe(false);
  });

  it("handles primitives and nulls", () => {
    expect(configsEqual(1, 1)).toBe(true);
    expect(configsEqual(null, null)).toBe(true);
    expect(configsEqual(null, {})).toBe(false);
    expect(configsEqual("a", "b")).toBe(false);
  });
});
