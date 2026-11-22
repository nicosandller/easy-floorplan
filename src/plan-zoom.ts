/**
 * Free zoom and pan (issue #446): the "+"/"−" buttons, dragging the plan
 * around while it is zoomed, and Ctrl+wheel.
 *
 * Everything here works on the same `translate(%) scale()` pair that
 * zoom-to-room produces ({@link AreaZoomTransform}), so a free view can start
 * from a room's framing and the wrapper, the overlay counter-scale and the
 * zoom-out button all keep reading one value.
 *
 * Rotation needs no maths of its own. The wrapper the transform lands on sits
 * outside the SVG's rotation group, and zoom-to-room rotates a room's points
 * before framing it, so the translate is already in display space: a finger
 * moving right moves the plan right whatever the plan's rotation.
 */
import { IDENTITY_ZOOM, type AreaZoomTransform } from "./render";
import { MAX_AREA_ZOOM } from "./types";

/** One press of "+" multiplies the zoom by this; "−" divides by it. */
export const ZOOM_STEP = 1.5;
/** The closest the free zoom goes: the same ceiling a room's own zoom has. */
export const MAX_PLAN_ZOOM = MAX_AREA_ZOOM;
/**
 * How far (px) a pointer may wander before the press stops being a tap and
 * becomes a pan. Below it, the press reaches the device or room underneath
 * exactly as it does on an unzoomed plan.
 */
export const PAN_THRESHOLD_PX = 6;
/** Treat a scale this close to 1 as the whole plan, so float drift cannot leave a 1.0000001 zoom with a live zoom-out button. */
const WHOLE_PLAN_EPSILON = 1e-3;

/** True when the view shows the whole plan (nothing to pan, nothing to zoom out of). */
export function isWholePlan(v: AreaZoomTransform): boolean {
  return !(v.scale > 1 + WHOLE_PLAN_EPSILON);
}

/**
 * Clamp a view: the scale to 1..`max`, and the pan so the plan's own edge
 * never moves inside the visible box — the same rule zoom-to-room uses, so a
 * dragged plan stops where a room framed near that corner would. At the whole
 * plan the pan range collapses to exactly 0. A non-finite value anywhere
 * falls back to the whole plan rather than reaching the style sink.
 */
export function clampView(v: AreaZoomTransform, max = MAX_PLAN_ZOOM): AreaZoomTransform {
  if (![v.scale, v.txPercent, v.tyPercent, max].every(Number.isFinite)) return IDENTITY_ZOOM;
  const scale = Math.min(Math.max(1, max), Math.max(1, v.scale));
  if (isWholePlan({ ...v, scale })) return IDENTITY_ZOOM;
  const clamp = (t: number) => Math.min(0, Math.max(100 * (1 - scale), t));
  return { scale, txPercent: clamp(v.txPercent), tyPercent: clamp(v.tyPercent) };
}

/**
 * Multiply the zoom by `factor`, keeping the point at (`fx`, `fy`) — fractions
 * of the visible plan box — where it is on screen. The buttons zoom about the
 * centre; the wheel about the cursor.
 */
export function zoomAt(
  v: AreaZoomTransform,
  factor: number,
  fx = 0.5,
  fy = 0.5,
  max = MAX_PLAN_ZOOM
): AreaZoomTransform {
  if (!Number.isFinite(factor) || factor <= 0) return clampView(v, max);
  const from = clampView(v, max);
  const scale = Math.min(Math.max(1, max), Math.max(1, from.scale * factor));
  // The plan point under (fx, fy), in percent of the plan, before the change...
  const px = (fx * 100 - from.txPercent) / from.scale;
  const py = (fy * 100 - from.tyPercent) / from.scale;
  // ...and the translate that puts it back under (fx, fy) after it.
  return clampView({ scale, txPercent: fx * 100 - scale * px, tyPercent: fy * 100 - scale * py }, max);
}

/** One press of "+" (`1`) or "−" (`-1`), about the centre of the view. */
export function stepZoom(v: AreaZoomTransform, dir: 1 | -1, max = MAX_PLAN_ZOOM): AreaZoomTransform {
  return zoomAt(v, dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP, 0.5, 0.5, max);
}

/**
 * Move the view by a pointer delta in screen pixels, measured against the
 * visible plan box (`boxW` × `boxH`, the untransformed `.plan`). The plan
 * follows the pointer: dragging right shows more of the left of the plan.
 */
export function panBy(
  v: AreaZoomTransform,
  dxPx: number,
  dyPx: number,
  boxW: number,
  boxH: number,
  max = MAX_PLAN_ZOOM
): AreaZoomTransform {
  if (!(boxW > 0 && boxH > 0) || isWholePlan(v)) return clampView(v, max);
  return clampView(
    { scale: v.scale, txPercent: v.txPercent + (dxPx / boxW) * 100, tyPercent: v.tyPercent + (dyPx / boxH) * 100 },
    max
  );
}

/** Whether a press has moved far enough to be a pan rather than a tap. */
export function pastPanThreshold(dxPx: number, dyPx: number, threshold = PAN_THRESHOLD_PX): boolean {
  return Math.hypot(dxPx, dyPx) >= threshold;
}

/**
 * The zoom factor for one wheel event. Pixel deltas from a trackpad pinch
 * (which Chromium and Firefox report as Ctrl+wheel) are small and many; a
 * mouse notch is ~100px or one line. Each event is capped at one button step
 * so a fast notch cannot jump the whole range.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY)) return 1;
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY;
  const f = Math.exp(-px * 0.004);
  return Math.min(ZOOM_STEP, Math.max(1 / ZOOM_STEP, f));
}
