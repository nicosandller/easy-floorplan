import { describe, it, expect } from "vitest";
import { nothing, svg } from "lit";
import { rotatePlanPoint, areaZoomTransform, type PlanRotation } from "./render";
import {
  DEFAULT_WALL_HEIGHT,
  MAX_WALL_HEIGHT,
  OUTDOOR_WALL_HEIGHT_MULTIPLIER,
  ISO_CHUNK,
  SILL_FRACTION,
  GLASS_FRACTION,
  normalizeProjection,
  normalizeWallHeight,
  normalizeWallOpacity,
  projectedCanvasSize,
  projectPlanPoint,
  projectPlanDirection,
  planProjectionTransform,
  elevate,
  elevationShift,
  wallSolids,
  openingWall,
  openingWallHeight,
  wallStandingHeight,
  wallHeadroom,
  furnitureSolid,
  solidDepth,
  roofSolids,
  renderIsoSolids,
  type DisplayFrame,
  type IsoSolid,
} from "./projection";
import type { Roof } from "./types";

// Interleave a template's strings and values, recursively. Values land
// unquoted, so assertions read `data-id=w1`, not `data-id="w1"`.
const flatten = (node: unknown): string => {
  if (node == null || node === nothing) return "";
  if (Array.isArray(node)) return node.map(flatten).join("");
  if (typeof node === "object" && "strings" in node && "values" in node) {
    const t = node as { strings: readonly string[]; values: unknown[] };
    return t.strings.reduce((acc, s, i) => acc + s + (i < t.values.length ? flatten(t.values[i]) : ""), "");
  }
  return String(node);
};

const iso = (w = 1000, h = 600, wallHeight = 60): DisplayFrame => ({ w, h, projection: "iso", wallHeight });
const flat = (w = 1000, h = 600): DisplayFrame => ({ w, h, projection: "plan", wallHeight: 60 });
const COS = Math.sqrt(3) / 2;

describe("normalizeProjection", () => {
  it("reads 3d and iso, with the flat plan as fallback", () => {
    expect(normalizeProjection("iso")).toBe("iso");
    expect(normalizeProjection("plan")).toBe("plan");
    expect(normalizeProjection(undefined)).toBe("plan");
    expect(normalizeProjection("3d")).toBe("iso");
    expect(normalizeProjection(1)).toBe("plan");
  });
});

describe("normalizeWallHeight", () => {
  it("defaults when unset and clamps to the range", () => {
    expect(normalizeWallHeight(undefined)).toBe(DEFAULT_WALL_HEIGHT);
    expect(normalizeWallHeight(null)).toBe(DEFAULT_WALL_HEIGHT);
    expect(normalizeWallHeight("")).toBe(DEFAULT_WALL_HEIGHT);
    expect(normalizeWallHeight(NaN)).toBe(DEFAULT_WALL_HEIGHT);
    expect(normalizeWallHeight(80)).toBe(80);
    expect(normalizeWallHeight("80")).toBe(80);
    expect(normalizeWallHeight(-5)).toBe(0);
    expect(normalizeWallHeight(1e6)).toBe(MAX_WALL_HEIGHT);
    expect(normalizeWallHeight(undefined, 80)).toBe(80);
    expect(normalizeWallHeight("invalid", 50)).toBe(50);
  });
});

describe("wallStandingHeight and wallHeadroom", () => {
  it("computes wall standing height respecting kind and overrides", () => {
    expect(wallStandingHeight({}, 60)).toBe(60);
    expect(wallStandingHeight({ height: 120 }, 60)).toBe(120);
    expect(wallStandingHeight({ kind: "railing" }, 60)).toBe(30);
    expect(wallStandingHeight({ kind: "railing", height: 100 }, 60)).toBe(50);
    // Unnormalized height guards
    expect(wallStandingHeight({ height: "invalid" as unknown as number }, 60)).toBe(60);
    expect(wallStandingHeight({ height: -50 }, 60)).toBe(0);
    expect(wallStandingHeight({ height: 9999 }, 60)).toBe(MAX_WALL_HEIGHT);
  });

  it("calculates headroom from the max of base wall height and all wall heights", () => {
    expect(wallHeadroom(60, [])).toBe(60);
    expect(wallHeadroom(60, [{ height: 40 }])).toBe(60);
    expect(wallHeadroom(60, [{ height: 120 }])).toBe(120);
    expect(wallHeadroom(60, [{ height: 100, kind: "railing" }])).toBe(60); // 100 * 0.5 = 50 <= 60
    expect(wallHeadroom(60, [{ height: 160, kind: "railing" }])).toBe(80); // 160 * 0.5 = 80 > 60
    expect(wallHeadroom(undefined, [{ height: 150 }])).toBe(150);
  });

  it("prevents clipping of tall walls near the plan origin", () => {
    const tallWall = { id: "tall", x1: 0, y1: 0, x2: 100, y2: 0, height: 140 };
    const baseWallHeight = 60;
    const headroom = wallHeadroom(baseWallHeight, [tallWall]);
    expect(headroom).toBe(140);
    const frame: DisplayFrame = { ...iso(), wallHeight: headroom, padding: 14 };
    const dims = projectedCanvasSize(frame);
    expect(dims.h).toBeCloseTo(800 + 140 + 28, 6);
    // A point at the top of the tall wall at (0, 0)
    const topOfWall = projectPlanPoint(0, 0, frame, 140);
    // With headroom = 140, y coordinate does not go negative (stays inside canvas at padding)
    expect(topOfWall.y).toBeCloseTo(14, 6);
  });
  it("provides 2.5x multiplier for 3D outdoor area full wall height rendering", () => {
    expect(OUTDOOR_WALL_HEIGHT_MULTIPLIER).toBe(2.5);
    expect(DEFAULT_WALL_HEIGHT * OUTDOOR_WALL_HEIGHT_MULTIPLIER).toBe(150);
  });
});

