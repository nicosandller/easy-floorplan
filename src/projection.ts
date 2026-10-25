/**
 * The isometric view (issue #261).
 *
 * The plan is drawn flat by default. `projection: iso` shows the same plan as
 * an isometric elevation: the floor plane is turned by one affine transform —
 * the trick whole-plan rotation (issue #33) already uses — and the walls
 * stand up on it as extruded boxes. Nothing is stored any differently:
 * coordinates stay plan coordinates, and the editor always shows the plan as
 * drawn.
 *
 * The projection is the classic 30° isometric. A plan point (x, y) standing
 * z above the floor lands at
 *
 *     u = (x − y) · cos 30°
 *     v = (x + y) · sin 30° − z
 *
 * which has the two properties everything below leans on. It is affine on
 * the floor plane, so one SVG `matrix()` carries every floor layer — rooms,
 * light pools, furniture glyphs, the background image — with no per-element
 * work at all. And because sin 30° is exactly ½, raising a point by z is the
 * same as sliding it by (−z, −z) on the floor: the standing geometry can be
 * drawn in plan coordinates inside the very same group, with no inverse
 * transform and no second coordinate system. See {@link elevate}.
 *
 * The viewer looks along (1,1,1). Face normals decide visibility; spatial
 * separation and visible-face depth decide the order of overlapping solids.
 */
import { svg, nothing, type SVGTemplateResult } from "lit";
import { rotationBasis } from "./rotation";
import { cssNumber, cssIdent, cssColorOr } from "./css-safe";
import type { WallKind, Wall, OpeningType, Roof, RoofType, AreaPoint, RectAreaSide } from "./types";
import { OPENING_ON_WALL_EPS } from "./dead-space";
import { openingIsSkylight } from "./types";
import { joinIsoWalls } from "./projection-joints";
import { sortIsoSolids } from "./projection-order";

export type PlanProjection = "plan" | "iso";

/**
 * Wall height under `projection: iso`, in canvas units. A real wall is taller
 * than a room is wide and would hide everything in it, so this is a maquette's
 * cut-down wall: tall enough to read as one, short enough to see over.
 */
export const DEFAULT_WALL_HEIGHT = 60;
/** The tallest wall worth drawing — past this the elevation swallows the plan. */
export const MAX_WALL_HEIGHT = 400;
/** How tall a piece of furniture stands, as a fraction of the wall height. */
export const FURNITURE_HEIGHT_FRACTION = 0.4;
/** Railings are low barriers, rather than another full-height room wall. */
export const RAILING_HEIGHT_FRACTION = 0.5;
/** A window's sill, and the top of its glass, as fractions of the wall height. */
export const SILL_FRACTION = 0.35;
export const GLASS_FRACTION = 0.85;
/** The highest sill a window can have, leaving a band of glass under its head. */
export const MAX_SILL = 0.8;

/**
 * A window's sill as a fraction of the wall height: its own `sill`, clamped,
 * or {@link SILL_FRACTION}. `0` is a floor-to-ceiling window.
 */
export function openingSill(o: { sill?: number }): number {
  const raw = o.sill;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return SILL_FRACTION;
  return Math.max(0, Math.min(MAX_SILL, raw));
}
/**
 * Walls are drawn in pieces no longer than this. A painter's order sorts
 * whole shapes, and a long wall has no single depth: the far end of a front
 * wall can be further away than the near end of a side wall it never touches.
 * Short pieces can be ordered independently around objects along the wall.
 */
export const ISO_CHUNK = 32;
/** Shade laid over a face that looks along +x (right) and one that looks along +y (front). */
export const SHADE_RIGHT = 0.18;
export const SHADE_FRONT = 0.34;

const ISO_COS = Math.sqrt(3) / 2;
const ISO_SIN = 0.5;
/** An opening runs along a wall when the sine of the angle between them is under this (~15°). */
const PARALLEL_EPS = 0.26;

export interface Pt {
  x: number;
  y: number;
}

/** Accept the public 3D name and the original prototype alias. */
export function normalizeProjection(v: unknown): PlanProjection {
  return v === "iso" || v === "3d" ? "iso" : "plan";
}

/** Coerce a config `wallHeight` or per-wall height override to `0..MAX_WALL_HEIGHT`, defaulting when unset or not a number. */
export function normalizeWallHeight(v: unknown, fallback = DEFAULT_WALL_HEIGHT): number {
  return Math.min(MAX_WALL_HEIGHT, Math.max(0, cssNumber(v, fallback)));
}

/**
 * Resolves the effective standing height of a wall, taking into account any custom
 * height override (normalized), railing fraction, and falling back to baseWallHeight.
 */
export function wallStandingHeight(w: { height?: number; kind?: WallKind }, baseWallHeight: number): number {
  const normBase = normalizeWallHeight(baseWallHeight);
  const base = normalizeWallHeight(w.height, normBase);
  return base * (w.kind === "railing" ? RAILING_HEIGHT_FRACTION : 1);
}

/**
 * Calculates the required 3D headroom from the card's base wall height and
 * any per-wall height overrides across all walls, ensuring tall walls fit the canvas.
 */
export function wallHeadroom(
  baseWallHeight: unknown,
  walls: readonly { height?: number; kind?: WallKind }[]
): number {
  const base = normalizeWallHeight(baseWallHeight);
  return Math.max(base, ...walls.map((w) => wallStandingHeight(w, base)));
}

/** Default ridge height or flat slab thickness for a roof style. */
export function defaultRoofHeight(type: RoofType, wallHeight = DEFAULT_WALL_HEIGHT): number {
  return type === "flat" ? 8 : Math.round(wallHeight * 0.6);
}

/** Wall opacity is independent of glass and furniture. */
export function normalizeWallOpacity(v: unknown): number {
  return Math.min(1, Math.max(0, cssNumber(v, 1)));
}

/** Multiplier for full-height external wall rendering when viewing 3D outside areas (~2.5m vs ~1m maquette). */
export const OUTDOOR_WALL_HEIGHT_MULTIPLIER = 2.5;

