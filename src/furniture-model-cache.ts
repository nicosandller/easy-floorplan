import { furnitureModelSolids, type IsoSolid } from "./projection";
import { furnitureModelHeight, type SymbolModel } from "./symbol-model";
import type { Furniture } from "./types";

type Entry = { furniture: Furniture; model: SymbolModel; color: string };
type View = { width: number; height: number; rotation: number; sectionHeight: number };
type Cached = { model: SymbolModel; key: unknown[]; solids: IsoSolid[] };

/** Per-card, last-frame cache. Removed furniture and previous floors are discarded. */
export class FurnitureModelCache {
  private entries = new Map<string, Cached>();

  project(entries: Entry[], view: View, map: (x: number, y: number) => { x: number; y: number }): Map<Furniture, IsoSolid[]> {
    const next = new Map<string, Cached>();
    const result = new Map<Furniture, IsoSolid[]>();
    for (const { furniture: f, model, color } of entries) {
      // The mapping is fully determined by the canvas dimensions and rotation.
      // Compare values, not furniture object identity: unrelated editor updates
      // can replace objects without changing the geometry.
      const key = [f.x, f.y, f.w, f.h, f.angle ?? 0, furnitureModelHeight(f, model),
        view.width, view.height, view.rotation, view.sectionHeight, color];
      const old = this.entries.get(f.id);
      const cached = old?.model === model && key.every((value, i) => Object.is(value, old.key[i]))
        ? old : { model, key, solids: furnitureModelSolids(f, model, map, view.sectionHeight, color) };
      next.set(f.id, cached);
      result.set(f, cached.solids);
    }
    this.entries = next;
    return result;
  }
}
