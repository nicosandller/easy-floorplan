import { describe, it, expect } from "vitest";
import {
  emptyConfig,
  makeFloor,
  getFloors,
  resolveSnap,
  snapToGridPercent,
  gridPercentToSnap,
  uid,
} from "./types";
import type { FloorplanCardConfig } from "./types";

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
  });
});

describe("makeFloor", () => {
  it("creates a named floor with a unique id and empty element arrays", () => {
    const f = makeFloor("Upstairs");
    expect(f.name).toBe("Upstairs");
    expect(f.id).toMatch(/^floor_/);
    expect(f.walls).toEqual([]);
    expect(f.openings).toEqual([]);
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
  it("returns the floors array when present and non-empty", () => {
    const floors = [makeFloor("A"), makeFloor("B")];
    const c = { ...emptyConfig("x"), floors } as FloorplanCardConfig;
    expect(getFloors(c)).toBe(floors);
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
});

describe("uid", () => {
  it("prefixes the id and stays unique", () => {
    expect(uid("wall")).toMatch(/^wall_/);
    expect(uid("x")).not.toBe(uid("x"));
  });
});
