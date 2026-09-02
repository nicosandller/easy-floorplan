import { svg, type SVGTemplateResult } from "lit";
import type { Area, AreaPoint } from "./types";
import type { AmbientDaylightPatch } from "./ambient-daylight";

/** Neutral/cool sky light, intentionally distinct from warm direct sunlight. */
export const DEFAULT_AMBIENT_DAYLIGHT_COLOR = "#f4f8ff";
/** Canvas-space edge feather for the prototype light pool. */
export const DEFAULT_AMBIENT_DAYLIGHT_BLUR = 10;

export interface AmbientDaylightRenderOptions {
  /** Stable namespace when more than one floorplan SVG can exist on a page. */
  idPrefix?: string;
  /** Prototype sky-light tint. Public configuration can be added after visual calibration. */
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

/**
 * Pure render preparation shared by tests and the SVG template.
 *
 * The Area polygon is the hard room boundary. Patch edges inside the room are
 * feathered later by the blur filter, while clipping after that blur prevents
 * diffuse light from leaking through walls into a neighbouring room.
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
    rendered.push({
      openingId: patch.openingId,
      points,
      gradientId: ambientDaylightSvgId(`${prefix}-gradient-${area.id}-${patch.openingId}-${i}`),
      gradientStart: patch.gradientStart,
      gradientEnd: patch.gradientEnd,
      opacity: clamp(patch.opacity, 0, 1),
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
        <filter id=${model.filterId} x="-25%" y="-25%" width="150%" height="150%"
                color-interpolation-filters="sRGB">
          <feGaussianBlur stdDeviation=${model.blur}></feGaussianBlur>
        </filter>
        ${model.patches.map(
          (patch) => svg`
            <linearGradient id=${patch.gradientId} gradientUnits="userSpaceOnUse"
                            x1=${patch.gradientStart.x} y1=${patch.gradientStart.y}
                            x2=${patch.gradientEnd.x} y2=${patch.gradientEnd.y}>
              <stop offset="0%" stop-color=${model.color} stop-opacity="1"></stop>
              <stop offset="35%" stop-color=${model.color} stop-opacity="0.72"></stop>
              <stop offset="72%" stop-color=${model.color} stop-opacity="0.25"></stop>
              <stop offset="100%" stop-color=${model.color} stop-opacity="0"></stop>
            </linearGradient>
          `,
        )}
      </defs>
      <g clip-path=${`url(#${model.clipId})`}>
        ${model.patches.map(
          (patch) => svg`
            <polygon class="fp-ambient-daylight-patch"
                     data-opening-id=${patch.openingId}
                     points=${patch.points}
                     fill=${`url(#${patch.gradientId})`}
                     opacity=${patch.opacity}
                     filter=${model.blur > 0 ? `url(#${model.filterId})` : "none"}>
            </polygon>
          `,
        )}
      </g>
    </g>
  `;
}
