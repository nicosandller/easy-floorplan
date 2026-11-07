import type { Area, AreaPoint, Opening, Wall } from "./types";
import { openingIsSkylight } from "./types";
import { splitSegments, traceFaces, signedArea, WELD_EPS, OPENING_ON_WALL_EPS } from "./dead-space";
import { glowReach, wallsLightPassesThrough } from "./render";
import {
  ambientDaylightPatches, ambientOpeningSources, ambientPointInArea,
  type AmbientDaylightPatch, type AmbientOpeningSource,
} from "./ambient-daylight";

/** Physical rooms and their exterior outlines, independent of named Areas. */
function traceRegions(walls: readonly Wall[]): { rooms: Area[]; shells: Area[] } {
  const faces = traceFaces(splitSegments(walls.map(w => ({
    a: { x: w.x1, y: w.y1 }, b: { x: w.x2, y: w.y2 },
  })), WELD_EPS), WELD_EPS);
  const rooms: Area[] = [];
  const shells: Area[] = [];
  faces.forEach((points, index) => {
    const size = signedArea(points);
    const area = { id: `wall-region-${index}`, points };
    if (size > WELD_EPS * WELD_EPS) rooms.push(area);
    if (size < -WELD_EPS * WELD_EPS) shells.push(area);
  });
  // A detached loop inside the house (a cupboard, for example) is a blocker,
  // not another outside wall. The face walker sees it as a separate component.
  return { rooms, shells: shells.filter(a => !shells.some(b =>
    a !== b && Math.abs(signedArea(b.points)) > Math.abs(signedArea(a.points)) &&
    ambientPointInArea(b, a.points[0].x, a.points[0].y))) };
}

function wallPoint(point: AreaPoint, wall: Wall): AreaPoint {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1;
  const length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1,
    ((point.x - wall.x1) * dx + (point.y - wall.y1) * dy) / length2)) : 0;
  return { x: wall.x1 + t * dx, y: wall.y1 + t * dy };
}

function nearestWall(point: AreaPoint, walls: readonly Wall[]) {
  let best: { wall: Wall; point: AreaPoint; distance: number } | undefined;
  for (const wall of walls) {
    if (wall.x1 === wall.x2 && wall.y1 === wall.y2) continue;
    const p = wallPoint(point, wall);
    const distance = Math.hypot(point.x - p.x, point.y - p.y);
    if (!best || distance < best.distance) best = { wall, point: p, distance };
  }
  return best;
}

/**
 * A wall end that stops short of another wall, but within that wall's
 * thickness, looks joined on the plan. Join it here too: otherwise the room
 * behind leaks to the outside through a slot nobody can see, and its interior
 * openings read as sky sources (issue #360: a terrace wall 4 units short of the
 * side wall). A real doorway is far wider than this tolerance.
 */
function joinWallEnds(walls: readonly Wall[]): Wall[] {
  const joins: Wall[] = [];
  walls.forEach((w, index) => {
    const others = walls.filter(o => o !== w);
    [{ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }].forEach((p, end) => {
      const match = nearestWall(p, others);
      if (!match || match.distance <= WELD_EPS || match.distance > OPENING_ON_WALL_EPS) return;
      joins.push({ id: `ambient-join-${index}-${end}`, x1: p.x, y1: p.y, x2: match.point.x, y2: match.point.y });
    });
  });
  return [...walls, ...joins];
}

/**
 * An explicit opening can close a run only when both jambs meet solid walls,
 * or another opening that does: a glazed bay is often two windows side by
 * side. A jamb gets the same nudge tolerance as an opening's centre. A gap
 * left open here joins the room behind it to the outside, and every interior
 * opening of that room then reads as a sky source (issue #360).
 */
