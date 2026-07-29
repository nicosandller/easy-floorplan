import type { Area, AreaPoint, Floor, Wall } from "./types";
import { polygonCentroid } from "./render";

/** Element kinds addressable by the editor's selection model. */
export type SelKind = "wall" | "opening" | "item" | "text" | "furniture" | "tracker" | "area";

export interface Sel {
  kind: SelKind;
  id: string;
}

/** Snapshot of an element's position at drag start, for group translation. */
export type OrigPos =
  | { kind: "wall"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "pt"; x: number; y: number }
  | { kind: "polygon"; points: AreaPoint[] };

/** A rectangle described by two opposite corners (any orientation). */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

type WallSegment = Pick<Wall, "x1" | "y1" | "x2" | "y2">;

/** Snap distance (virtual units) for wall endpoints onto each other. */
export const ENDPOINT_SNAP = 26;

/**
 * Corners of different walls at most this far apart count as the same room
 * corner for stretch-dragging (issue #30). Kept tight so only genuinely
 * shared corners travel together — walls that merely pass near each other
 * don't get grabbed.
 */
export const CORNER_ATTACH_EPS = 0.75;

/** An endpoint of another wall that shares a corner with a dragged wall. */
export interface AttachedCorner {
  id: string;
  /** Which endpoint of the attached wall coincides. */
  end: 1 | 2;
  /** Which endpoint of the dragged wall it follows. */
  which: 1 | 2;
  /** Position at drag start (for whole-wall translation). */
  x0: number;
  y0: number;
}

/**
 * Endpoints of other walls sharing a corner with the grabbed wall (issue
 * #30): dragging a corner or a whole wall stretches the room instead of
 * tearing it open. Scans only the grabbed endpoint's corner for an
 * endpoint-handle drag; both corners for a whole-wall drag.
 */
export function attachedCorners(
  walls: readonly Wall[],
  wallId: string,
  endpoint?: 1 | 2,
  eps = CORNER_ATTACH_EPS
): AttachedCorner[] | undefined {
  const w = walls.find((x) => x.id === wallId);
  if (!w) return undefined;
  const anchors: { x: number; y: number; which: 1 | 2 }[] = [];
  if (endpoint !== 2) anchors.push({ x: w.x1, y: w.y1, which: 1 });
  if (endpoint !== 1) anchors.push({ x: w.x2, y: w.y2, which: 2 });
  const attached: AttachedCorner[] = [];
  for (const other of walls) {
    if (other.id === w.id) continue;
    for (const end of [1, 2] as const) {
      const px = end === 1 ? other.x1 : other.x2;
      const py = end === 1 ? other.y1 : other.y2;
      const a = anchors.find((an) => Math.hypot(px - an.x, py - an.y) <= eps);
      if (a) attached.push({ id: other.id, end, which: a.which, x0: px, y0: py });
    }
  }
  return attached.length ? attached : undefined;
}

