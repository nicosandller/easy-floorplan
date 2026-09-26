import type { IsoSolid, Pt } from "./projection";

interface Vertex extends Pt { z: number }
const EPS = 1e-7;
const dot = (a: Vertex, b: Vertex) => a.x * b.x + a.y * b.y + a.z * b.z;

/** Vertices in the rotated world, before elevation flattens away their depth. */
function vertices(s: IsoSolid): Vertex[] {
  return s.vertices ?? s.base.flatMap(p => [{ ...p, z: s.z0 }, { ...p, z: s.z1 }]);
}

function hull(points: Pt[]): Pt[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (ps: Pt[]) => {
    const out: Pt[] = [];
    for (const p of ps) {
      while (out.length > 1 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= EPS) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

function interval(ps: Vertex[], axis: Vertex): [number, number] {
  const ds = ps.map(p => dot(p, axis));
  return [Math.min(...ds), Math.max(...ds)];
}

function axes(s: IsoSolid): Vertex[] {
  const result: Vertex[] = [{ x: 0, y: 0, z: 1 }];
  for (let i = 0; i < s.base.length; i++) {
    const a = s.base[i]!, b = s.base[(i + 1) % s.base.length]!;
    result.push({ x: b.y - a.y, y: a.x - b.x, z: 0 });
  }
  // Tilted awnings/skylights also have a separating plane that is neither
  // horizontal nor vertical.
  if (s.vertices && s.vertices.length >= 3) {
    const [a, b, c] = s.vertices;
    const u = { x: b!.x - a!.x, y: b!.y - a!.y, z: b!.z - a!.z };
    const v = { x: c!.x - a!.x, y: c!.y - a!.y, z: c!.z - a!.z };
    result.push({ x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x });
  }
  return result.filter(a => Math.hypot(a.x, a.y, a.z) > EPS).map(a => {
    const n = Math.hypot(a.x, a.y, a.z);
    return { x: a.x / n, y: a.y / n, z: a.z / n };
  });
}

/** Non-overlapping silhouettes impose no painter constraint. */
function overlaps(a: Pt[], b: Pt[]): boolean {
  if (a.length < 3 || b.length < 3) return false;
  for (const ps of [a, b]) for (let i = 0; i < ps.length; i++) {
    const p = ps[i]!, q = ps[(i + 1) % ps.length]!;
    const dx = q.y - p.y, dy = p.x - q.x;
    const aa = a.map(v => v.x * dx + v.y * dy), bb = b.map(v => v.x * dx + v.y * dy);
    if (Math.max(...aa) <= Math.min(...bb) + EPS || Math.max(...bb) <= Math.min(...aa) + EPS) return false;
  }
  return true;
}

interface Face { polygon: Pt[]; normal: Vertex; distance: number; toward: number }
function faces(s: IsoSolid): Face[] {
  const lifted = (ps: Pt[], z: number) => ps.map(p => ({ ...p, z }));
  const polygons: Vertex[][] = [];
  if (s.kind === "glass" || s.kind === "panel" || s.kind === "opening-hit") {
    const [a, b] = s.base;
    polygons.push(s.vertices ?? [{ ...a!, z: s.z0 }, { ...b!, z: s.z0 },
      { ...b!, z: s.z1 }, { ...a!, z: s.z1 }]);
  } else {
    polygons.push(lifted(s.base, s.z1));
    const centre = s.base.reduce((p, q) => ({ x: p.x + q.x / s.base.length, y: p.y + q.y / s.base.length }), { x: 0, y: 0 });
    for (let i = 0; i < s.base.length; i++) {
      if (s.hiddenEdges?.includes(i)) continue;
      const a = s.base[i]!, b = s.base[(i + 1) % s.base.length]!;
      let nx = b.y - a.y, ny = a.x - b.x;
      if (nx * (centre.x - a.x) + ny * (centre.y - a.y) > 0) { nx = -nx; ny = -ny; }
      if (nx + ny > 0) polygons.push([...lifted([a, b], s.z0), ...lifted([b, a], s.z1)]);
    }
  }
  return polygons.flatMap(ps => {
    if (ps.length < 3) return [];
    const [a, b, c] = ps;
    const u = { x: b!.x - a!.x, y: b!.y - a!.y, z: b!.z - a!.z };
    const v = { x: c!.x - a!.x, y: c!.y - a!.y, z: c!.z - a!.z };
    const normal = { x: u.y * v.z - u.z * v.y, y: u.z * v.x - u.x * v.z, z: u.x * v.y - u.y * v.x };
    const toward = normal.x + normal.y + normal.z;
    return Math.abs(toward) <= EPS ? [] : [{ polygon: ps.map(p => ({ x: p.x - p.z, y: p.y - p.z })),
      normal, distance: dot(normal, a!), toward }];
  });
}

function intersection(a: Pt[], b: Pt[]): Pt[] {
  let clipped = a;
  const area = b.reduce((sum, p, i) => {
    const q = b[(i + 1) % b.length]!;
    return sum + p.x * q.y - p.y * q.x;
  }, 0);
  for (let i = 0; i < b.length && clipped.length; i++) {
    const p = b[i]!, q = b[(i + 1) % b.length]!;
    const side = (v: Pt) => Math.sign(area) * ((q.x - p.x) * (v.y - p.y) - (q.y - p.y) * (v.x - p.x));
    const next: Pt[] = [];
    for (let j = 0; j < clipped.length; j++) {
      const v = clipped[j]!, w = clipped[(j + 1) % clipped.length]!;
      const dv = side(v), dw = side(w);
      if (dv >= -EPS) next.push(v);
      if ((dv > EPS && dw < -EPS) || (dv < -EPS && dw > EPS)) {
        const t = dv / (dv - dw);
        next.push({ x: v.x + (w.x - v.x) * t, y: v.y + (w.y - v.y) * t });
      }
    }
    clipped = next;
  }
  return clipped;
}

/** Furniture may tuck into the back half of a thick wall. The visible front
 * faces can still have an unambiguous order even though their volumes overlap. */
function faceOrder(a: Face[], b: Face[]): number {
  let direction = 0;
  const depth = (f: Face, p: Pt) => (f.distance - f.normal.x * p.x - f.normal.y * p.y) / f.toward;
  for (const fa of a) for (const fb of b) {
    if (!overlaps(fa.polygon, fb.polygon)) continue;
    const common = intersection(fa.polygon, fb.polygon);
    if (common.length < 3) continue;
    const ds = common.map(p => depth(fa, p) - depth(fb, p));
    const min = Math.min(...ds), max = Math.max(...ds);
    if (min < -EPS && max > EPS) return 0; // Intersecting visible surfaces.
    const order = min < -EPS ? 1 : max > EPS ? -1 : 0;
    if (order && direction && direction !== order) return 0;
    direction ||= order;
  }
  return direction;
}

/**
 * Order standing solids by spatial separation and visible-face depth.
 * A separating plane says which solid a viewing ray meets first. The camera
 * is along (1,1,1): adding the same amount to x, y and z leaves elevate()
 * unchanged. In particular a sill is behind its glass even when a sill
 * chunk's midpoint lies nearer than the pane's midpoint.
 * If their volumes overlap, compare the visible faces across their shared
 * projected region; furniture can extend into a wall's hidden back face.
 *
 * Keep each solid/glyph intact, preserving one action target and tab stop.
 * The old stable depth key remains the tie-break for disjoint silhouettes,
 * coplanar surfaces and genuinely intersecting/cyclic geometry.
 */
export function sortIsoSolids(solids: readonly IsoSolid[]): IsoSolid[] {
  const nodes = solids.map((s, i) => {
    const vs = vertices(s);
    const shadow = hull(vs.map(p => ({ x: p.x - p.z, y: p.y - p.z })));
    return { s, i, vs, shadow, axes: axes(s), faces: faces(s), next: new Set<number>(), incoming: 0,
      depth: s.base.reduce((sum, p) => sum + p.x + p.y, 0) / (s.base.length || 1),
      xmin: Math.min(...shadow.map(p => p.x)), xmax: Math.max(...shadow.map(p => p.x)),
      ymin: Math.min(...shadow.map(p => p.y)), ymax: Math.max(...shadow.map(p => p.y)) };
  });
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const a = nodes[i]!, b = nodes[j]!;
    if (a.xmax <= b.xmin + EPS || b.xmax <= a.xmin + EPS ||
      a.ymax <= b.ymin + EPS || b.ymax <= a.ymin + EPS || !overlaps(a.shadow, b.shadow)) continue;
    let direction = 0;
    for (const axis of [...a.axes, ...b.axes]) {
      const toward = axis.x + axis.y + axis.z;
      if (Math.abs(toward) <= EPS) continue;
      const [amin, amax] = interval(a.vs, axis), [bmin, bmax] = interval(b.vs, axis);
      // Coincident panes have no order along their common zero-width axis.
      if (amax - amin <= EPS && bmax - bmin <= EPS && Math.abs(amin - bmin) <= EPS) continue;
      direction = amax <= bmin + EPS ? toward : bmax <= amin + EPS ? -toward : 0;
      if (!direction) continue;
      break;
    }
    direction ||= faceOrder(a.faces, b.faces);
    if (direction) {
      const [far, near] = direction > 0 ? [a, b] : [b, a];
      far.next.add(near.i);
      near.incoming++;
    }
  }
  const waiting = [...nodes].sort((a, b) => a.depth - b.depth || a.i - b.i);
  const ordered: IsoSolid[] = [];
  while (waiting.length) {
    const ready = waiting.findIndex(n => n.incoming === 0);
    const [node] = waiting.splice(ready < 0 ? 0 : ready, 1);
    ordered.push(node!.s);
    for (const n of node!.next) nodes[n]!.incoming--;
  }
  return ordered;
}
