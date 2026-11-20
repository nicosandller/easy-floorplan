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

describe("placed 3D height", () => {
  const m = normalizeModel(model([{ box: [60, 60, 20], position: [0, 0, 100] }]))!;
  const f = { x: 0, y: 0, w: 60, h: 60 };
  const map = (x: number, y: number) => ({ x, y });
  it("scales vertical positions and thickness before sectioning, leaving the footprint unchanged", () => {
    const original = furnitureModelSolids(f, m, map, 400, "#555")[0]!;
    const scaled = furnitureModelSolids({ ...f, height3d: 90 }, m, map, 55, "#555")[0]!;
    expect(scaled.base).toEqual(original.base);
    expect(scaled.z0).toBe(50);
    expect(scaled.z1).toBe(55);
    expect(furnitureModelSolids({ ...f, height3d: 360 }, m, map, 400, "#555")[0]).toMatchObject({ z0: 200, z1: 240 });
  });
  it("preserves authored heights for absent or invalid overrides", () => {
    for (const height3d of [undefined, 0, -10, NaN, Infinity, 10001]) {
      expect(furnitureModelSolids({ ...f, height3d }, m, map, 400, "#555")[0]).toMatchObject({ z0: 100, z1: 120 });
    }
  });
});

it("positions elevated models at an absolute bottom before applying the independent cut", () => {
  const model = normalizeModel({ version: 1, units: "cm", size: { width: 60, depth: 10, height: 100 }, parts: [{ box: [60, 10, 100] }] })!;
  const f = { x: 0, y: 0, w: 60, h: 10 };
  const map = (x: number, y: number) => ({ x, y });
  const placement = { wallHeight: 200, elevation: { from: 100 } };
  expect(furnitureModelSolids(f, model, map, 300, "gray", placement)[0]).toMatchObject({ z0: 100, z1: 200 });
  expect(furnitureModelSolids(f, model, map, 130, "gray", placement)[0]).toMatchObject({ z0: 100, z1: 130 });
  expect(furnitureModelSolids(f, model, map, 100, "gray", placement)).toEqual([]);
  expect(furnitureModelSolids({ ...f, height3d: 80 }, model, map, 300, "gray", placement)[0]).toMatchObject({ z0: 100, z1: 180 });
});

it("normalizes a model bottom offset without requiring an elevation top", () => {
  const model3d = { version: 1, units: "cm", size: { width: 10, depth: 10, height: 70 }, parts: [{ box: [10, 10, 70] }] };
  const raw = { id: "tv", parts: [{ rect: [0, 0, 100, 100] }], model3d };
  expect(normalizeSymbol({ ...raw, elevation: { from: 100 } })?.elevation).toEqual({ from: 100 });
  const elevated = normalizeSymbol({ ...raw, elevation: { from: 100, to: 999 } })!;
  expect(elevated.elevation).toEqual({ from: 100, to: 999 });
  const solids = furnitureModelSolids({ x: 0, y: 0, w: 10, h: 10 }, elevated.model3d!, (x, y) => ({ x, y }), 400, "gray", { wallHeight: 200, elevation: elevated.elevation });
  expect(solids[0]).toMatchObject({ z0: 100, z1: 170 });
  for (const from of [-1, Infinity, NaN, 10001]) expect(normalizeSymbol({ ...raw, elevation: { from } })?.elevation).toBeUndefined();
});

it("keeps the indoor palm inside 40×40 with a 120 cm crown", () => {
  const m = BUILTIN_SYMBOLS.indoorPalm.model3d!;
  expect(m).toBeDefined();
  expect(m.size).toEqual({ width: 40, depth: 40, height: 120 });
  expect(Math.max(...m.parts.map(p => p.z1))).toBeCloseTo(120);
  expect(m.parts.length).toBeLessThanOrEqual(64);
  const leaves = m.parts.filter(p => Math.abs(p.z1 - p.z0 - 1.2) < 1e-6);
  expect(new Set(leaves.map(p => Math.round(p.z0 / 10))).size).toBeGreaterThanOrEqual(3);
});

it("ships the complete 35-model catalog, with awnings and curtains retaining the fallback", () => {
  expect(Object.keys(BUILTIN_SYMBOLS).filter(id => BUILTIN_SYMBOLS[id].model3d).sort()).toEqual([
    "airHandler", "bathtub", "bed", "bookcase", "bunkBed", "chair", "cornerShelf",
    "cornerShowerCurved", "desk", "dishwasher", "dresser", "dryer", "fishTank", "fridge",
    "hotTub", "indoorPalm", "ladderShelf", "piano", "plant", "quarterTub", "roundTable",
    "rug", "sectional", "sink", "sofa", "stairs", "stove", "table", "tallDresser", "toilet",
    "tv", "vanity", "wardrobe", "washer", "waterHeater",
  ].sort());
  expect(BUILTIN_SYMBOLS.awning.model3d).toBeUndefined();
  expect(BUILTIN_SYMBOLS.curtain.model3d).toBeUndefined();
});

it("keeps stairs at 220 cm with ascending treads and clips without rescaling", () => {
  const m = BUILTIN_SYMBOLS.stairs.model3d!;
  expect(m.size.height).toBe(220);
  expect(m.parts.map(p => p.z1)).toEqual([27.5, 55, 82.5, 110, 137.5, 165, 192.5, 220]);
  const cut = furnitureModelSolids({ x: 0, y: 0, w: 90, h: 170 }, m, (x, y) => ({ x, y }), 100, "gray");
  expect(cut.map(p => p.z1)).toEqual([27.5, 55, 82.5, 100, 100, 100, 100, 100]);
});

it.each(["airHandler", "rug", "waterHeater"])("keeps %s details within the authored dimensions", id => {
  const m = BUILTIN_SYMBOLS[id].model3d!;
  expect(m.parts.length).toBeGreaterThan(1);
  expect(Math.max(...m.parts.map(p => p.z1))).toBe(m.size.height);
  for (const p of m.parts) for (const [x, y] of p.base) {
    expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(m.size.width);
    expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(m.size.depth);
  }
});

it("gives the corner shower two glass doors, four flared grips and a floor drain", () => {
  const m = BUILTIN_SYMBOLS.cornerShowerCurved.model3d!;
  expect(m.size).toEqual({ width: 100, depth: 100, height: 200 });
  expect(m.parts.filter(p => p.glass)).toHaveLength(12);
  const grips = m.parts.filter(p => p.z0 === 98 && p.z1 === 102);
  expect(grips).toHaveLength(4);
  // Each door has one grip inside and one outside its 97 cm glass radius.
  const radii = grips.map(p => Math.hypot(
    p.base.reduce((sum, v) => sum + v[0], 0) / p.base.length - 100,
    p.base.reduce((sum, v) => sum + v[1], 0) / p.base.length - 2));
  expect(radii.filter(r => r < 97)).toHaveLength(2);
  expect(radii.filter(r => r > 97)).toHaveLength(2);
  expect(m.parts.filter(p => p.z0 === 0 && p.z1 === 0.5)).toHaveLength(7);
  const cut = furnitureModelSolids({ x: 0, y: 0, w: 100, h: 100 }, m, (x, y) => ({ x, y }), 100, "gray");
  expect(cut.filter(p => p.z0 === 98).map(p => p.z1)).toEqual([100, 100, 100, 100]);
});