/** Closest of `points` to `(rawX, rawY)` within `maxDist`, or null. */
function nearestOf(
  points: readonly AreaPoint[],
  rawX: number,
  rawY: number,
  maxDist: number
): AreaPoint | null {
  let best: AreaPoint | null = null;
  let bestDist = maxDist;
  for (const p of points) {
    const d = Math.hypot(rawX - p.x, rawY - p.y);
    if (d < bestDist) {
      bestDist = d;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}

/** Nearest existing wall endpoint within `maxDist`, or null. */
export function nearestCorner(
  walls: readonly WallSegment[],
  rawX: number,
  rawY: number,
  maxDist: number
): { x: number; y: number } | null {
  const corners = walls.flatMap((w) => [
    { x: w.x1, y: w.y1 },
    { x: w.x2, y: w.y2 },
  ]);
  return nearestOf(corners, rawX, rawY, maxDist);
}

/**
 * Nearest point within `maxDist` among every wall endpoint and every Area
 * vertex on the floor — used both while drawing a new Area polygon and while
 * dragging an existing vertex, so adjacent rooms (or a room and a wall) can
 * share an exact boundary point. `exclude` drops one specific vertex from the
 * candidate set — the one currently being moved, so it never snaps to its own
 * pre-drag position.
 */
export function nearestAreaSnapPoint(
  f: { walls: readonly WallSegment[]; areas?: readonly Area[] },
  rawX: number,
  rawY: number,
  maxDist: number,
  exclude?: { areaId: string; vertexIndex: number }
): AreaPoint | null {
  const corners = f.walls.flatMap((w) => [
    { x: w.x1, y: w.y1 },
    { x: w.x2, y: w.y2 },
  ]);
  const vertices = (f.areas ?? []).flatMap((a) =>
    a.points
      .filter((_, i) => !(exclude && exclude.areaId === a.id && exclude.vertexIndex === i))
      .map((p) => ({ x: p.x, y: p.y }))
  );
  return nearestOf([...corners, ...vertices], rawX, rawY, maxDist);
}

/**
 * Ray-casting point-in-polygon test. Points exactly on an edge may resolve
 * either way (not a documented guarantee) — the caller only needs an
 * approximate "did this land inside the room" answer, not exact edge
 * semantics.
 */
export function pointInPolygon(points: readonly AreaPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i]!;
    const pj = points[j]!;
    const intersects =
      pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * The topmost (last-drawn) Area whose polygon contains `(x, y)`, or undefined
 * when none does. Overlapping areas resolve by array order — later elements
 * paint over earlier ones, the same implicit tie-break the rest of the editor
 * uses (e.g. marquee/click hit-testing).
 */
export function areaContainingPoint(f: Pick<Floor, "areas">, x: number, y: number): Area | undefined {
  const areas = f.areas ?? [];
  for (let i = areas.length - 1; i >= 0; i--) {
    if (pointInPolygon(areas[i]!.points, x, y)) return areas[i];
  }
  return undefined;
}

/**
 * Evenly distribute `count` points across the interior of `polygon` — used to
 * auto-place a batch of new elements (e.g. every entity in a linked HA area)
 * without stacking them on top of each other. Lays a grid over the polygon's
 * bounding box, sized to `count` and the box's aspect ratio, and keeps only
 * the cell centers that actually fall inside the (possibly concave) polygon;
 * if too few land inside on the first pass — a narrow or oddly-shaped room —
 * the grid is retried at higher density up to a cap. More hits than needed
 * are evenly subsampled down to `count` rather than just taking the first
 * `count` found, so the result stays spread out instead of clumping wherever
 * the scan happened to pass first. Any shortfall past the density cap (a
 * sliver-shaped room, or `count` far exceeding what it could ever hold
 * legibly) is padded with points ringed around the centroid — accepting some
 * overlap is better than throwing.
 */
export function layoutPointsInPolygon(polygon: readonly AreaPoint[], count: number): AreaPoint[] {
  if (count <= 0) return [];
  const centroid = polygonCentroid(polygon);
  if (count === 1) return [centroid];

  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(maxX - minX, 1);
  const h = Math.max(maxY - minY, 1);

  for (let density = 1; density <= 8; density++) {
    const n = count * density;
    const cols = Math.max(1, Math.round(Math.sqrt((n * w) / h)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const stepX = w / (cols + 1);
    const stepY = h / (rows + 1);
    const candidates: AreaPoint[] = [];
    for (let r = 1; r <= rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const x = minX + c * stepX;
        const y = minY + r * stepY;
        if (pointInPolygon(polygon, x, y)) candidates.push({ x, y });
      }
    }
    if (candidates.length >= count) {
      return Array.from(
        { length: count },
        (_, i) => candidates[Math.floor((i * candidates.length) / count)]!
      );
    }
  }

  // Fallback: ring the remainder around the centroid so points at least
  // separate a little instead of landing exactly on top of each other.
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2;
    const ring = Math.min(w, h) * 0.15 * (1 + Math.floor(i / 6));
    return { x: centroid.x + Math.cos(angle) * ring, y: centroid.y + Math.sin(angle) * ring };
  });
}

/**
 * Snap a wall's moving endpoint while drawing. Existing corners win (so rooms
 * close/continue); otherwise, unless free-draw is on, apply "gravity" toward
 * horizontal/vertical relative to the start point. The position itself snaps
 * via `snap` (the grid by default, or nothing when Snap is Off) — "straighten"
 * only governs the H/V alignment, not snapping.
 */
export function snapWallEnd(
  walls: readonly WallSegment[],
  x1: number,
  y1: number,
  rawX: number,
  rawY: number,
  snap: (v: number) => number,
  free: boolean,
  axisSnapDeg: number,
  cornerSnap = ENDPOINT_SNAP
): { x: number; y: number } {
  if (free) return { x: snap(rawX), y: snap(rawY) };
  const corner = nearestCorner(walls, rawX, rawY, cornerSnap);
  if (corner) return corner;
  const dx = rawX - x1;
  const dy = rawY - y1;
  const t = Math.tan((axisSnapDeg * Math.PI) / 180);
  // Sticky: align flat to an axis when close; the free coordinate snaps to step.
  if (Math.abs(dy) <= Math.abs(dx) * t) return { x: snap(rawX), y: y1 }; // horizontal
  if (Math.abs(dx) <= Math.abs(dy) * t) return { x: x1, y: snap(rawY) }; // vertical
  return { x: snap(rawX), y: snap(rawY) };
}

/** All floor elements whose reference point lies inside the (any-orientation) rect. */
export function elementsInRect(f: Floor, m: Rect): Sel[] {
  const minX = Math.min(m.x0, m.x1);
  const maxX = Math.max(m.x0, m.x1);
  const minY = Math.min(m.y0, m.y1);
  const maxY = Math.max(m.y0, m.y1);
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const out: Sel[] = [];
  for (const w of f.walls)
    if (inside((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)) out.push({ kind: "wall", id: w.id });
  for (const o of f.openings) if (inside(o.x, o.y)) out.push({ kind: "opening", id: o.id });
  for (const it of f.items) if (inside(it.x, it.y)) out.push({ kind: "item", id: it.id });
  for (const t of f.texts) if (inside(t.x, t.y)) out.push({ kind: "text", id: t.id });
  for (const fu of f.furniture) if (inside(fu.x, fu.y)) out.push({ kind: "furniture", id: fu.id });
  for (const tr of f.trackers ?? [])
    if (inside(tr.x + tr.w / 2, tr.y + tr.h / 2)) out.push({ kind: "tracker", id: tr.id });
  for (const a of f.areas ?? []) {
    const c = polygonCentroid(a.points);
    if (inside(c.x, c.y)) out.push({ kind: "area", id: a.id });
  }
  return out;
}

/** Translate every snapshotted element by (dx, dy). */
export function applyDelta(f: Floor, dx: number, dy: number, orig: Map<string, OrigPos>): Partial<Floor> {
  return {
    walls: f.walls.map((w) => {
      const o = orig.get(`wall:${w.id}`);
      return o && o.kind === "wall"
        ? { ...w, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
        : w;
    }),
    openings: f.openings.map((el) => {
      const o = orig.get(`opening:${el.id}`);
      return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
    }),
    items: f.items.map((el) => {
      const o = orig.get(`item:${el.id}`);
      return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
    }),
    texts: f.texts.map((el) => {
      const o = orig.get(`text:${el.id}`);
      return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
    }),
    furniture: f.furniture.map((el) => {
      const o = orig.get(`furniture:${el.id}`);
      return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
    }),
    trackers: (f.trackers ?? []).map((el) => {
      const o = orig.get(`tracker:${el.id}`);
      return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
    }),
    areas: (f.areas ?? []).map((el) => {
      const o = orig.get(`area:${el.id}`);
      return o && o.kind === "polygon"
        ? { ...el, points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
        : el;
    }),
  };
}
