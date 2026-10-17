import { describe, expect, it } from "vitest";
import { furnitureSolid, wallSolids, roofSolids, roofCourseLines, shiftIsoSolidZ, type IsoSolid, type Pt } from "./projection";
import type { Roof } from "./types";
import { sortIsoSolids, solidDepth } from "./projection-order";
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

  it("incorporates Z elevation into fallback depth along isometric camera ray", () => {
    const lower: IsoSolid = { kind: "roof", id: "lower", base: [{ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }], z0: 0, z1: 50 };
    const higher: IsoSolid = { kind: "roof", id: "higher", base: [{ x: 50, y: 50 }, { x: 100, y: 50 }, { x: 100, y: 100 }, { x: 50, y: 100 }], z0: 100, z1: 150 };
    const sorted = sortIsoSolids([higher, lower]);
    expect(sorted).toEqual([lower, higher]);
  });

  it("generates intersecting cross-gable roof solids with valley-trimmed faces", () => {
    const mainRoof: Roof = {
      id: "main_roof",
      points: [{ x: 420, y: 220 }, { x: 1320, y: 220 }, { x: 1320, y: 1120 }, { x: 420, y: 1120 }],
      type: "gable",
      height: 90,
    };
    const smallRoof: Roof = {
      id: "small_roof",
      points: [{ x: 720, y: 680 }, { x: 1020, y: 680 }, { x: 1020, y: 1120 }, { x: 720, y: 1120 }],
      type: "gable",
      height: 90,
    };
    const solids = roofSolids([mainRoof, smallRoof], (x, y) => ({ x, y }), 150);
    const mainSolids = solids.filter((s) => s.id === "main_roof");
    const smallSolids = solids.filter((s) => s.id === "small_roof");

    // Main roof has North slope, 2 gable ends, and South slope split into 2 quads by the valley
    expect(mainSolids.length).toBe(5);
    // Small roof has West slope, East slope, and South gable end
    expect(smallSolids.length).toBe(3);

    // All solids sort deterministically without cycles
    const sorted = sortIsoSolids(solids);
    expect(sorted.length).toBe(solids.length);
  });

  it("generates horizontal contour lines at constant Z on sloped roof faces", () => {
    // Sloped triangular/trapezoidal roof face from Z=300 to Z=390
    const vertices = [
      { x: 100, y: 0, z: 300 },
      { x: 200, y: 0, z: 300 },
      { x: 200, y: 50, z: 390 },
      { x: 100, y: 50, z: 390 },
    ];
    const lines = roofCourseLines(vertices);
    expect(lines.length).toBeGreaterThan(3);
    for (const [p1, p2] of lines) {
      // In elevated coordinates: xElev = x - z, yElev = y - z
      // When Z is constant across the line, deltaY / deltaX corresponds to the plan edge
      expect(Number.isFinite(p1.x) && Number.isFinite(p1.y)).toBe(true);
      expect(Number.isFinite(p2.x) && Number.isFinite(p2.y)).toBe(true);
      expect(p1.x).not.toEqual(p2.x);
    }
  });

  it("shifts lower level walls and slabs to negative Z elevations", () => {
    const wall1 = { id: "basement_wall", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8 };
    const outdoorWallHeight = 150;
    const zOffset = -outdoorWallHeight; // level 0 vs baseLevel 1

    const wSolids = wallSolids([wall1], [], outdoorWallHeight);
    const shiftedWalls = wSolids.map((s) => shiftIsoSolidZ(s, zOffset));

    for (const s of shiftedWalls) {
      expect(s.z0).toBe(-outdoorWallHeight);
      expect(s.z1).toBe(0);
    }

    const slab: IsoSolid = {
      kind: "roof",
      id: "slab_basement_garage",
      isSlab: true,
      base: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      z0: -6,
      z1: 0,
      color: "#888888",
    };
    const shiftedSlab = shiftIsoSolidZ(slab, zOffset);
    expect(shiftedSlab.z0).toBe(-outdoorWallHeight - 6);
    expect(shiftedSlab.z1).toBe(-outdoorWallHeight);

    // Ground level slab at z=0 sits above the basement slab
    const groundSlab: IsoSolid = {
      kind: "roof",
      id: "slab_first_floor",
      isSlab: true,
      base: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      z0: -6,
      z1: 0,
      color: "#cccccc",
    };

    const sorted = sortIsoSolids([groundSlab, shiftedSlab]);
    // Slices sort back-to-front: lower basement slab is painted before/under ground slab
    expect(sorted[0]!.id).toBe("slab_basement_garage");
    expect(sorted[1]!.id).toBe("slab_first_floor");
  });

  it("orders ground slab underneath elevated roof even when slab depth exceeds roof depth", () => {
    // Slabs spanning outdoors can have a centroid far to the south/east, giving them a larger depth
    // value than a northern elevated roof. Ground slabs must always sort before elevated roofs.
    const groundSlab: IsoSolid = {
      kind: "roof",
      id: "slab_curte",
      isSlab: true,
      base: [
        { x: 200, y: 200 },
        { x: 1500, y: 200 },
        { x: 1500, y: 1500 },
        { x: 200, y: 1500 },
      ],
      z0: -6,
      z1: 0,
      color: "#44aa44",
    };

    const elevatedRoof: IsoSolid = {
      kind: "roof",
      id: "roof_second_floor",
      base: [
        { x: 500, y: 500 },
        { x: 700, y: 500 },
        { x: 700, y: 700 },
        { x: 500, y: 700 },
      ],
      z0: 300,
      z1: 390,
      color: "#8844aa",
    };

    // Even if ground slab is after elevated roof in input, it must sort before it
    const sorted = sortIsoSolids([elevatedRoof, groundSlab]);
    expect(sorted[0]!.id).toBe("slab_curte");
    expect(sorted[1]!.id).toBe("roof_second_floor");
  });

  it("orders ground slab over subterranean basement walls even when basement wall depth exceeds slab depth", () => {
    // A ground slab (like Curte) can have its centroid in the middle of the property,
    // while a subterranean basement wall chunk in the south has a higher depth value.
    // The ground slab sits at ground level (z1 = 0) while the basement wall is underground (z1 <= 0),
    // so the ground slab must occlude the subterranean wall (slab sorts after wall in painter's order).
    const groundSlab: IsoSolid = {
      kind: "roof",
      id: "slab_curte",
      isSlab: true,
      base: [
        { x: 200, y: 200 },
        { x: 1500, y: 200 },
        { x: 1500, y: 1500 },
        { x: 200, y: 1500 },
      ],
      z0: -6,
      z1: 0,
      color: "#44aa44",
    };

    const subterraneanWall: IsoSolid = {
      kind: "wall",
      id: "wall_basement_south",
      base: [
        { x: 1000, y: 1000 },
        { x: 1050, y: 1000 },
        { x: 1050, y: 1010 },
        { x: 1000, y: 1010 },
      ],
      z0: -150,
      z1: 0,
      color: "#999999",
    };

    const sorted = sortIsoSolids([groundSlab, subterraneanWall]);
    // Painter's order: subterranean wall is drawn first (background), ground slab is drawn on top (foreground)
    expect(sorted[0]!.id).toBe("wall_basement_south");
    expect(sorted[1]!.id).toBe("slab_curte");
  });

  describe("solidDepth fallback calculation", () => {
    it("does not include z in depth for wall and furniture solids", () => {
      const base: Pt[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      // Base average: (0+0 + 10+0 + 10+10 + 0+10) / 4 = 40 / 4 = 10
      const wallSolid: IsoSolid = { kind: "wall", base, z0: 100, z1: 200 };
      expect(solidDepth(wallSolid)).toBe(10);

      const furniture: IsoSolid = { kind: "furniture", base, z0: 50, z1: 80 };
      expect(solidDepth(furniture)).toBe(10);
    });

    it("includes z average in depth for roof solids", () => {
      const base: Pt[] = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ];
      // Base avg: 10, z avg: (100 + 200) / 2 = 150 -> 160
      const roofSolid: IsoSolid = { kind: "roof", base, z0: 100, z1: 200 };
      expect(solidDepth(roofSolid)).toBe(160);
    });
  });
});