/**
 * The frame a plan is displayed in: its size once rotated (issue #33), and
 * how that rotated frame is projected. The card builds one per render and
 * every mapping — the SVG's group transform, each overlay anchor, the zoom's
 * framing — comes from it, so the layers cannot drift apart.
 */
export interface DisplayFrame {
  /** Rotated canvas width — the frame the projection acts on. */
  w: number;
  /** Rotated canvas height. */
  h: number;
  projection: PlanProjection;
  wallHeight: number;
  /** Extra vertical headroom downwards for lower levels beneath base elevation. */
  lowerDepth?: number;
  /** Screen-space margin for wall caps at the canvas boundary. */
  padding?: number;
  /** Fixed floor span for live orbit controls; fits the full rotation without zoom pulsing. */
  orbitSpan?: number;
}

/**
 * Size of the displayed canvas: the rotated plan's own on the flat plan, and
 * under `iso` the box around the projected floor plus headroom for a wall
 * standing at the far corner.
 */
export function projectedCanvasSize(f: DisplayFrame): { w: number; h: number } {
  if (f.projection !== "iso") return { w: f.w, h: f.h };
  const span = f.orbitSpan ?? f.w + f.h;
  return {
    w: span * ISO_COS + 2 * (f.padding ?? 0),
    h: span * ISO_SIN + f.wallHeight + (f.lowerDepth ?? 0) + 2 * (f.padding ?? 0),
  };
}

/**
 * Map a point of the rotated plan, standing `z` above the floor, onto the
 * displayed canvas. The floor's far corner (0, 0) lands at the top of the
 * left edge, `wallHeight` down from the top so a wall there still fits.
 */
export function projectPlanPoint(x: number, y: number, f: DisplayFrame, z = 0): Pt {
  if (f.projection !== "iso") return { x, y };
  const margin = ((f.orbitSpan ?? f.w + f.h) - f.w - f.h) / 2;
  return {
    x: (x - y) * ISO_COS + (f.h + margin) * ISO_COS + (f.padding ?? 0),
    y: (x + y + margin) * ISO_SIN + f.wallHeight - z + (f.padding ?? 0),
  };
}

/**
 * A direction in the rotated plan, as a unit vector on the displayed canvas —
 * for the overlay badges that are pushed clear of the thing they mark, which
 * must be pushed the way that thing now points.
 */
export function projectPlanDirection(dx: number, dy: number, f: DisplayFrame): Pt {
  if (f.projection !== "iso") return { x: dx, y: dy };
  const u = (dx - dy) * ISO_COS;
  const v = (dx + dy) * ISO_SIN;
  const len = Math.hypot(u, v) || 1;
  return { x: u / len, y: v / len };
}

/**
 * SVG group transform realizing {@link projectPlanPoint} at z = 0 for whole
 * layers, or "" for the flat plan. Matches the point mapping exactly, for the
 * same reason `planRotationTransform` must: the drawing (SVG, one transform)
 * and the overlay (HTML, remapped per point) have to land in the same place.
 */
export function planProjectionTransform(f: DisplayFrame): string {
  if (f.projection !== "iso") return "";
  const n = (v: number) => String(+v.toFixed(6));
  const origin = projectPlanPoint(0, 0, f);
  return `matrix(${n(ISO_COS)} ${n(ISO_SIN)} ${n(-ISO_COS)} ${n(ISO_SIN)} ${n(origin.x)} ${n(origin.y)})`;
}

/**
 * Where a point of the rotated floor is drawn, in floor coordinates, once
 * raised by `z`. Exact for this projection (see the module comment), and the
 * reason the standing geometry needs no coordinate system of its own.
 */
export function elevate(p: Pt, z: number): Pt {
  return { x: p.x - z, y: p.y - z };
}

/**
 * {@link elevate} for something drawn in *unrotated* plan coordinates inside
 * the rotated group: the plan-space shift that becomes (−z, −z) once the
 * rotation has turned it. A furniture glyph is lifted onto its block this way.
 */
export function elevationShift(z: number, rot: number): Pt {
  switch (rot) {
    case 90:
      return { x: -z, y: z };
    case 180:
      return { x: z, y: z };
    case 270:
      return { x: z, y: -z };
    default: {
      const { cos, sin } = rotationBasis(rot);
      return { x: -z * (cos + sin), y: z * (sin - cos) };
    }
  }
}

// ---- standing geometry ------------------------------------------------------

export type IsoSolidKind = "wall" | "railing" | "sill" | "glass" | "furniture" | "panel" | "opening-hit" | "roof";

/** A box standing on the rotated floor — or, for glass, one pane of it. */
export interface IsoSolid {
  kind: IsoSolidKind;
  id?: string;
  /** Footprint corners in the rotated frame, or two points for a pane. */
  base: Pt[];
  /** Where it starts above the floor — 0 for anything standing on it. */
  z0: number;
  /** Where it ends. */
  z1: number;
  /** Fill for a furniture block. Walls take the skin's wall colour from the stylesheet. */
  color?: string;
  opacity?: number;
  /** Flag for outdoor terrain and ground floor slabs. */
  isSlab?: boolean;
  /** Drawn on the top face, already positioned in the layer's frame. */
  top?: SVGTemplateResult;
  /** Explicit raised corners for a tilted opening panel or 3D roof face. */
  vertices?: Array<Pt & { z: number }>;
  glazed?: boolean;
  /** Adjacent wall chunks share these faces; drawing them shows ribs through transparency. */
  hiddenEdges?: number[];
  sortDepth?: number;
}

export function shiftIsoSolidZ(solid: IsoSolid, zOffset: number): IsoSolid {
  if (!zOffset) return solid;
  return {
    ...solid,
    z0: solid.z0 + zOffset,
    z1: solid.z1 + zOffset,
    sortDepth: solid.sortDepth !== undefined ? solid.sortDepth + zOffset : undefined,
    vertices: solid.vertices?.map((v) => ({ ...v, z: v.z + zOffset })),
  };
}

export interface IsoWallInput {
  id: string;
  kind?: WallKind;
  height?: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  thickness: number;
}

