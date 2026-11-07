import type {
  Area,
  AreaPoint,
  RectAreaSide,
  RectAreaSideWallSegment,
  RectAreaSideWallState,
  RectAreaSideWallValue,
} from "./types";
import { RECT_AREA_SIDES } from "./types";
import {
  RECT_AREA_EPSILON,
  isRectArea,
  polygonEdgeSide,
  rectAreaClamp,
  rectAreaPoints,
  rectAreaSharedSides,
  rectAreaSideBoundarySegments,
  rectAreaSideWallNext,
  rectAreaSideWallSegments,
} from "./editor-geometry";
import { signedArea, traceFaces } from "./dead-space";
import { pointInPolygon } from "./render";
import { createDebugLogger } from "./debug";

const areaToolsDebug = createDebugLogger("area-tools", {
  enabled: false,
  maxChars: 1200,
  repeatSummaryEvery: 20,
  labelAllow: ["toggleRectAreaSide:", "clickRectAreaSide:"],
  omitKeys: ["area", "updated", "sideWalls"],
});

export function updateAreaRectangleDraft(
  start: AreaPoint,
  target: AreaPoint,
  areas: readonly Area[],
  snap: (value: number) => number
): { points: AreaPoint[] } {
  const snapped = { x: snap(target.x), y: snap(target.y) };
  return {
    points: rectAreaClamp(
      rectAreaPoints({ x0: start.x, y0: start.y, x1: snapped.x, y1: snapped.y }),
      areas,
      { dx: snapped.x - start.x, dy: snapped.y - start.y }
    ),
  };
}

export function segmentWindowAt(t: number, span = 0.3): { start: number; end: number } {
  const half = span / 2;
  let start = Math.max(0, t - half);
  let end = Math.min(1, t + half);
  if (end - start < 0.08) {
    start = Math.max(0, t - 0.04);
    end = Math.min(1, t + 0.04);
  }
  return { start, end };
}

// On overlap between segments of different states, the earlier (lower
// `start`) segment wins; the later one is trimmed back to the boundary.
export function normalizeRectAreaSideSegments(
  segments: RectAreaSideWallSegment[]
): RectAreaSideWallSegment[] {
  const filtered = segments
    .map((segment) => ({
      start: Math.max(0, Math.min(1, segment.start)),
      end: Math.max(0, Math.min(1, segment.end)),
      state: segment.state,
    }))
    .filter(
      (segment) =>
        segment.end - segment.start > RECT_AREA_EPSILON &&
        (segment.state === "wall" || segment.state === "divider")
    )
    .sort((a, b) => a.start - b.start);

  const out: RectAreaSideWallSegment[] = [];
  for (const segment of filtered) {
    const last = out[out.length - 1];
    if (!last) {
      out.push({ ...segment });
      continue;
    }
    if (segment.start < last.end - RECT_AREA_EPSILON && segment.state === last.state) {
      last.end = Math.max(last.end, segment.end);
      continue;
    }
    const start = segment.start < last.end - RECT_AREA_EPSILON ? Math.max(last.end, segment.start) : segment.start;
    if (segment.end - start <= RECT_AREA_EPSILON) continue;
    out.push({ ...segment, start });
  }
  return out;
}

export function rectAreaEdgeFraction(
  area: Area,
  edgeIndex: number,
  point?: { x: number; y: number }
): number {
  if (!point) return 0.5;
  // (0, 0) is editor.ts's sentinel for a synthetic click with no real pointer
  // coords (see `_rectAreaEdgeFraction`'s `ev.clientX === 0 && ev.clientY === 0` check).
  if (point.x === 0 && point.y === 0) return 0.5;
  const p = area.points[edgeIndex];
  const next = area.points[(edgeIndex + 1) % area.points.length];
  if (!p || !next) return 0.5;
  const dx = next.x - p.x;
  const dy = next.y - p.y;
  const t = Math.abs(dx) >= Math.abs(dy)
    ? (Math.abs(dx) < RECT_AREA_EPSILON ? 0.5 : (point.x - p.x) / dx)
    : (Math.abs(dy) < RECT_AREA_EPSILON ? 0.5 : (point.y - p.y) / dy);
  return Math.min(1, Math.max(0, t));
}