function bridgeOpenings(walls: readonly Wall[], openings: readonly Opening[]): Wall[] {
  let spans: Wall[] = [];
  openings.forEach((o, index) => {
    if (openingIsSkylight(o) || !(o.length > 0)) return;
    if ((nearestWall(o, walls)?.distance ?? Infinity) <= WELD_EPS) return;
    const angle = o.angle * Math.PI / 180;
    const dx = Math.cos(angle) * o.length / 2, dy = Math.sin(angle) * o.length / 2;
    spans.push({ id: `ambient-opening-${index}`, x1: o.x - dx, y1: o.y - dy, x2: o.x + dx, y2: o.y + dy });
  });
  const jamb = (p: AreaPoint, span: Wall, others: readonly Wall[]) => {
    const match = nearestWall(p, [...walls, ...others.filter(s => s !== span)]);
    return match && match.distance <= OPENING_ON_WALL_EPS ? match.point : undefined;
  };
  const ends = (s: Wall): [AreaPoint, AreaPoint] => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];
  // Drop dangling spans until every remaining jamb meets something that stays.
  for (let n = -1; n !== spans.length;) {
    n = spans.length;
    const kept = spans;
    spans = kept.filter(s => ends(s).every(p => jamb(p, s, kept)));
  }
  return [...walls, ...spans.map(s => {
    const [a, b] = ends(s).map(p => jamb(p, s, spans));
    return { id: s.id, x1: a!.x, y1: a!.y, x2: b!.x, y2: b!.y };
  })];
}

/** Collinear pieces of the nearest supporting wall own the opening, not a
 * different parallel partition that merely falls inside the snap tolerance. */
function sameRun(a: Wall, b: Wall): boolean {
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, length = Math.hypot(dx, dy);
  return length > 0 && [
    { x: b.x1, y: b.y1 }, { x: b.x2, y: b.y2 },
  ].every(p => Math.abs((p.x - a.x1) * dy - (p.y - a.y1) * dx) / length <= WELD_EPS);
}

function buildGeometry(walls: readonly Wall[], openings: readonly Opening[]) {
  const closedWalls = bridgeOpenings(joinWallEnds(walls), openings);
  const regions = traceRegions(closedWalls);
  const attached = openings.map(o => {
    if (openingIsSkylight(o)) return undefined;
    const match = nearestWall(o, closedWalls);
    return match && match.distance <= OPENING_ON_WALL_EPS ? match : undefined;
  });
  const placed = openings.map((o, i) => attached[i] ? { ...o, ...attached[i]!.point } : o);
  const onWalls = closedWalls.map(w => placed.filter((_, i) => attached[i] && sameRun(attached[i]!.wall, w)));
  const sources = placed.map((o, index) => {
    if (!attached[index]) return undefined;
    // Snap to the owning wall before asking which shell owns that point. A
    // nearby interior wall must never be promoted to the exterior boundary.
    const [source] = ambientOpeningSources(regions.shells, [o], { openingEps: WELD_EPS });
    if (!source) return undefined;
    const envelope = regions.shells.find(a => a.id === source.areaId)!;
    // Probe immediately inside the wall, not beyond a narrow room. Pick the
    // smallest containing face if disconnected/nested loops also contain it.
    const room = regions.rooms.filter(a => ambientPointInArea(a,
      source.x + source.inwardX * 0.01, source.y + source.inwardY * 0.01))
      .sort((a, b) => Math.abs(signedArea(a.points)) - Math.abs(signedArea(b.points)))[0] ?? envelope;
    const id = `opening-${index}`;
    return { source: { ...source, areaId: id }, room: { ...room, id }, envelope: { ...envelope, id } };
  });
  return { walls: closedWalls, openings: placed, onWalls, regions, sources };
}

type WallGeometry = ReturnType<typeof buildGeometry>;
const noOpenings: readonly Opening[] = [];
const geometryMemo = new WeakMap<readonly Wall[], { openings: readonly Opening[]; geometry: WallGeometry }>();