export interface IsoOpeningInput {
  x: number;
  y: number;
  length: number;
  angle: number;
  type: OpeningType;
  sill?: number;
}

interface Span {
  s0: number;
  s1: number;
  type: "door" | "window";
  /** Windows only: the sill, as a fraction of the wall height. */
  sill: number;
}

/**
 * Find the wall an opening is placed on, if any.
 * Matches using the same distance and parallel tolerances as openingSpans and dead-space.
 * When multiple collinear walls match (e.g. at a junction), the one with the greatest
 * opening overlap is chosen.
 */
export function openingWall<W extends { x1: number; y1: number; x2: number; y2: number }>(
  o: { x: number; y: number; length: number; angle: number; type?: OpeningType },
  walls: readonly W[]
): W | undefined {
  if (o.type === "skylight") return undefined;
  const rad = (o.angle * Math.PI) / 180;
  let bestWall: W | undefined;
  let bestOverlap = -Infinity;
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) continue;
    const d = { x: dx / len, y: dy / len };
    const cross = Math.abs(d.x * Math.sin(rad) - d.y * Math.cos(rad));
    if (cross > PARALLEL_EPS) continue;
    const rx = o.x - w.x1;
    const ry = o.y - w.y1;
    const t = rx * d.x + ry * d.y;
    if (t < -o.length / 2 || t > len + o.length / 2) continue;
    const off = Math.abs(rx * -d.y + ry * d.x);
    if (off <= OPENING_ON_WALL_EPS) {
      const overlap = Math.min(len, t + o.length / 2) - Math.max(0, t - o.length / 2);
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestWall = w;
      }
    }
  }
  return bestWall;
}

/**
 * Height an opening should stand in 3D projection: inherited from its underlying wall
 * when placed on one with custom height (or a railing), or defaulting to wallHeight.
 */
export function openingWallHeight(
  o: { x: number; y: number; length: number; angle: number; type?: OpeningType },
  walls: readonly (Wall | IsoWallInput)[],
  defaultWallHeight: number
): number {
  const normDefault = normalizeWallHeight(defaultWallHeight);
  const w = openingWall(o, walls);
  return w ? wallStandingHeight(w, normDefault) : normDefault;
}

/** The openings that sit on this wall, as spans along it, clipped and in order. */
function openingSpans(
  w: IsoWallInput,
  openings: readonly IsoOpeningInput[],
  d: Pt,
  len: number,
  outdoor = false
): Span[] {
  const spans: Span[] = [];
  for (const o of openings) {
    // A skylight is a hole in the ceiling, so it is a gap in no wall at all.
    // The test below only asks whether its centre lies along this wall, and
    // a roof light drawn over a partition passes that by coincidence — left
    // in, it sawed the partition in half. The same guard the lighting code
    // has (`wallsLightPassesThrough`), for the same reason.
    if (openingIsSkylight(o)) continue;
    const rad = (o.angle * Math.PI) / 180;
    // Along the wall, or it is some other wall's opening.
    const cross = Math.abs(d.x * Math.sin(rad) - d.y * Math.cos(rad));
    if (cross > PARALLEL_EPS) continue;
    const rx = o.x - w.x1;
    const ry = o.y - w.y1;
    const t = rx * d.x + ry * d.y;
    // The same closeness the dead-space tracer uses (#141), so "this door is
    // in this wall" means one thing across the card.
    const off = Math.abs(rx * -d.y + ry * d.x);
    if (off > OPENING_ON_WALL_EPS) continue;
    const rawS0 = t - o.length / 2;
    const rawS1 = t + o.length / 2;
    let s0 = Math.max(0, rawS0);
    let s1 = Math.min(len, rawS1);
    if (outdoor) {
      if (s0 <= 2) s0 = 0;
      if (len - s1 <= 2) s1 = len;
    }
    if (s1 - s0 <= 0) continue;
    const window = o.type === "window";
    spans.push({ s0, s1, type: window ? "window" : "door", sill: window ? openingSill(o) : 0 });
  }
  spans.sort((a, b) => a.s0 - b.s0);
  // Overlapping openings merge; the first kind wins, but a window span
  // keeps the highest sill so a lower neighbour cannot erase its parapet.
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && (s.s0 < last.s1 || (s.s0 === last.s1 && s.sill === last.sill))) {
      last.s1 = Math.max(last.s1, s.s1);
      if (last.type === "window") last.sill = Math.max(last.sill, s.sill);
    }
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * The walls as boxes, in the rotated frame. Each wall is cut at its doors,
 * lowered to a sill under its windows with a pane of glass above, and what
 * remains is drawn in pieces of at most {@link ISO_CHUNK} so it sorts well.
 * Free ends extend by half the thickness. Shared corners meet at one miter;
 * T/cross junctions partition their centre without overlapping end caps.
 */
