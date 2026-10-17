/**
 * Automatic room tints (`roomTints: auto`).
 *
 * A plan whose rooms have no colour of their own draws every one of them in
 * the same accent wash, so the eye has nothing to tell one room from the next.
 * With the option on, each room without a `color` gets a soft tint from a short
 * built-in palette instead — chosen so that rooms sharing a wall never share a
 * tint, and so that the same room keeps the same tint from one load to the
 * next.
 *
 * ## How a room's tint is picked
 *
 * A pure id hash would be stable but blind: two neighbours hash to the same
 * tint one time in eight, and on a plan of a dozen rooms that is nearly
 * certain to happen somewhere. A plain greedy colouring would avoid that, but
 * hands out tint 1, 2, 3 in order, so a room added with an early id reshuffles
 * every room after it.
 *
 * {@link assignRoomTints} does both: rooms are visited in id order, each one
 * *prefers* the tint its id hashes to, and takes the next free one round the
 * palette only if an already-tinted neighbour holds it. A room's tint
 * therefore depends only on its own id and its neighbours'. Adding a room on
 * the far side of the plan changes nothing; adding one beside an existing room
 * can only move rooms it touches (and then only those visited after it).
 *
 * ## Light and dark
 *
 * Each tint has two values, for light and dark paper — the same name a shade
 * darker on white and a shade lighter on near-black, so both read at the same
 * low opacity. The card picks the side from Home Assistant's dark mode, or from
 * a skin that is always dark ({@link Skin.scheme}).
 *
 * The fill is a `var()` chain so the tint stays overridable without new
 * plumbing: `--fp-room-tint-N` (a Home Assistant theme or card-mod), then a
 * palette entry named `Room tint N` (`--fp-color-room-tint-N`), then the
 * built-in value. The built-in value is written into the chain rather than
 * declared on `:host` because the two sides differ by scheme: switching dark
 * mode then changes the attribute string itself, which is what makes Chromium
 * repaint an SVG fill (see the keyed() note in floorplan-card.ts).
 */

import type { AreaPoint } from "./types";
import { findSkin } from "./skins";

export interface RoomTint {
  /** Stable name, used in docs and tests. */
  name: string;
  /** For light paper. */
  light: string;
  /** For dark paper. */
  dark: string;
}

/**
 * The built-in tints. Muted hues spread round the wheel, deliberately clear of
 * the saturated yellow/orange/red a `stateColor` rule or an active light uses,
 * so a live room still stands out from the resting ones around it.
 *
 * Order matters only as the order rooms fall back through; changing it moves
 * tints on saved plans.
 */
export const ROOM_TINTS: readonly RoomTint[] = [
  { name: "sage", light: "#5f9a68", dark: "#9fd8a8" },
  { name: "sky", light: "#3f86c4", dark: "#8ec8f2" },
  { name: "lilac", light: "#8c6cc0", dark: "#c8b0f2" },
  { name: "sand", light: "#b48a48", dark: "#e6c790" },
  { name: "teal", light: "#2f9a90", dark: "#7fdcd0" },
  { name: "rose", light: "#bf6a8a", dark: "#f2aac4" },
  { name: "slate", light: "#6a7c96", dark: "#b6c4da" },
  { name: "olive", light: "#8c9640", dark: "#d0d884" },
];

/**
 * Fill opacity for a tinted room that sets no `opacity` of its own. Lower than
 * the plain fill's 0.25: a tint is there to tell rooms apart, not to colour
 * the plan, and every room carries one.
 */
export const ROOM_TINT_OPACITY = 0.18;

/**
 * How far apart two parallel edges may sit and still count as one shared wall,
 * in canvas units. One wall's thickness: rooms drawn on the wall centreline
 * share the edge exactly, rooms drawn to the inside faces sit a wall apart.
 */
export const ROOM_TINT_WALL_GAP = 8;

/**
 * The shortest stretch two edges must run together to count as shared. Rooms
 * meeting only at a corner are not neighbours — as on any map, a corner does
 * not make two tints hard to tell apart.
 */
export const ROOM_TINT_MIN_SHARED = 4;

export type RoomTintsMode = "auto" | "off";
export type RoomTintScheme = "light" | "dark";

/** The mode a config renders with. Anything but `auto` is off, the default. */
export function roomTintsOf(c: { roomTints?: unknown } | undefined): RoomTintsMode {
  return c?.roomTints === "auto" ? "auto" : "off";
}

/**
 * Which side of each tint to draw: a skin that is always dark wins, otherwise
 * Home Assistant's dark mode. A frontend that does not say is light.
 */
export function roomTintScheme(
  hass: { themes?: { darkMode?: boolean } } | undefined,
  skin: unknown
): RoomTintScheme {
  const s = findSkin(skin)?.scheme;
  if (s) return s;
  return hass?.themes?.darkMode === true ? "dark" : "light";
}

/** The `fill` for tint `index` (0-based). Library constants only — safe to interpolate. */
export function roomTintFill(index: number, scheme: RoomTintScheme): string {
  const tint = ROOM_TINTS[((index % ROOM_TINTS.length) + ROOM_TINTS.length) % ROOM_TINTS.length]!;
  const n = ROOM_TINTS.indexOf(tint) + 1;
  return `var(--fp-room-tint-${n}, var(--fp-color-room-tint-${n}, ${tint[scheme]}))`;
}