export function rectAreaOppositeSide(side: RectAreaSide): RectAreaSide {
  switch (side) {
    case "top":
      return "bottom";
    case "bottom":
      return "top";
    case "left":
      return "right";
    case "right":
      return "left";
  }
}

export function rectAreaEdgeSide(area: Area, edgeIndex: number): RectAreaSide {
  return polygonEdgeSide(area.points, edgeIndex) ?? RECT_AREA_SIDES[edgeIndex % RECT_AREA_SIDES.length];
}

/** Normalize `segments` and fold them into `a.sideWalls[side]`, collapsing a
 * single full-edge segment back to its plain string form. Shared by
 * `toggleRectAreaSide` and `splitRectAreaSide` so the two don't drift apart. */
function applySideWallSegments(
  a: Area,
  side: RectAreaSide,
  segments: RectAreaSideWallSegment[]
): { updated: Area; normalized: RectAreaSideWallSegment[] } {
  const normalized = normalizeRectAreaSideSegments(segments);
  const sideWalls = { ...(a.sideWalls ?? {}) };
  if (!normalized.length) delete sideWalls[side];
  else if (normalized.length === 1 && normalized[0]!.start <= RECT_AREA_EPSILON && normalized[0]!.end >= 1 - RECT_AREA_EPSILON)
    sideWalls[side] = normalized[0]!.state;
  else sideWalls[side] = normalized;
  return {
    updated: { ...a, sideWalls: Object.keys(sideWalls).length ? sideWalls : undefined },
    normalized,
  };
}

export function toggleRectAreaSide(
  a: Area,
  edgeIndex: number,
  clickT = 0.5,
  targetInterval?: { start: number; end: number }
): Area | undefined {
  if (a.locked) return undefined;
  const side = rectAreaEdgeSide(a, edgeIndex);
  const current = a.sideWalls?.[side];
  areaToolsDebug("toggleRectAreaSide:before", {
    areaId: a.id,
    edgeIndex,
    side,
    clickT,
    targetInterval,
    current,
    sideWalls: a.sideWalls,
  });

  if (targetInterval) {
    const start = Math.max(0, Math.min(1, targetInterval.start));
    const end = Math.max(0, Math.min(1, targetInterval.end));
    if (end - start <= RECT_AREA_EPSILON) return undefined;

    const existing = normalizeRectAreaSideSegments(
      rectAreaSideWallSegments(current).map((segment) => ({ ...segment }))
    );
    const clampedClick = Math.max(start, Math.min(end, clickT));
    const targetStart = start;
    const targetEnd = end;

    // Edge toggles should operate on the full clicked edge interval, not a local
    // click window. Treat the interval as "wall" / "divider" only when that
    // whole interval is fully covered by exactly one state.
    let currentState: "none" | "wall" | "divider" = "none";
    if (existing.length) {
      let cursor = targetStart;
      let state: RectAreaSideWallState | undefined;
      let fullCoverage = true;
      for (const segment of existing) {
        const segStart = Math.max(targetStart, segment.start);
        const segEnd = Math.min(targetEnd, segment.end);
        if (segEnd - segStart <= RECT_AREA_EPSILON) continue;
        if (segStart > cursor + RECT_AREA_EPSILON) {
          fullCoverage = false;
          break;
        }
        if (!state) state = segment.state;
        else if (state !== segment.state) {
          fullCoverage = false;
          break;
        }
        cursor = Math.max(cursor, segEnd);
      }
      if (cursor < targetEnd - RECT_AREA_EPSILON) fullCoverage = false;
      if (fullCoverage && state) currentState = state;
    }

    const nextState = rectAreaSideWallNext(currentState);
    const nextSegments: RectAreaSideWallSegment[] = [];

    for (const segment of existing) {
      if (segment.end <= targetStart + RECT_AREA_EPSILON || segment.start >= targetEnd - RECT_AREA_EPSILON) {
        nextSegments.push(segment);
        continue;
      }
      if (segment.start < targetStart - RECT_AREA_EPSILON) {
        nextSegments.push({ ...segment, end: targetStart });
      }
      if (segment.end > targetEnd + RECT_AREA_EPSILON) {
        nextSegments.push({ ...segment, start: targetEnd });
      }
    }

    if (nextState !== "none") {
      nextSegments.push({ start: targetStart, end: targetEnd, state: nextState });
    }

    const { updated, normalized } = applySideWallSegments(a, side, nextSegments);
    areaToolsDebug("toggleRectAreaSide:after-interval", {
      areaId: a.id,
      side,
      before: current,
      after: updated.sideWalls,
      targetInterval: { start, end },
      targetRange: { start: targetStart, end: targetEnd },
      clampedClick,
      previousState: currentState,
      nextState,
      normalized,
    });
    return updated;
  }

  if (Array.isArray(current)) {
    const nextSegments = rectAreaSideWallSegments(current).map((segment) => ({ ...segment }));
    const hit = nextSegments.findIndex(
      (segment) => clickT >= segment.start - RECT_AREA_EPSILON && clickT <= segment.end + RECT_AREA_EPSILON
    );

    if (hit >= 0) {
      const seg = nextSegments[hit]!;
      const next = rectAreaSideWallNext(seg.state);
      if (next === "none") nextSegments.splice(hit, 1);
      else nextSegments[hit] = { ...seg, state: next };
    } else {
      const w = segmentWindowAt(clickT);
      nextSegments.push({ start: w.start, end: w.end, state: "wall" });
    }

    const { updated, normalized } = applySideWallSegments(a, side, nextSegments);
    areaToolsDebug("toggleRectAreaSide:after-array", {
      areaId: a.id,
      side,
      before: current,
      after: updated.sideWalls,
      nextSegments,
      normalized,
    });
    return updated;
  }

  const state = current ?? "none";
  const next = rectAreaSideWallNext(state);
  const sideWalls = { ...(a.sideWalls ?? {}) };
  if (next === "none") delete sideWalls[side];
  else sideWalls[side] = next;
  const updated = { ...a, sideWalls: Object.keys(sideWalls).length ? sideWalls : undefined };
  areaToolsDebug("toggleRectAreaSide:after-string", {
    areaId: a.id,
    side,
    before: current,
    after: updated.sideWalls,
    previousState: state,
    nextState: next,
  });
  return updated;
}

