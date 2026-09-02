import type { Area, AreaPoint, Opening } from "./types";
import { SUN_ELEVATION_DAY, SUN_ELEVATION_NIGHT } from "./types";
import { OPENING_ON_WALL_EPS } from "./dead-space";

/**
 * Prototype geometry for room-aware diffuse daylight.
 *
 * This module is deliberately pure and not wired into the card yet. It answers
 * the questions the eventual renderer needs without changing today's render:
 *
 * 1. Which openings are on the exterior envelope rather than between rooms?
 * 2. How much soft sky light reaches a sample point inside the adjacent room?
 * 3. What deterministic patch geometry should an SVG renderer paint?
 *
 * Direct sunlight remains a separate concern in render.ts. Ambient daylight
 * never reads sun azimuth/bearing, so a north-facing window can brighten a room
 * even while no direct ray reaches it.
 */

/** Prototype defaults. Kept here until visual calibration gives them a home in card config. */
export const DEFAULT_AMBIENT_DAYLIGHT_STRENGTH = 0.28;
export const DEFAULT_AMBIENT_DAYLIGHT_DEPTH = 0.8;
export const DEFAULT_AMBIENT_DAYLIGHT_SPREAD = 1.15;

export interface AmbientDaylightOptions {
  /** Maximum normalized contribution from one fully transmitting opening, 0-1. */
  strength?: number;
  /** Reach as a fraction of the room's longer bounding-box side. */
  depth?: number;
  /** How quickly the soft pool fans sideways as it travels into the room. */
  spread?: number;
  /** Opening-to-area-boundary tolerance in canvas units. */
  openingEps?: number;
}

export interface AmbientOpeningSource {
  openingId: string;
  areaId: string;
  x: number;
  y: number;
  /** Unit vector pointing from the exterior opening into the room. */
  inwardX: number;
  inwardY: number;
  /** Opening width along the wall, in canvas units. */
  length: number;
}

/**
 * One soft daylight patch ready for a renderer.
 *
 * `points` is a broad trapezoid that starts at the opening and fans into the
 * room. The renderer must additionally clip it to the Area polygon; keeping
 * the unclipped patch here makes the geometry deterministic and easy to test.
 * `gradientStart`/`gradientEnd` define the opening-to-room fade axis.
 */
export interface AmbientDaylightPatch {
  openingId: string;
  areaId: string;
  points: [AreaPoint, AreaPoint, AreaPoint, AreaPoint];
  gradientStart: AreaPoint;
  gradientEnd: AreaPoint;
  opacity: number;
}

interface BoundaryMatch {
  area: Area;
  segmentIndex: number;
  distance: number;
}

function finitePositive(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

function clamp01(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(0, Math.min(1, v));
}

function normalizedOptions(opts: AmbientDaylightOptions = {}) {
  return {
    strength: clamp01(opts.strength, DEFAULT_AMBIENT_DAYLIGHT_STRENGTH),
    depth: Math.max(0.05, Math.min(3, finitePositive(opts.depth, DEFAULT_AMBIENT_DAYLIGHT_DEPTH))),
    spread: Math.max(0.05, Math.min(4, finitePositive(opts.spread, DEFAULT_AMBIENT_DAYLIGHT_SPREAD))),
    openingEps: finitePositive(opts.openingEps, OPENING_ON_WALL_EPS),
  };
}

/** Ray-cast point-in-polygon. Points on the edge are close enough for our sampling use. */
export function ambientPointInArea(area: Pick<Area, "points">, x: number, y: number): boolean {
  const points = area.points;
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    const crosses = a.y > y !== b.y > y;
    if (!crosses) continue;
    const xHit = ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x;
    if (x < xHit) inside = !inside;
  }
  return inside;
}

/** Distance from a point to a finite segment. */
function distanceToSegment(x: number, y: number, a: AreaPoint, b: AreaPoint): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return Math.hypot(x - a.x, y - a.y);
  let t = ((x - a.x) * vx + (y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (a.x + t * vx), y - (a.y + t * vy));
}

/** Nearest boundary segment of an area to an opening centre. */
function nearestBoundary(area: Area, opening: Pick<Opening, "x" | "y">): BoundaryMatch | undefined {
  if (area.points.length < 2) return undefined;
  let best: BoundaryMatch | undefined;
  for (let i = 0; i < area.points.length; i++) {
    const a = area.points[i]!;
    const b = area.points[(i + 1) % area.points.length]!;
    const distance = distanceToSegment(opening.x, opening.y, a, b);
    if (!best || distance < best.distance) best = { area, segmentIndex: i, distance };
  }
  return best;
}

