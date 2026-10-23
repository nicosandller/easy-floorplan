/** Declarative, bounded 3D geometry. No markup, URLs or executable expressions. */
export interface ModelPart { base: [number, number][]; z0: number; z1: number; glass?: boolean }
export interface SymbolModel {
  size: { width: number; depth: number; height: number };
  parts: ModelPart[];
}
const record = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 10000;
const vector = (v: unknown, n: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every(finite) ? v : null;
const LIMIT = 64;

/** Invalid/unknown models fall back as a whole, without losing the 2D symbol. */
export function normalizeModel(raw: unknown): SymbolModel | undefined {
  const r = record(raw), size = record(r?.size);
  if (!r || r.version !== 1 || r.units !== "cm" || !size ||
      (r.axes !== undefined && record(r.axes)?.up !== "z")) return;
  const dims = [size.width, size.depth, size.height];
  if (!dims.every(v => finite(v) && v > 0) || !Array.isArray(r.parts) || !r.parts.length || r.parts.length > LIMIT) return;
  const [width, depth, height] = dims as number[];
  const parts: ModelPart[] = [];
  function add(rawPart: unknown, offset: number[], nested = false): boolean {
    const p = record(rawPart);
    if (!p) return false;
    if (p.repeat !== undefined) {
      const step = vector(p.step, 3);
      if (nested || !Number.isInteger(p.repeat) || !finite(p.repeat) || p.repeat < 1 || p.repeat > LIMIT || !step) return false;
      for (let i = 0; i < p.repeat; i++) if (!add(p.part, offset.map((v, j) => v + i * step[j]!), true)) return false;
      return true;
    }
    if (parts.length >= LIMIT) return false;
    const pos = p.position === undefined ? [0, 0, 0] : vector(p.position, 3);
    if (!pos || [p.box, p.cylinder, p.extrude].filter(v => v !== undefined).length !== 1) return false;
    let base: [number, number][] = [], tall: number;
    if (p.box !== undefined) {
      const box = vector(p.box, 3);
      if (!box || box.some(v => v <= 0)) return false;
      base = [[0, 0], [box[0]!, 0], [box[0]!, box[1]!], [0, box[1]!]];
      tall = box[2]!;
    } else if (p.cylinder !== undefined) {
      const c = record(p.cylinder);
      if (!c || !finite(c.radius) || c.radius <= 0 || !finite(c.height) || c.height <= 0) return false;
      const radius = c.radius;
      base = Array.from({ length: 12 }, (_, i) => [radius + radius * Math.cos(i * Math.PI / 6), radius + radius * Math.sin(i * Math.PI / 6)]);
      tall = c.height;
    } else {
      const e = record(p.extrude);
      if (!e || !finite(e.height) || e.height <= 0 || !Array.isArray(e.polygon) || e.polygon.length < 3 || e.polygon.length > 24) return false;
      for (const point of e.polygon) {
        const xy = vector(point, 2);
        if (!xy) return false;
        base.push(xy as [number, number]);
      }
      // Every other vertex must lie strictly on the same side of each edge.
      // This rejects concave, degenerate and self-intersecting footprints.
      let winding = 0;
      for (let i = 0; i < base.length; i++) {
        const a = base[i]!, b = base[(i + 1) % base.length]!;
        for (let j = 0; j < base.length; j++) {
          if (j === i || j === (i + 1) % base.length) continue;
          const c = base[j]!, cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
          if (Math.abs(cross) < 1e-8 || (winding && Math.sign(cross) !== winding)) return false;
          winding = Math.sign(cross);
        }
      }
      tall = e.height;
    }
    base = base.map(([x, y]) => [x + pos[0]! + offset[0]!, y + pos[1]! + offset[1]!]);
    const z0 = pos[2]! + offset[2]!, z1 = z0 + tall;
    if (base.some(([x, y]) => x < -1e-7 || y < -1e-7 || x > width! + 1e-7 || y > depth! + 1e-7) || z0 < 0 || z1 > height! + 1e-7) return false;
    parts.push({ base, z0, z1, ...(p.material === "glass" ? { glass: true } : {}) });
    return true;
  }
  for (const p of r.parts) if (!add(p, [0, 0, 0])) return;
  return { size: { width: width!, depth: depth!, height: height! }, parts };
}