function wallGeometry(walls: readonly Wall[], openings: readonly Opening[]): WallGeometry {
  const hit = geometryMemo.get(walls);
  if (hit?.openings === openings) return hit.geometry;
  const geometry = buildGeometry(walls, openings);
  geometryMemo.set(walls, { openings, geometry });
  return geometry;
}

/** Config arrays are replaced on edits, just as for deadSpacesCached. */
export function ambientWallRegions(walls: readonly Wall[], openings = noOpenings) {
  return wallGeometry(walls, openings).regions;
}

const blockerMemo = new WeakMap<WallGeometry, { spans: readonly (readonly [number, number])[]; walls: Wall[] }>();

/** Cut the shared, placed clear spans from each opening's supporting run.
 * Virtual doorway walls also block when shut. Reuse the result until travel
 * changes, so brightness-only state updates can reuse visibility polygons. */
export function ambientWallBlockers(
  walls: readonly Wall[],
  openings: readonly Opening[],
  clearSpan: (opening: Opening) => readonly [number, number],
): Wall[] {
  const geometry = wallGeometry(walls, openings);
  const spans = openings.map(clearSpan);
  const hit = blockerMemo.get(geometry);
  if (hit && spans.every((span, i) => span[0] === hit.spans[i]![0] && span[1] === hit.spans[i]![1])) return hit.walls;
  const byOpening = new Map(geometry.openings.map((o, i) => [o, spans[i]!]));
  const result = geometry.walls.flatMap((w, i) =>
    wallsLightPassesThrough([w], geometry.onWalls[i]!, o => byOpening.get(o)!));
  blockerMemo.set(geometry, { spans, walls: result });
  return result;
}

const clipMemo = new WeakMap<readonly Wall[], WeakMap<AmbientOpeningSource, { radius: number; points: AreaPoint[] | undefined }>>();

/** Clip after blur: even the soft edge must stop at solid wall. */
export function ambientWallClip(
  source: AmbientOpeningSource,
  patch: AmbientDaylightPatch,
  blockers: readonly Wall[],
): AmbientDaylightPatch {
  // The origin is just inside the opening. Unlike a wall-mounted lamp, it
  // cannot ignore nearby walls: a thin porch's opposite wall still blocks sky.
  const x = source.x + source.inwardX * 0.01;
  const y = source.y + source.inwardY * 0.01;
  const radius = Math.max(...patch.points.map(p => Math.hypot(p.x - x, p.y - y))) + 40;
  let memo = clipMemo.get(blockers);
  if (!memo) { memo = new WeakMap(); clipMemo.set(blockers, memo); }
  const hit = memo.get(source);
  const clipPoints = hit?.radius === radius ? hit.points : glowReach(x, y, radius, blockers, 0.001);
  if (!hit || hit.radius !== radius) memo.set(source, { radius, points: clipPoints });
  return clipPoints ? { ...patch, clipPoints } : patch;
}

export interface AmbientWallLight {
  area: Area;
  patch: AmbientDaylightPatch;
}

/**
 * One patch per exterior opening. Physical rooms set its depth; the exterior
 * outline and visibility through cut walls bound its paint. Named Areas do
 * neither, so editing a label cannot create a sun or cut the light in half.
 */
export function ambientWallLights(
  walls: readonly Wall[],
  openings: readonly Opening[],
  blockers: readonly Wall[],
  elevation: unknown,
  transmission: (openingId: string) => number,
  strength: number,
): Array<AmbientWallLight | undefined> | undefined {
  const { regions: { shells }, sources } = wallGeometry(walls, openings);
  // Area-only plans have no physical envelope to infer. Keep their established
  // fallback; the integration still clips those patches against any walls.
  if (!shells.length) return undefined;
  return sources.map(prepared => {
    if (!prepared) return undefined;
    const { source, room, envelope } = prepared;
    const [patch] = ambientDaylightPatches(room, [source], elevation, transmission, { strength });
    if (!patch) return undefined;
    return { area: envelope, patch: ambientWallClip(source, patch, blockers) };
  });
}