/**
 * Keep a newly split-off window from overlapping any *other* existing
 * segment on this side — clicking in the open gap next to an existing wall
 * must create a new segment that stops at it, not one that reaches past it
 * and gets merged into (or torn into) that wall by normalization. `exclude`
 * is the segment the click actually landed inside, if any — that one is
 * allowed to be touched/absorbed; every other segment is off limits.
 */
function clampSegmentWindow(
  clickT: number,
  window: { start: number; end: number },
  segments: readonly RectAreaSideWallSegment[],
  exclude?: RectAreaSideWallSegment
): { start: number; end: number } {
  let start = window.start;
  let end = window.end;
  for (const segment of segments) {
    if (segment === exclude) continue;
    if (segment.end <= clickT + RECT_AREA_EPSILON) start = Math.max(start, segment.end);
    if (segment.start >= clickT - RECT_AREA_EPSILON) end = Math.min(end, segment.start);
  }
  if (end - start <= RECT_AREA_EPSILON) {
    const point = Math.min(Math.max(clickT, start), end);
    return { start: point, end: point };
  }
  return { start, end };
}

export function splitRectAreaSide(
  a: Area,
  edgeIndex: number,
  clickT: number,
  hasPointerCoords = true
): Area | undefined {
  if (a.locked) return undefined;
  const side = rectAreaEdgeSide(a, edgeIndex);
  const sideWalls = { ...(a.sideWalls ?? {}) };
  const prev = sideWalls[side] as RectAreaSideWallValue | undefined;
  const segmentWindow = segmentWindowAt(clickT);

  if (typeof prev === "string" && prev !== "none") {
    const segments: RectAreaSideWallSegment[] = [];
    if (segmentWindow.start > RECT_AREA_EPSILON) {
      segments.push({ start: 0, end: segmentWindow.start, state: prev });
    }
    segments.push({ start: segmentWindow.start, end: segmentWindow.end, state: prev });
    if (segmentWindow.end < 1 - RECT_AREA_EPSILON) {
      segments.push({ start: segmentWindow.end, end: 1, state: prev });
    }
    return applySideWallSegments(a, side, segments).updated;
  }

  const segments = rectAreaSideWallSegments(prev).map((segment) => ({ ...segment }));
  if (!hasPointerCoords) {
    const tail = segments.length ? Math.max(...segments.map((segment) => segment.end)) : 0;
    const state = segments.length ? segments[segments.length - 1]!.state : "wall";
    if (tail < 1 - RECT_AREA_EPSILON) {
      segments.push({ start: tail, end: 1, state });
    }
  } else {
    const existing = segments.find(
      (segment) => clickT > segment.start + RECT_AREA_EPSILON && clickT < segment.end - RECT_AREA_EPSILON
    );
    const state = existing?.state ?? "wall";
    const clamped = clampSegmentWindow(clickT, segmentWindow, segments, existing);
    segments.push({ start: clamped.start, end: clamped.end, state });
  }

  return applySideWallSegments(a, side, segments).updated;
}