export function wallSolids(
  walls: readonly IsoWallInput[],
  openings: readonly IsoOpeningInput[],
  wallHeight: number,
  includeGlass = true,
  outdoor = false
): IsoSolid[] {
  const normWallHeight = normalizeWallHeight(wallHeight);
  const out: IsoSolid[] = [];
  const joined = joinIsoWalls(walls, (w, start) => {
    const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const d = { x: (w.x2 - w.x1) / len, y: (w.y2 - w.y1) / len };
    // A doorway or a low sill at a junction leaves its neighbour's end face
    // exposed. Do not miter it away as if another full-height wall met it.
    return !openingSpans(w, openings, d, len, outdoor).some(s => start ? s.s0 <= 1e-6 : s.s1 >= len - 1e-6);
  });
  for (const w of joined) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) continue;
    const height = wallStandingHeight(w, normWallHeight);
    const kind = w.kind === "railing" ? "railing" : "wall";
    const d = { x: dx / len, y: dy / len };
    const n = { x: -d.y, y: d.x };
    const half = w.thickness / 2;
    const at = (s: number): Pt => ({ x: w.x1 + d.x * s, y: w.y1 + d.y * s });
    const box = (s0: number, s1: number) => {
      const a = at(s0);
      const b = at(s1);
      const start = s0 <= 0 && w.start ? w.start : [
        { x: a.x + n.x * half, y: a.y + n.y * half }, { x: a.x - n.x * half, y: a.y - n.y * half }];
      const end = s1 >= len && w.end ? w.end : [
        { x: b.x + n.x * half, y: b.y + n.y * half }, { x: b.x - n.x * half, y: b.y - n.y * half }];
      return {
        base: [start[0]!, ...end, ...start.slice(1).reverse()],
        endEdges: end.slice(1).map((_p, i) => i + 1),
        startEdges: start.slice(1).map((_p, i) => end.length + 1 + i)
      };
    };
    const pieces = (s0: number, s1: number, z1: number, kind: IsoSolidKind, z0 = 0) => {
      const count = Math.max(1, Math.ceil((s1 - s0) / ISO_CHUNK));
      const step = (s1 - s0) / count;
      for (let i = 0; i < count; i++) {
        const shape = box(s0 + step * i, s0 + step * (i + 1));
        out.push({
          kind, id: w.id, base: shape.base, z0, z1,
          hiddenEdges: [...(i < count - 1 || (s1 >= len && w.end) ? shape.endEdges : []),
          ...(i > 0 || (s0 <= 0 && w.start) ? shape.startEdges : [])]
        });
      }
    };
    const spans = openingSpans(w, openings, d, len, outdoor);
    let cursor = 0;
    const hasHeader = w.kind !== "railing" && height > DEFAULT_WALL_HEIGHT;
    const minStub = outdoor ? 2 : 0;
    for (const s of spans) {
      // Solid wall up to this opening. The cap only at the wall's real end.
      if (s.s0 - cursor > minStub) pieces(cursor === 0 ? -half : cursor, s.s0, height, kind);
      if (s.type === "window") {
        // A floor-to-ceiling window stands on no sill at all.
        if (s.sill > 0) pieces(s.s0, s.s1, height * s.sill, "sill");
        if (includeGlass) out.push({
          kind: "glass",
          id: w.id,
          base: [at(s.s0), at(s.s1)],
          z0: height * s.sill,
          z1: height * GLASS_FRACTION,
        });
      }
      if (hasHeader) {
        const openingTop = height * GLASS_FRACTION;
        if (height > openingTop + 1e-4) {
          pieces(s.s0, s.s1, height, kind, openingTop);
        }
      }
      cursor = s.s1;
    }
    if (len - cursor > minStub) pieces(cursor === 0 ? -half : cursor, len + half, height, kind);
  }
  return out;
}

/**
 * A piece of furniture as a block, in the rotated frame: its rectangle turned
 * by its own angle about its centre — which is where the glyph is drawn
 * from — then mapped by `map` (the plan's rotation).
 */
export function furnitureSolid(
  f: { id?: string; x: number; y: number; w: number; h: number; angle?: number },
  map: (x: number, y: number) => Pt,
  height: number,
  color: string,
  top?: SVGTemplateResult,
  z0 = 0
): IsoSolid {
  const rad = ((f.angle ?? 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const hw = f.w / 2;
  const hh = f.h / 2;
  const base = (
    [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ] as const
  ).map(([ox, oy]) => map(f.x + ox * c - oy * s, f.y + ox * s + oy * c));
  return { kind: "furniture", id: f.id, base, z0, z1: height, color, top };
}

function offsetAreaPoints(pts: readonly AreaPoint[], overhang: number): Pt[] {
  if (overhang <= 0 || pts.length < 3) return pts.map((p) => ({ x: p.x, y: p.y }));
  if (pts.length === 4) {
    const xs = new Set(pts.map((p) => p.x));
    const ys = new Set(pts.map((p) => p.y));
    if (xs.size === 2 && ys.size === 2) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      return pts.map((p) => ({
        x: p.x === minX ? minX - overhang : maxX + overhang,
        y: p.y === minY ? minY - overhang : maxY + overhang,
      }));
    }
  }
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p.x / pts.length; cy += p.y / pts.length; }
  return pts.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return { x: p.x + (dx / len) * overhang, y: p.y + (dy / len) * overhang };
  });
}

function createRoofFace(
  id: string,
  rawPts3D: Array<{ x: number; y: number; z: number }>,
  map: (x: number, y: number) => Pt,
  color: string,
  z0: number,
  z1: number,
  sortDepth?: number
): IsoSolid {
  const pts3D: Array<{ x: number; y: number; z: number }> = [];
  for (const p of rawPts3D) {
    const last = pts3D[pts3D.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y, p.z - last.z) > 1e-4) {
      pts3D.push(p);
    }
  }
  if (pts3D.length > 2) {
    const first = pts3D[0]!;
    const last = pts3D[pts3D.length - 1]!;
    if (Math.hypot(first.x - last.x, first.y - last.y, first.z - last.z) <= 1e-4) {
      pts3D.pop();
    }
  }
  if (pts3D.length < 3) return { kind: "roof", base: [], z0, z1, sortDepth };

  const basePts = pts3D.map((p) => map(p.x, p.y));
  const vert3D = pts3D.map((p) => ({ ...map(p.x, p.y), z: p.z }));

  return {
    kind: "roof",
    id,
    base: basePts,
    z0,
    z1,
    color,
    sortDepth,
    vertices: vert3D,
  };
}

interface NormalizedRoof {
  id: string;
  type: RoofType;
  points: AreaPoint[];
  height: number;
  elevation: number;
  overhang: number;
  color: string;
  highSide?: RectAreaSide;
  ridge?: "horizontal" | "vertical";
}

interface ParsedGableRoof {
  norm: NormalizedRoof;
  id: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  midX: number;
  midY: number;
  rangeX: number;
  rangeY: number;
  alongX: boolean;
  z0: number;
  pitch: number;
  zPeak: number;
  color: string;
}