/** FNV-1a, 32-bit. Small, stable, and spreads short ids like `area_a5r5nwl` well. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function finitePoints(points: unknown): AreaPoint[] {
  if (!Array.isArray(points)) return [];
  return points.filter(
    (p): p is AreaPoint =>
      !!p && Number.isFinite((p as AreaPoint).x) && Number.isFinite((p as AreaPoint).y)
  );
}

function inside(points: readonly AreaPoint[], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!;
    const b = points[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Whether edge p→q and edge r→s run along each other: r and s both within
 * `gap` of the line through p→q, and their projections onto it overlapping by
 * at least `minShared`.
 */
function edgesShared(
  p: AreaPoint,
  q: AreaPoint,
  r: AreaPoint,
  s: AreaPoint,
  gap: number,
  minShared: number
): boolean {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy);
  if (len < minShared) return false;
  const ux = dx / len;
  const uy = dy / len;
  const off = (pt: AreaPoint) => Math.abs((pt.x - p.x) * uy - (pt.y - p.y) * ux);
  if (off(r) > gap || off(s) > gap) return false;
  const along = (pt: AreaPoint) => (pt.x - p.x) * ux + (pt.y - p.y) * uy;
  const a = along(r);
  const b = along(s);
  const lo = Math.max(0, Math.min(a, b));
  const hi = Math.min(len, Math.max(a, b));
  return hi - lo >= minShared;
}

/**
 * Whether two room polygons are neighbours: they share a stretch of wall (see
 * {@link ROOM_TINT_WALL_GAP} and {@link ROOM_TINT_MIN_SHARED}), or one has a
 * vertex inside the other — an overlapping or nested room is as hard to tell
 * apart from its host as one beside it.
 */
export function areasAdjacent(
  a: readonly AreaPoint[],
  b: readonly AreaPoint[],
  gap = ROOM_TINT_WALL_GAP,
  minShared = ROOM_TINT_MIN_SHARED
): boolean {
  if (a.length < 2 || b.length < 2) return false;
  // Cheap reject on bounding boxes grown by the gap.
  const box = (pts: readonly AreaPoint[]) => ({
    x0: Math.min(...pts.map((p) => p.x)),
    y0: Math.min(...pts.map((p) => p.y)),
    x1: Math.max(...pts.map((p) => p.x)),
    y1: Math.max(...pts.map((p) => p.y)),
  });
  const ba = box(a);
  const bb = box(b);
  if (ba.x0 > bb.x1 + gap || bb.x0 > ba.x1 + gap || ba.y0 > bb.y1 + gap || bb.y0 > ba.y1 + gap) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = a[(i + 1) % a.length]!;
    for (let j = 0; j < b.length; j++) {
      if (edgesShared(p, q, b[j]!, b[(j + 1) % b.length]!, gap, minShared)) return true;
    }
  }
  // Overlap: a vertex well inside the other room. "Well" because a vertex on
  // the other's boundary is how two rooms meet at a corner, and ray casting
  // reads a boundary point either way.
  const deepIn = (poly: readonly AreaPoint[], pts: readonly AreaPoint[]) =>
    poly.length >= 3 &&
    pts.some((p) => inside(poly, p.x, p.y) && distanceToRing(poly, p) > gap);
  return deepIn(a, b) || deepIn(b, a);
}

function distanceToRing(poly: readonly AreaPoint[], p: AreaPoint): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * A tint index (0-based) for every room in `areas`, or `undefined` for a room
 * that has a `color` of its own — that room keeps it, and does not hold a tint
 * its neighbours must avoid.
 *
 * Deterministic: the result depends only on ids and geometry, never on the
 * order rooms appear in the config. See the file comment for the rule.
 */
export function assignRoomTints(
  areas: readonly { id?: unknown; points?: unknown; color?: unknown }[],
  count = ROOM_TINTS.length
): (number | undefined)[] {
  const out: (number | undefined)[] = areas.map(() => undefined);
  if (count < 1) return out;
  const rooms = areas
    .map((a, i) => ({
      i,
      key: typeof a.id === "string" ? a.id : "",
      pts: finitePoints(a.points),
      own: typeof a.color === "string" && a.color.trim() !== "",
    }))
    .filter((r) => !r.own);
  // Id order, so moving an entry in `areas:` changes nothing. Duplicate or
  // missing ids fall back to config order between themselves.
  rooms.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : x.i - y.i));

  const done: { pts: AreaPoint[]; tint: number }[] = [];
  for (const r of rooms) {
    const taken = new Set(
      done.filter((d) => areasAdjacent(r.pts, d.pts)).map((d) => d.tint)
    );
    const preferred = hash(r.key) % count;
    let tint = preferred;
    for (let k = 0; k < count; k++) {
      const t = (preferred + k) % count;
      if (!taken.has(t)) {
        tint = t;
        break;
      }
    }
    out[r.i] = tint;
    done.push({ pts: r.pts, tint });
  }
  return out;
}

/** What a tinted room rests at: the fill and opacity used when no live colour applies. */
export interface RoomTintPaint {
  color: string;
  opacity: number;
}

/**
 * The resting paint for every room on a floor, aligned with `areas`, or an
 * all-`undefined` list when tints are off. A room with its own `color` gets
 * `undefined`; a room with its own `opacity` keeps that opacity.
 */
export function roomTintPaints(
  areas: readonly { id?: unknown; points?: unknown; color?: unknown; opacity?: unknown }[],
  mode: RoomTintsMode,
  scheme: RoomTintScheme
): (RoomTintPaint | undefined)[] {
  if (mode !== "auto") return areas.map(() => undefined);
  const tints = assignRoomTints(areas);
  return areas.map((a, i) => {
    const t = tints[i];
    if (t === undefined) return undefined;
    return {
      color: roomTintFill(t, scheme),
      opacity: typeof a.opacity === "number" && Number.isFinite(a.opacity) ? a.opacity : ROOM_TINT_OPACITY,
    };
  });
}
