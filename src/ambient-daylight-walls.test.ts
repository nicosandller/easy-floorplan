import { describe, expect, it } from "vitest";
import type { Area, Opening, Wall } from "./types";
import { ambientPointInArea, ambientOpeningTransmission } from "./ambient-daylight";
import { ambientWallClip, ambientWallLights, ambientWallRegions } from "./ambient-daylight-walls";
import { buildAmbientDaylightRenderModel } from "./ambient-daylight-render";
import { wallsLightPassesThrough, wallsThatBlock } from "./render";

const rectangle = (x: number, y: number, w: number, h: number): Area["points"] =>
  [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const outline = (points: Area["points"], prefix = "outer"): Wall[] => points.map((p, i) => {
  const next = points[(i + 1) % points.length]!;
  return { id: `${prefix}-${i}`, x1: p.x, y1: p.y, x2: next.x, y2: next.y };
});
const outer = outline(rectangle(0, 0, 400, 300));
const partition: Wall = { id: "partition", x1: 160, y1: 0, x2: 160, y2: 300 };
const window: Opening = { id: "outside", type: "window", x: 0, y: 150, length: 70, angle: 90 };
const door: Opening = { id: "inside", type: "door", x: 160, y: 150, length: 70, angle: 90 };

function lights(walls = outer, openings = [window], amount = 0) {
  const solid = wallsThatBlock(walls);
  const transmission = (id: string) => ambientOpeningTransmission(openings.find(o => o.id === id)!, amount);
  const blockers = wallsLightPassesThrough(solid, openings, o => transmission(o.id));
  return ambientWallLights(solid, openings, blockers, 30, transmission, 0.28);
}
const visible = (points: Area["points"] | undefined, x: number, y: number) =>
  points ? ambientPointInArea({ points }, x, y) : true;

describe("ambient daylight follows physical walls (#319)", () => {
  it("finds two physical rooms but one outside outline across T junctions", () => {
    const regions = ambientWallRegions([...outer, partition]);
    expect(regions.rooms).toHaveLength(2);
    expect(regions.shells).toHaveLength(1);
    expect(ambientPointInArea(regions.shells[0]!, 250, 150)).toBe(true);
  });

  it("does not require named Areas, and does not turn the inside door into a sky source", () => {
    const result = lights([...outer, partition], [window, door], 1)!;
    expect(result[0]?.patch.openingId).toBe("outside");
    expect(result[1]).toBeUndefined();
  });

  it("stops the wash at a solid partition", () => {
    const patch = lights([...outer, partition])![0]!.patch;
    expect(visible(patch.clipPoints, 100, 150)).toBe(true);
    expect(visible(patch.clipPoints, 180, 150)).toBe(false);
    expect(visible(patch.clipPoints, 180, 70)).toBe(false);
  });

  it("lets light continue through an open door, but not the wall alongside it", () => {
    const walls = [...outer, partition];
    const closed = lights(walls, [window, door], 0)![0]!.patch;
    const open = lights(walls, [window, door], 1)![0]!.patch;
    expect(visible(closed.clipPoints, 200, 150)).toBe(false);
    expect(visible(open.clipPoints, 200, 150)).toBe(true);
    expect(visible(open.clipPoints, 200, 50)).toBe(false);
    // Opening the door changes visibility, not the source's fade or strength.
    expect(open.gradientEnd).toEqual(closed.gradientEnd);
    expect(open.opacity).toEqual(closed.opacity);
  });

  it("narrows a partially open opaque passage and respects a natural-light opt-out", () => {
    const partial = lights([...outer, partition], [window, door], 0.25)![0]!.patch;
    expect(visible(partial.clipPoints, 200, 150)).toBe(true);
    expect(visible(partial.clipPoints, 200, 170)).toBe(false);
    const blocked = lights([...outer, partition], [window, { ...door, sunlight: false }], 1)![0]!.patch;
    expect(visible(blocked.clipPoints, 200, 150)).toBe(false);
  });

  it("keeps a close opposite wall instead of treating it as a lamp mounting wall", () => {
    const narrow = { ...partition, x1: 5, x2: 5 };
    // Test visibility after opening gaps have been resolved. The shared gap
    // resolver's 8-unit snap tolerance is separate from a lamp's clearance.
    const patch = ambientWallClip({ openingId: "outside", areaId: "opening-0",
      x: 0, y: 150, inwardX: 1, inwardY: 0, length: 70 },
    lights()![0]!.patch, [narrow]);
    expect(visible(patch.clipPoints, 2, 150)).toBe(true);
    expect(visible(patch.clipPoints, 10, 150)).toBe(false);
  });

  it("casts a shadow behind a dangling partition without making a new exterior", () => {
    const patch = lights([...outer, { ...partition, y1: 100, y2: 200 }])![0]!.patch;
    expect(visible(patch.clipPoints, 190, 150)).toBe(false);
    expect(visible(patch.clipPoints, 190, 40)).toBe(true);
  });

  it("does not mistake a detached interior loop for another outside wall", () => {
    const walls = [...outer, ...outline(rectangle(160, 100, 50, 100), "cupboard")];
    expect(ambientWallRegions(walls).shells).toHaveLength(1);
    expect(lights(walls, [window, door], 1)![1]).toBeUndefined();
    expect(visible(lights(walls)![0]!.patch.clipPoints, 220, 150)).toBe(false);
  });

  it("keeps detached buildings separate", () => {
    const walls = [...outer, ...outline(rectangle(500, 0, 200, 300), "annex")];
    const annexWindow = { ...window, id: "annex", x: 500 };
    const result = lights(walls, [window, annexWindow])!;
    expect(ambientWallRegions(walls).shells).toHaveLength(2);
    expect(ambientPointInArea(result[0]!.area, 550, 150)).toBe(false);
    expect(ambientPointInArea(result[1]!.area, 550, 150)).toBe(true);
  });

  it("handles diagonal and concave exteriors", () => {
    const walls = outline([{ x: 0, y: 100 }, { x: 100, y: 0 }, { x: 400, y: 0 },
      { x: 400, y: 150 }, { x: 200, y: 150 }, { x: 200, y: 300 }, { x: 0, y: 300 }]);
    const diagonal = { ...window, x: 50, y: 50, angle: -45 };
    const result = lights(walls, [diagonal])![0]!;
    expect(result.patch.gradientEnd.x).toBeGreaterThan(50);
    expect(result.patch.gradientEnd.y).toBeGreaterThan(50);
    expect(ambientPointInArea(result.area, 300, 250)).toBe(false);
    expect(visible(result.patch.clipPoints, 120, 120)).toBe(true);
  });

  it("ignores railings and keeps source identifiers stable as other sources switch off", () => {
    const railing = { ...partition, kind: "railing" as const };
    expect(visible(lights([...outer, railing])![0]!.patch.clipPoints, 200, 150)).toBe(true);
    const second = { ...window, id: "second", y: 230 };
    const on = lights(outer, [window, second])![1]!;
    const off = lights(outer, [{ ...window, sunlight: false }, second])![1]!;
    const before = buildAmbientDaylightRenderModel(on.area, [on.patch])!;
    const after = buildAmbientDaylightRenderModel(off.area, [off.patch])!;
    expect(after.clipId).toBe(before.clipId);
    expect(after.filterId).toBe(before.filterId);
    expect(after.patches[0]!.gradientId).toBe(before.patches[0]!.gradientId);
    expect(after.patches[0]!.clipId).toBe(before.patches[0]!.clipId);
  });

  it("keeps skylights out of the wall-source model even at the perimeter", () => {
    expect(lights(outer, [{ ...window, type: "skylight" }])![0]).toBeUndefined();
  });

  it("returns the Area fallback for incomplete or absent wall outlines", () => {
    expect(lights([])).toBeUndefined();
    expect(lights([partition])).toBeUndefined();
  });
});