function generateIntersectingGables(
  main: ParsedGableRoof,
  crossList: ParsedGableRoof[],
  map: (x: number, y: number) => Pt
): IsoSolid[] {
  const solids: IsoSolid[] = [];
  const alongX = main.alongX;

  const makePt3D = (u: number, v: number, z: number) =>
    alongX ? { x: u, y: v, z } : { x: v, y: u, z };
  const orderFace = (pts: Array<{ x: number; y: number; z: number }>) =>
    alongX ? pts : [...pts].reverse();

  const minUA = alongX ? main.minX : main.minY;
  const maxUA = alongX ? main.maxX : main.maxY;
  const minVA = alongX ? main.minY : main.minX;
  const maxVA = alongX ? main.maxY : main.maxX;
  const midVA = (minVA + maxVA) / 2;

  const z0A = main.z0;
  const zPeakA = main.zPeak;
  const halfVA_south = maxVA - midVA;
  const slopeA_south = halfVA_south > 0 ? (zPeakA - z0A) / halfVA_south : 1;
  const halfVA_north = midVA - minVA;
  const slopeA_north = halfVA_north > 0 ? (zPeakA - z0A) / halfVA_north : 1;

  const southCross = crossList
    .filter((c) => (alongX ? c.midY : c.midX) >= midVA)
    .sort((a, b) => (alongX ? a.minX - b.minX : a.minY - b.minY));
  const northCross = crossList
    .filter((c) => (alongX ? c.midY : c.midX) < midVA)
    .sort((a, b) => (alongX ? a.minX - b.minX : a.minY - b.minY));

  // --- Process South side (v >= midVA) ---
  if (southCross.length === 0) {
    const p3 = makePt3D(maxUA, maxVA, z0A);
    const p4 = makePt3D(minUA, maxVA, z0A);
    const r1 = makePt3D(minUA, midVA, zPeakA);
    const r2 = makePt3D(maxUA, midVA, zPeakA);
    solids.push(createRoofFace(main.id, orderFace([p3, p4, r1, r2]), map, main.color, z0A, zPeakA));
  } else {
    let curU = minUA;
    for (const c of southCross) {
      const minUB = alongX ? c.minX : c.minY;
      const maxUB = alongX ? c.maxX : c.maxY;
      const midUB = (minUB + maxUB) / 2;
      const maxVB = alongX ? c.maxY : c.maxX;
      const vFront = Math.max(maxVA, maxVB);

      const z0B = c.z0;
      const zPeakB = c.zPeak;
      const zApex = Math.min(zPeakA, zPeakB);
      const vApex = midVA + (zPeakA - zApex) / slopeA_south;

      const valleyW = makePt3D(minUB, vFront, z0B);
      const valleyE = makePt3D(maxUB, vFront, z0B);
      const apex = makePt3D(midUB, vApex, zApex);
      const frontRidge = makePt3D(midUB, vFront, zPeakB);

      solids.push(createRoofFace(c.id, orderFace([valleyW, apex, frontRidge]), map, c.color, z0B, zPeakB));
      solids.push(createRoofFace(c.id, orderFace([valleyE, frontRidge, apex]), map, c.color, z0B, zPeakB));
      solids.push(createRoofFace(c.id, orderFace([valleyE, valleyW, frontRidge]), map, c.color, z0B, zPeakB));

      const rW = makePt3D(curU, midVA, zPeakA);
      const eW = makePt3D(curU, vFront, z0A);
      solids.push(createRoofFace(main.id, orderFace([rW, apex, valleyW, eW]), map, main.color, z0A, zPeakA));

      if (zPeakB < zPeakA) {
        const rB1 = makePt3D(minUB, midVA, zPeakA);
        const rB2 = makePt3D(maxUB, midVA, zPeakA);
        solids.push(createRoofFace(main.id, orderFace([rB1, rB2, apex]), map, main.color, z0A, zPeakA));
      }

      curU = maxUB;
    }
    if (curU < maxUA) {
      const lastC = southCross[southCross.length - 1]!;
      const minULast = alongX ? lastC.minX : lastC.minY;
      const maxULast = alongX ? lastC.maxX : lastC.maxY;
      const midULast = (minULast + maxULast) / 2;
      const maxVLast = alongX ? lastC.maxY : lastC.maxX;
      const vFront = Math.max(maxVA, maxVLast);
      const zApex = Math.min(zPeakA, lastC.zPeak);
      const vApex = midVA + (zPeakA - zApex) / slopeA_south;
      const apexLast = makePt3D(midULast, vApex, zApex);
      const valleyELast = makePt3D(maxULast, vFront, lastC.z0);
      const rE = makePt3D(maxUA, midVA, zPeakA);
      const eE = makePt3D(maxUA, vFront, z0A);
      solids.push(createRoofFace(main.id, orderFace([apexLast, rE, eE, valleyELast]), map, main.color, z0A, zPeakA));
    }
  }

  // --- Process North side (v < midVA) ---
  if (northCross.length === 0) {
    const p1 = makePt3D(minUA, minVA, z0A);
    const p2 = makePt3D(maxUA, minVA, z0A);
    const r1 = makePt3D(minUA, midVA, zPeakA);
    const r2 = makePt3D(maxUA, midVA, zPeakA);
    solids.push(createRoofFace(main.id, orderFace([p1, p2, r2, r1]), map, main.color, z0A, zPeakA));
  } else {
    let curU = minUA;
    for (const c of northCross) {
      const minUB = alongX ? c.minX : c.minY;
      const maxUB = alongX ? c.maxX : c.maxY;
      const midUB = (minUB + maxUB) / 2;
      const minVB = alongX ? c.minY : c.minX;
      const vFront = Math.min(minVA, minVB);

      const z0B = c.z0;
      const zPeakB = c.zPeak;
      const zApex = Math.min(zPeakA, zPeakB);
      const vApex = midVA - (zPeakA - zApex) / slopeA_north;

      const valleyW = makePt3D(minUB, vFront, z0B);
      const valleyE = makePt3D(maxUB, vFront, z0B);
      const apex = makePt3D(midUB, vApex, zApex);
      const frontRidge = makePt3D(midUB, vFront, zPeakB);

      solids.push(createRoofFace(c.id, orderFace([frontRidge, apex, valleyW]), map, c.color, z0B, zPeakB));
      solids.push(createRoofFace(c.id, orderFace([frontRidge, valleyE, apex]), map, c.color, z0B, zPeakB));
      solids.push(createRoofFace(c.id, orderFace([valleyW, valleyE, frontRidge]), map, c.color, z0B, zPeakB));

      const rW = makePt3D(curU, midVA, zPeakA);
      const eW = makePt3D(curU, vFront, z0A);
      solids.push(createRoofFace(main.id, orderFace([eW, valleyW, apex, rW]), map, main.color, z0A, zPeakA));

      if (zPeakB < zPeakA) {
        const rB1 = makePt3D(minUB, midVA, zPeakA);
        const rB2 = makePt3D(maxUB, midVA, zPeakA);
        solids.push(createRoofFace(main.id, orderFace([rB2, rB1, apex]), map, main.color, z0A, zPeakA));
      }

      curU = maxUB;
    }
    if (curU < maxUA) {
      const lastC = northCross[northCross.length - 1]!;
      const minULast = alongX ? lastC.minX : lastC.minY;
      const maxULast = alongX ? lastC.maxX : lastC.maxY;
      const midULast = (minULast + maxULast) / 2;
      const minVLast = alongX ? lastC.minY : lastC.minX;
      const vFront = Math.min(minVA, minVLast);
      const zApex = Math.min(zPeakA, lastC.zPeak);
      const vApex = midVA - (zPeakA - zApex) / slopeA_north;
      const apexLast = makePt3D(midULast, vApex, zApex);
      const valleyELast = makePt3D(maxULast, vFront, lastC.z0);
      const rE = makePt3D(maxUA, midVA, zPeakA);
      const eE = makePt3D(maxUA, vFront, z0A);
      solids.push(createRoofFace(main.id, orderFace([valleyELast, eE, rE, apexLast]), map, main.color, z0A, zPeakA));
    }
  }

  // --- End gable walls of main roof ---
  const vSouth = southCross.length > 0 ? Math.max(maxVA, ...southCross.map((c) => (alongX ? c.maxY : c.maxX))) : maxVA;
  const vNorth = northCross.length > 0 ? Math.min(minVA, ...northCross.map((c) => (alongX ? c.minY : c.minX))) : minVA;

  const w1 = makePt3D(minUA, vSouth, z0A);
  const w2 = makePt3D(minUA, vNorth, z0A);
  const wRidge = makePt3D(minUA, midVA, zPeakA);
  solids.push(createRoofFace(main.id, orderFace([w1, w2, wRidge]), map, main.color, z0A, zPeakA));

  const e1 = makePt3D(maxUA, vNorth, z0A);
  const e2 = makePt3D(maxUA, vSouth, z0A);
  const eRidge = makePt3D(maxUA, midVA, zPeakA);
  solids.push(createRoofFace(main.id, orderFace([e1, e2, eRidge]), map, main.color, z0A, zPeakA));

  return solids;
}