describe("projectedCanvasSize", () => {
  it("is the plan's own size when flat", () => {
    expect(projectedCanvasSize(flat())).toEqual({ w: 1000, h: 600 });
  });
  it("boxes the projected floor with headroom for a wall at the far corner", () => {
    const d = projectedCanvasSize(iso());
    expect(d.w).toBeCloseTo(1600 * COS, 6);
    expect(d.h).toBeCloseTo(800 + 60, 6);
  });
  it("includes lowerDepth for lower levels beneath the base elevation", () => {
    const d = projectedCanvasSize({ ...iso(), lowerDepth: 90 });
    expect(d.h).toBeCloseTo(800 + 60 + 90, 6);
  });
});

describe("projectPlanPoint", () => {
  it("passes through when flat", () => {
    expect(projectPlanPoint(12, 34, flat())).toEqual({ x: 12, y: 34 });
  });
  it("lands the four corners of the floor on the edges of the box", () => {
    const f = iso();
    const d = projectedCanvasSize(f);
    const far = projectPlanPoint(0, 0, f);
    expect(far.x).toBeCloseTo(600 * COS, 6);
    expect(far.y).toBeCloseTo(60, 6);
    expect(projectPlanPoint(1000, 0, f).x).toBeCloseTo(d.w, 6);
    expect(projectPlanPoint(0, 600, f).x).toBeCloseTo(0, 6);
    expect(projectPlanPoint(1000, 600, f).y).toBeCloseTo(d.h, 6);
  });
  it("raises a point straight up by z", () => {
    const f = iso();
    const p = projectPlanPoint(300, 200, f);
    const q = projectPlanPoint(300, 200, f, 45);
    expect(q.x).toBeCloseTo(p.x, 9);
    expect(q.y).toBeCloseTo(p.y - 45, 9);
  });
  it("fits a wall standing at the far corner", () => {
    expect(projectPlanPoint(0, 0, iso(), 60).y).toBeCloseTo(0, 9);
  });
});

describe("elevate", () => {
  it("is exactly a raise by z once projected", () => {
    const f = iso();
    for (const [x, y, z] of [
      [0, 0, 10],
      [300, 200, 60],
      [999, 1, 33.3],
    ]) {
      const e = elevate({ x, y }, z);
      const a = projectPlanPoint(e.x, e.y, f);
      const b = projectPlanPoint(x, y, f, z);
      expect(a.x).toBeCloseTo(b.x, 9);
      expect(a.y).toBeCloseTo(b.y, 9);
    }
  });
});

describe("planProjectionTransform", () => {
  it("is empty when flat", () => {
    expect(planProjectionTransform(flat())).toBe("");
  });
  it("realizes projectPlanPoint on the floor", () => {
    const f = iso();
    const m = planProjectionTransform(f).match(/^matrix\(([^)]+)\)$/);
    expect(m).not.toBeNull();
    const [a, b, c, d, e, g] = m![1].split(" ").map(Number);
    for (const [x, y] of [
      [0, 0],
      [1000, 600],
      [123, 456],
    ]) {
      const p = projectPlanPoint(x, y, f);
      expect(a * x + c * y + e).toBeCloseTo(p.x, 3);
      expect(b * x + d * y + g).toBeCloseTo(p.y, 3);
    }
  });
});

