import { nothing, svg, type SVGTemplateResult } from "lit";
import type { Area, AreaPoint } from "./types";
import { ambientLateralFalloff, type AmbientDaylightPatch } from "./ambient-daylight";

/** Neutral/cool sky light, intentionally distinct from warm direct sunlight. */
export const DEFAULT_AMBIENT_DAYLIGHT_COLOR = "#f4f8ff";
/** Canvas-space edge feather for the light pool. */
export const DEFAULT_AMBIENT_DAYLIGHT_BLUR = 10;
/** Nested fans per patch that step the sideways fade; the blur smooths the steps. */
export const AMBIENT_DAYLIGHT_SIDE_BANDS = 32;

export interface AmbientDaylightRenderOptions {
  /** Stable namespace when more than one floorplan SVG can exist on a page. */
  idPrefix?: string;
  /** Sky-light tint. Public configuration can be added after visual calibration. */
  color?: string;
  /** Gaussian blur in plan/canvas units. Zero keeps the deterministic patch edge sharp. */
  blur?: number;
}

export interface AmbientDaylightRenderPatch {
  openingId: string;
  points: string;
  gradientId: string;
  gradientStart: AreaPoint;
  gradientEnd: AreaPoint;
  opacity: number;
  clipId?: string;
  clipPoints?: string;
  /** Sideways fade: nested fans, widest first, stacked inside an SVG mask. */
  maskId: string;
  sideBands: AmbientDaylightSideBand[];
}

/** One nested fan of the sideways mask and the fill-opacity it stacks with. */
export interface AmbientDaylightSideBand {
  points: string;
  opacity: number;
}

