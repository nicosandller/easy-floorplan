import { describe, expect, it, vi } from "vitest";
import { FurnitureModelCache } from "./furniture-model-cache";
import { normalizeModel } from "./symbol-model";
import type { Furniture } from "./types";

const model = normalizeModel({ version: 1, units: "cm", size: { width: 60, depth: 60, height: 200 },
  parts: [{ box: [60, 60, 20], position: [0, 0, 100] }] })!;
const furniture: Furniture = { id: "shelf", type: "shelf", x: 100, y: 100, w: 60, h: 60 };
const view = { width: 400, height: 400, rotation: 0, sectionHeight: 180 };
const entry = { furniture, model, color: "#555" };
const map = () => vi.fn((x: number, y: number) => ({ x, y }));

describe("furniture model geometry cache", () => {
  it("reuses geometry across unrelated updates and replacement furniture objects", () => {
    const cache = new FurnitureModelCache(), project = map();
    const first = cache.project([entry], view, project).get(furniture);
    project.mockClear();
    const replacement = { ...furniture, entity: "sensor.new", showIcon: false };
    expect(cache.project([{ ...entry, furniture: replacement }], { ...view }, project).get(replacement)).toBe(first);
    expect(project).not.toHaveBeenCalled();
  });
  it.each([{ x: 101 }, { y: 101 }, { w: 80 }, { h: 80 }, { angle: 90 }, { height3d: 100 }])(
    "rebuilds changed furniture geometry: %j", change => {
      const cache = new FurnitureModelCache(), project = map();
      const first = cache.project([entry], view, project).get(furniture);
      project.mockClear();
      const changed = { ...furniture, ...change };
      const result = cache.project([{ ...entry, furniture: changed }], view, project).get(changed);
      expect(result).not.toBe(first);
      expect(project).toHaveBeenCalled();
    });
  it.each([{ width: 500 }, { height: 500 }, { rotation: 90 }, { sectionHeight: 110 }])(
    "rebuilds when the projection or cut changes: %j", change => {
      const cache = new FurnitureModelCache(), project = map();
      const first = cache.project([entry], view, project).get(furniture);
      expect(cache.project([entry], { ...view, ...change }, project).get(furniture)).not.toBe(first);
    });
  it("refreshes colors and replaced models", () => {
    const cache = new FurnitureModelCache(), project = map();
    cache.project([entry], view, project);
    expect(cache.project([{ ...entry, color: "#123456" }], view, project).get(furniture)![0]!.color).toBe("#123456");
    const changedModel = { ...model, parts: [{ ...model.parts[0]!, z1: 140 }] };
    expect(cache.project([{ ...entry, model: changedModel }], view, project).get(furniture)![0]!.z1).toBe(140);
  });
  it("rebuilds only the changed piece and discards removed pieces", () => {
    const cache = new FurnitureModelCache(), project = map();
    const second = { ...furniture, id: "second" };
    const secondEntry = { ...entry, furniture: second };
    const first = cache.project([entry, secondEntry], view, project);
    const changed = { ...furniture, height3d: 100 };
    const next = cache.project([{ ...entry, furniture: changed }, secondEntry], view, project);
    expect(next.get(second)).toBe(first.get(second));
    expect(next.get(changed)).not.toBe(first.get(furniture));
    cache.project([], view, project);
    expect(cache.project([secondEntry], view, project).get(second)).not.toBe(first.get(second));
  });
});