describe("projectPlanDirection", () => {
  it("passes through when flat", () => {
    expect(projectPlanDirection(0, 1, flat())).toEqual({ x: 0, y: 1 });
  });
  it("turns the plan's axes into the isometric ones, at unit length", () => {
    const f = iso();
    const px = projectPlanDirection(1, 0, f);
    const py = projectPlanDirection(0, 1, f);
    expect(Math.hypot(px.x, px.y)).toBeCloseTo(1, 9);
    expect(Math.hypot(py.x, py.y)).toBeCloseTo(1, 9);
    // +x runs down and to the right; +y down and to the left.
    expect(px.x).toBeGreaterThan(0);
    expect(px.y).toBeGreaterThan(0);
    expect(py.x).toBeLessThan(0);
    expect(py.y).toBeGreaterThan(0);
  });
});

describe("elevationShift", () => {
  it("becomes (-z, -z) once the plan's rotation has turned it", () => {
    const w = 1000;
    const h = 600;
    for (const rot of [0, 90, 180, 270] as PlanRotation[]) {
      const s = elevationShift(24, rot);
      const p = { x: 310, y: 120 };
      const r0 = rotatePlanPoint(p.x, p.y, w, h, rot);
      const r1 = rotatePlanPoint(p.x + s.x, p.y + s.y, w, h, rot);
      expect(r1.x).toBeCloseTo(r0.x - 24, 9);
      expect(r1.y).toBeCloseTo(r0.y - 24, 9);
    }
  });
});

