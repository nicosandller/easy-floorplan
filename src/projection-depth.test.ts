import { describe, expect, it } from "vitest";
import { furnitureSolid, wallSolids, type IsoSolid, type Pt } from "./projection";
import { sortIsoSolids } from "./projection-order";
import { joinIsoWalls } from "./projection-joints";
import { ambientPointInArea } from "./ambient-daylight";

const wall = { id: "horizontal", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8 };
const upright = { id: "vertical", x1: 100, y1: 0, x2: 100, y2: 100, thickness: 8 };
const reverse = (w: typeof wall) => ({ ...w, x1: w.x2, y1: w.y2, x2: w.x1, y2: w.y1 });
const contains = (s: IsoSolid, x: number, y: number) => ambientPointInArea({ points: s.base }, x, y);

describe("joined isometric walls (#321)", () => {
  it("gives the two arms of a corner one shared miter, with no overlapping caps", () => {
    for (const walls of [[wall, upright], [reverse(wall), upright], [upright, reverse(wall)], [reverse(upright), wall]]) {
      const solids = wallSolids(walls, [], 100);
      // Both sides of the diagonal join stay covered, exactly once.
      for (const [x, y] of [[97, 1], [101, 3], [99, -3], [103, 1]]) {
        expect(solids.filter(s => contains(s, x!, y!))).toHaveLength(1);
      }
      const atCorner = joinIsoWalls(walls).filter(w => w.start || w.end);
      expect(atCorner).toHaveLength(2);
      const corners = atCorner.flatMap(w => w.start ?? w.end!);
      expect(corners).toContainEqual({ x: 96, y: 4 });
      expect(corners).toContainEqual({ x: 104, y: -4 });
    }
  });

  it("splits a T junction inside a long wall and does not draw its internal caps", () => {
    const walls = [wall, { ...upright, x1: 50, x2: 50 }];
    const joined = joinIsoWalls(walls);
    expect(joined).toHaveLength(3);
    const solids = wallSolids(walls, [], 100);
    for (const [x, y] of [[47, 1], [49, 3], [51, -3], [53, 1]]) {
      expect(solids.filter(s => contains(s, x!, y!))).toHaveLength(1);
    }
    expect(solids.filter(s => s.id === "vertical")[0]!.hiddenEdges).toEqual([1, 3, 4]);
  });

  it("shares diagonal joins, welds small endpoint gaps, and bounds acute corners", () => {
    const diagonal = { ...upright, x1: 100.2, y1: 0.1, x2: 170, y2: 70 };
    const joined = joinIsoWalls([wall, diagonal]);
    expect(joined[0]!.end).toEqual(joined[1]!.start);
    const sharp = joinIsoWalls([wall, { ...upright, x2: 0, y2: 1 }]);
    for (const p of sharp.flatMap(w => w.start ?? w.end ?? [])) {
      expect(Math.hypot(p.x - 100, p.y)).toBeLessThanOrEqual(16);
      expect(Number.isFinite(p.x + p.y)).toBe(true);
    }
  });

  it("does not double-paint duplicate wall runs", () => {
    expect(wallSolids([wall, reverse(wall)], [], 100)).toEqual(wallSolids([wall], [], 100));
  });

  it("retains the exposed end face beside an opening at a corner", () => {
    for (const type of ["window", "door"] as const) {
      const solids = wallSolids([wall, upright], [{ type, x: 100, y: 25, length: 50, angle: 90 }], 100);
      const end = solids.filter(s => s.id === wall.id).slice(-1)[0]!;
      expect(end.hiddenEdges).not.toContain(1);
    }
  });

  it("covers a cross junction once and keeps ends exposed between different wall kinds", () => {
    const cross = wallSolids([wall, { ...upright, x1: 50, y1: -50, x2: 50, y2: 50 }], [], 100);
    for (const [x, y] of [[47, 1], [49, 3], [51, -3], [53, 1]]) {
      expect(cross.filter(s => contains(s, x!, y!))).toHaveLength(1);
    }
    const joined = joinIsoWalls([wall, { ...upright, kind: "railing" }]);
    expect(joined.every(w => !w.start && !w.end)).toBe(true);
  });
});

describe("spatial painter order (#321)", () => {
  it("puts every overlapping sill chunk below a long pane, including its nearer half", () => {
    const solids = wallSolids([{ ...wall, x2: 320 }], [{ type: "window", x: 160, y: 0, length: 200, angle: 0 }], 100);
    const ordered = sortIsoSolids(solids);
    const glass = ordered.find(s => s.kind === "glass")!;
    for (const sill of ordered.filter(s => s.kind === "sill")) {
      expect(ordered.indexOf(sill)).toBeLessThan(ordered.indexOf(glass));
    }
  });

  it("hides furniture behind a wall even when its footprint slightly enters the wall thickness", () => {
    // Bathroom dimensions from the issue's attached YAML. The tub reaches
    // x=478; the x=480 wall starts at x=476. Their visible fronts still have
    // a clear order although the volumes overlap by two units.
    const tub = furnitureSolid({ id: "tub", x: 440, y: 740, w: 150, h: 76, angle: 270 },
      (x, y) => ({ x, y }), 40, "#fff");
    const partition = wallSolids([{ id: "wall", x1: 480, y1: 660, x2: 480, y2: 980, thickness: 8 }], [], 100);
    const early = partition.find(s => s.base.some(p => p.y < 695) && s.base.some(p => p.y > 685))!;
    const sorted = sortIsoSolids([early, tub]);
    expect(sorted).toEqual([tub, early]);
  });

  it("preserves coplanar pane order and never duplicates a furniture action target", () => {
    const pane: IsoSolid = { kind: "panel", id: "pane", base: [{ x: 0, y: 0 }, { x: 100, y: 0 }], z0: 0, z1: 60 };
    const hit = { ...pane, kind: "opening-hit" as const, id: "hit" };
    expect(sortIsoSolids([hit, pane])).toEqual([hit, pane]);
    const piece = furnitureSolid({ x: 40, y: 40, w: 100, h: 100 }, (x, y) => ({ x, y }), 40, "#fff");
    const result = sortIsoSolids([piece, pane, hit]);
    expect(result.filter(s => s === piece)).toHaveLength(1);
  });

  it("terminates deterministically for physically intersecting solids", () => {
    const piece = (angle: number) => furnitureSolid({ x: 0, y: 0, w: 120, h: 20, angle },
      (x, y): Pt => ({ x, y }), 40, "#fff");
    const solids = [piece(0), piece(60), piece(120)];
    const result = sortIsoSolids(solids);
    expect(new Set(result).size).toBe(3);
    expect(sortIsoSolids(solids)).toEqual(result);
  });
});