export function rectAreaUnionPoints(a: AreaPoint[], other: AreaPoint[]): AreaPoint[] | undefined {
  const xs = [...new Set([...a, ...other].map((point) => point.x))].sort((left, right) => left - right);
  const ys = [...new Set([...a, ...other].map((point) => point.y))].sort((left, right) => left - right);
  if (xs.length < 2 || ys.length < 2) return undefined;

  const occupied = Array.from({ length: xs.length - 1 }, () =>
    Array.from({ length: ys.length - 1 }, () => false)
  );
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      const cx = (xs[i]! + xs[i + 1]!) / 2;
      const cy = (ys[j]! + ys[j + 1]!) / 2;
      occupied[i]![j] = pointInPolygon(a, cx, cy) || pointInPolygon(other, cx, cy);
    }
  }

  const boundary: Array<{ a: AreaPoint; b: AreaPoint }> = [];
  const addSegment = (a: AreaPoint, b: AreaPoint): void => {
    if (Math.abs(a.x - b.x) < RECT_AREA_EPSILON && Math.abs(a.y - b.y) < RECT_AREA_EPSILON) return;
    boundary.push({ a, b });
  };

  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < ys.length - 1; j++) {
      if (!occupied[i]?.[j]) continue;
      const x0 = xs[i]!;
      const x1 = xs[i + 1]!;
      const y0 = ys[j]!;
      const y1 = ys[j + 1]!;
      const left = i > 0 && occupied[i - 1]?.[j];
      const right = i < xs.length - 2 && occupied[i + 1]?.[j];
      const below = j > 0 && occupied[i]?.[j - 1];
      const above = j < ys.length - 2 && occupied[i]?.[j + 1];
      if (!left) addSegment({ x: x0, y: y0 }, { x: x0, y: y1 });
      if (!right) addSegment({ x: x1, y: y0 }, { x: x1, y: y1 });
      if (!below) addSegment({ x: x0, y: y0 }, { x: x1, y: y0 });
      if (!above) addSegment({ x: x0, y: y1 }, { x: x1, y: y1 });
    }
  }

  const combine = [...a, ...other];
  const centroid = {
    x: combine.reduce((sum, point) => sum + point.x, 0) / combine.length,
    y: combine.reduce((sum, point) => sum + point.y, 0) / combine.length,
  };
  const ring = traceFaces(boundary, 1e-6)
    .filter((face) => face.length >= 3)
    .filter((face) => pointInPolygon(face, centroid.x, centroid.y))
    .sort((left, right) => Math.abs(signedArea(right)) - Math.abs(signedArea(left)))[0];
  if (!ring) return undefined;

  const collapseCollinear = (points: AreaPoint[]): AreaPoint[] => {
    const out: AreaPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const prev = points[(i - 1 + points.length) % points.length]!;
      const current = points[i]!;
      const next = points[(i + 1) % points.length]!;
      const dx1 = current.x - prev.x;
      const dy1 = current.y - prev.y;
      const dx2 = next.x - current.x;
      const dy2 = next.y - current.y;
      const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
      const onLine = cross < RECT_AREA_EPSILON && (
        (Math.abs(current.x - prev.x) < RECT_AREA_EPSILON &&
          Math.abs(current.x - next.x) < RECT_AREA_EPSILON &&
          current.y >= Math.min(prev.y, next.y) - RECT_AREA_EPSILON &&
          current.y <= Math.max(prev.y, next.y) + RECT_AREA_EPSILON) ||
        (Math.abs(current.y - prev.y) < RECT_AREA_EPSILON &&
          Math.abs(current.y - next.y) < RECT_AREA_EPSILON &&
          current.x >= Math.min(prev.x, next.x) - RECT_AREA_EPSILON &&
          current.x <= Math.max(prev.x, next.x) + RECT_AREA_EPSILON)
      );
      if (!onLine) out.push(current);
    }
    return out.length >= 3 ? out : points;
  };

  const simplified = collapseCollinear(ring.map((point) => ({ ...point })));
  if (signedArea(simplified) < 0) simplified.reverse();
  return simplified;
}