export interface AmbientDaylightRenderModel {
  clipId: string;
  clipPoints: string;
  filterId: string;
  blur: number;
  color: string;
  patches: AmbientDaylightRenderPatch[];
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function finitePoint(p: AreaPoint): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** SVG polygon `points` text, or an empty string when the polygon is unusable. */
export function ambientDaylightPolygonPoints(points: readonly AreaPoint[]): string {
  if (points.length < 3 || points.some((p) => !finitePoint(p))) return "";
  return points.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Stable SVG-safe id with a hash suffix so two different source ids that
 * sanitize to the same visible text still cannot collide.
 */
export function ambientDaylightSvgId(raw: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const visible =
    raw
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "ambient";
  return `${visible}-${(hash >>> 0).toString(36)}`;
}

const lerp = (a: AreaPoint, b: AreaPoint, t: number): AreaPoint =>
  ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/**
 * Nested fans that fade a patch towards its sides the way the point model does.
 *
 * The patch is a trapezoid whose two side edges are where `ambientLateralFalloff`
 * reaches zero. Fan `i` of `n` keeps the same axis and covers the inner `i/n`
 * of the width at every depth, so the line at a given fraction of the
 * half-width is straight, exactly as the point model measures it. Stacked with
 * ordinary alpha compositing, the band between fan `i-1` and fan `i` is covered
 * by fans `i..n`, so each fan's opacity is chosen to make that stack equal the
 * falloff averaged over its band. Nested shapes overlap instead of abutting, so
 * no anti-aliased seam can show between two bands.
 *
 * Each fan also runs `back` units straight out behind the opening. The mask is
 * blurred like the light it masks, and without that run-out the blur would
 * halve the light right at the window, the brightest place in the room.
 */
export function ambientDaylightSideBands(
  points: readonly AreaPoint[],
  back: number,
  bands = AMBIENT_DAYLIGHT_SIDE_BANDS,
): AmbientDaylightSideBand[] {
  if (points.length !== 4 || points.some((p) => !finitePoint(p))) return [];
  const [nearA, nearB, farB, farA] = points as [AreaPoint, AreaPoint, AreaPoint, AreaPoint];
  const near = lerp(nearA, nearB, 0.5);
  const far = lerp(farA, farB, 0.5);
  const axisLength = Math.hypot(far.x - near.x, far.y - near.y);
  if (!(axisLength > 0)) return [];
  const out = { x: ((near.x - far.x) / axisLength) * back, y: ((near.y - far.y) / axisLength) * back };
  const n = Math.max(1, Math.floor(bands));

  // Falloff averaged over each band, innermost first; 16 midpoint samples.
  const target = Array.from({ length: n }, (_, i) => {
    let sum = 0;
    for (let k = 0; k < 16; k++) sum += ambientLateralFalloff((i + (k + 0.5) / 16) / n);
    return sum / 16;
  });

  // Widest first; alpha stacking does not care about order, readers might.
  const result: AmbientDaylightSideBand[] = [];
  for (let i = n; i >= 1; i--) {
    const u = i / n;
    const a = lerp(near, nearA, u);
    const b = lerp(near, nearB, u);
    // The wider fans i+1..n already cover this band to the next band's
    // target; fan i lifts it to its own.
    const own = target[i - 1]!;
    const wider = i === n ? 0 : target[i]!;
    const opacity = wider >= 1 ? 0 : clamp((own - wider) / (1 - wider), 0, 1);
    // Inside the full-light shoulder a fan adds nothing the one around it
    // has not already covered.
    if (!(opacity > 0)) continue;
    result.push({
      points: ambientDaylightPolygonPoints([
        { x: a.x + out.x, y: a.y + out.y }, a, lerp(far, farA, u),
        lerp(far, farB, u), b, { x: b.x + out.x, y: b.y + out.y },
      ]),
      opacity,
    });
  }
  return result;
}

/**
 * Pure render preparation shared by tests and the SVG template.
 *
 * The supplied polygon bounds the building (or the Area-only fallback).
 * Each patch can also carry a wall-visibility polygon. Both clips apply after
 * blur, so its soft edge cannot leak through a solid wall.
 */
export function buildAmbientDaylightRenderModel(
  area: Area,
  patches: readonly AmbientDaylightPatch[],
  opts: AmbientDaylightRenderOptions = {},
): AmbientDaylightRenderModel | null {
  const clipPoints = ambientDaylightPolygonPoints(area.points);
  if (!clipPoints) return null;

  const prefix = opts.idPrefix?.trim() || "fp-ambient";
  const clipId = ambientDaylightSvgId(`${prefix}-clip-${area.id}`);
  const filterId = ambientDaylightSvgId(`${prefix}-blur-${area.id}`);
  const blur = Number.isFinite(opts.blur) ? clamp(opts.blur!, 0, 40) : DEFAULT_AMBIENT_DAYLIGHT_BLUR;
  const color = opts.color?.trim() || DEFAULT_AMBIENT_DAYLIGHT_COLOR;

  const rendered: AmbientDaylightRenderPatch[] = [];
  for (let i = 0; i < patches.length; i++) {
    const patch = patches[i]!;
    if (patch.areaId !== area.id) continue;
    const points = ambientDaylightPolygonPoints(patch.points);
    if (!points || !finitePoint(patch.gradientStart) || !finitePoint(patch.gradientEnd)) continue;
    if (!Number.isFinite(patch.opacity) || patch.opacity <= 0) continue;
    const wallClip = patch.clipPoints && ambientDaylightPolygonPoints(patch.clipPoints);
    if (patch.clipPoints && !wallClip) continue;
    rendered.push({
      openingId: patch.openingId,
      points,
      gradientId: ambientDaylightSvgId(`${prefix}-gradient-${area.id}-${patch.openingId}-${i}`),
      gradientStart: patch.gradientStart,
      gradientEnd: patch.gradientEnd,
      opacity: clamp(patch.opacity, 0, 1),
      clipId: wallClip ? ambientDaylightSvgId(`${prefix}-wall-${area.id}-${patch.openingId}-${i}`) : undefined,
      clipPoints: wallClip || undefined,
      maskId: ambientDaylightSvgId(`${prefix}-sides-${area.id}-${patch.openingId}-${i}`),
      sideBands: ambientDaylightSideBands(patch.points, Math.max(1, blur * 3)),
    });
  }

  if (!rendered.length) return null;
  return { clipId, clipPoints, filterId, blur, color, patches: rendered };
}

/**
 * Paint renderer-ready ambient daylight patches inside one room.
 *
 * The host card places this group immediately above Area floor fills and below
 * dead-space hatching, artificial glows, direct sunlight, walls/openings and
 * interactive items. Existing layer order is otherwise unchanged.
 */
export function renderAmbientDaylight(
  area: Area,
  patches: readonly AmbientDaylightPatch[],
  opts: AmbientDaylightRenderOptions = {},
): SVGTemplateResult {
  const model = buildAmbientDaylightRenderModel(area, patches, opts);
  if (!model) return svg``;

  return svg`
    <g class="fp-ambient-daylight" data-area-id=${area.id} aria-hidden="true" pointer-events="none">
      <defs>
        <clipPath id=${model.clipId}>
          <polygon points=${model.clipPoints}></polygon>
        </clipPath>
        <!-- The filter region is a proportion of the patch's own box, and a
             Gaussian tail runs to roughly 3x its deviation, so the two are
             coupled: the margin has to stay wider than the blur or the falloff
             is cut off square at the region edge — a hard line exactly where
             the softness was the point. It holds comfortably at the shipped
             blur, since a patch fans most of the way across its room while the
             blur stays in single digits. Worth sizing from the blur instead if
             it ever becomes a public knob. -->
        <filter id=${model.filterId} x="-25%" y="-25%" width="150%" height="150%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation=${model.blur}></feGaussianBlur>
        </filter>
        ${model.patches.map(
          (patch) => svg`
            ${patch.clipPoints ? svg`<clipPath id=${patch.clipId}>
              <polygon points=${patch.clipPoints}></polygon>
            </clipPath>` : nothing}
            <linearGradient id=${patch.gradientId} gradientUnits="userSpaceOnUse"
                            x1=${patch.gradientStart.x} y1=${patch.gradientStart.y}
                            x2=${patch.gradientEnd.x} y2=${patch.gradientEnd.y}>
              <stop offset="0%" stop-color=${model.color} stop-opacity="1"></stop>
              <stop offset="35%" stop-color=${model.color} stop-opacity="0.72"></stop>
              <stop offset="72%" stop-color=${model.color} stop-opacity="0.25"></stop>
              <stop offset="100%" stop-color=${model.color} stop-opacity="0"></stop>
            </linearGradient>
            <!-- Sideways fade, blurred like the light so its steps melt. Same
                 region margin as the filter: the mask follows the blurred
                 patch, and a tighter box would cut its soft edge square. -->
            ${patch.sideBands.length ? svg`<mask id=${patch.maskId}
                  x="-25%" y="-25%" width="150%" height="150%">
              <g filter=${model.blur > 0 ? `url(#${model.filterId})` : nothing}>
                ${patch.sideBands.map((band) => svg`<polygon points=${band.points}
                  fill="#fff" fill-opacity=${band.opacity}></polygon>`)}
              </g>
            </mask>` : nothing}
          `,
        )}
      </defs>
      <g clip-path=${`url(#${model.clipId})`}>
        ${model.patches.map(
          (patch) => svg`
            <g clip-path=${patch.clipId ? `url(#${patch.clipId})` : nothing}>
            <polygon class="fp-ambient-daylight-patch"
                     data-opening-id=${patch.openingId}
                     points=${patch.points}
                     fill=${`url(#${patch.gradientId})`}
                     opacity=${patch.opacity}
                     filter=${model.blur > 0 ? `url(#${model.filterId})` : "none"}
                     mask=${patch.sideBands.length ? `url(#${patch.maskId})` : nothing}>
            </polygon>
            </g>
          `,
        )}
      </g>
    </g>
  `;
}
