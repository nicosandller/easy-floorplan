import type { Area, AreaPoint, RectAreaSide } from "./types";
import {
  RECT_AREA_EPSILON,
  isRectArea,
  pointInPolygon,
  rectAreaHasMinimumSize,
  rectAreaSharedEdgeCouple,
} from "./editor-geometry";
import { createDebugLogger } from "./debug";

const areaGeometryDebug = createDebugLogger("geometry", {
  enabled: false,
  maxChars: 1400,
  repeatSummaryEvery: 50,
  labelAllow: [
    "coupleSharedBoundarySegment:decision",
    "coupleSharedBoundarySegment:no-overlap",
    "coupleSharedBoundarySegment:no-overlap-intervals",
  ],
  arrayLengthKeys: ["points", "other", "coupled"],
});

export function rectAreasOverlap(a: Area, b: Area): boolean {
  const aXs = a.points.map((p) => p.x);
  const aYs = a.points.map((p) => p.y);
  const bXs = b.points.map((p) => p.x);
  const bYs = b.points.map((p) => p.y);
  const bboxOverlap = (
    Math.max(...aXs) > Math.min(...bXs) &&
    Math.min(...aXs) < Math.max(...bXs) &&
    Math.max(...aYs) > Math.min(...bYs) &&
    Math.min(...aYs) < Math.max(...bYs)
  );
  if (!bboxOverlap) return false;

  type Seg = { x1: number; y1: number; x2: number; y2: number };
  const segments = (pts: readonly AreaPoint[]): Seg[] =>
    pts.map((p, i) => {
      const n = pts[(i + 1) % pts.length]!;
      return { x1: p.x, y1: p.y, x2: n.x, y2: n.y };
    });

  const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number =>
    (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  const onSeg = (ax: number, ay: number, bx: number, by: number, px: number, py: number): boolean =>
    px >= Math.min(ax, bx) - RECT_AREA_EPSILON &&
    px <= Math.max(ax, bx) + RECT_AREA_EPSILON &&
    py >= Math.min(ay, by) - RECT_AREA_EPSILON &&
    py <= Math.max(ay, by) + RECT_AREA_EPSILON;

  const pointOnBoundary = (pts: readonly AreaPoint[], x: number, y: number): boolean => {
    for (let i = 0; i < pts.length; i++) {
      const aPt = pts[i]!;
      const bPt = pts[(i + 1) % pts.length]!;
      const cross = orient(aPt.x, aPt.y, bPt.x, bPt.y, x, y);
      if (Math.abs(cross) > RECT_AREA_EPSILON) continue;
      if (onSeg(aPt.x, aPt.y, bPt.x, bPt.y, x, y)) return true;
    }
    return false;
  };

  const strictInside = (pts: readonly AreaPoint[], x: number, y: number): boolean =>
    pointInPolygon(pts, x, y) && !pointOnBoundary(pts, x, y);

  const properSegIntersection = (aSeg: Seg, bSeg: Seg): boolean => {
    const o1 = orient(aSeg.x1, aSeg.y1, aSeg.x2, aSeg.y2, bSeg.x1, bSeg.y1);
    const o2 = orient(aSeg.x1, aSeg.y1, aSeg.x2, aSeg.y2, bSeg.x2, bSeg.y2);
    const o3 = orient(bSeg.x1, bSeg.y1, bSeg.x2, bSeg.y2, aSeg.x1, aSeg.y1);
    const o4 = orient(bSeg.x1, bSeg.y1, bSeg.x2, bSeg.y2, aSeg.x2, aSeg.y2);

    const s1 = Math.abs(o1) <= RECT_AREA_EPSILON ? 0 : Math.sign(o1);
    const s2 = Math.abs(o2) <= RECT_AREA_EPSILON ? 0 : Math.sign(o2);
    const s3 = Math.abs(o3) <= RECT_AREA_EPSILON ? 0 : Math.sign(o3);
    const s4 = Math.abs(o4) <= RECT_AREA_EPSILON ? 0 : Math.sign(o4);

    if (s1 !== s2 && s3 !== s4) return true;

    // Touching at a point/edge is allowed (shared boundary). Only interior
    // overlap should be considered a collision.
    if (s1 === 0 && onSeg(aSeg.x1, aSeg.y1, aSeg.x2, aSeg.y2, bSeg.x1, bSeg.y1)) return false;
    if (s2 === 0 && onSeg(aSeg.x1, aSeg.y1, aSeg.x2, aSeg.y2, bSeg.x2, bSeg.y2)) return false;
    if (s3 === 0 && onSeg(bSeg.x1, bSeg.y1, bSeg.x2, bSeg.y2, aSeg.x1, aSeg.y1)) return false;
    if (s4 === 0 && onSeg(bSeg.x1, bSeg.y1, bSeg.x2, bSeg.y2, aSeg.x2, aSeg.y2)) return false;
    return false;
  };

  const aSegs = segments(a.points);
  const bSegs = segments(b.points);
  for (const aSeg of aSegs) {
    for (const bSeg of bSegs) {
      if (properSegIntersection(aSeg, bSeg)) return true;
    }
  }

  if (a.points.some((p) => strictInside(b.points, p.x, p.y))) return true;
  if (b.points.some((p) => strictInside(a.points, p.x, p.y))) return true;
  return false;
}

/**
 * Which vertices of `points` are a "stale" duplicate: part of a run of
 * coincident vertices (the editor inserts these at a boundary split point)
 * but not the first one. A stale duplicate is skipped when a boundary move
 * is applied so only one copy of the coincident point actually travels,
 * instead of every copy independently recomputing the same new position.
 * Shared by `moveAreaBoundary` and `coupleSharedBoundarySegment`.
 */
function staleDuplicateVertices(points: readonly AreaPoint[]): boolean[] {
  const len = points.length;
  const samePoint = (a: AreaPoint, b: AreaPoint): boolean =>
    Math.abs(a.x - b.x) <= RECT_AREA_EPSILON && Math.abs(a.y - b.y) <= RECT_AREA_EPSILON;
  const runStart = (index: number): number => {
    let start = index;
    while (samePoint(points[(start - 1 + len) % len]!, points[start]!)) {
      start = (start - 1 + len) % len;
    }
    return start;
  };
  const runEnd = (index: number): number => {
    let end = index;
    while (samePoint(points[end]!, points[(end + 1) % len]!)) {
      end = (end + 1) % len;
    }
    return end;
  };
  return points.map((_, index) => {
    const start = runStart(index);
    const end = runEnd(index);
    if (start === end) return false;
    return index === start;
  });
}

export function moveAreaBoundary(
  points: readonly AreaPoint[],
  delta: { dx: number; dy: number },
  movingSide?: RectAreaSide,
  movingBoundary?: number
): AreaPoint[] | undefined {
  if (!movingSide) return undefined;
  areaGeometryDebug("moveAreaBoundary:input", { points, delta, movingSide, movingBoundary });
  const isVertical = movingSide === "left" || movingSide === "right";
  const bounds = {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
  const boundary = movingBoundary ?? (
    isVertical
      ? (movingSide === "right" ? bounds.maxX : bounds.minX)
      : (movingSide === "bottom" ? bounds.maxY : bounds.minY)
  );
  const stale = staleDuplicateVertices(points);

  const next = points.map((point, index) => {
    if (isVertical) {
      if (Math.abs(point.x - boundary) > RECT_AREA_EPSILON) return { ...point };
      if (stale[index]) return { ...point };
      return { ...point, x: boundary + delta.dx };
    }
    if (Math.abs(point.y - boundary) > RECT_AREA_EPSILON) return { ...point };
    if (stale[index]) return { ...point };
    return { ...point, y: boundary + delta.dy };
  });
  areaGeometryDebug("moveAreaBoundary:results", {
    boundary,
    delta,
    staleByIndex: points.map((_, index) => ({ index, stale: stale[index] })),
    next,
  });
  return next;
}

export function coupleSharedBoundarySegment(
  points: readonly AreaPoint[],
  other: readonly AreaPoint[],
  delta: { dx: number; dy: number },
  movingSide?: RectAreaSide,
  movingBoundary?: number
): AreaPoint[] | undefined {
  if (!movingSide) return undefined;
  areaGeometryDebug("coupleSharedBoundarySegment:input", { points, other, delta, movingSide, movingBoundary });
  if (Math.abs(delta.dx) < RECT_AREA_EPSILON && Math.abs(delta.dy) < RECT_AREA_EPSILON) return undefined;

  const bounds = {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };

  const isVertical = movingSide === "left" || movingSide === "right";
  const primaryBoundary = movingBoundary ?? (
    isVertical
      ? (movingSide === "right" ? bounds.maxX : bounds.minX)
      : (movingSide === "bottom" ? bounds.maxY : bounds.minY)
  );
  const boundaryIntervals = (
    poly: readonly AreaPoint[],
    boundary: number
  ): Array<{ start: number; end: number }> => {
    const intervals: Array<{ start: number; end: number }> = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if (isVertical) {
        if (Math.abs(a.x - boundary) > RECT_AREA_EPSILON || Math.abs(b.x - boundary) > RECT_AREA_EPSILON) continue;
        const start = Math.min(a.y, b.y);
        const end = Math.max(a.y, b.y);
        if (end - start > RECT_AREA_EPSILON) intervals.push({ start, end });
        continue;
      }
      if (Math.abs(a.y - boundary) > RECT_AREA_EPSILON || Math.abs(b.y - boundary) > RECT_AREA_EPSILON) continue;
      const start = Math.min(a.x, b.x);
      const end = Math.max(a.x, b.x);
      if (end - start > RECT_AREA_EPSILON) intervals.push({ start, end });
    }
    return intervals;
  };

  const primaryIntervals = boundaryIntervals(points, primaryBoundary);
  const otherIntervals = boundaryIntervals(other, primaryBoundary);
  if (!primaryIntervals.length || !otherIntervals.length) {
    areaGeometryDebug("coupleSharedBoundarySegment:no-overlap", {
      primaryBoundary,
      primaryIntervals,
      otherIntervals,
    });
    return undefined;
  }

  const overlapIntervals: Array<{ start: number; end: number }> = [];
  for (const a of primaryIntervals) {
    for (const b of otherIntervals) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end - start > RECT_AREA_EPSILON) {
        overlapIntervals.push({ start, end });
      }
    }
  }
  if (!overlapIntervals.length) {
    areaGeometryDebug("coupleSharedBoundarySegment:no-overlap-intervals", {
      primaryIntervals,
      otherIntervals,
      overlapIntervals,
    });
    return undefined;
  }

  const coupled = other.map((point) => ({ ...point }));
  const moveVertex = new Array<boolean>(other.length).fill(false);
  const staleOther = staleDuplicateVertices(other);

  for (let i = 0; i < other.length; i++) {
    const j = (i + 1) % other.length;
    const a = other[i]!;
    const b = other[j]!;
    const edgeOnBoundary = isVertical
      ? Math.abs(a.x - primaryBoundary) <= RECT_AREA_EPSILON && Math.abs(b.x - primaryBoundary) <= RECT_AREA_EPSILON
      : Math.abs(a.y - primaryBoundary) <= RECT_AREA_EPSILON && Math.abs(b.y - primaryBoundary) <= RECT_AREA_EPSILON;
    if (!edgeOnBoundary) continue;

    const edgeIsDegenerate =
      Math.abs(a.x - b.x) <= RECT_AREA_EPSILON &&
      Math.abs(a.y - b.y) <= RECT_AREA_EPSILON;
    if (edgeIsDegenerate) continue;

    const edgeStart = isVertical ? Math.min(a.y, b.y) : Math.min(a.x, b.x);
    const edgeEnd = isVertical ? Math.max(a.y, b.y) : Math.max(a.x, b.x);
    const overlaps = overlapIntervals.some((interval) => {
      const start = Math.max(interval.start, edgeStart);
      const end = Math.min(interval.end, edgeEnd);
      return end - start > RECT_AREA_EPSILON;
    });
    if (!overlaps) continue;

    moveVertex[i] = !staleOther[i];
    moveVertex[j] = !staleOther[j];
  }

  let moved = false;
  for (let i = 0; i < coupled.length; i++) {
    if (!moveVertex[i]) continue;
    if (isVertical) {
      coupled[i] = { ...coupled[i]!, x: primaryBoundary + delta.dx };
    } else {
      coupled[i] = { ...coupled[i]!, y: primaryBoundary + delta.dy };
    }
    moved = true;
  }

  areaGeometryDebug("coupleSharedBoundarySegment:decision", {
    primaryBoundary,
    overlapIntervals,
    moveVertex,
    staleByIndex: other.map((_, index) => ({
      index,
      stale: staleOther[index],
      point: other[index],
    })),
    coupled,
  });

  return moved ? coupled : undefined;
}

