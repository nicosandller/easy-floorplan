import { describe, expect, it } from "vitest";
import { normalizeModel } from "./symbol-model";
import { BUILTIN_SYMBOLS, normalizeSymbol } from "./symbols";
import { furnitureModelSolids } from "./projection";
const size = { width: 60, depth: 60, height: 180 };
const model = (parts: unknown[]) => ({ version: 1, units: "cm", size, parts });
const box = { box: [3, 30, 180] };

describe("optional 3D furniture", () => {
  it("validates every shipped model, with bounded geometry", () => {
    const files = import.meta.glob("../furniture/*.json", { eager: true, import: "default" });
    for (const [file, raw] of Object.entries(files)) {
      const model3d = (raw as { model3d?: unknown }).model3d;
      if (model3d === undefined) continue; // Newly added 2D symbols use the block fallback.
      const m = normalizeModel(model3d);
      expect(m, file).toBeDefined();
      expect(m!.parts.length).toBeLessThanOrEqual(64);
    }
  });
  it("retains the 2D symbol when a model is absent, invalid or a future version", () => {
    for (const model3d of [undefined, {}, { ...model([box]), version: 2 }]) {
      const symbol = normalizeSymbol({ id: "custom", parts: [{ rect: [0, 0, 100, 100] }], model3d });
      expect(symbol?.parts).toHaveLength(1);
      expect(symbol?.model3d).toBeUndefined();
    }
  });
  it("expands five shelf levels and respects the corner footprint", () => {
    const m = BUILTIN_SYMBOLS.cornerShelf.model3d!;
    const shelves = m.parts.filter(p => p.base.length === 5);
    expect(shelves).toHaveLength(5);
    expect(shelves.map(p => p.z0)).toEqual([8, 55, 102, 149, 196]);
    expect(shelves[0].base).toEqual([[0, 0], [60, 0], [60, 30], [30, 60], [0, 60]]);
    const repeated = normalizeModel(model([{ repeat: 5, step: [0, 0, 40], part: { box: [60, 60, 2], position: [0, 0, 5] } }]));
    expect(repeated?.parts.map(p => p.z0)).toEqual([5, 45, 85, 125, 165]);
  });
  it("builds a bounded glass cylinder and caps total expanded parts", () => {
    const m = normalizeModel(model([{ cylinder: { radius: 10, height: 30 }, position: [5, 7, 9], material: "glass" }]))!;
    expect(m.parts[0].base).toHaveLength(12);
    expect(m.parts[0].base[0]).toEqual([25, 17]);
    expect(m.parts[0].z0).toBe(9);
    expect(m.parts[0].z1).toBe(39);
    expect(m.parts[0].glass).toBe(true);
    expect(normalizeModel(model([{ repeat: 64, step: [0, 0, 0], part: box }, box]))).toBeUndefined();
  });
  it("rejects unbounded, malformed, concave and self-intersecting geometry", () => {
    for (const p of [
      { box: [NaN, 2, 2] }, { box: [0, 2, 2] }, { box: [61, 2, 2] },
      { ...box, position: [-1, 0, 0] }, { box: [1, 1, Infinity] },
      { cylinder: { radius: 40, height: 5 } },
      { repeat: 1000000, step: [0, 0, 0], part: box },
      { repeat: 2, step: [0, 0, 0], part: { repeat: 2, step: [0, 0, 0], part: box } },
      { extrude: { polygon: [[0, 0], [60, 0], [20, 20], [60, 60], [0, 60]], height: 5 } },
      { extrude: { polygon: [[0, 0], [60, 60], [0, 60], [60, 0]], height: 5 } },
      { extrude: { polygon: [[0, 0], [0, 0], [20, 20]], height: 5 } },
      { box: [3, 3, 3], cylinder: { radius: 2, height: 3 } },
    ]) expect(normalizeModel(model([p])), JSON.stringify(p)).toBeUndefined();
  });
  it("scales and rotates the footprint around the furniture centre, clipping at the wall height", () => {
    const m = normalizeModel(model([box]))!;
    const [s] = furnitureModelSolids({ id: "x", x: 100, y: 100, w: 120, h: 60, angle: 90 }, m, (x, y) => ({ x: y, y: -x }), 60, "#123456");
    expect(s.base[0]).toEqual({ x: 40, y: -130 });
    expect(s.z1).toBe(60);
    expect(s.id).toBe("x");
    expect(s.color).toBe("#123456");
  });
  it("removes shelves above the section plane without compressing lower shelves", () => {
    const m = BUILTIN_SYMBOLS.cornerShelf.model3d!;
    const solids = furnitureModelSolids({ x: 0, y: 0, w: 60, h: 60 }, m, (x, y) => ({ x, y }), 56, "#555");
    expect(solids.filter(s => s.base.length === 5).map(s => [s.z0, s.z1])).toEqual([[8, 11], [55, 56]]);
    expect(furnitureModelSolids({ x: 0, y: 0, w: 60, h: 60 }, m, (x, y) => ({ x, y }), 0, "#555")).toEqual([]);
  });
  it("caps model height at the frame padding for unusually tall custom furniture", () => {
    const m = normalizeModel({ ...model([{ box: [3, 3, 1000] }]), size: { ...size, height: 1000 } })!;
    expect(furnitureModelSolids({ x: 0, y: 0, w: 60, h: 60 }, m, (x, y) => ({ x, y }), 60, "#555")[0].z1).toBe(60);
  });
});