describe("wallSolids", () => {
  const H = 60;
  const wall = { id: "w1", x1: 0, y1: 0, x2: 320, y2: 0, thickness: 8 };
  const xs = (solids: IsoSolid[]) => solids.flatMap((s) => s.base.map((p) => p.x));

  it("draws a plain wall as pieces no longer than the chunk, capped at both ends", () => {
    const solids = wallSolids([wall], [], H);
    expect(solids.length).toBe(Math.ceil((320 + 8) / ISO_CHUNK));
    expect(solids.every((s) => s.kind === "wall" && s.z0 === 0 && s.z1 === H)).toBe(true);
    expect(Math.min(...xs(solids))).toBeCloseTo(-4, 9);
    expect(Math.max(...xs(solids))).toBeCloseTo(324, 9);
    for (const s of solids) {
      const w = Math.max(...s.base.map((p) => p.x)) - Math.min(...s.base.map((p) => p.x));
      expect(w).toBeLessThanOrEqual(ISO_CHUNK + 1e-9);
    }
  });

  it("leaves a doorway open", () => {
    const door = { x: 100, y: 0, length: 40, angle: 0, type: "door" as const };
    const solids = wallSolids([wall], [door], H);
    expect(solids.every((s) => s.kind === "wall")).toBe(true);
    for (const x of xs(solids)) expect(x <= 80 + 1e-9 || x >= 120 - 1e-9).toBe(true);
    // Something on each side of it.
    expect(xs(solids).some((x) => x < 80)).toBe(true);
    expect(xs(solids).some((x) => x > 120)).toBe(true);
  });

  it("leaves a passage open the way it leaves a doorway (issue #309)", () => {
    const passage = { x: 100, y: 0, length: 40, angle: 0, type: "passage" as const };
    const door = { ...passage, type: "door" as const };
    expect(wallSolids([wall], [passage], H)).toEqual(wallSolids([wall], [door], H));
  });

  it("lowers a window to a sill and puts glass above it", () => {
    const win = { x: 200, y: 0, length: 60, angle: 0, type: "window" as const };
    const solids = wallSolids([wall], [win], H);
    const sills = solids.filter((s) => s.kind === "sill");
    const glass = solids.filter((s) => s.kind === "glass");
    expect(sills.length).toBeGreaterThan(0);
    expect(sills.every((s) => s.z1 === H * SILL_FRACTION)).toBe(true);
    expect(glass).toHaveLength(1);
    expect(glass[0].base).toHaveLength(2);
    expect(glass[0].base[0].x).toBeCloseTo(170, 9);
    expect(glass[0].base[1].x).toBeCloseTo(230, 9);
    expect(glass[0].z0).toBe(H * SILL_FRACTION);
    expect(glass[0].z1).toBe(H * GLASS_FRACTION);
    // The full-height wall stops at the window.
    for (const s of solids.filter((s) => s.kind === "wall"))
      for (const p of s.base) expect(p.x <= 170 + 1e-9 || p.x >= 230 - 1e-9).toBe(true);
  });

  it("ignores an opening that is not on the wall", () => {
    const plain = wallSolids([wall], [], H).length;
    const across = { x: 100, y: 0, length: 40, angle: 90, type: "door" as const };
    const away = { x: 100, y: 50, length: 40, angle: 0, type: "door" as const };
    expect(wallSolids([wall], [across], H)).toHaveLength(plain);
    expect(wallSolids([wall], [away], H)).toHaveLength(plain);
  });

  it("cuts no wall for a skylight, even one drawn right over it", () => {
    // A roof light is a hole in the ceiling. Its centre can lie along a
    // partition by coincidence, and that must not saw the partition in half.
    const plain = wallSolids([wall], [], H);
    const velux = { x: 100, y: 0, length: 40, angle: 0, type: "skylight" as const };
    expect(wallSolids([wall], [velux], H)).toEqual(plain);
  });

  it("cuts a door out of a wall that runs the other way", () => {
    const up = { id: "w2", x1: 0, y1: 0, x2: 0, y2: 200, thickness: 8 };
    const door = { x: 0, y: 100, length: 40, angle: 90, type: "door" as const };
    const ys = wallSolids([up], [door], H).flatMap((s) => s.base.map((p) => p.y));
    for (const y of ys) expect(y <= 80 + 1e-9 || y >= 120 - 1e-9).toBe(true);
    expect(ys.some((y) => y < 80) && ys.some((y) => y > 120)).toBe(true);
  });

  it("draws nothing for a wall with no length", () => {
    expect(wallSolids([{ id: "w0", x1: 5, y1: 5, x2: 5, y2: 5, thickness: 8 }], [], H)).toHaveLength(0);
  });
  it("renders a wall interval above windows and doors when wall height is full height (> DEFAULT_WALL_HEIGHT)", () => {
    const door = { x: 100, y: 0, length: 40, angle: 0, type: "door" as const };
    const fullHeight = 150;
    const solids = wallSolids([wall], [door], fullHeight);
    const headers = solids.filter((s) => s.kind === "wall" && s.z0 === fullHeight * GLASS_FRACTION && s.z1 === fullHeight);
    expect(headers.length).toBeGreaterThan(0);
    expect(headers[0].base.some((p) => p.x >= 80 && p.x <= 120)).toBe(true);

    const window = { x: 100, y: 0, length: 40, angle: 0, type: "window" as const };
    const winSolids = wallSolids([wall], [window], fullHeight);
    const winHeaders = winSolids.filter((s) => s.kind === "wall" && s.z0 === fullHeight * GLASS_FRACTION && s.z1 === fullHeight);
    expect(winHeaders.length).toBeGreaterThan(0);
  });

  it("stands a railing at half height while keeping a passage gap", () => {
    const rail = { ...wall, kind: "railing" as const, thickness: 3.2 };
    const solids = wallSolids([rail], [{ x: 100, y: 0, length: 40, angle: 0, type: "passage" }], H);
    expect(solids.length).toBeGreaterThan(0);
    expect(solids.every(s => s.kind === "railing" && s.z1 === H / 2)).toBe(true);
    for (const x of xs(solids)) expect(x <= 80 + 1e-9 || x >= 120 - 1e-9).toBe(true);
  });
  it("preserves small wall stubs on indoor plans and omits <= 2px on outdoor plans", () => {
    const w = { id: "w_stub", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8 };
    // Door centered at 59 with length 80 spans 19 to 99 (leaves 1px <= 2px at end)
    const d = { x: 59, y: 0, length: 80, angle: 0, type: "door" as const };
    const indoorSolids = wallSolids([w], [d], H, false, false);
    const indoorWallPieces = indoorSolids.filter((s) => s.kind === "wall");
    expect(indoorWallPieces).toHaveLength(2);

    const outdoorSolids = wallSolids([w], [d], H, false, true);
    const outdoorWallPieces = outdoorSolids.filter((s) => s.kind === "wall");
    expect(outdoorWallPieces).toHaveLength(1);
    expect(Math.max(...outdoorWallPieces[0]!.base.map((p) => p.x))).toBeCloseTo(19, 1);
  });
  it("normalizes unparseable and out-of-range wall heights in wallSolids", () => {
    const negWall = { id: "w_neg", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: -30 };
    const strWall = { id: "w_str", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: "xyz" as unknown as number };
    const giantWall = { id: "w_giant", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: 9999 };

    const negSolids = wallSolids([negWall], [], 60);
    expect(negSolids[0].z1).toBe(0);
    expect(negSolids[0].z0).toBe(0);

    const strSolids = wallSolids([strWall], [], 60);
    expect(strSolids[0].z1).toBe(60);

    const giantSolids = wallSolids([giantWall], [], 60);
    expect(giantSolids[0].z1).toBe(MAX_WALL_HEIGHT);
  });
});

