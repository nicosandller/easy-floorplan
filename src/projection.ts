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
 * Nearer the viewer means larger x + y. That one fact decides which faces of
 * a box are visible and the order the boxes are painted in.
 */
import { svg, nothing, type SVGTemplateResult } from "lit";
import { cssNumber, cssIdent } from "./css-safe";
import { OPENING_ON_WALL_EPS } from "./dead-space";

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
/** A window's sill, and the top of its glass, as fractions of the wall height. */
export const SILL_FRACTION = 0.35;
export const GLASS_FRACTION = 0.85;
/**
 * Walls are drawn in pieces no longer than this. A painter's order sorts
 * whole shapes, and a long wall has no single depth: the far end of a front
 * wall can be further away than the near end of a side wall it never touches.
 * Short pieces each have a depth that is nearly right everywhere along them,
 * which is what lets one sort key stand in for real occlusion.
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

/** Coerce a config `projection`; anything but `iso` means the flat plan. */
export function normalizeProjection(v: unknown): PlanProjection {
  return v === "iso" ? "iso" : "plan";
}

/** Coerce a config `wallHeight` to `0..MAX_WALL_HEIGHT`, defaulting when unset or not a number. */
export function normalizeWallHeight(v: unknown): number {
  return Math.min(MAX_WALL_HEIGHT, Math.max(0, cssNumber(v, DEFAULT_WALL_HEIGHT)));
}

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
}

/**
 * Size of the displayed canvas: the rotated plan's own on the flat plan, and
 * under `iso` the box around the projected floor plus headroom for a wall
 * standing at the far corner.
 */
export function projectedCanvasSize(f: DisplayFrame): { w: number; h: number } {
  if (f.projection !== "iso") return { w: f.w, h: f.h };
  return { w: (f.w + f.h) * ISO_COS, h: (f.w + f.h) * ISO_SIN + f.wallHeight };
}

/**
 * Map a point of the rotated plan, standing `z` above the floor, onto the
 * displayed canvas. The floor's far corner (0, 0) lands at the top of the
 * left edge, `wallHeight` down from the top so a wall there still fits.
 */
export function projectPlanPoint(x: number, y: number, f: DisplayFrame, z = 0): Pt {
  if (f.projection !== "iso") return { x, y };
  return {
    x: (x - y) * ISO_COS + f.h * ISO_COS,
    y: (x + y) * ISO_SIN + f.wallHeight - z,
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
  return `matrix(${n(ISO_COS)} ${n(ISO_SIN)} ${n(-ISO_COS)} ${n(ISO_SIN)} ${n(f.h * ISO_COS)} ${n(f.wallHeight)})`;
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
    default:
      return { x: -z, y: -z };
  }
}

// ---- standing geometry ------------------------------------------------------

export type IsoSolidKind = "wall" | "sill" | "glass" | "furniture";

/** A box standing on the rotated floor — or, for glass, one pane of it. */
export interface IsoSolid {
  kind: IsoSolidKind;
  id?: string;
  /** Footprint corners in the rotated frame: a quad for a box, two points for a pane. */
  base: Pt[];
  /** Where it starts above the floor — 0 for anything standing on it. */
  z0: number;
  /** Where it ends. */
  z1: number;
  /** Fill for a furniture block. Walls take the skin's wall colour from the stylesheet. */
  color?: string;
  /** Drawn on the top face, already positioned in the layer's frame. */
  top?: SVGTemplateResult;
}

export interface IsoWallInput {
  id: string;
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
  type: "door" | "window";
}

interface Span {
  s0: number;
  s1: number;
  type: "door" | "window";
}

/** The openings that sit on this wall, as spans along it, clipped and in order. */
function openingSpans(
  w: IsoWallInput,
  openings: readonly IsoOpeningInput[],
  d: Pt,
  len: number
): Span[] {
  const spans: Span[] = [];
  for (const o of openings) {
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
    const s0 = Math.max(0, t - o.length / 2);
    const s1 = Math.min(len, t + o.length / 2);
    if (s1 - s0 <= 0) continue;
    spans.push({ s0, s1, type: o.type });
  }
  spans.sort((a, b) => a.s0 - b.s0);
  // Overlapping openings merge; the first one's kind wins.
  const merged: Span[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.s0 <= last.s1) last.s1 = Math.max(last.s1, s.s1);
    else merged.push({ ...s });
  }
  return merged;
}