export function coupleRectAreaSharedEdges(
  primaryId: string,
  points: AreaPoint[],
  delta: { dx: number; dy: number },
  areas: readonly Area[],
  movingSide?: RectAreaSide,
  movingBoundary?: number
): { areas: Area[]; coupledIds: Set<string> } {
  let primaryPoints = points;
  const sharedReference = points;
  const updated = new Map<string, AreaPoint[]>();
  const coupledIds = new Set<string>();

  for (const other of areas) {
    if (other.id === primaryId) continue;
    const otherPoints = updated.get(other.id) ?? other.points;
    if (other.locked) continue;
    const coupled = rectAreaSharedEdgeCouple(sharedReference, otherPoints, delta, movingSide);
    if (!coupled) {
      const polygonCoupled = coupleSharedBoundarySegment(
        sharedReference,
        otherPoints,
        delta,
        movingSide,
        movingBoundary
      );
      if (!polygonCoupled) continue;
      primaryPoints = moveAreaBoundary(
        sharedReference,
        delta,
        movingSide,
        movingBoundary
      ) ?? primaryPoints;
      updated.set(other.id, polygonCoupled);
      coupledIds.add(other.id);
      continue;
    }
    primaryPoints = coupled.points;
    updated.set(other.id, coupled.other);
    coupledIds.add(other.id);
  }

  return {
    areas: areas.map((a) => {
      if (a.id === primaryId) return { ...a, points: primaryPoints };
      const next = updated.get(a.id);
      return next ? { ...a, points: next } : a;
    }),
    coupledIds,
  };
}

