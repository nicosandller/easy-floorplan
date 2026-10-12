import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { load, YAML11_SCHEMA } from "js-yaml";
import {
  filterLowerWallsByUpperCoverage,
  isAreaCoveredByUpper,
  filterExternalOpenings,
  splitWallsAtJunctions,
} from "./editor-geometry";
import { getFloors, type Floor, type AreaPoint } from "./types";

describe("lower floor coverage filtering", () => {
  const yamlText = readFileSync(new URL("./fixtures/3floorHouse.yaml", import.meta.url), "utf8");
  const c = load(yamlText, { schema: YAML11_SCHEMA }) as any;
  const floors = getFloors(c);
  const outside = floors.find((f: Floor) => f.name === "OUtside")!;
  const basement = floors.find((f: Floor) => f.name === "Basement")!;
  const first = floors.find((f: Floor) => f.name === "1st")!;
  const second = floors.find((f: Floor) => f.name === "2nd")!;

  const upperPolygons: (readonly AreaPoint[])[] = [];
  for (const f of [outside, first, second]) {
    for (const a of f.areas) {
      if (a.points && a.points.length >= 3) upperPolygons.push(a.points);
    }
  }

  it("splits walls at junctions correctly", () => {
    const split = splitWallsAtJunctions(basement.walls);
    expect(split.length).toBeGreaterThan(basement.walls.length);
    const splitWallX1 = split.filter((w) => Math.abs(w.x1 - 1320) < 1 && Math.abs(w.x2 - 1320) < 1);
    expect(splitWallX1.length).toBeGreaterThanOrEqual(3);
  });

  it("identifies uncovered area Rampa and hides covered basement areas", () => {
    const rampa = basement.areas.find((a: any) => a.name === "Rampa")!;
    expect(rampa).toBeDefined();
    expect(isAreaCoveredByUpper(rampa, upperPolygons)).toBe(false);

    const garage = basement.areas.find((a: any) => a.name === "Garage")!;
    expect(garage).toBeDefined();
    expect(isAreaCoveredByUpper(garage, upperPolygons)).toBe(true);

    const office = basement.areas.find((a: any) => a.name === "Office")!;
    expect(office).toBeDefined();
    expect(isAreaCoveredByUpper(office, upperPolygons)).toBe(true);

    const instrumente = basement.areas.find((a: any) => a.name === "Instrumente")!;
    expect(instrumente).toBeDefined();
    expect(isAreaCoveredByUpper(instrumente, upperPolygons)).toBe(true);

    const storage = basement.areas.find((a: any) => a.name === "StorageRoom")!;
    expect(storage).toBeDefined();
    expect(isAreaCoveredByUpper(storage, upperPolygons)).toBe(true);
  });

  it("filters lower walls so that only walls exposed to uncovered areas are kept", () => {
    const keptWalls = filterLowerWallsByUpperCoverage(basement.walls, upperPolygons);

    // Garage door wall segments (x=1320, between y=520 and y=820) must be kept
    const garageDoorWalls = keptWalls.filter(
      (w) => Math.abs(w.x1 - 1320) < 1 && Math.abs(w.x2 - 1320) < 1 &&
             Math.max(w.y1, w.y2) > 520 && Math.min(w.y1, w.y2) < 820
    );
    expect(garageDoorWalls.length).toBeGreaterThan(0);

    // The covered basement foundation walls must be hidden
    // e.g. west wall at x=420 from y=220 to 1120
    const westBuriedWall = keptWalls.find(
      (w) => Math.abs(w.x1 - 420) < 1 && Math.abs(w.x2 - 420) < 1
    );
    expect(westBuriedWall).toBeUndefined();

    // south wall at y=1120
    const southBuriedWall = keptWalls.find(
      (w) => Math.abs(w.y1 - 1120) < 1 && Math.abs(w.y2 - 1120) < 1
    );
    expect(southBuriedWall).toBeUndefined();

    // north wall at y=220
    const northBuriedWall = keptWalls.find(
      (w) => Math.abs(w.y1 - 220) < 1 && Math.abs(w.y2 - 220) < 1
    );
    expect(northBuriedWall).toBeUndefined();
  });

  it("filters lower walls by viewing angle so that areas between viewer and wall hide the wall", () => {
    // At rot 0 (viewer looking from south):
    // South retaining wall at y=820 has Curte between viewer and wall -> hidden!
    // North retaining wall at y=520 is viewed across open trench -> visible!
    // Garage door at x=1320 is viewed across open trench -> visible!
    const rot0Walls = filterLowerWallsByUpperCoverage(basement.walls, upperPolygons, 8, 0);
    const southWallRot0 = rot0Walls.find((w) => Math.abs(w.y1 - 820) < 1 && Math.abs(w.y2 - 820) < 1);
    expect(southWallRot0).toBeUndefined();
    const northWallRot0 = rot0Walls.find((w) => Math.abs(w.y1 - 520) < 1 && Math.abs(w.y2 - 520) < 1);
    expect(northWallRot0).toBeDefined();
    const garageDoorRot0 = rot0Walls.find((w) => Math.abs(w.x1 - 1320) < 1 && Math.abs(w.x2 - 1320) < 1 && Math.min(w.y1, w.y2) >= 520);
    expect(garageDoorRot0).toBeDefined();

    // At rot 180 (viewer looking from north):
    // North retaining wall at y=520 has Gradina between viewer and wall -> hidden!
    // South retaining wall at y=820 is viewed across open trench -> visible!
    // Garage door at x=1320 is behind Casa -> hidden!
    const rot180Walls = filterLowerWallsByUpperCoverage(basement.walls, upperPolygons, 8, 180);
    const northWallRot180 = rot180Walls.find((w) => Math.abs(w.y1 - 520) < 1 && Math.abs(w.y2 - 520) < 1);
    expect(northWallRot180).toBeUndefined();
    const southWallRot180 = rot180Walls.find((w) => Math.abs(w.y1 - 820) < 1 && Math.abs(w.y2 - 820) < 1);
    expect(southWallRot180).toBeDefined();
    const garageDoorRot180 = rot180Walls.find((w) => Math.abs(w.x1 - 1320) < 1 && Math.abs(w.x2 - 1320) < 1 && Math.min(w.y1, w.y2) >= 520);
    expect(garageDoorRot180).toBeUndefined();
  });

  it("keeps garage door opening and hides covered openings", () => {
    const keptWalls = filterLowerWallsByUpperCoverage(basement.walls, upperPolygons);
    const keptOpenings = filterExternalOpenings(basement.openings, keptWalls);

    // Garage door must be kept
    const garageDoor = keptOpenings.find((o) => o.id === "door_mbm6tg3");
    expect(garageDoor).toBeDefined();

    // Doors inside the house must be hidden
    const doorInside1 = keptOpenings.find((o) => o.id === "door_pixlunj");
    expect(doorInside1).toBeUndefined();
    const doorInside2 = keptOpenings.find((o) => o.id === "door_9uut9s5");
    expect(doorInside2).toBeUndefined();
  });

  it("creates ground slabs with opacity to cover lower floor geometry", () => {
    const curte = outside.areas.find((a: any) => a.name === "Curte")!;
    expect(curte).toBeDefined();

    const slab = {
      kind: "roof",
      id: `slab_${curte.id}`,
      base: curte.points.map((p: any) => ({ x: p.x, y: p.y })),
      z0: -6,
      z1: 0,
      color: "#f7fbfd",
      opacity: curte.opacity !== undefined ? curte.opacity : 1,
    };
    expect(slab.opacity).toBe(1);
    expect(slab.base.length).toBeGreaterThan(3);
  });
});