/**
 * Areas whose boundary this opening belongs to, nearest first.
 *
 * Exactly one match means an exterior-envelope opening for V1. Two matches
 * means a doorway/window between rooms and therefore not a sky-light source.
 */
export function openingAdjacentAreas(
  opening: Pick<Opening, "x" | "y">,
  areas: readonly Area[],
  openingEps = OPENING_ON_WALL_EPS,
): BoundaryMatch[] {
  const eps = finitePositive(openingEps, OPENING_ON_WALL_EPS);
  return areas
    .map((area) => nearestBoundary(area, opening))
    .filter((m): m is BoundaryMatch => m !== undefined && m.distance <= eps)
    .sort((a, b) => a.distance - b.distance);
}

/** Find which of the two normals of an area's boundary points into the room. */
function inwardNormal(match: BoundaryMatch, x: number, y: number, eps: number): { x: number; y: number } | undefined {
  const points = match.area.points;
  const a = points[match.segmentIndex]!;
  const b = points[(match.segmentIndex + 1) % points.length]!;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return undefined;

  const left = { x: -dy / len, y: dx / len };
  const right = { x: dy / len, y: -dx / len };
  // The opening centre can sit a few canvas units off the polygon edge after a
  // manual nudge, so probe farther than the accepted boundary tolerance.
  const probe = Math.max(1, eps + 1);
  const leftInside = ambientPointInArea(match.area, x + left.x * probe, y + left.y * probe);
  const rightInside = ambientPointInArea(match.area, x + right.x * probe, y + right.y * probe);
  if (leftInside && !rightInside) return left;
  if (rightInside && !leftInside) return right;

  // Rare fallback for a very shallow/concave corner: pick the normal pointing
  // toward the average vertex position. It is deterministic and only decides
  // a direction for a source already proven to sit on this area's boundary.
  const centre = match.area.points.reduce(
    (acc, p) => ({ x: acc.x + p.x / match.area.points.length, y: acc.y + p.y / match.area.points.length }),
    { x: 0, y: 0 },
  );
  const toCentre = { x: centre.x - x, y: centre.y - y };
  return left.x * toCentre.x + left.y * toCentre.y >= 0 ? left : right;
}

/**
 * Exterior ambient sources derived from room geometry alone.
 *
 * An opening is a V1 sky-light source only when it touches exactly one Area.
 * That excludes interior doors/windows without another config flag. Openings
 * touching zero areas are ignored because there is no room to illuminate.
 */
export function ambientOpeningSources(
  areas: readonly Area[],
  openings: readonly Opening[],
  opts: AmbientDaylightOptions = {},
): AmbientOpeningSource[] {
  const { openingEps } = normalizedOptions(opts);
  const out: AmbientOpeningSource[] = [];
  for (const opening of openings) {
    const matches = openingAdjacentAreas(opening, areas, openingEps);
    if (matches.length !== 1) continue;
    const match = matches[0]!;
    const inward = inwardNormal(match, opening.x, opening.y, openingEps);
    if (!inward) continue;
    out.push({
      openingId: opening.id,
      areaId: match.area.id,
      x: opening.x,
      y: opening.y,
      inwardX: inward.x,
      inwardY: inward.y,
      length: Math.max(0, opening.length),
    });
  }
  return out;
}

/**
 * Fraction of ambient sky light an opening can transmit, 0-1.
 *
 * `sunlight: false` remains the explicit "this opening is wall to daylight"
 * opt-out for this prototype only; a dedicated ambient opt-out can replace it
 * if the feature becomes public. Windows are glazed by default, doors opaque
 * by default. An opaque opening can still admit daylight while physically open.
 * `openFraction` and `shutterOpenFraction` are intentionally inputs rather
 * than HA reads so this module stays deterministic and renderer-agnostic.
 */
export function ambientOpeningTransmission(
  opening: Pick<Opening, "type" | "glazed" | "sunlight">,
  openFraction = 0,
  shutterOpenFraction = 1,
): number {
  if (opening.sunlight === false) return 0;
  const glazed = opening.glazed ?? opening.type === "window";
  const base = glazed ? 1 : clamp01(openFraction, 0);
  return base * clamp01(shutterOpenFraction, 1);
}

/**
 * Day/night factor shared with the visual language of sunDimming, but
 * independent of sun bearing. Below civil twilight there is no daylight;
 * above +6° it is full. Between them use smoothstep rather than a linear ramp,
 * so dawn/dusk start and finish gently instead of changing slope at the two
 * thresholds. An unreadable elevation fails dark: stale or missing `sun.sun`
 * must never make the card invent daylight. The next valid HA state restores it.
 */