export function mergeRectAreaSide(
  a: Area,
  edgeIndex: number,
  areas: readonly Area[]
): Area[] | undefined {
  const clickedSide = rectAreaEdgeSide(a, edgeIndex);
  const candidates = areas.filter(
    (candidate) =>
      candidate.id !== a.id &&
      isRectArea(a.points) &&
      isRectArea(candidate.points) &&
      (a.haArea === candidate.haArea || (!a.haArea && !candidate.haArea)) &&
      rectAreaSharedSides(a.points, candidate.points).includes(clickedSide)
  );
  const other = candidates[0];
  if (!other) return undefined;

  const merged = rectAreaUnionPoints(a.points, other.points);
  if (!merged) return undefined;

  const beforeArea = Math.abs(signedArea(a.points)) + Math.abs(signedArea(other.points));
  const afterArea = Math.abs(signedArea(merged));
  const valid = Math.abs(afterArea - beforeArea) < 0.01;

  if (!valid) return undefined;

  const mergedSideWalls = mergeOuterSideWalls(a, other, merged, clickedSide);

  return [
    ...areas.filter((candidate) => candidate.id !== a.id && candidate.id !== other.id),
    { ...a, points: merged, sideWalls: mergedSideWalls },
  ];
}

function mergeOuterSideWalls(
  a: Area,
  b: Area,
  mergedPoints: AreaPoint[],
  sharedSide: RectAreaSide
): Area["sideWalls"] {
  const projected = new Map<RectAreaSide, RectAreaSideWallSegment[]>();
  const sources = [
    { area: a, omittedSide: sharedSide },
    { area: b, omittedSide: rectAreaOppositeSide(sharedSide) },
  ];

  for (const { area, omittedSide } of sources) {
    for (const side of RECT_AREA_SIDES) {
      if (side === omittedSide) continue;
      const bounds = rectAreaSideBoundarySegments(side, area.points);
      const sourceLength = bounds.reduce((sum, piece) =>
        sum + (side === "top" || side === "bottom"
          ? Math.abs(piece.x2 - piece.x1)
          : Math.abs(piece.y2 - piece.y1)), 0);
      if (sourceLength <= RECT_AREA_EPSILON) continue;

      const rawSegments = rectAreaSideWallSegments(area.sideWalls?.[side]);
      if (!rawSegments.length) continue;
      const mergedSide = side;
      const targetBounds = rectAreaSideBoundarySegments(mergedSide, mergedPoints);
      const targetLength = targetBounds.reduce((sum, piece) =>
        sum + (mergedSide === "top" || mergedSide === "bottom"
          ? Math.abs(piece.x2 - piece.x1)
          : Math.abs(piece.y2 - piece.y1)), 0);
      if (targetLength <= RECT_AREA_EPSILON) continue;

      for (const segment of rawSegments) {
        const sourceStart = segment.start * sourceLength;
        const sourceEnd = segment.end * sourceLength;
        let sourceCursor = 0;
        for (const sourceBound of bounds) {
          const horizontal = side === "top" || side === "bottom";
          const length = horizontal
            ? Math.abs(sourceBound.x2 - sourceBound.x1)
            : Math.abs(sourceBound.y2 - sourceBound.y1);
          const overlapStart = Math.max(sourceStart, sourceCursor);
          const overlapEnd = Math.min(sourceEnd, sourceCursor + length);
          if (overlapEnd > overlapStart + RECT_AREA_EPSILON) {
            const sourceT0 = (overlapStart - sourceCursor) / length;
            const sourceT1 = (overlapEnd - sourceCursor) / length;
            const coord0 = horizontal
              ? sourceBound.x1 + (sourceBound.x2 - sourceBound.x1) * sourceT0
              : sourceBound.y1 + (sourceBound.y2 - sourceBound.y1) * sourceT0;
            const coord1 = horizontal
              ? sourceBound.x1 + (sourceBound.x2 - sourceBound.x1) * sourceT1
              : sourceBound.y1 + (sourceBound.y2 - sourceBound.y1) * sourceT1;
            let targetCursor = 0;
            for (const targetBound of targetBounds) {
              const targetBoundLength = horizontal
                ? Math.abs(targetBound.x2 - targetBound.x1)
                : Math.abs(targetBound.y2 - targetBound.y1);
              const targetBoundStart = horizontal
                ? Math.min(targetBound.x1, targetBound.x2)
                : Math.min(targetBound.y1, targetBound.y2);
              const targetBoundEnd = targetBoundStart + targetBoundLength;
              const worldStart = Math.min(coord0, coord1);
              const worldEnd = Math.max(coord0, coord1);
              const projectedStart = Math.max(worldStart, targetBoundStart);
              const projectedEnd = Math.min(worldEnd, targetBoundEnd);
              if (projectedEnd > projectedStart + RECT_AREA_EPSILON) {
                const start = (targetCursor + projectedStart - targetBoundStart) / targetLength;
                const end = (targetCursor + projectedEnd - targetBoundStart) / targetLength;
                const segments = projected.get(mergedSide) ?? [];
                segments.push({ start, end, state: segment.state });
                projected.set(mergedSide, segments);
              }
              targetCursor += targetBoundLength;
            }
          }
          sourceCursor += length;
        }
      }
    }
  }

  const result: NonNullable<Area["sideWalls"]> = {};
  for (const [side, segments] of projected) {
    if (!segments.length) continue;
    const normalized = normalizeRectAreaSideSegments(segments);
    result[side] = normalized.length === 1 &&
      normalized[0]!.start <= RECT_AREA_EPSILON &&
      normalized[0]!.end >= 1 - RECT_AREA_EPSILON
      ? normalized[0]!.state
      : normalized;
  }
  return Object.keys(result).length ? result : undefined;
}