/**
 * Roof solids generated from Roof elements.
 *
 * Supports 4 architectural styles:
 * - `flat`: Slab from base elevation to base + height
 * - `hip`: Sloped triangular/trapezoidal pitch faces meeting at central ridge / apex
 * - `gable`: Dual-slope pitch along primary axis with end gables (supports cross-gable intersections)
 * - `shed`: Mono-pitch slope from eaves to high side
 */
export function roofSolids(
  roofs: readonly Roof[],
  map: (x: number, y: number) => Pt,
  defaultWallHeight: number
): IsoSolid[] {
  const solids: IsoSolid[] = [];

  const parsedGables: ParsedGableRoof[] = [];
  const otherRoofs: NormalizedRoof[] = [];

  for (const roof of roofs) {
    if (!roof.points || roof.points.length < 3) continue;

    const type: RoofType = roof.type ?? "gable";
    const elevation = roof.elevation ?? defaultWallHeight;
    const defaultHeight = defaultRoofHeight(type, defaultWallHeight);
    const height = roof.height ?? defaultHeight;
    const overhang = roof.overhang ?? 0;
    const color = cssColorOr(roof.color, "#8d6e63");
    const highSide = roof.highSide;
    const ridge = roof.ridge;

    const norm: NormalizedRoof = {
      id: roof.id,
      type,
      points: roof.points,
      height,
      elevation,
      overhang,
      color,
      highSide,
      ridge,
    };

    if (type === "gable") {
      const planPts = offsetAreaPoints(norm.points, overhang);
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const p of planPts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const rangeX = maxX - minX;
      const rangeY = maxY - minY;
      const alongX = ridge ? ridge === "horizontal" : rangeX >= rangeY;
      parsedGables.push({
        norm,
        id: norm.id,
        minX, maxX, minY, maxY,
        rangeX, rangeY,
        midX: (minX + maxX) / 2, midY: (minY + maxY) / 2,
        alongX,
        z0: elevation,
        pitch: height,
        zPeak: elevation + height,
        color,
      });
    } else {
      otherRoofs.push(norm);
    }
  }

  // Detect intersecting gable roof pairs
  const handledGableIds = new Set<string>();
  const mainToCross = new Map<ParsedGableRoof, ParsedGableRoof[]>();

  for (let i = 0; i < parsedGables.length; i++) {
    for (let j = 0; j < parsedGables.length; j++) {
      if (i === j) continue;
      const g1 = parsedGables[i]!;
      const g2 = parsedGables[j]!;
      if (g1.alongX === g2.alongX) continue;

      const a1 = g1.rangeX * g1.rangeY;
      const a2 = g2.rangeX * g2.rangeY;
      if (a1 < a2 || (a1 === a2 && i > j)) continue;

      if (g2.maxX <= g1.minX || g1.maxX <= g2.minX || g2.maxY <= g1.minY || g1.maxY <= g2.minY) continue;

      const crossRidgeInMain = g1.alongX
        ? (g1.minX < g2.midX && g2.midX < g1.maxX)
        : (g1.minY < g2.midY && g2.midY < g1.maxY);
      if (!crossRidgeInMain) continue;

      if (!mainToCross.has(g1)) mainToCross.set(g1, []);
      mainToCross.get(g1)!.push(g2);
      handledGableIds.add(g1.id);
      handledGableIds.add(g2.id);
    }
  }

  for (const [main, crossList] of mainToCross) {
    solids.push(...generateIntersectingGables(main, crossList, map));
  }

  const remainingRoofs: NormalizedRoof[] = [
    ...parsedGables
      .filter((g) => !handledGableIds.has(g.id))
      .map((g) => g.norm),
    ...otherRoofs,
  ];

  for (const roof of remainingRoofs) {
    const roofType = roof.type;
    const z0 = roof.elevation;
    const pitch = roof.height;
    const overhang = roof.overhang;
    const color = roof.color;

    const planPts = overhang > 0 ? offsetAreaPoints(roof.points, overhang) : roof.points;
    const mappedPts = planPts.map((p) => map(p.x, p.y));

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of planPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const rangeX = maxX - minX;
    const rangeY = maxY - minY;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const zPeak = z0 + pitch;
    const mappedCenter = map(midX, midY);
    const sortDepth = mappedCenter.x + mappedCenter.y + (z0 + zPeak) / 2;

    if (roofType === "flat") {
      solids.push({
        kind: "roof",
        id: roof.id,
        base: mappedPts,
        z0,
        z1: z0 + pitch,
        color,
        sortDepth,
      });
    } else if (roofType === "hip") {
      const alongX = roof.ridge ? roof.ridge === "horizontal" : rangeX >= rangeY;
      const delta = Math.min(alongX ? rangeX / 2 : rangeY / 2, (alongX ? rangeY : rangeX) / 2);

      if (alongX) {
        const r1 = { x: minX + delta, y: midY, z: zPeak };
        const r2 = { x: maxX - delta, y: midY, z: zPeak };
        const p1 = { x: minX, y: minY, z: z0 };
        const p2 = { x: maxX, y: minY, z: z0 };
        const p3 = { x: maxX, y: maxY, z: z0 };
        const p4 = { x: minX, y: maxY, z: z0 };

        solids.push(createRoofFace(roof.id, [p1, p2, r2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p2, p3, r2], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p3, p4, r1, r2], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p4, p1, r1], map, color, z0, zPeak, sortDepth));
      } else {
        const r1 = { x: midX, y: minY + delta, z: zPeak };
        const r2 = { x: midX, y: maxY - delta, z: zPeak };
        const p1 = { x: minX, y: minY, z: z0 };
        const p2 = { x: maxX, y: minY, z: z0 };
        const p3 = { x: maxX, y: maxY, z: z0 };
        const p4 = { x: minX, y: maxY, z: z0 };

        solids.push(createRoofFace(roof.id, [p1, p2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p2, p3, r2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p3, p4, r2], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p4, p1, r1, r2], map, color, z0, zPeak, sortDepth));
      }
    } else if (roofType === "gable") {
      const alongX = roof.ridge ? roof.ridge === "horizontal" : rangeX >= rangeY;
      const p1 = { x: minX, y: minY, z: z0 };
      const p2 = { x: maxX, y: minY, z: z0 };
      const p3 = { x: maxX, y: maxY, z: z0 };
      const p4 = { x: minX, y: maxY, z: z0 };

      if (alongX) {
        const r1 = { x: minX, y: midY, z: zPeak };
        const r2 = { x: maxX, y: midY, z: zPeak };
        solids.push(createRoofFace(roof.id, [p1, p2, r2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p3, p4, r1, r2], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p4, p1, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p2, p3, r2], map, color, z0, zPeak, sortDepth));
      } else {
        const r1 = { x: midX, y: minY, z: zPeak };
        const r2 = { x: midX, y: maxY, z: zPeak };
        solids.push(createRoofFace(roof.id, [p4, p1, r1, r2], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p2, p3, r2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p1, p2, r1], map, color, z0, zPeak, sortDepth));
        solids.push(createRoofFace(roof.id, [p3, p4, r2], map, color, z0, zPeak, sortDepth));
      }
    } else if (roofType === "shed") {
      const side = roof.highSide ?? "top";
      const zPeak = z0 + pitch;

      // In canvas coordinates, y=0 is top (North), y=maxY is bottom (South),
      // x=0 is left (West), x=maxX is right (East).
      let zNW = z0, zNE = z0, zSE = z0, zSW = z0;
      if (side === "top") {
        zNW = zPeak;
        zNE = zPeak;
      } else if (side === "bottom") {
        zSW = zPeak;
        zSE = zPeak;
      } else if (side === "left") {
        zNW = zPeak;
        zSW = zPeak;
      } else if (side === "right") {
        zNE = zPeak;
        zSE = zPeak;
      }

      const pNW = { x: minX, y: minY, z: zNW };
      const pNE = { x: maxX, y: minY, z: zNE };
      const pSE = { x: maxX, y: maxY, z: zSE };
      const pSW = { x: minX, y: maxY, z: zSW };

      solids.push(createRoofFace(roof.id, [pNW, pNE, pSE, pSW], map, color, z0, zPeak, sortDepth));

      const corners = [pNW, pNE, pSE, pSW];
      for (let i = 0; i < 4; i++) {
        const c1 = corners[i]!;
        const c2 = corners[(i + 1) % 4]!;
        if (c1.z > z0 || c2.z > z0) {
          solids.push(createRoofFace(
            roof.id,
            [
              { x: c1.x, y: c1.y, z: z0 },
              { x: c2.x, y: c2.y, z: z0 },
              { x: c2.x, y: c2.y, z: c2.z },
              { x: c1.x, y: c1.y, z: c1.z },
            ],
            map, color, z0, Math.max(c1.z, c2.z), sortDepth
          ));
        }
      }
    }
  }
  return solids;
}