export function ambientDaylightDayFactor(elevation: unknown): number {
  if (typeof elevation !== "number" || !Number.isFinite(elevation)) return 0;
  const e = elevation;
  if (e <= SUN_ELEVATION_NIGHT) return 0;
  if (e >= SUN_ELEVATION_DAY) return 1;
  const t = (e - SUN_ELEVATION_NIGHT) / (SUN_ELEVATION_DAY - SUN_ELEVATION_NIGHT);
  return t * t * (3 - 2 * t);
}

function areaLongSide(area: Area): number {
  if (!area.points.length) return 1;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of area.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return Math.max(1, maxX - minX, maxY - minY);
}

/**
 * Deterministic patch geometry for an SVG renderer.
 *
 * The patch itself is deliberately broader than a direct-sun beam and must be
 * clipped to its Area polygon by the renderer. That is what makes it read as a
 * soft window-side wash rather than another ray. Its opacity carries only the
 * daylight/opening strength; the renderer is free to use a linear/radial mask
 * for the final visual softness without changing source classification.
 */
export function ambientDaylightPatches(
  area: Area,
  sources: readonly AmbientOpeningSource[],
  elevation: unknown,
  transmission: (openingId: string) => number = () => 1,
  opts: AmbientDaylightOptions = {},
): AmbientDaylightPatch[] {
  const { strength, depth, spread } = normalizedOptions(opts);
  const day = ambientDaylightDayFactor(elevation);
  if (!(day > 0) || !(strength > 0)) return [];

  const reach = areaLongSide(area) * depth;
  const out: AmbientDaylightPatch[] = [];
  for (const source of sources) {
    if (source.areaId !== area.id) continue;
    const t = clamp01(transmission(source.openingId), 0);
    const opacity = Math.max(0, Math.min(1, strength * day * t));
    if (!(opacity > 0)) continue;

    const tangentX = -source.inwardY;
    const tangentY = source.inwardX;
    const nearHalf = Math.max(1, source.length / 2);
    const farHalf = nearHalf + reach * spread;
    const farX = source.x + source.inwardX * reach;
    const farY = source.y + source.inwardY * reach;

    out.push({
      openingId: source.openingId,
      areaId: source.areaId,
      points: [
        { x: source.x - tangentX * nearHalf, y: source.y - tangentY * nearHalf },
        { x: source.x + tangentX * nearHalf, y: source.y + tangentY * nearHalf },
        { x: farX + tangentX * farHalf, y: farY + tangentY * farHalf },
        { x: farX - tangentX * farHalf, y: farY - tangentY * farHalf },
      ],
      gradientStart: { x: source.x, y: source.y },
      gradientEnd: { x: farX, y: farY },
      opacity,
    });
  }
  return out;
}

/**
 * Normalized ambient daylight at one point in one room.
 *
 * Contributions broaden from each opening and fade with depth. Multiple
 * sources combine as light coverage (`1 - Π(1-c)`) instead of simple addition,
 * so two windows brighten a room without ever exceeding 1.
 */
export function ambientDaylightAtPoint(
  area: Area,
  sources: readonly AmbientOpeningSource[],
  point: AreaPoint,
  elevation: unknown,
  transmission: (openingId: string) => number = () => 1,
  opts: AmbientDaylightOptions = {},
): number {
  if (!ambientPointInArea(area, point.x, point.y)) return 0;
  const { strength, depth, spread } = normalizedOptions(opts);
  const day = ambientDaylightDayFactor(elevation);
  if (!(day > 0) || !(strength > 0)) return 0;

  const maxDepth = areaLongSide(area) * depth;
  let darkness = 1;

  for (const source of sources) {
    if (source.areaId !== area.id) continue;
    const tx = point.x - source.x;
    const ty = point.y - source.y;
    const axial = tx * source.inwardX + ty * source.inwardY;
    if (axial < 0 || axial > maxDepth) continue;

    const lateral = Math.abs(tx * -source.inwardY + ty * source.inwardX);
    const halfWidth = Math.max(1, source.length / 2 + axial * spread);
    if (lateral >= halfWidth) continue;

    // Smooth, deliberately broad falloff. Squaring the depth term keeps the
    // window side visibly brighter without turning the far wall into a hard
    // cutoff; the lateral smoothstep avoids a triangular spotlight edge.
    const depthT = axial / maxDepth;
    const depthFactor = (1 - depthT) ** 2;
    const lateralT = lateral / halfWidth;
    const lateralFactor = 1 - lateralT * lateralT * (3 - 2 * lateralT);
    const t = clamp01(transmission(source.openingId), 0);
    const contribution = Math.max(0, Math.min(1, strength * day * t * depthFactor * lateralFactor));
    darkness *= 1 - contribution;
  }

  return Math.max(0, Math.min(1, 1 - darkness));
}
