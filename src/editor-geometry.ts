import type { Floor, Wall } from "./types";

/** Element kinds addressable by the editor's selection model. */
export type SelKind = "wall" | "opening" | "item" | "text" | "furniture" | "tracker";

export interface Sel {
  kind: SelKind;
  id: string;
}

/** Snapshot of an element's position at drag start, for group translation. */
export type OrigPos =
  | { kind: "wall"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "pt"; x: number; y: number };

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

/** Nearest existing wall endpoint within `maxDist`, or null. */
export function nearestCorner(
  walls: readonly WallSegment[],
  rawX: number,
  rawY: number,
  maxDist: number
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDist = maxDist;
  for (const w of walls) {
    for (const e of [
      { x: w.x1, y: w.y1 },
      { x: w.x2, y: w.y2 },
    ]) {
      const d = Math.hypot(rawX - e.x, rawY - e.y);
      if (d < bestDist) {
        bestDist = d;
        best = { x: e.x, y: e.y };
      }
    }
  }
  return best;
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
  };
}
