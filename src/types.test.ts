import { describe, it, expect } from "vitest";
import { emptyConfig, makeFloor, getFloors, uid } from "./types";
import type { FloorplanCardConfig } from "./types";

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