/**
 * The walls as boxes, in the rotated frame. Each wall is cut at its doors,
 * lowered to a sill under its windows with a pane of glass above, and what
 * remains is drawn in pieces of at most {@link ISO_CHUNK} so it sorts well.
 * A wall's own ends are extended by half its thickness, the way the flat
 * plan's round caps do, which is what makes two walls meet at a corner
 * without a notch.
 */
export function wallSolids(
  walls: readonly IsoWallInput[],
  openings: readonly IsoOpeningInput[],
  wallHeight: number
): IsoSolid[] {
  const out: IsoSolid[] = [];
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len = Math.hypot(dx, dy);
    if (!(len > 1e-6)) continue;
    const d = { x: dx / len, y: dy / len };
    const n = { x: -d.y, y: d.x };
    const half = w.thickness / 2;
    const at = (s: number): Pt => ({ x: w.x1 + d.x * s, y: w.y1 + d.y * s });
    const box = (s0: number, s1: number): Pt[] => {
      const a = at(s0);
      const b = at(s1);
      return [
        { x: a.x + n.x * half, y: a.y + n.y * half },
        { x: b.x + n.x * half, y: b.y + n.y * half },
        { x: b.x - n.x * half, y: b.y - n.y * half },
        { x: a.x - n.x * half, y: a.y - n.y * half },
      ];
    };
    const pieces = (s0: number, s1: number, z1: number, kind: IsoSolidKind) => {
      const count = Math.max(1, Math.ceil((s1 - s0) / ISO_CHUNK));
      const step = (s1 - s0) / count;
      for (let i = 0; i < count; i++) {
        out.push({ kind, id: w.id, base: box(s0 + step * i, s0 + step * (i + 1)), z0: 0, z1 });
      }
    };
    const spans = openingSpans(w, openings, d, len);
    let cursor = 0;
    for (const s of spans) {
      // Solid wall up to this opening. The cap only at the wall's real end.
      if (s.s0 > cursor) pieces(cursor === 0 ? -half : cursor, s.s0, wallHeight, "wall");
      if (s.type === "window") {
        pieces(s.s0, s.s1, wallHeight * SILL_FRACTION, "sill");
        out.push({
          kind: "glass",
          id: w.id,
          base: [at(s.s0), at(s.s1)],
          z0: wallHeight * SILL_FRACTION,
          z1: wallHeight * GLASS_FRACTION,
        });
      }
      cursor = s.s1;
    }
    if (cursor < len) pieces(cursor === 0 ? -half : cursor, len + half, wallHeight, "wall");
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
  top?: SVGTemplateResult
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
  return { kind: "furniture", id: f.id, base, z0: 0, z1: height, color, top };
}

/** Painter's key: the footprint's mean x + y. Larger is nearer, and drawn later. */
export function solidDepth(s: IsoSolid): number {
  let sum = 0;
  for (const p of s.base) sum += p.x + p.y;
  return sum / (s.base.length || 1);
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);
const points = (ps: readonly Pt[]) => ps.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

/**
 * The solids, painted back to front. Ties keep their given order, so two
 * pieces of one wall never swap.
 */
export function renderIsoSolids(solids: readonly IsoSolid[]): SVGTemplateResult {
  const order = solids
    .map((s, i) => ({ s, i, depth: solidDepth(s) }))
    .sort((a, b) => a.depth - b.depth || a.i - b.i);
  return svg`<g class="fp-iso">${order.map(({ s }) => renderIsoSolid(s))}</g>`;
}

/**
 * One box: the side faces that look toward the viewer, each with a shade
 * over it so the box reads as one, then the top, then whatever is drawn on
 * the top. Faces that look away are not drawn at all, and the visible faces
 * of one box never overlap each other, so a box needs no sorting of its own.
 */
export function renderIsoSolid(s: IsoSolid): SVGTemplateResult {
  const id = cssIdent(s.id) ?? nothing;
  if (s.kind === "glass") {
    const [a, b] = s.base;
    return svg`<polygon class="fp-iso-glass" data-id=${id}
                        points=${points([elevate(a, s.z0), elevate(b, s.z0), elevate(b, s.z1), elevate(a, s.z1)])} />`;
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
  const top = points(s.base.map((p) => elevate(p, s.z1)));
  return svg`<g class=${`fp-iso-solid fp-iso-${s.kind}`} data-id=${id}
                style=${s.color ? `--fp-iso-color:${s.color}` : nothing}>
    ${faces.map(
      (f) => svg`<polygon class="fp-iso-face" points=${f.pts} /><polygon class="fp-iso-shade" points=${f.pts} opacity=${f.shade} />`
    )}
    <polygon class="fp-iso-face fp-iso-top" points=${top} />
    ${s.top ?? nothing}
  </g>`;
}