describe("openingWall and openingWallHeight", () => {
  const wallA = { id: "w_a", x1: 0, y1: 0, x2: 200, y2: 0, thickness: 8, height: 120 };
  const wallB = { id: "w_b", x1: 200, y1: 0, x2: 200, y2: 200, thickness: 8, height: 40 };
  const railing = { id: "w_rail", x1: 0, y1: 200, x2: 200, y2: 200, thickness: 4, kind: "railing" as const };
  const plainWall = { id: "w_plain", x1: 0, y1: 0, x2: 0, y2: 200, thickness: 8 };

  it("finds the wall an opening is placed on", () => {
    const doorOnA = { x: 100, y: 0, length: 40, angle: 0, type: "door" as const };
    const doorOnB = { x: 200, y: 100, length: 40, angle: 90, type: "door" as const };
    const offWall = { x: 50, y: 50, length: 40, angle: 0, type: "door" as const };
    const skylight = { x: 100, y: 0, length: 40, angle: 0, type: "skylight" as const };

    expect(openingWall(doorOnA, [wallA, wallB])?.id).toBe("w_a");
    expect(openingWall(doorOnB, [wallA, wallB])?.id).toBe("w_b");
    expect(openingWall(offWall, [wallA, wallB])).toBeUndefined();
    expect(openingWall(skylight, [wallA, wallB])).toBeUndefined();
  });

  it("calculates opening height by inheriting from the underlying wall", () => {
    const doorOnA = { x: 100, y: 0, length: 40, angle: 0, type: "door" as const };
    const doorOnB = { x: 200, y: 100, length: 40, angle: 90, type: "door" as const };
    const passageOnRail = { x: 100, y: 200, length: 40, angle: 0, type: "passage" as const };
    const doorOnPlain = { x: 0, y: 100, length: 40, angle: 90, type: "door" as const };
    const floatingDoor = { x: 50, y: 50, length: 40, angle: 0, type: "door" as const };

    const walls = [wallA, wallB, railing, plainWall];
    // Inherits wallA's height of 120
    expect(openingWallHeight(doorOnA, walls, 60)).toBe(120);
    // Inherits wallB's height of 40
    expect(openingWallHeight(doorOnB, walls, 60)).toBe(40);
    // Inherits railing's fraction (60 * 0.5 = 30)
    expect(openingWallHeight(passageOnRail, walls, 60)).toBe(30);
    // Falls back to card's defaultWallHeight for plain wall with no height override
    expect(openingWallHeight(doorOnPlain, walls, 60)).toBe(60);
    // Falls back to defaultWallHeight when not on any wall
    expect(openingWallHeight(floatingDoor, walls, 60)).toBe(60);
  });

  it("resolves collinear walls at a junction by choosing the wall with greatest overlap", () => {
    const colWallA = { id: "col_a", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: 60 };
    const colWallB = { id: "col_b", x1: 100, y1: 0, x2: 200, y2: 0, thickness: 8, height: 120 };

    // Door at x=90, length=40 (spans [70, 110]): overlaps colWallA by 30, colWallB by 10
    const doorNearA = { x: 90, y: 0, length: 40, angle: 0, type: "door" as const };
    expect(openingWall(doorNearA, [colWallA, colWallB])?.id).toBe("col_a");
    // Independent of array ordering
    expect(openingWall(doorNearA, [colWallB, colWallA])?.id).toBe("col_a");

    // Door at x=110, length=40 (spans [90, 130]): overlaps colWallA by 10, colWallB by 30
    const doorNearB = { x: 110, y: 0, length: 40, angle: 0, type: "door" as const };
    expect(openingWall(doorNearB, [colWallA, colWallB])?.id).toBe("col_b");
    expect(openingWall(doorNearB, [colWallB, colWallA])?.id).toBe("col_b");
  });

  it("normalizes unparseable and out-of-range wall heights in openingWallHeight", () => {
    const negWall = { id: "w_neg", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: -30 };
    const strWall = { id: "w_str", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: "xyz" as unknown as number };
    const giantWall = { id: "w_giant", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: 9999 };

    const door = { x: 50, y: 0, length: 40, angle: 0, type: "door" as const };
    expect(openingWallHeight(door, [negWall], 60)).toBe(0);
    expect(openingWallHeight(door, [strWall], 60)).toBe(60);
    expect(openingWallHeight(door, [giantWall], 60)).toBe(MAX_WALL_HEIGHT);
  });
});

