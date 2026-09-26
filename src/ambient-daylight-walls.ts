import type { Area, Opening, Wall } from "./types";
import { openingIsSkylight } from "./types";
import { splitSegments, traceFaces, signedArea, WELD_EPS, OPENING_ON_WALL_EPS } from "./dead-space";
import { glowReach } from "./render";
import {
  ambientDaylightPatches, ambientOpeningSources, ambientPointInArea,
  type AmbientDaylightPatch, type AmbientOpeningSource,
} from "./ambient-daylight";

/** Physical rooms and their exterior outlines, independent of named Areas. */
export function ambientWallRegions(walls: readonly Wall[]): { rooms: Area[]; shells: Area[] } {
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
  const clipPoints = glowReach(x, y, radius, blockers, 0.001);
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
  const { rooms, shells } = ambientWallRegions(walls);
  // Area-only plans have no physical envelope to infer. Keep their established
  // fallback; the integration still clips those patches against any walls.
  if (!shells.length) return undefined;
  return openings.map((opening, index) => {
    if (openingIsSkylight(opening)) return undefined;
    const [source] = ambientOpeningSources(shells, [opening]);
    if (!source) return undefined;
    const envelope = shells.find(a => a.id === source.areaId)!;
    const probe = OPENING_ON_WALL_EPS + 1;
    const room = rooms.find(a => ambientPointInArea(a,
      source.x + source.inwardX * probe, source.y + source.inwardY * probe)) ?? envelope;
    // Namespace by the original opening index, including unlit slots. Opening
    // a door must not renumber another window's SVG gradient/clip references.
    const id = `opening-${index}`;
    const localSource = { ...source, areaId: id };
    const [patch] = ambientDaylightPatches({ ...room, id }, [localSource], elevation, transmission, { strength });
    if (!patch) return undefined;
    return { area: { ...envelope, id }, patch: ambientWallClip(localSource, patch, blockers) };
  });
}