function canMergeRectAreaSide(a: Area, edgeIndex: number, areas: readonly Area[]): boolean {
  const clickedSide = rectAreaEdgeSide(a, edgeIndex);
  return areas.some((candidate) =>
    candidate.id !== a.id &&
    isRectArea(a.points) &&
    isRectArea(candidate.points) &&
    (a.haArea === candidate.haArea || (!a.haArea && !candidate.haArea)) &&
    rectAreaSharedSides(a.points, candidate.points).includes(clickedSide)
  );
}

export function rectAreaEdgeModifierClass(
  area: Area,
  edgeIndex: number,
  areas: readonly Area[],
  areaEdgeModifier: string
): string {
  if (areaEdgeModifier === "join") {
    return canMergeRectAreaSide(area, edgeIndex, areas) ? "modifier-ready" : "modifier-invalid";
  }
  if (areaEdgeModifier === "split") return "modifier-split";
  return "";
}

export function rectAreaEdgeCursor(area: Area, edgeIndex: number, modifierClass: string): string {
  if (modifierClass === "modifier-ready") return "copy";
  if (modifierClass === "modifier-invalid") return "not-allowed";
  const side = rectAreaEdgeSide(area, edgeIndex);
  return side === "top" || side === "bottom" ? "ns-resize" : "ew-resize";
}