export function roofCourseLines(vertices: Array<{ x: number; y: number; z: number }>): Array<[Pt, Pt]> {
  const zMin = Math.min(...vertices.map((v) => v.z));
  const zMax = Math.max(...vertices.map((v) => v.z));
  const diff = zMax - zMin;
  if (diff < 6) return [];

  const step = Math.max(10, Math.min(22, Math.round(diff / 8)));
  const lines: Array<[Pt, Pt]> = [];
  const startZ = Math.ceil((zMin + step * 0.4) / step) * step;
  for (let z = startZ; z < zMax; z += step) {
    const pts: Pt[] = [];
    const n = vertices.length;
    for (let i = 0; i < n; i++) {
      const v1 = vertices[i]!;
      const v2 = vertices[(i + 1) % n]!;
      if ((v1.z <= z && v2.z >= z) || (v1.z >= z && v2.z <= z)) {
        if (Math.abs(v2.z - v1.z) > 1e-4) {
          const t = (z - v1.z) / (v2.z - v1.z);
          pts.push(elevate({
            x: v1.x + t * (v2.x - v1.x),
            y: v1.y + t * (v2.y - v1.y),
          }, z));
        }
      }
    }
    if (pts.length >= 2) {
      lines.push([pts[0]!, pts[pts.length - 1]!]);
    }
  }
  return lines;
}

