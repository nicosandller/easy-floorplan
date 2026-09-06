import { describe, it, expect } from "vitest";
import { nothing, svg } from "lit";
import { rotatePlanPoint, areaZoomTransform, type PlanRotation } from "./render";
import {
  DEFAULT_WALL_HEIGHT,
  MAX_WALL_HEIGHT,
  ISO_CHUNK,
  SILL_FRACTION,
  GLASS_FRACTION,
  normalizeProjection,
  normalizeWallHeight,
  projectedCanvasSize,
  projectPlanPoint,
  projectPlanDirection,
  planProjectionTransform,
  elevate,
  elevationShift,
  wallSolids,
  furnitureSolid,
  solidDepth,
  renderIsoSolids,
  type DisplayFrame,
  type IsoSolid,
} from "./projection";

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
  it("reads iso, and everything else as the flat plan", () => {
    expect(normalizeProjection("iso")).toBe("iso");
    expect(normalizeProjection("plan")).toBe("plan");
    expect(normalizeProjection(undefined)).toBe("plan");
    expect(normalizeProjection("3d")).toBe("plan");
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
