import type { Area, RectAreaSide, RectAreaSideWallState } from "./types";
import { RECT_AREA_EPSILON, rectAreaSideBoundarySegments, rectAreaSideWallSegments } from "./editor-geometry";

/**
 * Smallest allowed span, as a fraction of the side's length, for a wall
 * segment being dragged. Independent of {@link RECT_AREA_EPSILON} (a
 * near-zero tolerance for float comparisons) — this is a usability floor so a
 * segment can't be dragged down to an unselectably thin sliver.
 */
export const MIN_WALL_SEGMENT_SPAN = 0.02;

export type AreaWallSegmentDragMode = "segment" | "start" | "end";

export interface AreaWallSegmentDrag {
  areaId: string;
  side: RectAreaSide;
  segmentIndex: number;
  mode: AreaWallSegmentDragMode;
  start: number;
  end: number;
  state: RectAreaSideWallState;
}

export function applyAreaWallSegmentDrag(
  area: Area,
  drag: AreaWallSegmentDrag,
  moveX: number,
  moveY: number
): Area | undefined {
  const boundary = rectAreaSideBoundarySegments(drag.side, area.points);
  const totalLength = boundary.reduce((sum, piece) => {
    if (drag.side === "top" || drag.side === "bottom") return sum + Math.abs(piece.x2 - piece.x1);
    return sum + Math.abs(piece.y2 - piece.y1);
  }, 0);
  if (totalLength <= RECT_AREA_EPSILON) return undefined;

  const deltaFrac =
    drag.side === "top" || drag.side === "bottom"
      ? moveX / totalLength
      : moveY / totalLength;
  const minSpan = MIN_WALL_SEGMENT_SPAN;
  let nextStart = drag.start;
  let nextEnd = drag.end;

  if (drag.mode === "segment") {
    const width = drag.end - drag.start;
    nextStart = drag.start + deltaFrac;
    nextEnd = drag.end + deltaFrac;
    if (nextStart < 0) {
      nextEnd -= nextStart;
      nextStart = 0;
    }
    if (nextEnd > 1) {
      const overflow = nextEnd - 1;
      nextStart -= overflow;
      nextEnd = 1;
    }
    if (nextEnd - nextStart < minSpan) nextEnd = Math.min(1, nextStart + Math.max(minSpan, width));
  } else if (drag.mode === "start") {
    nextStart = Math.max(0, Math.min(drag.end - minSpan, drag.start + deltaFrac));
  } else {
    nextEnd = Math.min(1, Math.max(drag.start + minSpan, drag.end + deltaFrac));
  }

  const sideWalls = { ...(area.sideWalls ?? {}) };
  const segments = rectAreaSideWallSegments(sideWalls[drag.side]).map((segment) => ({ ...segment }));
  if (!segments[drag.segmentIndex]) return undefined;

  segments[drag.segmentIndex] = {
    ...segments[drag.segmentIndex]!,
    start: nextStart,
    end: nextEnd,
    state: drag.state,
  };
  sideWalls[drag.side] = segments;
  return { ...area, sideWalls };
}

export function removeAreaWallSegment(
  area: Area,
  side: RectAreaSide,
  segmentIndex: number
): Area | undefined {
  const sideWalls = { ...(area.sideWalls ?? {}) };
  const current = sideWalls[side];
  const segments = rectAreaSideWallSegments(current).map((segment) => ({ ...segment }));
  if (!segments.length) return undefined;

  const kept = segments.filter((_, index) => index !== segmentIndex);
  if (!kept.length) delete sideWalls[side];
  else if (kept.length === 1 && kept[0]!.start <= RECT_AREA_EPSILON && kept[0]!.end >= 1 - RECT_AREA_EPSILON)
    sideWalls[side] = kept[0]!.state;
  else sideWalls[side] = kept;

  return {
    ...area,
    sideWalls: Object.keys(sideWalls).length ? sideWalls : undefined,
  };
}