export { solidDepth } from "./projection-order";

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const points = (ps: readonly Pt[]) => ps.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

/**
 * The solids, painted back to front. Ties keep their given order, so two
 * pieces of one wall never swap.
 */
export function renderIsoSolids(
  solids: readonly IsoSolid[],
  decorate: (solid: IsoSolid, drawing: SVGTemplateResult) => SVGTemplateResult = (_s, drawing) => drawing
): SVGTemplateResult {
  return svg`<g class="fp-iso">${sortIsoSolids(solids).map(s => decorate(s, renderIsoSolid(s)))}</g>`;
}

/**
 * One box: the side faces that look toward the viewer, each with a shade
 * over it so the box reads as one, then the top, then whatever is drawn on
 * the top. Faces that look away are not drawn at all, and the visible faces
 * of one box never overlap each other, so a box needs no sorting of its own.
 */
export function renderIsoSolid(s: IsoSolid): SVGTemplateResult {
  const id = cssIdent(s.id) ?? nothing;
  if (s.kind === "glass" || s.kind === "panel" || s.kind === "opening-hit") {
    const [a, b] = s.base;
    return svg`<polygon class=${`fp-iso-${s.kind}${s.glazed ? " fp-iso-glazed" : ""}`} data-id=${id}
                        style=${s.color ? `--fp-iso-color:${s.color}` : nothing}
                        points=${points(s.vertices
      ? s.vertices.map((p) => elevate(p, p.z))
      : [elevate(a, s.z0), elevate(b, s.z0), elevate(b, s.z1), elevate(a, s.z1)])} />`;
  }
  if (s.kind === "roof" && s.vertices) {
    const elevated = s.vertices.map((p) => elevate(p, p.z));
    const [a, b, c] = s.vertices;
    if (a && b && c) {
      const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
      const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
      const nx = u.y * v.z - u.z * v.y;
      const ny = u.z * v.x - u.x * v.z;
      const nz = u.x * v.y - u.y * v.x;
      const toward = nx + ny + nz;
      if (toward <= 0) return svg`${nothing}`;

      const len = Math.hypot(nx, ny, nz) || 1;
      const unx = nx / len, uny = ny / len, unz = nz / len;
      let shade = 0.12;
      if (unz > 0.8) {
        shade = 0.05;
      } else if (Math.abs(unx) >= Math.abs(uny)) {
        shade = unx > 0 ? SHADE_RIGHT : 0.22;
      } else {
        shade = uny > 0 ? SHADE_FRONT : 0.35;
      }

      const lines = unz > 0.05 ? roofCourseLines(s.vertices) : [];

      const styleParts: string[] = [];
      if (s.color) styleParts.push(`--fp-iso-color:${s.color}`);
      if (s.opacity !== undefined) styleParts.push(`opacity:${s.opacity}`);
      const style = styleParts.length > 0 ? styleParts.join(";") : nothing;

      return svg`<g class="fp-iso-solid fp-iso-roof" data-id=${id}
                    style=${style}>
        <polygon class="fp-iso-face" points=${points(elevated)} />
        <polygon class="fp-iso-shade" points=${points(elevated)} opacity=${shade} />
        ${lines.map(([p1, p2]) => svg`<line class="fp-iso-roof-line" x1=${p1.x} y1=${p1.y} x2=${p2.x} y2=${p2.y} />`)}
      </g>`;
    }
  }
  const n = s.base.length;
  let cx = 0;
  let cy = 0;
  for (const p of s.base) {
    cx += p.x / n;
    cy += p.y / n;
  }
  const faces: Array<{ pts: string; shade: number }> = [];
  for (let i = 0; i < n; i++) {
    if (s.hiddenEdges?.includes(i)) continue;
    const a = s.base[i];
    const b = s.base[(i + 1) % n];
    // The edge's normal, turned to point away from the footprint.
    let mx = b.y - a.y;
    let my = -(b.x - a.x);
    if (mx * (cx - a.x) + my * (cy - a.y) > 0) {
      mx = -mx;
      my = -my;
    }
    // Looking away from the viewer: hidden behind the box itself.
    if (mx + my <= 0) continue;
    faces.push({
      pts: points([elevate(a, s.z0), elevate(b, s.z0), elevate(b, s.z1), elevate(a, s.z1)]),
      shade: Math.abs(mx) >= Math.abs(my) ? SHADE_RIGHT : SHADE_FRONT,
    });
  }
  const styleParts: string[] = [];
  if (s.color) styleParts.push(`--fp-iso-color:${s.color}`);
  if (s.opacity !== undefined) styleParts.push(`opacity:${s.opacity}`);
  const style = styleParts.length > 0 ? styleParts.join(";") : nothing;

  const top = points(s.base.map((p) => elevate(p, s.z1)));
  return svg`<g class=${`fp-iso-solid fp-iso-${s.kind}${s.isSlab ? " fp-iso-slab" : ""}`} data-id=${id}
                style=${style}>
    ${faces.map(
    (f) => svg`<polygon class="fp-iso-face" points=${f.pts} /><polygon class="fp-iso-shade" points=${f.pts} opacity=${f.shade} />`
  )}
    <polygon class="fp-iso-face fp-iso-top" points=${top} />
    ${s.top ?? nothing}
  </g>`;
}