describe("furnitureSolid", () => {
  const same = (x: number, y: number) => ({ x, y });
  it("stands the piece's rectangle up about its centre", () => {
    const s = furnitureSolid({ id: "f1", x: 100, y: 100, w: 40, h: 20 }, same, 24, "#123456");
    expect(s.kind).toBe("furniture");
    expect(s.z1).toBe(24);
    expect(s.base.map((p) => [p.x, p.y])).toEqual([
      [80, 90],
      [120, 90],
      [120, 110],
      [80, 110],
    ]);
  });
  it("turns with the piece", () => {
    const s = furnitureSolid({ x: 100, y: 100, w: 40, h: 20, angle: 90 }, same, 24, "#123456");
    const xs = s.base.map((p) => p.x);
    const ys = s.base.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(20, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(40, 9);
  });
});

describe("renderIsoSolids", () => {
  const box = (id: string, x: number, y: number, color?: string): IsoSolid => ({
    kind: color ? "furniture" : "wall",
    id,
    base: [
      { x, y },
      { x: x + 10, y },
      { x: x + 10, y: y + 10 },
      { x, y: y + 10 },
    ],
    z0: 0,
    z1: 20,
    color,
  });

  it("paints the nearer box later", () => {
    const near = box("near", 500, 500);
    const far = box("far", 0, 0);
    expect(solidDepth(near)).toBeGreaterThan(solidDepth(far));
    const out = flatten(renderIsoSolids([near, far]));
    expect(out.indexOf("data-id=far")).toBeGreaterThan(-1);
    expect(out.indexOf("data-id=far")).toBeLessThan(out.indexOf("data-id=near"));
  });

  it("draws the two faces that look toward the viewer, then the top", () => {
    const out = flatten(renderIsoSolids([box("b", 0, 0)]));
    expect(out.match(/fp-iso-shade/g)).toHaveLength(2);
    expect(out.match(/fp-iso-top/g)).toHaveLength(1);
    // The top is the footprint raised by the height: (-20, -20).
    expect(out).toContain("points=-20,-20 -10,-20 -10,-10 -20,-10");
  });

  it("gives a furniture block its colour and whatever sits on top", () => {
    const s = { ...box("sofa", 0, 0, "#123456"), top: svg`<g class="glyph"></g>` };
    const out = flatten(renderIsoSolids([s]));
    expect(out).toContain("fp-iso-furniture");
    expect(out).toContain("--fp-iso-color:#123456");
    expect(out).toContain("glyph");
  });

  it("draws glass as one pane between its two heights", () => {
    const pane: IsoSolid = { kind: "glass", id: "w1", base: [{ x: 0, y: 0 }, { x: 30, y: 0 }], z0: 21, z1: 51 };
    const out = flatten(renderIsoSolids([pane]));
    expect(out.match(/fp-iso-glass/g)).toHaveLength(1);
    expect(out).toContain("points=-21,-21 9,-21 -21,-51 -51,-51");
  });
});

describe("areaZoomTransform under the isometric view", () => {
  const room = [
    { x: 100, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 300 },
    { x: 100, y: 300 },
  ];
  it("frames the room where it is drawn", () => {
    const flatZoom = areaZoomTransform(room, 1000, 600, 0);
    const isoZoom = areaZoomTransform(room, 1000, 600, 0, undefined, undefined, undefined, iso());
    for (const z of [flatZoom, isoZoom]) {
      expect(Number.isFinite(z.scale)).toBe(true);
      expect(z.scale).toBeGreaterThanOrEqual(1);
    }
    expect(isoZoom).not.toEqual(flatZoom);
  });
  it("is the flat framing when no frame is given", () => {
    const a = areaZoomTransform(room, 1000, 600, 90);
    const b = areaZoomTransform(room, 1000, 600, 90, undefined, undefined, undefined, {
      w: 600,
      h: 1000,
      projection: "plan",
      wallHeight: 0,
    });
    expect(a).toEqual(b);
  });
});


describe("transparent wall geometry", () => {
  it("only draws end caps at the ends of a wall run", () => {
    const chunks = wallSolids([{ id: "wall", x1: 0, y1: 0, x2: 320, y2: 0, thickness: 8 }], [], 60);
    expect(chunks[0].hiddenEdges).toEqual([1]);
    expect(chunks[chunks.length - 1].hiddenEdges).toEqual([3]);
    expect(chunks.slice(1, -1).every((s) => s.hiddenEdges?.length === 2)).toBe(true);
    // A middle chunk only presents its long near face and top, never a rib.
    const drawing = flatten(renderIsoSolids([chunks[1]]));
    expect((drawing.match(/class="fp-iso-shade"/g) ?? []).length).toBe(1);
  });
  it("uses per-wall height override when specified", () => {
    const defaultChunks = wallSolids([{ id: "wall", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8 }], [], 60);
    const customChunks = wallSolids([{ id: "wall", x1: 0, y1: 0, x2: 100, y2: 0, thickness: 8, height: 120 }], [], 60);
    expect(defaultChunks[0].z1).toBe(60);
    expect(customChunks[0].z1).toBe(120);
  });
  it("includes a screen margin in both the SVG transform and overlay coordinates", () => {
    const frame = { ...iso(), padding: 14 };
    const size = projectedCanvasSize(frame);
    expect(size.w - projectedCanvasSize(iso()).w).toBeCloseTo(28);
    const top = projectPlanPoint(0, 0, frame, 60);
    expect(top.y).toBe(14);
    const values = planProjectionTransform(frame).match(/matrix\((.*)\)/)![1].split(" ").map(Number);
    const p = projectPlanPoint(100, 200, frame);
    expect(values[0] * 100 + values[2] * 200 + values[4]).toBeCloseTo(p.x, 3);
    expect(values[1] * 100 + values[3] * 200 + values[5]).toBeCloseTo(p.y, 3);
  });
});


describe("3D framing and opacity", () => {
  it("keeps the tops of tall room walls inside a fitted room zoom", () => {
    const room = [{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 400, y: 300 }, { x: 100, y: 300 }];
    const frame = iso(1000, 600, 200);
    const zoom = areaZoomTransform(room, 1000, 600, 0, undefined, undefined, undefined, frame);
    const size = projectedCanvasSize(frame);
    for (const point of room) for (const height of [0, 200]) {
      const p = projectPlanPoint(point.x, point.y, frame, height);
      const y = p.y * zoom.scale + zoom.tyPercent / 100 * size.h;
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(size.h);
    }
  });
  it("defaults malformed opacity and clamps finite values", () => {
    for (const value of [undefined, null, "", NaN, Infinity]) expect(normalizeWallOpacity(value)).toBe(1);
    expect(normalizeWallOpacity(-1)).toBe(0);
    expect(normalizeWallOpacity(0)).toBe(0);
    expect(normalizeWallOpacity(0.45)).toBe(0.45);
    expect(normalizeWallOpacity(2)).toBe(1);
  });
});

describe("roofSolids", () => {
  const mapIdentity = (x: number, y: number) => ({ x, y });
  const points = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];

  it("generates flat roof solid", () => {
    const roof: Roof = { id: "r1", points, type: "flat", elevation: 60, height: 12, color: "#ff0000" };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids).toHaveLength(1);
    expect(solids[0].kind).toBe("roof");
    expect(solids[0].z0).toBe(60);
    expect(solids[0].z1).toBe(72);
    expect(solids[0].color).toBe("#ff0000");
  });

  it("generates hip roof solids", () => {
    const roof: Roof = { id: "r1", points, type: "hip", elevation: 60, height: 40 };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids).toHaveLength(4);
    expect(solids.every((s) => s.kind === "roof" && s.z0 === 60 && s.z1 === 100)).toBe(true);
  });

  it("generates shed roof solids with pitch side options", () => {
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const roof: Roof = { id: "r1", points, type: "shed", highSide: side, elevation: 60, height: 30 };
      const solids = roofSolids([roof], mapIdentity, 60);
      expect(solids.length).toBeGreaterThanOrEqual(2);
      expect(solids.some((s) => s.vertices !== undefined)).toBe(true);
    }
  });

  it("generates gable roof solids", () => {
    const roof: Roof = { id: "r1", points, type: "gable", elevation: 60, height: 30 };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids.length).toBeGreaterThanOrEqual(2);
    expect(solids.every((s) => s.kind === "roof")).toBe(true);
  });

  it("supports dedicated Roof objects", () => {
    const roof: Roof = {
      id: "r1",
      type: "shed",
      points,
      height: 40,
      elevation: 50,
      highSide: "top",
      overhang: 5,
      color: "#336699",
    };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids.length).toBeGreaterThanOrEqual(2);
    expect(solids[0].color).toBe("#336699");
    // Verify highSide === "top" slopes up to North (min-Y / top edge)
    const slope = solids.find((s) => s.vertices !== undefined);
    expect(slope).toBeDefined();
    // North vertices (y = minY - overhang = -5) should have peak elevation 50 + 40 = 90
    const northVertices = slope!.vertices!.filter((v) => v.y === -5);
    expect(northVertices).toHaveLength(2);
    expect(northVertices.every((v) => v.z === 90)).toBe(true);
    // South vertices (y = maxY + overhang = 105) should have base elevation 50
    const southVertices = slope!.vertices!.filter((v) => v.y === 105);
    expect(southVertices).toHaveLength(2);
    expect(southVertices.every((v) => v.z === 50)).toBe(true);
  });

  it("respects ridge orientation override on gable roof", () => {
    // 200 wide x 100 tall rectangle: auto ridge would be horizontal (along longer X side)
    const widePoints = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 }];
    const roofVert: Roof = {
      id: "r_vert",
      type: "gable",
      points: widePoints,
      height: 30,
      ridge: "vertical",
    };
    const solids = roofSolids([roofVert], mapIdentity, 60);
    expect(solids.length).toBe(4);
    // For vertical ridge, ridge runs along Y at mid-X (x = 100), splitting into left and right slopes
    const slope0 = solids[0];
    expect(slope0.base.some((p) => p.x === 100)).toBe(true);
  });

  it("sanitises hostile roof colour and falls back to default (#8d6e63)", () => {
    const roof: Roof = {
      id: "r1",
      points,
      type: "flat",
      elevation: 60,
      height: 12,
      color: "red;position:fixed;inset:0;z-index:99999;background-image:url(https://evil.example/x)",
    };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids[0].color).toBe("#8d6e63");
    const html = flatten(renderIsoSolids(solids));
    expect(html).not.toContain("position:fixed");
    expect(html).not.toContain("evil.example");
    expect(html).toContain("--fp-iso-color:#8d6e63");
  });

  it("sanitises hostile roof colour for pitched roofs in renderIsoSolids", () => {
    const roof: Roof = {
      id: "r1",
      points,
      type: "gable",
      elevation: 60,
      height: 30,
      color: "red;position:fixed;inset:0",
    };
    const solids = roofSolids([roof], mapIdentity, 60);
    expect(solids.every((s) => s.color === "#8d6e63")).toBe(true);
    const html = flatten(renderIsoSolids(solids));
    expect(html).not.toContain("position:fixed");
    expect(html).toContain("--fp-iso-color:#8d6e63");
  });

  it("renders IsoSolid with opacity in renderIsoSolids", () => {
    const solid: IsoSolid = {
      kind: "roof",
      id: "slab_curte",
      base: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      z0: -6,
      z1: 0,
      color: "#f7fbfd",
      opacity: 1,
    };
    const html = flatten(renderIsoSolids([solid]));
    expect(html).toContain("opacity:1");
    expect(html).toContain("--fp-iso-color:#f7fbfd");
  });

  it("renders IsoSolid with partial opacity", () => {
    const solid: IsoSolid = {
      kind: "roof",
      id: "slab_garden",
      base: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      z0: -6,
      z1: 0,
      color: "#06f202",
      opacity: 0.5,
    };
    const html = flatten(renderIsoSolids([solid]));
    expect(html).toContain("opacity:0.5");
    expect(html).toContain("--fp-iso-color:#06f202");
  });

  it("resolves equal-area intersecting gable roof pair without duplicate faces", () => {
    // Symmetrical plus-shaped intersection: two 200x40 gables, both with area 8000
    // g1 runs horizontally along X (0..200, 80..120) with ridge at y=100
    // g2 runs vertically along Y (80..120, 0..200) with ridge at x=100
    const g1: Roof = {
      id: "g1",
      type: "gable",
      points: [{ x: 0, y: 80 }, { x: 200, y: 80 }, { x: 200, y: 120 }, { x: 0, y: 120 }],
      height: 30,
    };
    const g2: Roof = {
      id: "g2",
      type: "gable",
      points: [{ x: 80, y: 0 }, { x: 120, y: 0 }, { x: 120, y: 200 }, { x: 80, y: 200 }],
      height: 30,
    };
    const solids = roofSolids([g1, g2], mapIdentity, 60);
    // Exactly one gable becomes main and generates 8 intersecting solids, avoiding duplicates
    expect(solids).toHaveLength(8);
    expect(solids.every((s) => s.kind === "roof")).toBe(true);
  });

  it("sets valley point elevation from cross-gable eaves when elevations differ", () => {
    // Main gable at elevation 60, cross-gable at lower elevation 40
    const mainGable: Roof = {
      id: "main",
      type: "gable",
      points: [{ x: 0, y: 80 }, { x: 240, y: 80 }, { x: 240, y: 140 }, { x: 0, y: 140 }],
      elevation: 60,
      height: 30,
    };
    const crossGable: Roof = {
      id: "cross",
      type: "gable",
      points: [{ x: 80, y: 100 }, { x: 140, y: 100 }, { x: 140, y: 200 }, { x: 80, y: 200 }],
      elevation: 40,
      height: 25,
    };
    const solids = roofSolids([mainGable, crossGable], mapIdentity, 60);
    expect(solids.length).toBeGreaterThan(0);
    // Find the cross-gable front faces and verify they use cross-gable's eaves elevation (40)
    const crossSolids = solids.filter((s) => s.id === "cross");
    expect(crossSolids.length).toBeGreaterThanOrEqual(3);
    expect(crossSolids.some((s) => s.z0 === 40)).toBe(true);
  });
});

