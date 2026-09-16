/**
 * Moving the zoom from room to room (issue #261).
 *
 * Zoom-to-room already existed: tap a room and the plan frames it (issue
 * #222). What it had no answer for was *stepping* — a wall tablet nobody is
 * standing at, or anyone without a pointer, since a room only becomes a tab
 * stop when it has been given an explicit action. So a room that merely zooms
 * could not be reached from a keyboard at all.
 *
 * This is the order and the arithmetic, kept away from the card: which rooms
 * the focus visits, and which one comes next. The card owns the state and the
 * timer, and the existing `.plan-zoom` transition animates the move for free —
 * in the isometric view as well, where the zoom already frames a room where it
 * is drawn rather than where it sits on the flat plan.
 */

/** Seconds. Below this a dwell reads as a flicker rather than a look. */
export const MIN_FOCUS_INTERVAL = 2;
/** Ten minutes: past this it is not a cycle, it is a screensaver. */
export const MAX_FOCUS_INTERVAL = 600;

export interface RoomFocusSettings {
  /** Show the previous/next controls on the card. */
  controls: boolean;
  /** Dwell per room in milliseconds; 0 means it only ever moves when asked. */
  intervalMs: number;
  /** Explicit visiting order by area id. Absent visits every room as drawn. */
  rooms?: string[];
}

/**
 * Coerce the `roomFocus` config. `true` is the plain case — controls, no
 * cycling — and anything unusable switches the whole feature off rather than
 * half-enabling it.
 */
export function normalizeRoomFocus(v: unknown): RoomFocusSettings | undefined {
  if (v === true) return { controls: true, intervalMs: 0 };
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const raw = v as { controls?: unknown; interval?: unknown; rooms?: unknown };
  const controls = raw.controls === undefined ? true : !!raw.controls;
  const seconds = typeof raw.interval === "number" || typeof raw.interval === "string"
    ? Number(raw.interval)
    : NaN;
  const intervalMs = Number.isFinite(seconds) && seconds > 0
    ? Math.min(Math.max(seconds, MIN_FOCUS_INTERVAL), MAX_FOCUS_INTERVAL) * 1000
    : 0;
  const rooms = Array.isArray(raw.rooms)
    ? raw.rooms.filter((r): r is string => typeof r === "string" && r !== "")
    : undefined;
  // Controls off and nothing cycling would leave a feature that does nothing.
  if (!controls && intervalMs === 0) return undefined;
  return { controls, intervalMs, ...(rooms?.length ? { rooms } : {}) };
}

/**
 * The rooms the focus visits, in order.
 *
 * A named order keeps only the rooms that exist, so renaming or deleting a
 * room degrades to a shorter tour rather than a focus that lands on nothing.
 * Unnamed, it follows the floor's own order, which is the order they were
 * drawn in — and the order the editor lists them in.
 */
export function focusOrder(
  areas: readonly { id: string }[] | undefined,
  settings: RoomFocusSettings | undefined
): string[] {
  if (!settings || !areas?.length) return [];
  const present = new Set(areas.map((a) => a.id));
  if (settings.rooms) return settings.rooms.filter((id) => present.has(id));
  return areas.map((a) => a.id);
}

/**
 * The room after `current`, wrapping at the ends.
 *
 * From nowhere — the unzoomed plan — forwards lands on the first room and
 * backwards on the last, so either control is a way *in* as well as a way
 * along. A room that is no longer in the order (its floor changed under it)
 * is treated as nowhere rather than throwing the tour off.
 */
export function stepFocus(
  order: readonly string[],
  current: string | undefined,
  step: 1 | -1
): string | undefined {
  if (!order.length) return undefined;
  const at = current === undefined ? -1 : order.indexOf(current);
  if (at < 0) return step === 1 ? order[0] : order[order.length - 1];
  return order[(at + step + order.length) % order.length];
}