/**
 * Binary-searches down to the largest fraction of `delta` (18 iterations,
 * i.e. error under 1/2^18 of the requested move) that keeps every area in
 * the coupled component clear of its neighbors — called on every pointer-move
 * frame while dragging a coupled edge, each iteration re-running
 * `coupleRectAreaSharedEdges` plus an O(areas^2) collision check. Fine for
 * the handful of areas a floorplan typically has.
 */
export function coupledEdgeResize(
  primaryId: string,
  moving: Area,
  delta: { dx: number; dy: number },
  areas: readonly Area[],
  movingSide: RectAreaSide,
  movingBoundary?: number
): { areas: Area[]; coupledIds: Set<string>; delta: { dx: number; dy: number } } {
  const requested = coupleRectAreaSharedEdges(
    primaryId,
    moving.points,
    delta,
    areas,
    movingSide,
    movingBoundary
  );
  if (!requested.coupledIds.size) return { ...requested, delta };

  const componentIds = new Set([primaryId, ...requested.coupledIds]);
  const obstacles = areas.filter((a) => !componentIds.has(a.id));
  const collides = (candidate: { areas: Area[] }): boolean =>
    candidate.areas.some(
      (a) =>
        componentIds.has(a.id) &&
        ((isRectArea(a.points) && !rectAreaHasMinimumSize(a.points)) || obstacles.some((other) => rectAreasOverlap(a, other)))
    );

  if (!collides(requested)) return { ...requested, delta };

  let low = 0;
  let high = 1;
  for (let i = 0; i < 18; i++) {
    const scale = (low + high) / 2;
    const candidateDelta = { dx: delta.dx * scale, dy: delta.dy * scale };
    const candidate = coupleRectAreaSharedEdges(
      primaryId,
      moving.points,
      candidateDelta,
      areas,
      movingSide,
      movingBoundary
    );
    if (collides(candidate)) high = scale;
    else low = scale;
  }

  const safeDelta = { dx: delta.dx * low, dy: delta.dy * low };
  return {
    ...coupleRectAreaSharedEdges(primaryId, moving.points, safeDelta, areas, movingSide, movingBoundary),
    delta: safeDelta,
  };
}
