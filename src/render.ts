import { svg, html, nothing, type SVGTemplateResult, type TemplateResult } from "lit";
import type {
  FloorplanCardConfig,
  Floor,
  SectionalHand,
  Opening,
  ItemKind,
  IconAnimation,
  StateColorRule,
  BadgeContent,
  BadgeEntity,
  PressEffect,
  Furniture,
  Tracker,
  Area,
  AreaPoint,
  Wall,
  RenderHass,
  HassEntity,
  FloorItem,
} from "./types";
import {
  FURNITURE_COLOR,
  DEFAULT_TRACKER_DOT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_AREA_OPACITY,
  DEFAULT_AREA_BORDER_WIDTH,
  SUN_ELEVATION_NIGHT,
  SUN_ELEVATION_DAY,
  DEFAULT_SUN_MIN,
  DEFAULT_SUN_MAX,
  DEFAULT_GLOW_RADIUS,
  DEFAULT_GLOW_COLOR,
  DEFAULT_ITEM_SIZE,
  GLOW_MIN_OPACITY,
  GLOW_MAX_OPACITY,
  GLOW_MIN_RADIUS,
  DEFAULT_PRESS_EFFECT,
  BADGE_MIN_LIGHTNESS,
  FURNITURE_GLOW_TRANSMISSION,
  getFloors,
  trackerAxisFraction,
} from "./types";
import { cssColor, cssColorOr, cssNumber, cssIdent, cssEntityId, cssIcon } from "./css-safe";
import { SKIN_ACCENT, SKIN_PAPER, SKIN_WALL } from "./skins";
// The same tolerance #141 uses to decide an opening sits on a wall, so "this
// door is in this wall" means one thing across the card.
import { OPENING_ON_WALL_EPS } from "./dead-space";

export const WALL_THICKNESS = 8;

/** Shown in place of a reading when an entity is unset or absent from `hass`. */
const NO_STATE = "—";

/**
 * An entity's state as HA itself would render it, or "—" when there is none.
 *
 * A state carries the sensor's full precision; the decimals to display live in
 * the entity registry, as do the locale's number format, the blank before a
 * unit, and the wording of `unavailable`. Only HA can resolve all of that.
 */
export function entityStateText(
  hass: RenderHass | undefined,
  entityId: string | undefined,
): string {
  if (!entityId || !hass) return NO_STATE;
  const stateObj = hass.states[entityId];
  if (!stateObj) return NO_STATE;
  return hass.formatEntityState(stateObj);
}

/**
 * Whether a fresh `hass` can change anything this plan draws.
 *
 * Readings are worded by `hass.formatEntityState`, which HA rebuilds — as a new
 * function, on a later tick — whenever the registry, locale, translations or
 * config change. Its identity is the signal that arrives *with* the new
 * wording; watching the registry instead would render while the formatter is
 * still the old one, then skip the update that carries the new one.
 */
export function hassRenderInputsChanged(
  prev: RenderHass,
  next: RenderHass,
  watchedEntities: Iterable<string>,
): boolean {
  if (prev.formatEntityState !== next.formatEntityState) return true;
  for (const id of watchedEntities) {
    if (prev.states[id] !== next.states[id]) return true;
  }
  return false;
}

/** Every entity id whose state can change what a plan draws (all floors). */
export function collectWatchedEntities(c: FloorplanCardConfig): Set<string> {
  const ids = new Set<string>();
  // Sun dimming (issue #113) reads sun.sun's elevation. Miss this and the
  // plan is lit once and then frozen at whatever the sun was doing when the
  // card loaded — the same trap entity-bound furniture (#82) and areas (#6)
  // each fell into. HA replaces the state object when the attribute moves,
  // so identity comparison in hassRenderInputsChanged catches it.
  if (c.sunDimming) ids.add("sun.sun");
  for (const f of getFloors(c)) {
    for (const o of f.openings) {
      if (o.entity) ids.add(o.entity);
      if (o.shutterEntity) ids.add(o.shutterEntity);
    }
    for (const it of f.items) {
      if (it.entity) ids.add(it.entity);
      if (it.secondaryEntity) ids.add(it.secondaryEntity);
    }
    // Entity-bound furniture (issue #82) — without this the card never
    // re-renders when the soil sensor moves, and the plant stays its
    // first-painted color forever.
    for (const fu of f.furniture) {
      if (fu.entity) ids.add(fu.entity);
    }
    // Entity-bound areas (issue #6) — same reasoning as furniture above: miss
    // these and a room's color is painted once and then frozen, because
    // shouldUpdate drops every hass tick that only moved an unwatched entity.
    for (const a of f.areas) {
      if (a.entity) ids.add(a.entity);
    }
    for (const tr of f.trackers) {
      for (const s of [tr.xSensor, tr.ySensor]) {
        if (s?.entity) ids.add(s.entity);
        if (s?.presence?.entity) ids.add(s.presence.entity);
      }
    }
  }
  return ids;
}

/**
 * An entity attribute's value as HA would render it, or "—" when there is
 * none (issue #70). Uses HA's `formatEntityAttributeValue` when the running
 * frontend provides it (2023.9+); otherwise the raw value, stringified.
 */
export function entityAttributeText(
  hass: RenderHass | undefined,
  entityId: string | undefined,
  attribute: string,
): string {
  if (!entityId || !hass) return NO_STATE;
  const stateObj = hass.states[entityId];
  if (!stateObj) return NO_STATE;
  const fmt = (hass as { formatEntityAttributeValue?: (s: unknown, a: string) => string })
    .formatEntityAttributeValue;
  if (typeof fmt === "function") return fmt(stateObj, attribute);
  const raw = (stateObj.attributes as Record<string, unknown>)?.[attribute];
  return raw === undefined || raw === null || raw === "" ? NO_STATE : String(raw);
}

/**
 * State text for an item: primary reading (state, or `attribute` of the
 * entity — issue #70), plus a secondary one when configured. The secondary
 * reading comes from `secondaryEntity` when set, else from the same entity —
 * so one climate device can show `21.5 °C · 45%` from two attributes.
 */
export function itemStateText(
  hass: RenderHass | undefined,
  item: {
    entity: string;
    attribute?: string;
    secondaryEntity?: string;
    secondaryAttribute?: string;
  },
): string {
  const primary = item.attribute
    ? entityAttributeText(hass, item.entity, item.attribute)
    : entityStateText(hass, item.entity);
  const secondaryEntity = item.secondaryEntity ?? (item.secondaryAttribute ? item.entity : undefined);
  if (!secondaryEntity) return primary;
  const secondary = item.secondaryAttribute
    ? entityAttributeText(hass, secondaryEntity, item.secondaryAttribute)
    : entityStateText(hass, secondaryEntity);
  return `${primary} · ${secondary}`;
}

/**
 * The colour for a value (issues #68, #79, #82), or undefined for "use the
 * theme default". Precedence:
 *
 * 1. an exact `state` match (case-insensitive) — a cover "open", a light "on";
 * 2. otherwise the highest matching `above` threshold;
 * 3. otherwise the default rule (neither `above` nor `state`).
 *
 * A `state` rule is checked against the raw value stringified, so `state: "on"`
 * works for a boolean-ish reading too. Non-numeric values (a climate saying
 * "heat") never match an `above` rule. The returned color is config-supplied —
 * callers MUST pass it through cssColor/cssColorOr before it reaches a style
 * attribute.
 */
export function resolveStateColor(
  rules: readonly StateColorRule[] | undefined,
  raw: unknown,
): string | undefined {
  return matchStateRule(rules, raw)?.color;
}

/**
 * The rule that applies to a value, by the precedence documented on
 * {@link resolveStateColor} — which is now a one-line wrapper around this.
 *
 * Split out for issue #106: a rule can carry an `icon` as well as a `color`,
 * and both must come from the *same* matched rule. Re-running the precedence
 * once per property would be two chances to drift apart, and would quietly
 * allow one rule's colour beside another rule's icon.
 */
export function matchStateRule(
  rules: readonly StateColorRule[] | undefined,
  raw: unknown,
): StateColorRule | undefined {
  if (!rules?.length) return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  const numeric = typeof raw !== "boolean" && raw !== "" && raw != null && Number.isFinite(n);
  const text = raw == null ? "" : String(raw).trim().toLowerCase();
  let exact: StateColorRule | undefined;
  let best: StateColorRule | undefined;
  let fallback: StateColorRule | undefined;
  for (const rule of rules) {
    if (!rule || typeof rule !== "object" || typeof rule.color !== "string") continue;
    if (typeof rule.state === "string" && rule.state !== "") {
      // First matching state rule wins, so an earlier rule shadows a later
      // duplicate — the same "first one listed" reading as the default rule.
      if (exact === undefined && text !== "" && rule.state.trim().toLowerCase() === text) {
        exact = rule;
      }
    } else if (typeof rule.above === "number") {
      if (numeric && n > rule.above && (!best || rule.above > (best.above ?? -Infinity))) {
        best = rule;
      }
    } else if (fallback === undefined) {
      fallback = rule;
    }
  }
  return exact ?? best ?? fallback;
}

/**
 * The color a piece of furniture should draw in (issue #82), or undefined to
 * keep its configured/static color. Rules first, then the active color while
 * the entity is on — so a plant can go red below 50% moisture, and a cabinet
 * with a contact sensor can go amber while its door is open.
 *
 * Returns a value already through the style-injection allowlist (#64), because
 * it flows straight into `stroke`/`fill` attributes.
 */
export function furnitureColor(f: Furniture, state: string | undefined): string | undefined {
  if (!f.entity) return undefined;
  const rule = resolveStateColor(f.stateColor, state);
  if (rule) return cssColor(rule);
  if (f.activeColor && entityIsActive(f.entity, state)) return cssColor(f.activeColor);
  return undefined;
}

/**
 * Resolve the live fill color for an {@link Area} bound to an entity (issue #6),
 * mirroring {@link furnitureColor}: `stateColor` rules win, then `activeColor`
 * while the entity is active, else undefined so the static `color` applies.
 *
 * Returns a value already through the style-injection allowlist (#64), because
 * it flows straight into a `fill` attribute.
 */
export function areaColor(a: Area, state: string | undefined): string | undefined {
  if (!a.entity) return undefined;
  const rule = resolveStateColor(a.stateColor, state);
  if (rule) return cssColor(rule);
  if (a.activeColor && entityIsActive(a.entity, state)) return cssColor(a.activeColor);
  return undefined;
}

/** The light a device casts right now: a color and how strong at the center. */
export interface GlowPaint {
  /** Already through the style-injection allowlist (#64). */
  color: string;
  /** Opacity at the center of the pool, fading to 0 at the rim. */
  opacity: number;
  /**
   * How far the pool actually reaches, in canvas units (issue #123): the
   * configured `glowRadius` scaled by the lamp's brightness.
   *
   * Carried on the paint rather than recomputed by each caller so the pool and
   * the sun-dimming clearing cannot disagree about the same lamp's size — they
   * are documented as the same shape by construction, and two copies of this
   * arithmetic is exactly how that stops being true.
   */
  radius: number;
}

/**
 * What a light contributes as a cast pool (issue #6), or undefined for "casts
 * nothing".
 *
 * Lights vary in what they can report, so this degrades in rungs rather than
 * demanding `rgb_color` and doing nothing without it — on a real install most
 * lights are brightness-only or plain on/off switches:
 *
 * 1. **color-capable** — its own `rgb_color`. Home Assistant derives one even
 *    for `color_temp`-only bulbs, so warm white still reads as amber.
 * 2. **brightness-only** — `glowColor` (a warm white by default), with
 *    `brightness` driving the strength.
 * 3. **on/off-only** — `glowColor` at full strength.
 *
 * A light that is off, `unavailable` or `unknown` casts nothing — failing
 * closed like every other state reader here, so a dead bulb never leaves a
 * pool of light lying on the floor.
 *
 * Brightness drives the pool's **reach** as well as its strength (issue #123):
 * dimming a lamp draws the light in rather than only thinning it, which is what
 * dimming actually looks like. The configured `glowRadius` is the full-brightness
 * size, so nothing changes for a lamp at 100% or for a bulb that reports no
 * brightness at all.
 */
export function glowPaint(
  item: Pick<FloorItem, "glowColor" | "glowRadius">,
  light: HassEntity | undefined,
): GlowPaint | undefined {
  if (!light || light.state !== "on") return undefined;
  const attrs = (light.attributes ?? {}) as Record<string, unknown>;

  // brightness is 0-255, and absent on on/off-only lights where "on" is full.
  const raw = attrs.brightness;
  const bright =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(255, raw)) : undefined;
  const opacity =
    bright === undefined
      ? GLOW_MAX_OPACITY
      : GLOW_MIN_OPACITY + (GLOW_MAX_OPACITY - GLOW_MIN_OPACITY) * (bright / 255);
  // Same shape as the opacity band above, and a floor for the same reason: a
  // lamp dimmed to 10% should read as dim, not as switched off.
  const radius =
    cssNumber(item.glowRadius, DEFAULT_GLOW_RADIUS) *
    (bright === undefined ? 1 : GLOW_MIN_RADIUS + (1 - GLOW_MIN_RADIUS) * (bright / 255));

  const rgb = attrs.rgb_color;
  if (Array.isArray(rgb) && rgb.length >= 3) {
    const [r, g, b] = rgb;
    if ([r, g, b].every((c) => typeof c === "number" && Number.isFinite(c))) {
      const chan = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
      // Built from clamped integers, so it cannot carry a payload — but it
      // still goes through the allowlist, as every color here does.
      const color = cssColor(`rgb(${chan(r as number)}, ${chan(g as number)}, ${chan(b as number)})`);
      if (color) return { color, opacity, radius };
    }
  }
  return { color: cssColorOr(item.glowColor, DEFAULT_GLOW_COLOR), opacity, radius };
}

/**
 * The colour a light's **badge** should wear (issue #106, @ombre33): its own
 * `rgb_color`, darkened toward black in step with `brightness`, or `undefined`
 * to leave the badge exactly as it is today.
 *
 * Deliberately *not* {@link glowPaint}, which looks almost identical. That one
 * falls back to `glowColor` / {@link DEFAULT_GLOW_COLOR} so a pool always has a
 * colour to cast; reusing it here would turn every plain on/off bulb's badge
 * warm amber — a look change on installs that never asked for one. Only a
 * light that genuinely reports a colour changes appearance.
 *
 * Brightness scales the channels rather than the alpha on purpose: a
 * translucent badge composites against the *plan* behind it, so the same lamp
 * would read differently over a dark room than over a light one.
 */
export function lightBadgePaint(light: HassEntity | undefined): string | undefined {
  if (!light || light.state !== "on") return undefined;
  const attrs = (light.attributes ?? {}) as Record<string, unknown>;
  const rgb = attrs.rgb_color;
  if (!Array.isArray(rgb) || rgb.length < 3) return undefined;
  const [r, g, b] = rgb;
  if (![r, g, b].every((c) => typeof c === "number" && Number.isFinite(c))) return undefined;

  const raw = attrs.brightness;
  const bright =
    typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.min(255, raw)) : undefined;
  const factor =
    bright === undefined
      ? 1
      : BADGE_MIN_LIGHTNESS + (1 - BADGE_MIN_LIGHTNESS) * (bright / 255);

  const chan = (c: number) => Math.max(0, Math.min(255, Math.round((c as number) * factor)));
  // Built from clamped integers, so it cannot carry a payload — but it still
  // goes through the allowlist, as every colour here does.
  return cssColor(`rgb(${chan(r as number)}, ${chan(g as number)}, ${chan(b as number)})`);
}

/**
 * {@link glowPaint} as the **editor** should apply it (issue #108).
 *
 * The editor must trust the entity when there is one — an off light draws
 * nothing, exactly as on the card. Only a glow with no readable state at all
 * (no hass, or an entity hass does not know) previews lit, so the feature is
 * still visible outside Home Assistant. v1.1.0 shipped the fallback applied
 * unconditionally, and every off light washed the canvas at full strength.
 */
export function editorGlowPaint(
  item: Pick<FloorItem, "glowColor" | "glowRadius">,
  state: HassEntity | undefined,
): GlowPaint | undefined {
  if (state) return glowPaint(item, state);
  return {
    color: cssColorOr(item.glowColor, DEFAULT_GLOW_COLOR),
    opacity: GLOW_MAX_OPACITY,
    radius: cssNumber(item.glowRadius, DEFAULT_GLOW_RADIUS),
  };
}

/**
 * A light's cast pool: a radial gradient fading from `paint.color` at the
 * device's position to fully transparent at `glowRadius`.
 *
 * Each pool carries `mix-blend-mode: screen` so overlapping lights **add**
 * rather than the topmost one winning — two lamps in one room brighten where
 * they meet, and a warm and a cool lamp blend between them, which is how real
 * light behaves. The caller must isolate the layer (see `.fp-glows` in the
 * card) so the pools mix with each other and not with the plan beneath.
 */
/** Perpendicular distance from a point to a wall segment. */
function pointWallDist(x: number, y: number, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / len2));
  const px = w.x1 + t * dx;
  const py = w.y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

/** Distance along a ray from (cx,cy) toward (dx,dy) to a segment, or undefined. */
function rayWallHit(cx: number, cy: number, dx: number, dy: number, w: Wall): number | undefined {
  const sx = w.x2 - w.x1;
  const sy = w.y2 - w.y1;
  const denom = dx * sy - dy * sx;
  if (Math.abs(denom) < 1e-12) return undefined; // parallel
  const qx = w.x1 - cx;
  const qy = w.y1 - cy;
  const t = (qx * sy - qy * sx) / denom; // along the ray
  const u = (qx * dy - qy * dx) / denom; // along the wall
  if (t <= 1e-9 || u < 0 || u > 1) return undefined;
  return t;
}

/**
 * Clip a segment to an axis-aligned box (Liang–Barsky), or undefined when it
 * falls entirely outside. Used by {@link glowReach} — see the note there on
 * why the sweep needs the clipped wall rather than the configured one.
 */
function clipWallToBox(
  w: Wall,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Wall | undefined {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const p = [-dx, dx, -dy, dy];
  const q = [w.x1 - minX, maxX - w.x1, w.y1 - minY, maxY - w.y1];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return undefined; // parallel to this edge and outside it
      continue;
    }
    const t = q[i] / p[i];
    if (p[i] < 0) {
      if (t > t1) return undefined;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return undefined;
      if (t < t1) t1 = t;
    }
  }
  return {
    ...w,
    x1: w.x1 + t0 * dx,
    y1: w.y1 + t0 * dy,
    x2: w.x1 + t1 * dx,
    y2: w.y1 + t1 * dy,
  };
}

/**
 * How far a light at (cx,cy) actually reaches (issue #108): the visibility
 * polygon of the walls that fall inside its radius, so a pool stops at a wall
 * instead of washing into the next room. Classic angular sweep — a ray toward
 * each wall endpoint (and just past it, so light grazes corners), cut at the
 * nearest wall it hits; a bounding box just beyond the radius keeps every ray
 * finite, and the circle itself still bounds the final shape.
 *
 * **Blocking walls are clipped to that box first (issue #123).** The sweep's
 * only vertices are the angles of the segment endpoints it is given, and the
 * boundary between two of them is drawn as a straight chord. An ordinary room
 * wall runs well past the pool, so its *declared* endpoints sit outside the
 * box at the wrong angle entirely, and no ray is ever cast where the wall
 * actually enters the lit region — the point where the boundary hands over
 * from the box to the wall. The chord spanning that gap sliced a wedge out of
 * the pool beside every long wall: the reported artifact. Clipping makes the
 * wall's endpoints *be* those hand-over points, so the sweep samples them.
 * A wall already inside the box is unchanged, which is why short walls never
 * showed this.
 *
 * The wall the lamp is mounted on must not black out its own pool, so walls
 * closer than one wall thickness are treated as non-blocking. Returns
 * undefined when no wall is in reach — the common case, drawn as the plain
 * circle with no clip at all.
 */
/**
 * The walls as **light** meets them (issue #143): the plan's walls with a gap
 * cut wherever an opening is currently open.
 *
 * Walls and openings are stored independently — an opening is a rect that sits
 * *on* a wall, and the wall layer only appears cut because {@link renderWallMask}
 * punches the pixels out. {@link glowReach} was handed the uncut segments, so a
 * pool stopped dead at a doorway that the plan draws as a hole. As the reporter
 * put it: doors acted as walls regardless of open/closed status.
 *
 * The rule is that **light agrees with the picture** — it passes exactly where
 * the plan shows a gap. That falls out of using the same `amount` the leaf is
 * drawn from, so a closed door still blocks, a door opening on its sensor lets
 * light through as it swings, and an unbound door — which this card draws open,
 * with its swing arc — lights the room beyond it without anything to configure.
 * A window behaves the same way: shut it blocks, open it spills light outside,
 * which is what an open window does.
 *
 * The gap is `length * amount`, centred. A half-open slider really clears one
 * side rather than the middle, but the pool is a soft radial wash and centring
 * keeps this to one interval per opening instead of a handed special case.
 */
export function wallsLightPassesThrough(
  walls: readonly Wall[],
  openings: readonly Opening[],
  openAmount: (o: Opening) => number,
): Wall[] {
  // Resolve each opening once, not once per wall. `openAmount` reads hass on
  // every call, and asking it inside the wall loop made that walls × openings
  // state lookups per render — hundreds, on a plan of any size, to answer the
  // same handful of questions.
  const open: Array<{ o: Opening; amount: number }> = [];
  for (const o of openings) {
    const amount = Math.max(0, Math.min(1, openAmount(o)));
    if (amount > 0) open.push({ o, amount });
  }
  // Nothing open is the common case — a plan of shut doors, or one with no
  // openings at all. Hand back the same array, so a caller can compare
  // identity to know the light sees exactly the walls it always did.
  if (!open.length) return walls as Wall[];

  const out: Wall[] = [];
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      out.push(w);
      continue;
    }
    const len = Math.sqrt(len2);

    // Where each open opening sits along this wall, as a [0,1] interval.
    const gaps: Array<[number, number]> = [];
    for (const { o, amount } of open) {
      // Openings snap onto walls, but they are stored free of them, so an
      // opening belongs to this wall only if it actually lies on it.
      if (pointWallDist(o.x, o.y, w) > OPENING_ON_WALL_EPS) continue;
      const tc = ((o.x - w.x1) * dx + (o.y - w.y1) * dy) / len2;
      const half = (o.length * amount) / 2 / len;
      const a = Math.max(0, tc - half);
      const b = Math.min(1, tc + half);
      if (b > a) gaps.push([a, b]);
    }
    if (!gaps.length) {
      out.push(w);
      continue;
    }

    // Merge overlapping gaps, then keep what is left of the wall between them.
    gaps.sort((p, q) => p[0] - q[0]);
    const merged: Array<[number, number]> = [gaps[0]!];
    for (const g of gaps.slice(1)) {
      const last = merged[merged.length - 1]!;
      if (g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
      else merged.push(g);
    }
    const at = (t: number) => ({ x: w.x1 + dx * t, y: w.y1 + dy * t });
    let cursor = 0;
    let piece = 0;
    const emit = (t0: number, t1: number) => {
      // Sub-wall-thickness slivers block nothing you could see and only cost
      // the sweep rays.
      if ((t1 - t0) * len < WALL_THICKNESS / 2) return;
      const p0 = at(t0);
      const p1 = at(t1);
      out.push({ id: `${w.id}#${piece++}`, x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y });
    };
    for (const [a, b] of merged) {
      emit(cursor, a);
      cursor = b;
    }
    emit(cursor, 1);
  }
  return out;
}

export function glowReach(
  cx: number,
  cy: number,
  r: number,
  walls: readonly Wall[],
): Array<{ x: number; y: number }> | undefined {
  const blocking = walls.filter((w) => {
    const d = pointWallDist(cx, cy, w);
    return d < r && d > WALL_THICKNESS;
  });
  if (!blocking.length) return undefined;
  const m = r * 1.01;
  const bounds: Wall[] = [
    { id: "b1", x1: cx - m, y1: cy - m, x2: cx + m, y2: cy - m },
    { id: "b2", x1: cx + m, y1: cy - m, x2: cx + m, y2: cy + m },
    { id: "b3", x1: cx + m, y1: cy + m, x2: cx - m, y2: cy + m },
    { id: "b4", x1: cx - m, y1: cy + m, x2: cx - m, y2: cy - m },
  ];
  // Trim each wall to the swept region so its endpoints land where it enters
  // that region — those are the silhouette vertices the sweep has to sample.
  const clipped = blocking
    .map((w) => clipWallToBox(w, cx - m, cy - m, cx + m, cy + m))
    .filter((w): w is Wall => w !== undefined);
  if (!clipped.length) return undefined;
  const all = [...clipped, ...bounds];
  const pts: Array<{ x: number; y: number; a: number }> = [];
  for (const s of all) {
    for (const [ex, ey] of [
      [s.x1, s.y1],
      [s.x2, s.y2],
    ]) {
      const base = Math.atan2(ey - cy, ex - cx);
      for (const a of [base - 1e-4, base, base + 1e-4]) {
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        let best = Infinity;
        for (const seg of all) {
          const t = rayWallHit(cx, cy, dx, dy, seg);
          if (t !== undefined && t < best) best = t;
        }
        if (best < Infinity) {
          pts.push({ x: cx + dx * best, y: cy + dy * best, a });
        }
      }
    }
  }
  pts.sort((p, q) => p.a - q.a);
  const round = (v: number) => Math.round(v * 100) / 100;
  return pts.map(({ x, y }) => ({ x: round(x), y: round(y) }));
}

export function renderGlow(
  item: FloorItem,
  paint: GlowPaint,
  gradientId: string,
  walls?: readonly Wall[],
): SVGTemplateResult {
  // Brightness-scaled (issue #123), computed once on the paint so the pool and
  // the sun-dimming clearing are the same size for the same lamp.
  const r = paint.radius;
  // Walls block light (issue #108): clip the pool to what the lamp can see.
  const reach = walls?.length ? glowReach(item.x, item.y, r, walls) : undefined;
  const clipId = `${gradientId}-clip`;
  return svg`
    ${
      reach
        ? svg`<clipPath id=${clipId}>
                <polygon points=${reach.map((p) => `${p.x},${p.y}`).join(" ")} />
              </clipPath>`
        : nothing
    }
    <radialGradient id=${gradientId} gradientUnits="userSpaceOnUse"
                    cx=${item.x} cy=${item.y} r=${r}>
      <stop offset="0" stop-color=${paint.color} stop-opacity=${paint.opacity} />
      <stop offset="1" stop-color=${paint.color} stop-opacity="0" />
    </radialGradient>
    <circle class="fp-glow" cx=${item.x} cy=${item.y} r=${r}
            fill=${`url(#${gradientId})`}
            clip-path=${reach ? `url(#${clipId})` : nothing} />`;
}

/**
 * A `<mask>` for the sun-dimming layer that lets lit rooms hold back the night
 * (issue #113).
 *
 * The dim is one flat black rect, and a flat overlay multiplies the *whole*
 * image — including the contrast between a lit room and an unlit one. Measured
 * on the unmasked build, a lamp's pool read at 45% of its daytime contrast
 * after dark, i.e. exactly `1 - dimOpacity`: lamps became *less* visible at
 * night, the reverse of both physics and expectation.
 *
 * So rather than dimming over the light, the light withholds the dim. Each
 * Cast-light lamp that is on paints a black radial falloff into this mask —
 * black hides the dim — full clearing at the pool's centre, diffusing to full
 * dim at its `glowRadius`. Same centre, same radius, same falloff as
 * {@link renderGlow}, so the clearing and the pool are the same shape by
 * construction.
 *
 * Strength tracks brightness the way the glow does: a full-brightness lamp
 * clears completely, a lamp dimmed to nothing clears about a third.
 *
 * Only Cast-light devices qualify — they are the ones that define a radius.
 * Returns `nothing` when no lamp does, so an ordinary plan pays for no mask.
 */
export function renderSunDimMask(
  items: readonly FloorItem[],
  states: Record<string, HassEntity | undefined> | undefined,
  width: number,
  height: number,
  id: string,
  walls?: readonly Wall[],
): SVGTemplateResult | typeof nothing {
  // Strength per item, by INDEX — undefined where the lamp contributes nothing.
  // Deliberately not compacted: see the map below.
  const clearings = items.map((it) => {
    if (!it.glow) return undefined;
    const paint = glowPaint(it, states?.[it.entity]);
    if (!paint) return undefined;
    return {
      // Normalized against the glow's own ceiling, so a full-brightness lamp
      // clears the dim entirely and a dim one clears proportionally.
      strength: Math.max(0, Math.min(1, paint.opacity / GLOW_MAX_OPACITY)),
      // Straight off the paint, so the clearing tracks the pool as it shrinks
      // with brightness (issue #123) instead of staying at the configured size.
      radius: paint.radius,
    };
  });
  if (!clearings.some((v) => v !== undefined)) return nothing;

  const pad = WALL_THICKNESS;
  return svg`
    <defs>
      <mask id=${id} maskUnits="userSpaceOnUse"
            x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}>
        <rect x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}
              fill="white" />
        ${items.map((it, i) => {
          // One slot per item, holes included — exactly how the glow layer
          // itself is emitted. Compacting the list instead shifts every later
          // lamp's DOM position when one toggles, which rewrites the `id` on
          // an existing <radialGradient> and leaves the circle that referenced
          // it pointing at a paint server the browser has already cached under
          // that name. The symptom is a lamp suddenly clearing the dim as a
          // hard-edged disc at full strength rather than a soft falloff, and
          // it only bites lamps positioned *after* the one that toggled —
          // which is what made it look intermittent.
          const clearing = clearings[i];
          if (clearing === undefined) return nothing;
          const { strength, radius: r } = clearing;
          const gid = `${id}-${i}`;
          // Walls stop the clearing exactly as they stop the pool (issue #108),
          // reusing the same visibility polygon — otherwise a lit room lifts
          // the darkness in the room next door, through the wall between them.
          // The clip id hangs off `gid`, so it is pinned to the item index and
          // stays stable when another lamp toggles (issue #119).
          const reach = walls?.length ? glowReach(it.x, it.y, r, walls) : undefined;
          const clipId = `${gid}-clip`;
          return svg`
            ${
              reach
                ? svg`<clipPath id=${clipId}>
                        <polygon points=${reach.map((pt) => `${pt.x},${pt.y}`).join(" ")} />
                      </clipPath>`
                : nothing
            }
            <radialGradient id=${gid} gradientUnits="userSpaceOnUse"
                            cx=${it.x} cy=${it.y} r=${r}>
              <stop offset="0" stop-color="#000" stop-opacity=${strength} />
              <stop offset="1" stop-color="#000" stop-opacity="0" />
            </radialGradient>
            <circle cx=${it.x} cy=${it.y} r=${r} fill=${`url(#${gid})`}
                    clip-path=${reach ? `url(#${clipId})` : nothing} />`;
        })}
      </mask>
    </defs>`;
}

/**
 * A `<mask>` for the whole glow layer that **dims** the light over every
 * furniture footprint. Round-based types cut an ellipse, everything else its
 * rotated rect.
 *
 * This is a dial with a reported bug at each end, which is why it is a grey
 * and not `black` ({@link FURNITURE_GLOW_TRANSMISSION}):
 *
 * - Full light (no mask at all) was **#108**. Furniture line art fills at ~0.12
 *   opacity and draws *above* this layer, so a warm pool shone straight through
 *   and every sofa in the room read as highlighted-active.
 * - No light (a solid `black` hole, the first fix for that) turned furniture
 *   into a *shadow* — a lit table came out darker than the floor around it,
 *   which is what @MrMcFlyy reported on #106.
 *
 * Half-strength keeps both away: light visibly lands on a table, while the
 * furniture's own gray still reads as gray rather than taking the pool's hue.
 *
 * The region is stated explicitly rather than inherited — the viewport
 * default clipped walls under rotation once already (issue #102).
 */
export function renderGlowMask(
  furniture: readonly Furniture[],
  width: number,
  height: number,
  id: string,
): SVGTemplateResult {
  const pad = WALL_THICKNESS;
  return svg`
    <defs>
      <mask id=${id} maskUnits="userSpaceOnUse"
            x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}>
        <rect x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}
              fill="white" />
        ${furniture.map((f) => {
          const rot = f.angle ? `rotate(${f.angle} ${f.x} ${f.y})` : undefined;
          const roundBase = f.type === "roundTable" || f.type === "plant" || f.type === "waterHeater";
          // A mask's luminance is its transmission, and the region is already
          // white ("all the light"). So furniture paints *black* at the share
          // it blocks, leaving the share it lets through.
          const blocked = 1 - FURNITURE_GLOW_TRANSMISSION;
          return roundBase
            ? svg`<ellipse cx=${f.x} cy=${f.y} rx=${f.w / 2} ry=${f.h / 2}
                           fill="#000" fill-opacity=${blocked} transform=${rot ?? nothing} />`
            : svg`<rect x=${f.x - f.w / 2} y=${f.y - f.h / 2} width=${f.w} height=${f.h}
                        fill="#000" fill-opacity=${blocked} transform=${rot ?? nothing} />`;
        })}
      </mask>
    </defs>`;
}

/**
 * Whether a device should be omitted from the **live card** right now
 * (issue #55): it asked to appear only while active, and it isn't. An item
 * with no entity can never be active, so a hide-when-inactive item without
 * one stays hidden rather than becoming permanently invisible furniture the
 * user forgot about — the editor still shows it, dimmed.
 */
export function itemHiddenWhenInactive(
  item: { entity?: string; hideWhenInactive?: boolean },
  state: string | undefined,
): boolean {
  if (!item.hideWhenInactive) return false;
  // No entity, nothing that can be active — hide, and don't let a stray state
  // string argue otherwise (entityIsActive would read a bare "on" as active).
  if (!item.entity) return true;
  return !entityIsActive(item.entity, state);
}

/** Default label font size (px) for an item's name/state line. */
export const DEFAULT_LABEL_SIZE = 12;

/**
 * The label line under an item's badge, or "" for none: the name (issue #61)
 * and/or the state, per the item's toggles. `showState` keeps its historic
 * default (sensors only); `showName` defaults off. Both together read
 * "Name · state". No entity, no state line (issue #39) — an unbound device's
 * label can only be its configured name.
 */
export function itemBadgeLabel(
  hass: RenderHass | undefined,
  item: {
    entity: string;
    secondaryEntity?: string;
    name?: string;
    kind: ItemKind;
    showName?: boolean;
    showState?: boolean;
  },
): string {
  const parts: string[] = [];
  if (item.showName) {
    const friendly = hass?.states[item.entity]?.attributes?.friendly_name as string | undefined;
    const name = item.name || friendly || item.entity;
    if (name) parts.push(name);
  }
  if (!!item.entity && (item.showState ?? item.kind === "sensor"))
    parts.push(itemStateText(hass, item));
  return parts.join(" · ");
}

/**
 * The label the **editor canvas** puts under a device (issue #135), and whether
 * it is the card's own (`live`) or an editor-only stand-in.
 *
 * The canvas used to draw `name || entity || kind` always, so a device read
 * `light.kitchen` here and `21.5 °C` on the card, and turning "Show state" on
 * changed nothing you could see without leaving the editor. So it draws the
 * card's line whenever the card draws one.
 *
 * When the card draws nothing — both label toggles off — the canvas still needs
 * something, or a plan of unnamed devices becomes a field of identical circles
 * with nothing to tell them apart while dragging. That stand-in is rendered
 * dimmed, the same way a `hideWhenInactive` device is faded: the signal is
 * "this is a note to you, the card will not draw it".
 *
 * Lives here rather than in the editor so the rule is pinned by a test —
 * `editor.ts` has no render-test harness.
 */
export function editorItemLabel(
  hass: RenderHass | undefined,
  item: Parameters<typeof itemBadgeLabel>[1] & { kind: ItemKind },
): { text: string; live: boolean } {
  const card = itemBadgeLabel(hass, item);
  if (card) return { text: card, live: true };
  return { text: item.name || item.entity || item.kind, live: false };
}

/**
 * Clamp a config `labelSize` to the editor's 8–40 px range at the render
 * sink. The editor already clamps, but a hand-edited / imported config
 * bypasses it — and this value lands in an inline `style` attribute.
 * Coercion goes through {@link cssNumber} (the shared style-sink guard from
 * #65), so a string like `"20px;color:red"` becomes the default, never
 * markup; this adds only the range clamp on top.
 */
export function itemLabelSize(v: unknown): number {
  return Math.min(40, Math.max(8, cssNumber(v, DEFAULT_LABEL_SIZE)));
}

/** Default mdi icon per item kind, used when neither config nor entity supplies one. */
export function defaultIcon(kind: ItemKind): string {
  switch (kind) {
    case "light":
      return "mdi:lightbulb";
    case "switch":
      return "mdi:toggle-switch";
    case "sensor":
      return "mdi:gauge";
    case "binary_sensor":
      return "mdi:radiobox-marked";
    case "climate":
      return "mdi:thermostat";
    case "cover":
      return "mdi:window-shutter";
    case "media_player":
      return "mdi:television";
    case "fan":
      return "mdi:fan";
    case "camera":
      return "mdi:cctv";
    case "lock":
      return "mdi:lock";
    case "humidifier":
      return "mdi:air-humidifier";
    case "vacuum":
      return "mdi:robot-vacuum";
    default:
      return "mdi:circle";
  }
}

/**
 * State-aware icons for domains that carry their meaning in the domain rather
 * than in a device class. A `media_player` has no device class, so without this
 * a television and a doorbell both render `mdi:circle`.
 */
const DOMAIN_STATE_ICONS: Record<string, { on: string; off: string }> = {
  media_player: { on: "mdi:television-play", off: "mdi:television-off" },
  fan: { on: "mdi:fan", off: "mdi:fan-off" },
  lock: { on: "mdi:lock-open-variant", off: "mdi:lock" },
  camera: { on: "mdi:cctv", off: "mdi:cctv-off" },
  humidifier: { on: "mdi:air-humidifier", off: "mdi:air-humidifier-off" },
  vacuum: { on: "mdi:robot-vacuum", off: "mdi:robot-vacuum-variant" },
};

/**
 * State-aware icons per `binary_sensor` device class ("show as" in the HA UI),
 * mirroring Home Assistant's own device-class icon set. `on` is the
 * device-class's active state (open / detected / unlocked / …).
 */
const BINARY_SENSOR_CLASS_ICONS: Record<string, { on: string; off: string }> = {
  battery: { on: "mdi:battery-alert", off: "mdi:battery" },
  battery_charging: { on: "mdi:battery-charging", off: "mdi:battery" },
  carbon_monoxide: { on: "mdi:smoke-detector-alert", off: "mdi:smoke-detector" },
  cold: { on: "mdi:snowflake", off: "mdi:thermometer" },
  connectivity: { on: "mdi:check-network-outline", off: "mdi:close-network-outline" },
  door: { on: "mdi:door-open", off: "mdi:door-closed" },
  garage_door: { on: "mdi:garage-open", off: "mdi:garage" },
  gas: { on: "mdi:alert-circle", off: "mdi:check-circle" },
  heat: { on: "mdi:fire", off: "mdi:thermometer" },
  light: { on: "mdi:brightness-7", off: "mdi:brightness-5" },
  lock: { on: "mdi:lock-open", off: "mdi:lock" },
  moisture: { on: "mdi:water", off: "mdi:water-off" },
  motion: { on: "mdi:motion-sensor", off: "mdi:motion-sensor-off" },
  occupancy: { on: "mdi:home", off: "mdi:home-outline" },
  opening: { on: "mdi:square-outline", off: "mdi:square" },
  plug: { on: "mdi:power-plug", off: "mdi:power-plug-off" },
  power: { on: "mdi:power-plug", off: "mdi:power-plug-off" },
  presence: { on: "mdi:home", off: "mdi:home-outline" },
  problem: { on: "mdi:alert-circle", off: "mdi:check-circle" },
  running: { on: "mdi:play", off: "mdi:stop" },
  safety: { on: "mdi:alert-circle", off: "mdi:check-circle" },
  smoke: { on: "mdi:smoke-detector-variant-alert", off: "mdi:smoke-detector-variant" },
  sound: { on: "mdi:music-note", off: "mdi:music-note-off" },
  tamper: { on: "mdi:vibrate", off: "mdi:check-circle" },
  vibration: { on: "mdi:vibrate", off: "mdi:crop-portrait" },
  window: { on: "mdi:window-open", off: "mdi:window-closed" },
};

/** Icons per `sensor` device class (not state-dependent). */
const SENSOR_CLASS_ICONS: Record<string, string> = {
  temperature: "mdi:thermometer",
  humidity: "mdi:water-percent",
  battery: "mdi:battery",
  power: "mdi:flash",
  energy: "mdi:lightning-bolt",
  illuminance: "mdi:brightness-5",
  pressure: "mdi:gauge",
  carbon_dioxide: "mdi:molecule-co2",
  pm25: "mdi:air-filter",
  signal_strength: "mdi:wifi",
  voltage: "mdi:sine-wave",
  current: "mdi:current-ac",
};

/** State-aware icons per `cover` device class. */
const COVER_CLASS_ICONS: Record<string, { on: string; off: string }> = {
  garage: { on: "mdi:garage-open", off: "mdi:garage" },
  garage_door: { on: "mdi:garage-open", off: "mdi:garage" },
  door: { on: "mdi:door-open", off: "mdi:door-closed" },
  gate: { on: "mdi:gate-open", off: "mdi:gate" },
  window: { on: "mdi:window-open", off: "mdi:window-closed" },
  blind: { on: "mdi:blinds-open", off: "mdi:blinds" },
  shade: { on: "mdi:roller-shade", off: "mdi:roller-shade-closed" },
  shutter: { on: "mdi:window-shutter-open", off: "mdi:window-shutter" },
  curtain: { on: "mdi:curtains", off: "mdi:curtains-closed" },
  awning: { on: "mdi:awning-outline", off: "mdi:awning-outline" },
};

/** The generic on/off test: state is `on`, `open`, `home`, or `playing`. */
export function isEntityOn(state: string | undefined): boolean {
  return state === "on" || state === "open" || state === "home" || state === "playing";
}

/**
 * States that mean "this thing is doing something", for the domains that do not
 * say `on`.
 *
 * A lock is `locked` / `unlocked`; a vacuum is `docked` / `cleaning`; a camera is
 * `idle` / `recording`. None of them ever reads `on`, so the generic on/off test
 * calls every one of them off, forever — and their state-dependent icons
 * (`DOMAIN_STATE_ICONS`, above) can never show their active half.
 */
const ACTIVE_STATES: Record<string, ReadonlySet<string>> = {
  lock: new Set(["unlocked", "unlocking", "open", "opening"]),
  vacuum: new Set(["cleaning", "returning"]),
  camera: new Set(["recording", "streaming"]),
};

/**
 * Whether an entity is in its active state, by the rules of its own domain.
 * Every domain not in {@link ACTIVE_STATES} falls back to the generic on/off
 * test, unchanged. An unavailable or unknown state is never active, whatever
 * the domain — a stale "unlocked" during a sensor dropout is worse than
 * showing locked.
 */
export function entityIsActive(entityId: string | undefined, state: string | undefined): boolean {
  if (!state || state === "unavailable" || state === "unknown") return false;
  const domain = entityId?.split(".")[0] ?? "";
  const active = ACTIVE_STATES[domain];
  return active ? active.has(state) : isEntityOn(state);
}

/**
 * Domains whose icons move by default while active (issue #48), mirroring the
 * feel of HA's own Tile card: a running fan spins; playback and a working
 * vacuum breathe. Everything else stays still unless the config asks.
 */
const AUTO_ICON_ANIMATION: Record<string, "spin" | "pulse"> = {
  fan: "spin",
  media_player: "pulse",
  vacuum: "pulse",
};

/**
 * What `iconAnimation: "auto"` means for an entity — the animation its domain
 * plays by default, or undefined for the domains that stay still.
 *
 * Exported so the editor can *name* it (issue #127): its dropdown offers no
 * "auto" option, and instead shows a fan as "spinning" and a media player as
 * "pulsing" — the animation the card is already playing. Both sides therefore
 * read the domain defaults from this one table.
 */
export function domainIconAnimation(entity: string | undefined): "spin" | "pulse" | undefined {
  return AUTO_ICON_ANIMATION[entity?.split(".")[0] ?? ""];
}

/**
 * Which animation an item's icon should play right now, or undefined for
 * none. Shared by card and editor. Never animates an inactive (or
 * unavailable) entity — including when the config forces "spin"/"pulse": a
 * spinning fan icon is a claim that the fan is running, so it obeys the same
 * fail-closed rule as the active highlight ({@link entityIsActive}).
 */
export function resolveIconAnimation(
  item: { entity?: string; iconAnimation?: IconAnimation },
  state: string | undefined,
): "spin" | "pulse" | undefined {
  const mode = item.iconAnimation ?? "auto";
  if (mode === "none") return undefined;
  if (!entityIsActive(item.entity, state)) return undefined;
  if (mode === "spin" || mode === "pulse") return mode;
  return domainIconAnimation(item.entity);
}

/**
 * Device classes that mean "something is here" — the sensors a ripple ring was
 * drawn for (issue #127). `motion` and `occupancy` are HA's own binary-sensor
 * classes; `presence` is the home/away one.
 */
const PRESENCE_DEVICE_CLASSES = new Set(["motion", "occupancy", "presence"]);

/**
 * Whether a device detects presence, and so should be offered the ripple ring
 * (issue #127) — the same shape of gate as "Cast light" on a `light`.
 *
 * A `device_tracker` or `person` qualifies on its domain alone; a
 * `binary_sensor` needs the device class to say so, which is what separates a
 * motion sensor from a door contact or a leak detector. A binary sensor with
 * no device class set is therefore *not* presence: it could be anything, and
 * guessing from the entity id would ring doorbells and smoke alarms.
 */
export function isPresenceEntity(
  entity: string | undefined,
  deviceClass: string | undefined,
): boolean {
  const domain = entity?.split(".")[0];
  if (domain === "device_tracker" || domain === "person") return true;
  return domain === "binary_sensor" && !!deviceClass && PRESENCE_DEVICE_CLASSES.has(deviceClass);
}

/**
 * Icon implied by an entity's `device_class` — HA's "show as" setting (issue
 * #29). A `binary_sensor` shown as a Lock gets `mdi:lock` / `mdi:lock-open`,
 * matching what HA itself renders. Returns `undefined` when the domain /
 * device class has no mapping so callers can fall back to the kind default.
 * An explicit config `icon` or a per-entity `attributes.icon` still wins —
 * this only replaces the generic kind fallback.
 */
export function entityDefaultIcon(
  entityId: string,
  deviceClass: string | undefined,
  on: boolean,
): string | undefined {
  const domain = entityId.split(".")[0];
  // These domains carry their meaning in the domain, not a device class, so the
  // device-class guard below would skip them entirely.
  const byDomain = DOMAIN_STATE_ICONS[domain];
  if (byDomain) return on ? byDomain.on : byDomain.off;

  if (!deviceClass) return undefined;
  if (domain === "binary_sensor") {
    const m = BINARY_SENSOR_CLASS_ICONS[deviceClass];
    return m ? (on ? m.on : m.off) : undefined;
  }
  if (domain === "sensor") return SENSOR_CLASS_ICONS[deviceClass];
  if (domain === "cover") {
    const m = COVER_CLASS_ICONS[deviceClass];
    return m ? (on ? m.on : m.off) : undefined;
  }
  return undefined;
}

/**
 * The value an item's rules are judged on: the chosen `attribute` when set
 * (issue #70), else the plain state. Shared by card and editor so the colour
 * and the icon can never be resolved from two different readings.
 */
export function itemRawValue(
  item: { entity?: string; attribute?: string },
  st: { state: string; attributes: Record<string, unknown> } | undefined,
): unknown {
  if (!st) return undefined;
  return item.attribute ? st.attributes?.[item.attribute] : st.state;
}

/**
 * Icon precedence shared by card and editor: matching state rule's icon →
 * config override → the user's entity-registry icon → entity's explicit icon →
 * device_class-implied icon ("show as") → the kind default. The on-state comes
 * from {@link entityIsActive}, so domains that never say "on" (lock/vacuum/camera)
 * reach their active icons here.
 *
 * A state rule's icon (issue #106) sits *above* the config `icon` for the same
 * reason its colour already beats `activeColor`: it is the more specific
 * statement about what this device looks like right now. It also undoes a trap
 * — setting a config `icon` used to return early here, freezing the glyph and
 * silently disabling every state-dependent icon below.
 *
 * The registry override lives at `hass.entities[id].icon` and never reaches
 * `attributes.icon`, so a user who set an icon in Settings → Entities sees it
 * everywhere in HA except here. HA's own `entityIcon()` prefers it over the
 * integration's icon; so must we. `registryIcon` is passed in because this helper
 * takes the state object, not `hass`.
 */
export function resolveItemIcon(
  item: {
    entity?: string;
    kind: ItemKind;
    icon?: string;
    attribute?: string;
    stateColor?: StateColorRule[];
  },
  st: { state: string; attributes: Record<string, unknown> } | undefined,
  registryIcon?: string,
): string {
  // Config strings, so the icon goes through the allowlist (#106): an
  // unusable value falls through to the next candidate rather than rendering
  // an empty box.
  const ruleIcon = cssIcon(matchStateRule(item.stateColor, itemRawValue(item, st))?.icon);
  if (ruleIcon) return ruleIcon;
  const configIcon = cssIcon(item.icon);
  if (configIcon) return configIcon;
  // No entity bound (issue #39: devices that exist physically but not in HA):
  // nothing to derive from, fall straight through to the kind default.
  if (!item.entity) return defaultIcon(item.kind);
  if (registryIcon) return registryIcon;
  const attrIcon = st?.attributes?.icon as string | undefined;
  if (attrIcon) return attrIcon;
  return (
    entityDefaultIcon(
      item.entity,
      st?.attributes?.device_class as string | undefined,
      entityIsActive(item.entity, st?.state),
    ) ?? defaultIcon(item.kind)
  );
}

/**
 * Icon size for an item badge, shared by card and editor. ~62% of the badge,
 * nudged to the badge's parity so the flex-centering slack on each side is a
 * whole pixel — an 11px icon in an 18px badge sits on a half-pixel and the
 * glyph renders visibly off-center at small sizes (issue #39). The 34px
 * default badge still gets its familiar 22px icon.
 */
export function itemIconSize(badgeSize: number): number {
  const b = Math.round(badgeSize);
  let s = Math.round(b * 0.62);
  if (s % 2 !== b % 2) s += 1;
  return Math.max(2, s);
}

/**
 * What a device's badge holds, resolving {@link FloorItem.badgeContent} against
 * the `showIcon` boolean it replaced (issue #106). One function so the card,
 * the editor canvas and the form cannot drift on the migration rule: an
 * explicit `badgeContent` wins, else a legacy `showIcon: false` means "no
 * badge", else the icon as always.
 */
export function badgeContentOf(item: {
  badgeContent?: BadgeContent;
  showIcon?: boolean;
}): BadgeContent {
  if (item.badgeContent === "icon" || item.badgeContent === "value" || item.badgeContent === "none")
    return item.badgeContent;
  return item.showIcon === false ? "none" : "icon";
}

/**
 * Which press effect a plan uses (issue #134), resolving anything unrecognised
 * to the default rather than to nothing.
 *
 * The value becomes a class name, so an unchecked string would land as
 * `press-whatever`, match no rule, and silently mean "no feedback" — a
 * hand-edited typo would look like the feature was never implemented.
 */
export function pressEffectOf(c: { pressEffect?: PressEffect }): PressEffect {
  const v = c.pressEffect;
  return v === "scale" || v === "ripple" || v === "flash" || v === "none"
    ? v
    : DEFAULT_PRESS_EFFECT;
}

/**
 * The reading a domain shows in its badge when the config does not name one,
 * with the compact unit that goes with it (issue #106). A thermostat's *state*
 * is its mode — "heat" — so without this the one device the issue was opened
 * about would have no number to show.
 *
 * The unit is spelled out here rather than read from the entity: `climate` has
 * no `unit_of_measurement` attribute at all (HA carries the temperature unit on
 * the system config), so there is nothing to read.
 */
const DOMAIN_BADGE_READING: Record<string, { attribute: string; unit: string }> = {
  climate: { attribute: "current_temperature", unit: "°" },
  water_heater: { attribute: "current_temperature", unit: "°" },
  humidifier: { attribute: "current_humidity", unit: "%" },
};

/** A finite number from a state/attribute value, or undefined. Booleans and blanks are not readings. */
function numericReading(raw: unknown): number | undefined {
  if (raw == null || typeof raw === "boolean") return undefined;
  if (typeof raw === "string" && raw.trim() === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * A unit short enough to sit inside a 34px circle, or "" to drop it. Degrees
 * collapse to `°` (the C/F is not in doubt on your own floorplan) and
 * concentrations lose their unit entirely — CO₂ reads `780`, because `780ppm`
 * does not fit and the number alone is what people recognise. Anything longer
 * than three characters is dropped rather than shrinking the number to fit.
 */
function compactUnit(unit: unknown): string {
  if (typeof unit !== "string") return "";
  const u = unit.trim();
  if (u === "°C" || u === "°F" || u === "K") return "°";
  if (u === "ppm" || u === "ppb") return "";
  return u.length <= 3 ? u : "";
}

/** Round for the badge: whole numbers, keeping one decimal only where it carries meaning. */
function compactNumber(n: number): string {
  return Math.abs(n) < 10 && !Number.isInteger(n) ? n.toFixed(1) : String(Math.round(n));
}

/**
 * Fold a big reading into the next unit up, so a plug reads `1.2kW` instead of
 * `1240W`. Four digits and a unit letter is the widest thing a badge ever has
 * to hold, and power sensors report watts, so this is the common case rather
 * than an exotic one. Only W→kW: it is the pair this card actually meets, and
 * a general unit-prefix engine would be guessing at units it has never seen.
 */
function scaleUnit(n: number, unit: string): { n: number; unit: string } {
  if (unit === "W" && Math.abs(n) >= 1000) return { n: n / 1000, unit: "kW" };
  return { n, unit };
}

/** A reading and its own unit, compacted and scaled for the badge. */
function formatReading(n: number, rawUnit: unknown): string {
  const scaled = scaleUnit(n, compactUnit(rawUnit));
  return compactNumber(scaled.n) + scaled.unit;
}

/**
 * The number to draw inside a device's badge (issue #106), or undefined when
 * the device has no numeric reading — in which case the badge keeps its icon,
 * so turning this on can never leave an empty circle.
 *
 * Candidates are tried in order and the first *numeric* one wins:
 *
 * 1. the configured `attribute`;
 * 2. the domain's default reading ({@link DOMAIN_BADGE_READING});
 * 3. the entity's state;
 * 4. the secondary entity's reading — which is what makes a smart plug work: a
 *    `switch` item with `secondaryEntity: sensor.plug_power` shows `1.2kW` and
 *    still toggles the switch on tap.
 *
 * The numeric gate at every step is what makes step 1 safe to put first. The
 * thermostat in the issue is coloured by `attribute: hvac_action`, whose value
 * is "heating" — text, so it falls through and the badge still shows the
 * temperature. Colouring by one reading and displaying another needs no extra
 * config because of this.
 *
 * Deliberately *not* routed through `hass.formatEntityState`: that applies the
 * user's display precision and the full unit ("21.5 °C"), which is exactly what
 * does not fit in a badge. This is the one place reading `state` raw is correct.
 */
export function badgeValue(
  hass: RenderHass | undefined,
  item: BadgeReadingItem,
): string | undefined {
  return badgeReading(hass, item)?.text;
}

/** The shape {@link badgeReading} needs off a {@link FloorItem}. */
export interface BadgeReadingItem {
  entity?: string;
  attribute?: string;
  secondaryEntity?: string;
  secondaryAttribute?: string;
  badgeEntity?: BadgeEntity;
}

/** What a badge is showing, and which of the device's entities it came from. */
export interface BadgeReading {
  text: string;
  source: BadgeEntity;
}

/**
 * {@link badgeValue}, plus **which entity it read** (issue #136).
 *
 * The editor needs the source, not just the text: its "Badge reads" dropdown
 * has to open on the entity the badge is actually showing. Defaulting that
 * dropdown to "primary" would state the opposite of what is on screen for a
 * plug whose reading arrives through the fallback below — and the first
 * unrelated edit would save that as fact and drop the reading to an icon.
 *
 * So this is the one resolution and {@link badgeValue} is a wrapper over it,
 * the same shape as {@link matchStateRule} / {@link resolveStateColor} in this
 * file and for the same reason: two copies of a precedence chain are two
 * chances for the badge and the form to disagree about it.
 */
export function badgeReading(
  hass: RenderHass | undefined,
  item: BadgeReadingItem,
): BadgeReading | undefined {
  if (!hass || !item.entity) return undefined;

  // The secondary, resolved as the label line resolves it ({@link itemStateText}),
  // so the two never disagree about which entity the second reading comes from.
  const secondaryEntity = item.secondaryEntity ?? (item.secondaryAttribute ? item.entity : undefined);

  const primary = (): string | undefined => {
    const st = hass.states[item.entity as string];
    const attrs = st?.attributes as Record<string, unknown> | undefined;
    const reading = DOMAIN_BADGE_READING[(item.entity as string).split(".")[0]];
    if (item.attribute) {
      const n = numericReading(attrs?.[item.attribute]);
      // A unit only when we know it belongs to *this* attribute:
      // `unit_of_measurement` describes the state, not an arbitrary attribute,
      // so borrowing it here would label a battery percentage "°C".
      if (n !== undefined)
        return compactNumber(n) + (item.attribute === reading?.attribute ? reading.unit : "");
    }
    if (reading) {
      const n = numericReading(attrs?.[reading.attribute]);
      if (n !== undefined) return compactNumber(n) + reading.unit;
    }
    const own = numericReading(st?.state);
    return own === undefined ? undefined : formatReading(own, attrs?.unit_of_measurement);
  };

  const secondary = (): string | undefined => {
    if (!secondaryEntity) return undefined;
    const sec = hass.states[secondaryEntity];
    const secAttrs = sec?.attributes as Record<string, unknown> | undefined;
    if (item.secondaryAttribute) {
      const n = numericReading(secAttrs?.[item.secondaryAttribute]);
      return n === undefined ? undefined : compactNumber(n);
    }
    const n = numericReading(sec?.state);
    return n === undefined ? undefined : formatReading(n, secAttrs?.unit_of_measurement);
  };

  // An explicit choice reads that entity and stops. Falling through to the
  // other one would quietly show a different device than the one asked for;
  // no number at all is honest, and the badge draws its icon instead.
  if (item.badgeEntity === "secondary") {
    const text = secondary();
    return text === undefined ? undefined : { text, source: "secondary" };
  }
  if (item.badgeEntity === "primary") {
    const text = primary();
    return text === undefined ? undefined : { text, source: "primary" };
  }

  const own = primary();
  if (own !== undefined) return { text: own, source: "primary" };
  const other = secondary();
  return other === undefined ? undefined : { text: other, source: "secondary" };
}

/**
 * Advance width per character, in units of font-size, for the badge's 600-weight
 * face. Measured off the rendered card rather than guessed, and rounded *up* at
 * every entry so the estimate errs wide and the text never overflows the circle.
 *
 * Character width is what matters here, not character count: `45%` is wider
 * than `9999`, and `21°` is narrower than `782`. Sizing by string length — the
 * obvious first approach — put `1240W` 3.2px outside an 18px badge.
 */
const GLYPH_WIDTH: Record<string, number> = { ".": 0.28, "-": 0.38, "°": 0.45, "%": 1.0, k: 0.58 };
/**
 * Taken at the *small* end: a font's advance width per font-pixel grows as the
 * size shrinks (a digit measures 0.637 at 16px but 0.688 at 6px), so the large
 * figure would under-budget exactly the badges with least room to spare.
 */
const DIGIT_WIDTH = 0.7;
/** Unit letters (W, A, V, lx…) — uppercase is the wide case, so assume it. */
const LETTER_WIDTH = 0.85;

function estimatedWidth(text: string): number {
  let w = 0;
  for (const ch of text) {
    w += GLYPH_WIDTH[ch] ?? (ch >= "0" && ch <= "9" ? DIGIT_WIDTH : LETTER_WIDTH);
  }
  return w;
}

/**
 * Font size for a value badge, shared by card and editor: the largest size at
 * which the reading still fits inside the circle, capped so a short value like
 * `9°` does not balloon. Uses the same parity nudge as {@link itemIconSize} so
 * the text box centres on a whole pixel.
 *
 * The default 34px badge reads `21°` at 16px, `45%` at 12px and `1240W` at 8px.
 *
 * The 6px floor is a legibility floor, not a fitting one: below it nothing is
 * readable anyway, so a long reading in a very small badge is allowed to reach
 * the rim rather than shrinking into a smudge. A 5-glyph value wants a badge of
 * about 30px or more.
 */
export function badgeValueSize(badgeSize: number, text: string): number {
  const b = Math.round(cssNumber(badgeSize, DEFAULT_ITEM_SIZE));
  // The 1.5px border each side, plus breathing room off the curve.
  const usable = Math.max(0, b - 6);
  const fit = estimatedWidth(text) > 0 ? usable / estimatedWidth(text) : b;
  let s = Math.round(Math.min(b * 0.46, fit));
  // Nudge *down* to the badge's parity, where itemIconSize nudges up: this
  // size was just clamped to a width budget, and rounding up would spend a
  // pixel the reading does not have. (9999 in a 24px badge overflowed by 1.1px
  // when this went the other way.)
  if (s % 2 !== b % 2) s -= 1;
  return Math.max(6, s);
}

/** Infer a sensible item kind from an entity id's domain. */
export function kindFromEntity(entity: string): ItemKind {
  const domain = entity.split(".")[0];
  switch (domain) {
    case "light":
    case "switch":
    case "sensor":
    case "binary_sensor":
    case "climate":
    case "cover":
    case "media_player":
    case "fan":
    case "camera":
    case "lock":
    case "humidifier":
    case "vacuum":
      return domain as ItemKind;
    default:
      return "generic";
  }
}

/**
 * How an opening moves — `swing` (hinged door / casement window) or `slide`
 * (panels travelling along the wall). Defaults to `swing`.
 */
export function openingMotion(o: Opening): "swing" | "slide" | "roll" {
  return o.motion ?? "swing";
}

/**
 * Default open/closed state for an opening with no associated entity: only a
 * swing door is drawn open (the familiar swing symbol); windows and sliding
 * openings are drawn closed (intact glass / panels filling the gap). This
 * preserves the look of a static floor plan — a slider drawn open would read as
 * a hole rather than a door.
 */
export function openingDefaultOpen(o: Opening): boolean {
  return o.type === "door" && openingMotion(o) === "swing";
}

/**
 * Scale factors that mirror an opening within its own local frame: `flipH`
 * reflects across the wall's length (hinge jamb / slide direction), `flipV`
 * across the wall line (which room the door opens into). Applied as a single
 * `scale(sx sy)` wrapper so the base symbol is drawn once and reused for all
 * four orientations.
 */
export function openingMirror(o: Opening): { sx: 1 | -1; sy: 1 | -1 } {
  return { sx: o.flipH ? -1 : 1, sy: o.flipV ? -1 : 1 };
}

/**
 * Resolve a sliding opening's panel arrangement. Only meaningful while sliding
 * (swinging openings always resolve to `single`), defaulting to `single`.
 */
export function sliderStyleOf(o: Opening): "single" | "bypass" | "biparting" {
  return openingMotion(o) === "slide" ? (o.sliderStyle ?? "single") : "single";
}

/**
 * Sash count for a swing window (issue #73): `double` (the historic look) or
 * `single`. Only meaningful for `type: "window"` with swing motion — doors
 * and sliding/rolling openings always resolve to `double` (ignored).
 */
export function windowSash(o: Opening): "single" | "double" {
  return o.type === "window" && openingMotion(o) === "swing" ? (o.sash ?? "double") : "double";
}

/**
 * How far open an external roller shutter is drawn, 0..1 (issue #74). Cover
 * position when published, else open-ish states = 1. Fails closed on an
 * outage — a stale "open" shutter is worse than drawing it shut.
 */
/**
 * How an opening's external shutter is drawn (issue #74). An explicit
 * `shutterStyle` wins; otherwise the bound entity decides: a `binary_sensor`
 * only reports open/closed — what a hinged shutter (persiana) can say — so it
 * defaults to `swing`, while a `cover` carries a position and defaults to the
 * roller curtain (tapparella).
 */
export function shutterStyleOf(o: Pick<Opening, "shutterEntity" | "shutterStyle">): "roll" | "swing" {
  if (o.shutterStyle === "roll" || o.shutterStyle === "swing") return o.shutterStyle;
  return o.shutterEntity?.split(".")[0] === "binary_sensor" ? "swing" : "roll";
}

export function shutterAmount(
  state: { state: string; attributes?: Record<string, unknown> } | undefined,
): number {
  if (!state || isSensorOutage(state.state)) return 0;
  const pos = state.attributes?.current_position;
  if (typeof pos === "number" && Number.isFinite(pos)) {
    return Math.max(0, Math.min(1, pos / 100));
  }
  return state.state === "open" || state.state === "opening" || state.state === "closing" ||
    state.state === "on"
    ? 1
    : 0;
}

/**
 * Whether the shutter layer wears the accent — drawn (partly) open or still in
 * transit, matching {@link openingIsActive}'s "active = open" semantics.
 */
export function shutterActive(
  state: { state: string; attributes?: Record<string, unknown> } | undefined,
): boolean {
  if (!state || isSensorOutage(state.state)) return false;
  return shutterAmount(state) > 0 || state.state === "opening" || state.state === "closing";
}

/** HA `cover` / `binary_sensor` device classes that read as a window (glass). */
const WINDOW_DEVICE_CLASSES = new Set(["window", "blind", "shade", "shutter", "curtain", "awning"]);
/** Device classes whose panels travel along the wall. */
const SLIDING_DEVICE_CLASSES = new Set(["blind", "shade", "curtain"]);
/** Device classes whose curtain rolls up out of the floor plane (issue #45). */
const ROLLING_DEVICE_CLASSES = new Set(["garage", "garage_door", "shutter"]);

/**
 * Default opening `type` and `motion` inferred from a bound entity's HA
 * `device_class` (mirrors how HA itself picks icons/behaviour from it). Window-
 * like classes render as a window; blinds/shades/curtains default to `slide`;
 * garage doors and roller shutters to `roll`. Unknown / missing classes fall
 * back to a swing door. `motion: undefined` means swing (the default).
 */
export function openingFromDeviceClass(deviceClass: string | undefined): {
  type: Opening["type"];
  motion: "slide" | "roll" | undefined;
} {
  const dc = deviceClass ?? "";
  return {
    type: WINDOW_DEVICE_CLASSES.has(dc) ? "window" : "door",
    motion: ROLLING_DEVICE_CLASSES.has(dc)
      ? "roll"
      : SLIDING_DEVICE_CLASSES.has(dc)
        ? "slide"
        : undefined,
  };
}

/** Cover feature bits: OPEN = 1, CLOSE = 2 (a cover with either can be toggled). */
const COVER_OPEN_CLOSE = 0b11;

/**
 * What tapping an entity-bound opening should do: `cover-toggle` for a `cover`
 * that supports open/close, otherwise `more-info` (read-only `binary_sensor`s
 * and position-only covers open the entity dialog instead of a blind toggle).
 */
export function openingClickAction(
  entityId: string,
  supportedFeatures: number,
): "cover-toggle" | "more-info" {
  const domain = entityId.split(".")[0];
  return domain === "cover" && (supportedFeatures & COVER_OPEN_CLOSE) !== 0
    ? "cover-toggle"
    : "more-info";
}

/**
 * A sensor-outage state — we have no reliable reading, so callers must fail
 * **closed** and, crucially, never let `invert` flip an outage into "open"
 * (matches {@link trackerPresenceDetected}).
 */
function isSensorOutage(state: string | undefined): boolean {
  return state === "unavailable" || state === "unknown";
}

/**
 * Resolve whether an opening should be drawn open, from the raw state string of
 * its bound entity (or `undefined` when it has no entity / no state yet). A
 * contact `binary_sensor` or `cover` reads open on `on`/`open`; `invert` flips
 * that. With no entity / no state yet we fall back to the type default (see
 * {@link openingDefaultOpen}); an `unavailable`/`unknown` outage fails closed
 * regardless of `invert`. Shared by doors, windows and sliders — a slider bound
 * to a `cover` resolves exactly like a swing door.
 */
export function resolveOpeningOpen(o: Opening, state: string | undefined): boolean {
  if (!o.entity || state === undefined) return openingDefaultOpen(o);
  // Fail closed on an outage before applying invert — a stale "open" during a
  // sensor dropout is worse than showing closed.
  if (isSensorOutage(state)) return false;
  // `opening`/`closing` are transient cover states: the cover is in motion and
  // not fully closed, so draw it open. Anything else (closed/off/…) reads closed.
  const open =
    state === "on" || state === "open" || state === "opening" || state === "closing";
  return o.invert ? !open : open;
}

/** A `cover` in transit. Its `current_position` may not have caught up yet. */
export function openingInMotion(state: string | undefined): boolean {
  return state === "opening" || state === "closing";
}

/**
 * How far open an opening should be drawn, as a fraction 0..1, driving partial
 * swing / slide for position-aware `cover` entities. When the entity exposes a
 * numeric `current_position` (0–100) that maps linearly to the fraction (with
 * `invert` flipping it); otherwise it collapses to the binary
 * {@link resolveOpeningOpen} (0 or 1). With no entity/state it uses the type
 * default; an `unavailable`/`unknown` outage fails closed (0), ignoring any
 * stale position.
 *
 * A live position wins over the `opening`/`closing` state even when the two
 * disagree: a cover that has begun opening genuinely still sits at 0, and
 * overriding that would snap the leaf open and back on every cover that streams
 * its position. {@link openingIsActive} carries the motion instead.
 */
export function resolveOpeningAmount(
  o: Opening,
  state: { state: string; attributes?: Record<string, unknown> } | undefined,
): number {
  if (!o.entity || !state) return openingDefaultOpen(o) ? 1 : 0;
  // Fail closed on an outage before reading position — a cover that dropped out
  // can leave a stale current_position that would otherwise render it open.
  if (isSensorOutage(state.state)) return 0;
  const pos = state.attributes?.current_position;
  if (typeof pos === "number" && Number.isFinite(pos)) {
    const frac = Math.max(0, Math.min(1, pos / 100));
    return o.invert ? 1 - frac : frac;
  }
  return resolveOpeningOpen(o, state.state) ? 1 : 0;
}

/**
 * Whether an entity-bound opening should wear its accent colour. Drawn-open
 * covers do, and so does one still in transit: a cover reports `opening` at
 * position 0 for as long as it takes to move — a full second on a garage door,
 * the whole travel on a cover that only publishes position at rest. Without
 * this the leaf sits shut and unaccented and a tap reads as having done
 * nothing. An outage is never active (see {@link isSensorOutage}).
 */
export function openingIsActive(
  o: Opening,
  state: { state: string; attributes?: Record<string, unknown> } | undefined,
): boolean {
  if (!o.entity || !state || isSensorOutage(state.state)) return false;
  return openingInMotion(state.state) || resolveOpeningAmount(o, state) > 0;
}

/**
 * The slatted roll curtain (band + slat ticks) scaled by how far open, shared
 * by roll-up openings and the window shutter layer (issue #74). Centered on
 * the track line; callers draw their own jambs/track.
 */
function rollCurtain(length: number, tone: string, amt: number): SVGTemplateResult {
  const half = length / 2;
  const bandT = 5;
  const slats = Math.max(3, Math.round(length / 12));
  const ticks: SVGTemplateResult[] = [];
  for (let i = 1; i < slats; i++) {
    const x = -half + (length * i) / slats;
    ticks.push(
      svg`<line x1=${x} y1=${-bandT / 2} x2=${x} y2=${bandT / 2}
            stroke=${SKIN_PAPER} stroke-width="0.75" />`
    );
  }
  return svg`<g class="fp-roll-curtain" style="transform:scaleY(${1 - amt});">
      <rect x=${-half} y=${-bandT / 2} width=${length} height=${bandT}
            style="fill:${tone};" />
      ${ticks}
    </g>`;
}

/**
 * Hinged external shutters (issue #74) — the louvered panels you fold back
 * against the façade, not a roller curtain. Two leaves hinged at the jambs,
 * drawn just **outside** the wall band so they never collide with the
 * window's own casement sashes (which swing to the near side), rotating
 * outward as they open. Closed, they cover the opening.
 */
function swingShutter(
  length: number,
  cutH: number,
  tone: string,
  amt: number
): SVGTemplateResult {
  const half = length / 2;
  const t = 3;
  // Sit the panels beyond the wall band, on the far side from the sashes.
  const y0 = cutH / 2 + t / 2;
  /** Slat ticks across a panel whose rect starts at `x0` and runs `w` wide. */
  const louvers = (x0: number, w: number): SVGTemplateResult[] => {
    const out: SVGTemplateResult[] = [];
    const n = Math.max(2, Math.round(w / 14));
    for (let i = 1; i < n; i++) {
      const x = x0 + (w * i) / n;
      out.push(
        svg`<line x1=${x} y1=${-t / 2} x2=${x} y2=${t / 2}
              stroke=${SKIN_PAPER} stroke-width="0.75" />`
      );
    }
    return out;
  };
  // Reuses the door-leaf transition classes: same hinge semantics, so the
  // panels animate with the rest of the plan for free.
  return svg`
      <g transform="translate(${-half} ${y0})">
        <g class="fp-door-leaf" style="transform:rotate(${90 * amt}deg);">
          <rect x="0" y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
          ${louvers(0, half)}
        </g>
      </g>
      <g transform="translate(${half} ${y0})">
        <g class="fp-leaf-r" style="transform:rotate(${-90 * amt}deg);">
          <rect x=${-half} y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
          ${louvers(-half, half)}
        </g>
      </g>`;
}

/** Style options for {@link renderOpening}. */
export interface OpeningStyle {
  /** Base color of the jambs / leaf / swing arc. */
  color: string;
  /** Whether the opening is drawn open (default `true`). */
  open?: boolean;
  /**
   * How far open, 0..1, for partial rendering from a position-aware `cover`.
   * When omitted it falls back to the binary `open` (1 when open, else 0), so
   * existing callers are unaffected. See {@link resolveOpeningAmount}.
   */
  amount?: number;
  /** Entity-driven "actively open" state: tints the moving parts with `accent`. */
  active?: boolean;
  /**
   * Accent color used while `active`. Defaults to {@link SKIN_ACCENT} — the
   * skin's accent, falling back to the HA primary color when unskinned.
   */
  accent?: string;
  /**
   * External roller shutter layered over the opening (issue #74): how far
   * open (0..1, see {@link shutterAmount}) and whether it wears the accent.
   * Rendered as the roll curtain on top of the sash.
   */
  shutter?: { amount: number; active?: boolean; style?: "roll" | "swing" };
}

/**
 * Render a door or window as an SVG group centered at the origin, then translated
 * and rotated into place. The wall behind the opening is cut away by the host via
 * an SVG mask (see {@link renderWallMask}), so this draws only the symbol — jambs,
 * swing arc and the moving leaf/sash, which carry CSS classes so the host's styles
 * can transition them smoothly between open and closed.
 */
export function renderOpening(o: Opening, style: OpeningStyle): SVGTemplateResult {
  const { color, open = true, active = false, accent = SKIN_ACCENT } = style;
  const half = o.length / 2;
  const cutH = WALL_THICKNESS + 4;
  // The moving parts take the accent color when actively open (sensor-driven).
  // Sanitised: color/accent are config-supplied and land in `style="stroke/fill:…"`.
  const tone = cssColorOr(active ? accent : color, SKIN_ACCENT);
  // Fraction open (0..1) drives partial swing/slide. Defaults to the binary
  // `open` so callers that don't pass `amount` render exactly as before.
  const amt = Math.max(0, Math.min(1, style.amount ?? (open ? 1 : 0)));

  let body: SVGTemplateResult;
  if (o.type === "window" && openingMotion(o) === "swing" && windowSash(o) === "single") {
    // One casement sash hinged at the left jamb (issue #73) — the window
    // counterpart of the door leaf: full-width sash, quarter-circle arc that
    // draws on as it opens. flipH (via the mirror wrapper below) moves the
    // hinge to the other jamb.
    const arcLen = (Math.PI / 2) * o.length;
    body = svg`
        <!-- jambs -->
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <path class="fp-door-arc"
              d="M ${half} 0 A ${o.length} ${o.length} 0 0 0 ${-half} ${-o.length}"
              fill="none" stroke-width="1.5" stroke-dasharray=${arcLen}
              style="stroke:${tone};stroke-dashoffset:${arcLen * (1 - amt)};" />
        <g transform="translate(${-half} 0)">
          <g class="fp-door-leaf" style="transform:rotate(${-90 * amt}deg);">
            <rect x="0" y="-1.25" width=${o.length} height="2.5" style="fill:${tone};" />
          </g>
        </g>
      `;
  } else if (o.type === "window" && openingMotion(o) === "swing") {
    // Two casement leaves hinged at each jamb. Closed, they meet in the middle
    // along the wall; open, they swing outward (up) like double doors, each
    // tracing a quarter-circle arc (radius = half) that draws on as it opens.
    const arcLen = (Math.PI / 2) * half;
    body = svg`
        <!-- jambs -->
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <!-- swing arcs, drawn from the middle outward -->
        <path class="fp-door-arc" d="M 0 0 A ${half} ${half} 0 0 0 ${-half} ${-half}"
              fill="none" stroke-width="1.5" stroke-dasharray=${arcLen}
              style="stroke:${tone};stroke-dashoffset:${arcLen * (1 - amt)};" />
        <path class="fp-door-arc" d="M 0 0 A ${half} ${half} 0 0 1 ${half} ${-half}"
              fill="none" stroke-width="1.5" stroke-dasharray=${arcLen}
              style="stroke:${tone};stroke-dashoffset:${arcLen * (1 - amt)};" />
        <!-- left leaf, hinged at left jamb -->
        <g transform="translate(${-half} 0)">
          <g class="fp-door-leaf" style="transform:rotate(${-90 * amt}deg);">
            <rect x="0" y="-1.25" width=${half} height="2.5" style="fill:${tone};" />
          </g>
        </g>
        <!-- right leaf, hinged at right jamb -->
        <g transform="translate(${half} 0)">
          <g class="fp-leaf-r" style="transform:rotate(${90 * amt}deg);">
            <rect x=${-half} y="-1.25" width=${half} height="2.5" style="fill:${tone};" />
          </g>
        </g>
      `;
  } else if (openingMotion(o) === "roll") {
    // Roll-up cover — garage door, roller shutter (issues #45 / #47). Unlike a
    // slider nothing travels along the wall: the curtain leaves the floor
    // plane, so the slatted band thins toward the track line as it opens and
    // vanishes fully open, leaving jambs + track. Distinct at a glance from
    // both the giant swing leaf and the slide panel.
    body = svg`
        <!-- jambs -->
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <!-- track: stays when the curtain is up so the gap still reads as an opening -->
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        ${rollCurtain(o.length, tone, amt)}`;
  } else if (openingMotion(o) === "slide") {
    // A sliding door / window: panel(s) sit in the opening and travel *along* the
    // wall. Closed, they fill the gap; open, they slide aside (single), stack
    // (bypass) or part (biparting). No swing arc. A sliding *window*'s panels are
    // drawn as a thin glass line so it reads as glass rather than a solid door.
    const t = o.type === "window" ? 1.5 : 2.5; // glass vs solid panel
    const jambs = svg`
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />`;
    const sliderStyle = sliderStyleOf(o);
    if (sliderStyle === "bypass") {
      // Double bypass: two half-width panels on parallel tracks. The moving
      // (back) panel slides left to stack behind the fixed (front) panel.
      const off = 1.75; // half the gap between the two tracks
      const shift = -half * amt;
      body = svg`
        ${jambs}
        <!-- tracks -->
        <line x1=${-half} y1=${-off} x2=${half} y2=${-off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <line x1=${-half} y1=${off} x2=${half} y2=${off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <!-- fixed panel: left half, front track -->
        <rect x=${-half} y=${off - t / 2} width=${half} height=${t} style="fill:${tone};" />
        <!-- moving panel: right half, back track -->
        <g class="fp-slide-panel" style="transform:translateX(${shift}px);">
          <rect x="0" y=${-off - t / 2} width=${half} height=${t} style="fill:${tone};" />
        </g>`;
    } else if (sliderStyle === "biparting") {
      // Biparting: two half-width panels meet at the centre and part, each
      // recessing into the wall on its own side (left panel → left, right → right).
      const shift = half * amt;
      body = svg`
        ${jambs}
        <!-- track -->
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <g class="fp-slide-panel" style="transform:translateX(${-shift}px);">
          <rect x=${-half} y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
        </g>
        <g class="fp-slide-panel" style="transform:translateX(${shift}px);">
          <rect x="0" y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
        </g>`;
    } else {
      // Single panel: fills the opening closed, slides fully aside when open.
      const shift = o.length * amt;
      body = svg`
        ${jambs}
        <!-- track -->
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <g class="fp-slide-panel" style="transform:translateX(${shift}px);">
          <rect x=${-half} y=${-t / 2} width=${o.length} height=${t} style="fill:${tone};" />
        </g>`;
    }
  } else {
    // Door leaf hinged at the left jamb: lies along the wall when closed,
    // swings up (−90° when fully open) by `amt`. The leaf is drawn closed and
    // rotated via CSS.
    const angle = -90 * amt;
    // Swing arc revealed via stroke-dashoffset so it "draws on" as the door opens.
    // Path runs from the closed-leaf tip toward the open-leaf tip, so it traces
    // the door edge. arcLen is the quarter-circle length (radius = o.length).
    const arcLen = (Math.PI / 2) * o.length;
    body = svg`
        <!-- swing arc: hidden when closed, drawn as it opens -->
        <path class="fp-door-arc"
              d="M ${half} 0 A ${o.length} ${o.length} 0 0 0 ${-half} ${-o.length}"
              fill="none" stroke-width="1.5" stroke-dasharray=${arcLen}
              style="stroke:${tone};stroke-dashoffset:${arcLen * (1 - amt)};" />
        <!-- door leaf, hinged at left jamb -->
        <g transform="translate(${-half} 0)">
          <g class="fp-door-leaf" style="transform:rotate(${angle}deg);">
            <rect x="0" y="-1.25" width=${o.length} height="2.5" style="fill:${tone};" />
          </g>
        </g>
      `;
  }
  // Orientation mirrors are applied as a single scale wrapper inside the
  // place-into-position transform, so the base symbol (drawn once, centered at
  // the origin) reflects into any of the four hinge/swing orientations.
  // External shutter layer (issue #74): the roll curtain rides on top of the
  // sash so a shut shutter visibly covers an open window. Its own
  // active/accent state is independent of the window's.
  if (style.shutter) {
    const shutterTone = cssColorOr(
      style.shutter.active ? accent : color,
      SKIN_ACCENT
    );
    const amt2 = Math.max(0, Math.min(1, style.shutter.amount));
    body = svg`${body}${
      style.shutter.style === "swing"
        ? swingShutter(o.length, cutH, shutterTone, amt2)
        : rollCurtain(o.length, shutterTone, amt2)
    }`;
  }
  const { sx, sy } = openingMirror(o);
  return svg`<g class=${`fp-opening fp-opening-${cssIdent(o.type) ?? "unknown"}`}
                data-id=${cssIdent(o.id) ?? nothing}
                data-entity=${cssEntityId(o.entity) ?? nothing}
                transform="translate(${o.x} ${o.y}) rotate(${o.angle})">
      <g transform="scale(${sx} ${sy})">${body}</g>
    </g>`;
}

// ---- whole-plan rotation (issue #33) ---------------------------------------
//
// The card can display the plan rotated in 90° steps — a landscape plan on a
// portrait wall tablet — without touching any stored coordinate. The SVG
// layers rotate via one group transform; the HTML overlay (badges, labels,
// text) is repositioned point-by-point instead, so icons and text stay
// upright. The editor always shows the plan as drawn.

export type PlanRotation = 0 | 90 | 180 | 270;

/** Coerce a config `rotation` to a supported step; anything else means 0. */
export function normalizePlanRotation(v: unknown): PlanRotation {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const r = ((v % 360) + 360) % 360;
  return r === 90 || r === 180 || r === 270 ? r : 0;
}

/** Canvas size as displayed: 90°/270° swap width and height. */
export function rotatedCanvasSize(
  w: number,
  h: number,
  rot: PlanRotation
): { w: number; h: number } {
  return rot === 90 || rot === 270 ? { w: h, h: w } : { w, h };
}

/** Map a plan point into the rotated (displayed) frame. */
export function rotatePlanPoint(
  x: number,
  y: number,
  w: number,
  h: number,
  rot: PlanRotation
): { x: number; y: number } {
  switch (rot) {
    case 90:
      return { x: h - y, y: x };
    case 180:
      return { x: w - x, y: h - y };
    case 270:
      return { x: y, y: w - x };
    default:
      return { x, y };
  }
}

/**
 * SVG group transform realizing {@link rotatePlanPoint} for whole layers, or
 * "" for the unrotated plan. Matches the point mapping exactly — the overlay
 * (HTML, remapped per point) and the drawing (SVG, one transform) must land
 * on the same pixels or badges drift off their walls.
 */
export function planRotationTransform(w: number, h: number, rot: PlanRotation): string {
  switch (rot) {
    case 90:
      return `translate(${h} 0) rotate(90)`;
    case 180:
      return `translate(${w} ${h}) rotate(180)`;
    case 270:
      return `translate(0 ${w}) rotate(-90)`;
    default:
      return "";
  }
}

/**
 * How bright the plan should be for a given sun elevation (issue #113).
 *
 * `sun.sun`'s `elevation` is the signal rather than sunrise/sunset timestamps:
 * Home Assistant already computes it continuously from the instance's own
 * latitude, longitude and clock, so it is smooth by construction and it comes
 * from the **server**. A phone in another timezone showing the same dashboard
 * therefore sees the same picture, which is the point of the issue.
 *
 * The ramp spans civil twilight ({@link SUN_ELEVATION_NIGHT} to
 * {@link SUN_ELEVATION_DAY}) — roughly the hour around sunrise and sunset when
 * the light outside actually changes. Smoothstepped rather than linear so the
 * rate eases in and out instead of cornering at each end.
 *
 * A missing or unreadable elevation returns `max`: an outage should leave the
 * plan at full brightness, never stuck dark with no way to tell why.
 */
export function sunBrightness(
  elevation: unknown,
  min: number = DEFAULT_SUN_MIN,
  max: number = DEFAULT_SUN_MAX,
): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  // Allowlist the input rather than enumerate the coercions: Number(null),
  // Number(""), Number(false) and Number([]) are every one of them 0 — finite,
  // and 0° is the *middle* of this ramp. Left unguarded a dead sun.sun would
  // not fail bright at all, it would quietly settle the plan at half light and
  // read as a dusk that never ends. Same trap cssNumber documents.
  const usable =
    typeof elevation === "number" ||
    (typeof elevation === "string" && elevation.trim() !== "");
  if (!usable) return hi;
  const e = typeof elevation === "number" ? elevation : Number(elevation);
  if (!Number.isFinite(e)) return hi;
  const span = SUN_ELEVATION_DAY - SUN_ELEVATION_NIGHT;
  const t = Math.max(0, Math.min(1, (e - SUN_ELEVATION_NIGHT) / span));
  const eased = t * t * (3 - 2 * t);
  return lo + (hi - lo) * eased;
}

/**
 * `preserveAspectRatio` for a floor's background image (issue #86).
 *
 * SVG already knows how to do this, so the fit option is a straight mapping
 * rather than any arithmetic of ours: `none` stretches, `meet` fits inside
 * (letterbox), `slice` fills and crops. Centred in both directions.
 *
 * This governs only how the bitmap maps into its own rect — the rect still
 * spans the canvas, so element coordinates are untouched and a plan traced
 * over the image keeps its alignment with everything else.
 */
export function imageFitRatio(fit: Floor["imageFit"]): string {
  switch (fit) {
    case "contain":
      return "xMidYMid meet";
    case "cover":
      return "xMidYMid slice";
    default:
      // Unset and any stray value fall back to the historical behaviour.
      return "none";
  }
}

/**
 * Build an SVG `<mask>` (white field with a black rect at each opening) that, when
 * applied to the wall layer, removes the wall pixels behind doors/windows so a gap
 * shows through — including any background image. Shared by the live card and the
 * editor so both cut walls identically. Wrap the wall strokes in
 * `<g mask="url(#id)">` (or set `mask="url(#id)"` on each wall line).
 *
 * The mask's own region is stated explicitly (issue #102). Left unset it defaults
 * to -10%..110% *of the viewport*, and the rotated card (issue #33) swaps the
 * viewport's width and height while the mask content stays in plan coordinates —
 * so on a 1000x600 plan turned 90°, the region ended at 110% of 600 and every
 * wall past x=660 was masked away. Only walls, because only walls wear the mask.
 * A margin of one wall thickness keeps strokes that sit on the canvas edge whole.
 */
export function renderWallMask(
  openings: Opening[],
  width: number,
  height: number,
  id: string
): SVGTemplateResult {
  const cutH = WALL_THICKNESS + 4;
  const pad = WALL_THICKNESS;
  return svg`
    <defs>
      <mask id=${id} maskUnits="userSpaceOnUse"
            x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}>
        <rect x=${-pad} y=${-pad} width=${width + pad * 2} height=${height + pad * 2}
              fill="white" />
        ${openings.map((o) => {
          const half = o.length / 2;
          return svg`<rect x=${o.x - half} y=${o.y - cutH / 2}
                           width=${o.length} height=${cutH} fill="black"
                           transform="rotate(${o.angle} ${o.x} ${o.y})" />`;
        })}
      </mask>
    </defs>`;
}

/**
 * Arithmetic-mean centroid of a polygon's vertices. Not an exact
 * center-of-mass for a non-convex shape, but that precision isn't needed
 * here — it's only used for name-label placement and marquee/click
 * hit-testing (see `elementsInRect` in editor-geometry.ts).
 */
export function polygonCentroid(points: readonly AreaPoint[]): { x: number; y: number } {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((s, p) => ({ x: s.x + p.x, y: s.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/**
 * Diagonal hatching, at 45°, spaced in canvas units so it keeps the same weight
 * on the plan whatever size the card is drawn at.
 */
export const DEAD_SPACE_HATCH_GAP = 12;
export const DEAD_SPACE_HATCH_WIDTH = 1.5;
/**
 * Deliberately faint. A dead space is an absence — the plan should read "there
 * is nothing here", not draw the eye to it the way a lit room or an active
 * device does.
 */
export const DEAD_SPACE_HATCH_OPACITY = 0.4;

/**
 * The `<pattern>` the dead-space polygons fill with (issue #88): one vertical
 * line per tile, with the whole tile turned 45°, which is what makes the
 * hatching continuous across tile edges — a diagonal line drawn corner to
 * corner inside an upright tile shows a seam wherever the tiles meet.
 *
 * `patternUnits="userSpaceOnUse"` ties the spacing to canvas units rather than
 * to each polygon's bounding box, so a broom cupboard and a sealed courtyard
 * hatch at the same pitch instead of the small one looking finely cross-hatched.
 *
 * Rendered once per plan; `id` must be unique per card instance, since several
 * cards can share a document.
 */
export function renderDeadSpaceHatch(id: string): SVGTemplateResult {
  return svg`
    <defs>
      <pattern id=${id} width=${DEAD_SPACE_HATCH_GAP} height=${DEAD_SPACE_HATCH_GAP}
               patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <line class="fp-dead-space-line" x1="0" y1="0" x2="0" y2=${DEAD_SPACE_HATCH_GAP}
              stroke=${SKIN_WALL} stroke-width=${DEAD_SPACE_HATCH_WIDTH} />
      </pattern>
    </defs>`;
}

/**
 * One dead space, hatched (issue #88). The ring comes from `deadSpaces()` and
 * runs down the centrelines of the walls that seal the region, so the hatching
 * reaches under the walls and is trimmed by them being drawn on top — which is
 * exactly how it should meet them.
 *
 * `fill-rule="nonzero"` (the default, stated for the reason) matters here: a
 * region with a stub wall poking into it comes back as a ring that walks out
 * along the stub and back, and evenodd would read that zero-width spike as a
 * hole and leave a scratch across the hatching.
 */
export function renderDeadSpace(
  points: readonly AreaPoint[],
  patternId: string
): SVGTemplateResult {
  const pts = points.map((p) => `${p.x},${p.y}`).join(" ");
  return svg`<polygon class="fp-dead-space" points=${pts}
                      fill=${`url(#${patternId})`} fill-rule="nonzero"
                      fill-opacity=${DEAD_SPACE_HATCH_OPACITY} stroke="none" />`;
}

/**
 * A room's translucent fill polygon, with no stroke of its own — the outline
 * is a separate pass, drawn above the walls by {@link renderAreaBorder}.
 * `color`/`opacity` are config-supplied style values, so they go through the
 * same injection allowlist as every other color/number field (see css-safe.ts).
 */
export function renderArea(a: Area, liveColor?: string): SVGTemplateResult {
  const pts = a.points.map((p) => `${p.x},${p.y}`).join(" ");
  // `liveColor` has already been through the allowlist by areaColor(). When it
  // is present the area is "live" and `highlight` decides whether that color
  // lands on the fill, the outline, or both.
  const liveFill = liveColor !== undefined && (a.highlight ?? "fill") !== "border";

  // activeOpacity is a fill concern, so it only applies when the fill is live.
  const opacity = liveFill ? a.activeOpacity ?? a.opacity : a.opacity;

  // Stroke stays pinned off rather than omitted: this element is reused across
  // live/rest updates, and stating it keeps the fill pass unable to draw an
  // outline no matter what the border pass above the walls is doing.
  return svg`<polygon class="fp-area" data-id=${cssIdent(a.id) ?? nothing}
                       data-entity=${cssEntityId(a.entity) ?? nothing}
                       points=${pts}
                       fill=${liveFill ? liveColor : cssColorOr(a.color, SKIN_ACCENT)}
                       fill-opacity=${cssNumber(opacity, DEFAULT_AREA_OPACITY)}
                       stroke="none"
                       stroke-width="0" />`;
}

/**
 * A room's outline — drawn as its own pass **above the walls**.
 *
 * An area polygon almost always traces the room it encloses, which means it
 * runs down the centerline of that room's walls. Walls are stroked at
 * {@link WALL_THICKNESS} over the top of the fills, so an outline drawn with
 * the fill lands underneath the very wall it follows and cannot be seen at
 * all. That left `highlight: "border"` (#107) inert on any plan whose areas
 * follow its walls, which is very nearly all of them.
 *
 * Drawn above, the outline colors the room's own walls: an occupied or lit
 * room announces itself along its boundary instead of tinting everything
 * inside it, which is what `highlight: "border"` was for. The caller draws
 * this inside the wall mask, so doorways and windows stay cut out of the
 * outline exactly as they are cut out of the wall.
 *
 * A **live** border is clipped to its own room (`clipId` names the clip path
 * the caller must keep unique). Rooms share walls, and an unclipped stroke
 * straddles the boundary and paints the neighbour's face as well as its own —
 * so on a wall between two live rooms whichever area sits later in `areas:`
 * simply wins the whole wall, and reordering the config silently changes what
 * the plan says. Clipped, each room paints its own side and a corner where
 * several rooms meet splits between them. A **static** `borderColor` is drawn
 * as authored — centered on the polygon, unclipped — since it is decoration
 * placed deliberately rather than a per-room signal.
 *
 * Carries the same `data-id` / `data-entity` hooks as the fill (#111) under its
 * own `fp-area-border` class, so a rule can target a room's outline and its
 * fill separately. They go on the drawn polygon only: a `<clipPath>` is never
 * rendered, so a rule matching one would look like it silently does nothing.
 *
 * Returns `nothing` when there is no outline to draw — the default.
 */
export function renderAreaBorder(
  a: Area,
  liveColor?: string,
  clipId?: string
): SVGTemplateResult | typeof nothing {
  const liveBorder = liveColor !== undefined && (a.highlight ?? "fill") !== "fill";
  const stroke = liveBorder
    ? liveColor
    : a.borderColor
      ? cssColorOr(a.borderColor, "none")
      : undefined;
  if (stroke === undefined || stroke === "none") return nothing;

  const pts = a.points.map((p) => `${p.x},${p.y}`).join(" ");
  // `borderWidth` is always the width actually seen. A live border defaults to
  // half the wall: the wall is centered on the same line the polygon follows,
  // so the room only owns the inner half of it. Anything wider runs past the
  // wall's inner face onto the floor, over any furniture standing against that
  // wall, and — since the opening mask only cuts WALL_THICKNESS + 4 — out
  // through the doorways as a sliver either side of the cut. A static border is
  // decoration and keeps its thinner default.
  const width = cssNumber(
    a.borderWidth,
    liveBorder ? WALL_THICKNESS / 2 : DEFAULT_AREA_BORDER_WIDTH
  );

  if (!liveBorder || clipId === undefined) {
    return svg`<polygon class="fp-area-border" data-id=${cssIdent(a.id) ?? nothing}
                        data-entity=${cssEntityId(a.entity) ?? nothing}
                        points=${pts} fill="none"
                        stroke=${stroke} stroke-width=${width} />`;
  }

  // Clipping keeps only the inner half of the stroke, so it is drawn at twice
  // the width to leave `width` showing on this room's own side.
  return svg`
    <clipPath id=${clipId}><polygon points=${pts} /></clipPath>
    <polygon class="fp-area-border" data-id=${cssIdent(a.id) ?? nothing}
             data-entity=${cssEntityId(a.entity) ?? nothing}
             points=${pts} fill="none" clip-path=${`url(#${clipId})`}
             stroke=${stroke} stroke-width=${width * 2} />`;
}

/**
 * Render a furniture/fixture diagram as line art inside its w×h box, centered at the
 * origin, then translated and rotated into place. Defaults to gray so it reads
 * differently from black walls.
 */
/** Fraction of the bounding box the chaise occupies, and the main seat's depth. */
export const SECTIONAL_CHAISE_FRACTION = 0.42;
export const SECTIONAL_SEAT_FRACTION = 0.55;

/**
 * The six corners of an L-shaped sectional, centred on the origin, back at -y.
 *
 * `hand` is read facing the sofa from the front: a `right` sectional puts the
 * chaise on your right, extending toward you. Mirroring across x gives `left`,
 * so the two hands are the same polygon reflected -- not two separate shapes.
 */
export function sectionalPoints(
  w: number,
  h: number,
  hand: SectionalHand = "right",
): Array<[number, number]> {
  const hw = w / 2;
  const hh = h / 2;
  const seat = h * SECTIONAL_SEAT_FRACTION;   // depth of the main run, from the back
  const chaise = w * SECTIONAL_CHAISE_FRACTION;

  //  back  ( -y )
  //  +-----------------+
  //  |                 |
  //  |         +-------+   <- chaise, on the right
  //  |         |
  //  +---------+
  //  front ( +y )
  const pts: Array<[number, number]> = [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [hw - chaise, hh],
    [hw - chaise, -hh + seat],
    [-hw, -hh + seat],
  ];
  return hand === "left" ? pts.map(([x, y]) => [-x, y] as [number, number]) : pts;
}

/**
 * A furniture diagram. `override` is the entity-driven color resolved by the
 * caller (issue #82) — see {@link furnitureColor}; the editor passes nothing
 * and keeps the static look while you are drawing.
 */
export function renderFurniture(f: Furniture, override?: string): SVGTemplateResult {
  const color = override ?? f.color ?? FURNITURE_COLOR;
  const w = f.w;
  const h = f.h;
  const hw = w / 2;
  const hh = h / 2;

  const roundBase =
    f.type === "roundTable" || f.type === "plant" || f.type === "waterHeater";
  const base = f.type === "sectional"
    ? svg`<polygon points=${sectionalPoints(w, h, f.hand).map((p) => p.join(",")).join(" ")}
                   fill=${color} fill-opacity="0.12" stroke=${color} stroke-width="2"
                   stroke-linejoin="round" />`
    : roundBase
    ? svg`<ellipse cx="0" cy="0" rx=${hw} ry=${hh}
                   fill=${color} fill-opacity="0.12" stroke=${color} stroke-width="2" />`
    : f.type === "rug"
      ? svg`<rect x=${-hw} y=${-hh} width=${w} height=${h} rx=${Math.min(w, h) * 0.12}
                  fill=${color} fill-opacity="0.08" stroke=${color} stroke-width="2"
                  stroke-dasharray="8 5" />`
      : svg`<rect x=${-hw} y=${-hh} width=${w} height=${h} rx="4"
                  fill=${color} fill-opacity="0.12" stroke=${color} stroke-width="2" />`;

  let detail: SVGTemplateResult;
  switch (f.type) {
    case "chair":
      detail = svg`<line x1=${-hw} y1=${-hh + h * 0.22} x2=${hw} y2=${-hh + h * 0.22}
                         stroke=${color} stroke-width="2" />`;
      break;
    case "sofa":
      detail = svg`
        <line x1=${-hw} y1=${-hh + h * 0.3} x2=${hw} y2=${-hh + h * 0.3}
              stroke=${color} stroke-width="2" />
        <line x1=${-hw + w * 0.12} y1=${-hh + h * 0.3} x2=${-hw + w * 0.12} y2=${hh}
              stroke=${color} stroke-width="2" />
        <line x1=${hw - w * 0.12} y1=${-hh + h * 0.3} x2=${hw - w * 0.12} y2=${hh}
              stroke=${color} stroke-width="2" />`;
      break;
    case "bed":
      detail = svg`
        <line x1=${-hw} y1=${-hh + h * 0.26} x2=${hw} y2=${-hh + h * 0.26}
              stroke=${color} stroke-width="2" />
        <rect x=${-hw + w * 0.1} y=${-hh + h * 0.06} width=${w * 0.34} height=${h * 0.14} rx="3"
              fill="none" stroke=${color} stroke-width="1.5" />
        <rect x=${hw - w * 0.44} y=${-hh + h * 0.06} width=${w * 0.34} height=${h * 0.14} rx="3"
              fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    case "fridge":
      detail = svg`
        <line x1=${-hw} y1=${-hh + h * 0.4} x2=${hw} y2=${-hh + h * 0.4}
              stroke=${color} stroke-width="2" />
        <line x1=${hw - w * 0.16} y1=${-hh + h * 0.12} x2=${hw - w * 0.16} y2=${-hh + h * 0.3}
              stroke=${color} stroke-width="2" />
        <line x1=${hw - w * 0.16} y1=${-hh + h * 0.5} x2=${hw - w * 0.16} y2=${hh - h * 0.16}
              stroke=${color} stroke-width="2" />`;
      break;
    case "stove": {
      const r = Math.min(w, h) * 0.16;
      const ox = w * 0.22;
      const oy = h * 0.22;
      detail = svg`
        <circle cx=${-ox} cy=${-oy} r=${r} fill="none" stroke=${color} stroke-width="2" />
        <circle cx=${ox} cy=${-oy} r=${r} fill="none" stroke=${color} stroke-width="2" />
        <circle cx=${-ox} cy=${oy} r=${r} fill="none" stroke=${color} stroke-width="2" />
        <circle cx=${ox} cy=${oy} r=${r} fill="none" stroke=${color} stroke-width="2" />`;
      break;
    }
    case "sink":
      detail = svg`
        <rect x=${-hw + w * 0.12} y=${-hh + h * 0.18} width=${w * 0.76} height=${h * 0.5} rx="4"
              fill="none" stroke=${color} stroke-width="2" />
        <circle cx="0" cy=${-hh + h * 0.1} r=${Math.min(w, h) * 0.05}
                fill="none" stroke=${color} stroke-width="2" />`;
      break;
    case "toilet":
      detail = svg`
        <rect x=${-hw + w * 0.1} y=${-hh} width=${w * 0.8} height=${h * 0.22} rx="3"
              fill="none" stroke=${color} stroke-width="2" />
        <ellipse cx="0" cy=${hh - h * 0.32} rx=${w * 0.34} ry=${h * 0.3}
                 fill="none" stroke=${color} stroke-width="2" />`;
      break;
    case "stairs": {
      const steps = 7;
      const lines = [];
      for (let i = 1; i < steps; i++) {
        const y = -hh + (h / steps) * i;
        lines.push(svg`<line x1=${-hw} y1=${y} x2=${hw} y2=${y} stroke=${color} stroke-width="1.5" />`);
      }
      detail = svg`${lines}
        <line x1="0" y1=${hh - 6} x2="0" y2=${-hh + 6} stroke=${color} stroke-width="1.5" />
        <path d="M ${-w * 0.12} ${-hh + h * 0.16} L 0 ${-hh + 4} L ${w * 0.12} ${-hh + h * 0.16}"
              fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    }
    case "tv":
      detail = svg`<line x1=${-w * 0.18} y1=${hh} x2=${w * 0.18} y2=${hh + h}
                         stroke=${color} stroke-width="2" />`;
      break;
    case "desk":
      detail = svg`<line x1=${-hw} y1=${-hh + h * 0.55} x2=${hw} y2=${-hh + h * 0.55}
                         stroke=${color} stroke-width="1.5" opacity="0.7" />`;
      break;
    case "wardrobe":
      detail = svg`
        <line x1="0" y1=${-hh} x2="0" y2=${hh} stroke=${color} stroke-width="2" />
        <line x1=${-w * 0.06} y1=${-h * 0.1} x2=${-w * 0.06} y2=${h * 0.1}
              stroke=${color} stroke-width="2" />
        <line x1=${w * 0.06} y1=${-h * 0.1} x2=${w * 0.06} y2=${h * 0.1}
              stroke=${color} stroke-width="2" />`;
      break;
    case "plant": {
      const r = Math.min(w, h) * 0.18;
      detail = svg`
        <circle cx="0" cy=${-h * 0.12} r=${r} fill="none" stroke=${color} stroke-width="1.5" />
        <circle cx=${-w * 0.16} cy=${h * 0.08} r=${r} fill="none" stroke=${color} stroke-width="1.5" />
        <circle cx=${w * 0.16} cy=${h * 0.08} r=${r} fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    }
    case "fishTank": {
      // Issue #72: glass inset and two fish seen from above (lens body +
      // tail) so it can't be mistaken for a rug, plus a rising bubble.
      // Every measure scales with w/h like the other glyphs.
      const fx = w * 0.18;
      const fy = h * 0.1;
      const bubble = Math.min(w, h) * 0.04;
      const fish = (cx: number, cy: number, dir: number) => svg`
        <ellipse cx=${cx} cy=${cy} rx=${w * 0.07} ry=${h * 0.09}
                 fill="none" stroke=${color} stroke-width="1.5" />
        <path d="M ${cx + dir * w * 0.07} ${cy} l ${dir * w * 0.05} ${-h * 0.08} l 0 ${h * 0.16} z"
              fill=${color} opacity="0.7" />`;
      detail = svg`
        <rect x=${-hw + w * 0.05} y=${-hh + h * 0.12} width=${w * 0.9} height=${h * 0.76}
              fill="none" stroke=${color} stroke-width="1" opacity="0.6" />
        ${fish(-fx, -fy, 1)}
        ${fish(fx, fy, -1)}
        <circle cx=${w * 0.32} cy=${-h * 0.18} r=${bubble} fill="none" stroke=${color}
                stroke-width="1" opacity="0.6" />`;
      break;
    }
    case "piano": {
      // Upright piano from above: body with a keyboard strip along the front
      // edge, a few key separators, and the open lid line.
      const stripY = hh - h * 0.3;
      const keys: SVGTemplateResult[] = [];
      for (let i = 1; i < 8; i++) {
        const x = -hw + (w * i) / 8;
        keys.push(svg`<line x1=${x} y1=${stripY} x2=${x} y2=${hh - h * 0.06}
              stroke=${color} stroke-width="1" opacity="0.6" />`);
      }
      detail = svg`
        <line x1=${-hw + w * 0.04} y1=${stripY} x2=${hw - w * 0.04} y2=${stripY}
              stroke=${color} stroke-width="1.5" />
        ${keys}
        <line x1=${-hw + w * 0.04} y1=${-hh + h * 0.22} x2=${hw - w * 0.04} y2=${-hh + h * 0.22}
              stroke=${color} stroke-width="1" opacity="0.5" />`;
      break;
    }
    case "hotTub": {
      // Square shell, round tub, jet bubbles in the corners of the water.
      const r = Math.min(w, h) * 0.36;
      const jr = Math.min(w, h) * 0.05;
      const jd = r * 0.62;
      detail = svg`
        <circle cx="0" cy="0" r=${r} fill="none" stroke=${color} stroke-width="2" />
        <circle cx=${-jd} cy=${-jd} r=${jr} fill="none" stroke=${color} stroke-width="1" opacity="0.6" />
        <circle cx=${jd} cy=${-jd} r=${jr} fill="none" stroke=${color} stroke-width="1" opacity="0.6" />
        <circle cx=${-jd} cy=${jd} r=${jr} fill="none" stroke=${color} stroke-width="1" opacity="0.6" />
        <circle cx=${jd} cy=${jd} r=${jr} fill="none" stroke=${color} stroke-width="1" opacity="0.6" />`;
      break;
    }
    case "rug":
      detail = svg`<rect x=${-hw + w * 0.1} y=${-hh + h * 0.1} width=${w * 0.8} height=${h * 0.8}
                         rx=${Math.min(w, h) * 0.08} fill="none" stroke=${color}
                         stroke-width="1.5" opacity="0.6" />`;
      break;
    case "washer":
    case "dryer": {
      const r = Math.min(w, h) * 0.3;
      detail = svg`
        <line x1=${-hw + w * 0.06} y1=${-hh + h * 0.18} x2=${hw - w * 0.06} y2=${-hh + h * 0.18}
              stroke=${color} stroke-width="1.5" opacity="0.7" />
        <circle cx="0" cy=${h * 0.06} r=${r} fill="none" stroke=${color} stroke-width="2" />
        ${f.type === "dryer"
          ? svg`<circle cx="0" cy=${h * 0.06} r=${r * 0.45}
                        fill="none" stroke=${color} stroke-width="1.5" opacity="0.7" />`
          : svg`<circle cx=${-hw + w * 0.16} cy=${-hh + h * 0.09} r=${Math.min(w, h) * 0.045}
                        fill="none" stroke=${color} stroke-width="1.5" />`}`;
      break;
    }
    case "dishwasher":
      detail = svg`
        <rect x=${-hw + w * 0.1} y=${-hh + h * 0.24} width=${w * 0.8} height=${h * 0.62} rx="3"
              fill="none" stroke=${color} stroke-width="1.5" opacity="0.8" />
        <line x1=${-hw + w * 0.06} y1=${hh - h * 0.12} x2=${hw - w * 0.06} y2=${hh - h * 0.12}
              stroke=${color} stroke-width="2" />`;
      break;
    case "waterHeater":
      detail = svg`
        <circle cx="0" cy="0" r=${Math.min(hw, hh) * 0.34}
                fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    case "airHandler":
      detail = svg`
        <line x1=${-hw + w * 0.08} y1=${-hh + h * 0.08} x2=${hw - w * 0.08} y2=${hh - h * 0.08}
              stroke=${color} stroke-width="1.5" opacity="0.8" />
        <line x1=${-hw + w * 0.08} y1=${hh - h * 0.08} x2=${hw - w * 0.08} y2=${-hh + h * 0.08}
              stroke=${color} stroke-width="1.5" opacity="0.8" />`;
      break;
    case "bathtub":
      detail = svg`
        <rect x=${-hw + w * 0.06} y=${-hh + h * 0.12} width=${w * 0.88} height=${h * 0.76}
              rx=${Math.min(w, h) * 0.12} fill="none" stroke=${color} stroke-width="2" />
        <circle cx=${-hw + w * 0.14} cy="0" r=${Math.min(w, h) * 0.055}
                fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    case "vanity":
      detail = svg`
        <ellipse cx="0" cy=${h * 0.06} rx=${w * 0.2} ry=${h * 0.26}
                 fill="none" stroke=${color} stroke-width="2" />
        <circle cx="0" cy=${-hh + h * 0.14} r=${Math.min(w, h) * 0.05}
                fill="none" stroke=${color} stroke-width="1.5" />`;
      break;
    case "sectional": {
      const pts = sectionalPoints(w, h, f.hand);
      const seatY = pts[4][1];               // where the chaise meets the main run
      const backY = -hh + h * 0.16;
      const divX = pts[3][0];                // the chaise's inner edge
      const armX = f.hand === "left" ? hw - w * 0.09 : -hw + w * 0.09;
      detail = svg`
        <line x1=${-hw} y1=${backY} x2=${hw} y2=${backY} stroke=${color} stroke-width="2" />
        <line x1=${armX} y1=${backY} x2=${armX} y2=${seatY} stroke=${color} stroke-width="2" />
        <line x1=${divX} y1=${backY} x2=${divX} y2=${hh} stroke=${color} stroke-width="2" />`;
      break;
    }
    case "table":
    case "roundTable":
    default:
      detail = svg``;
      break;
  }
  return svg`<g class=${`fp-furniture fp-furniture-${cssIdent(f.type) ?? "unknown"}`}
                data-id=${cssIdent(f.id) ?? nothing}
                data-entity=${cssEntityId(f.entity) ?? nothing}
                transform="translate(${f.x} ${f.y}) rotate(${f.angle ?? 0})">${base}${detail}</g>`;
}

/**
 * Concentric pulsing rings for presence/movement devices. When `active`, the rings
 * animate (CSS keyframes `fp-ripple`, defined in each component's styles); when idle
 * only the faint center dot shows.
 */
export function renderRipple(
  active: boolean,
  color: string,
  sizePx: number,
  rings = 3
): TemplateResult {
  return html`
    <div
      class="ripple ${active ? "active" : ""}"
      style="width:${cssNumber(sizePx, DEFAULT_RIPPLE_SIZE)}px;height:${cssNumber(sizePx, DEFAULT_RIPPLE_SIZE)}px;--fp-ripple-color:${cssColorOr(color, SKIN_ACCENT)};"
    >
      <span class="dot"></span>
      ${Array.from(
        { length: rings },
        (_, i) => html`<span class="ring" style="animation-delay:${(i * 0.6).toFixed(2)}s;"></span>`
      )}
    </div>
  `;
}

/** Read a tracker sensor's current numeric value from HA, returning null when unavailable. */
export function trackerSensorReading(
  states: Record<string, { state: string } | undefined> | undefined,
  entity: string | undefined,
): number | null {
  if (!entity || !states) return null;
  const raw = states[entity]?.state;
  if (raw == null || raw === "unavailable" || raw === "unknown") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Options for {@link renderTracker}. */
export interface TrackerRenderOptions {
  /**
   * Whether the tracker is being rendered inside the editor. In the editor the
   * zone rectangle is drawn (semi-transparent fill + dashed stroke) so the user
   * can see / grab the tracked area. In the live card it is invisible — only
   * the tracked-object animation renders.
   */
  editing: boolean;
  /** Live X-axis sensor reading (null when unavailable). */
  xReading: number | null;
  /** Live Y-axis sensor reading (null when unavailable). */
  yReading: number | null;
  /**
   * Tri-state presence gate per axis:
   * - `null` / undefined — no presence sensor configured for that axis (don't gate).
   * - `true` — presence detected, allow the marker.
   * - `false` — presence clear (or unavailable / unknown), hide the marker.
   *
   * If **any** configured gate is `false`, the whole marker hides — that's the
   * "either presence sensor reports clear, so we don't trust the position"
   * semantics. The zone outline still renders when `editing` so the user can
   * find and re-configure the tracker.
   */
  xPresent?: boolean | null;
  yPresent?: boolean | null;
}

/**
 * Render a Tracker as an SVG group: an optional editor-only zone outline plus a
 * live tracked-object marker driven by 1 or 2 distance sensors. Two-sensor mode
 * shows a pulsating triangle at the resolved `(x, y)` with concentric ripples;
 * one-sensor mode shows a faint pulsating line spanning the unknown axis with
 * ripple bands. CSS keyframes `fp-tracker-pulse`, `fp-tracker-ring` and
 * `fp-tracker-band` are provided by the host component's styles.
 */
export function renderTracker(t: Tracker, opts: TrackerRenderOptions): SVGTemplateResult {
  const color = t.color ?? SKIN_ACCENT;
  const dotR = (t.dotSize ?? DEFAULT_TRACKER_DOT_SIZE) / 2;
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  const angle = t.angle ?? 0;

  const fx = trackerAxisFraction(t.xSensor, opts.xReading);
  const fy = trackerAxisFraction(t.ySensor, opts.yReading);
  const hasX = fx != null;
  const hasY = fy != null;

  // Presence gate: hide the marker if any configured presence sensor reports
  // "not detected" (false). A null/undefined here means no gate is configured
  // for that axis, so it doesn't veto. With both gates unset the behaviour is
  // unchanged from before this feature landed.
  const presenceGated = opts.xPresent === false || opts.yPresent === false;

  // Local (centered) coordinates so a rotation around the rect center is trivial.
  const hw = t.w / 2;
  const hh = t.h / 2;

  // Zone outline — editor only.
  const zone = opts.editing
    ? svg`<rect class="tracker-zone ${presenceGated ? "presence-gated" : ""}"
                x=${-hw} y=${-hh} width=${t.w} height=${t.h}
                fill=${color} fill-opacity="0.08" stroke=${color} stroke-width="1.5"
                stroke-dasharray="6 4" rx="4" pointer-events="none" />`
    : svg``;

  let marker: SVGTemplateResult;
  if (presenceGated) {
    // A presence gate is configured AND reports clear → hide the marker.
    // The zone outline (editor only) above still renders, so the user can
    // tell the tracker exists, but no pulsating triangle / line distracts
    // when nobody is there. Runtime view shows nothing.
    marker = svg``;
  } else if (hasX && hasY) {
    // 2-sensor: pulsating triangle + ripple rings at the resolved (x, y).
    const mx = -hw + fx! * t.w;
    const my = -hh + fy! * t.h;
    // Equilateral-ish triangle pointing up, sized in user units (≈ dotR scale).
    const tri = `0,${-dotR} ${dotR * 0.9},${dotR * 0.7} ${-dotR * 0.9},${dotR * 0.7}`;
    const ringMax = Math.max(dotR * 3.5, Math.min(t.w, t.h) * 0.45);
    marker = svg`
      <g class="tracker-marker" style="transform:translate(${mx}px, ${my}px);">
        <circle class="tracker-ring" cx="0" cy="0" r="0"
                fill="none" stroke=${color} stroke-width="1.5"
                style="--fp-tracker-ring-max:${ringMax}px;" />
        <circle class="tracker-ring" cx="0" cy="0" r="0"
                fill="none" stroke=${color} stroke-width="1.5"
                style="--fp-tracker-ring-max:${ringMax}px; animation-delay:0.7s;" />
        <polygon class="tracker-dot" points=${tri} fill=${color} />
      </g>`;
  } else if (hasX || hasY) {
    // 1-sensor: faint pulsating line + ripple bands along the unknown axis.
    if (hasX) {
      // Vertical line at the X position, spanning full height.
      const lx = -hw + fx! * t.w;
      marker = svg`
        <g class="tracker-line" style="transform:translate(${lx}px, 0);">
          <line class="tracker-line-stroke" x1="0" y1=${-hh} x2="0" y2=${hh}
                stroke=${color} stroke-width="1.5" />
          <line class="tracker-band" x1="0" y1=${-hh} x2="0" y2=${hh}
                stroke=${color} stroke-width="3" stroke-linecap="round" />
          <line class="tracker-band" x1="0" y1=${-hh} x2="0" y2=${hh}
                stroke=${color} stroke-width="3" stroke-linecap="round"
                style="animation-delay:0.8s;" />
        </g>`;
    } else {
      // Horizontal line at the Y position, spanning full width.
      const ly = -hh + fy! * t.h;
      marker = svg`
        <g class="tracker-line tracker-line-h" style="transform:translate(0, ${ly}px);">
          <line class="tracker-line-stroke" x1=${-hw} y1="0" x2=${hw} y2="0"
                stroke=${color} stroke-width="1.5" />
          <line class="tracker-band" x1=${-hw} y1="0" x2=${hw} y2="0"
                stroke=${color} stroke-width="3" stroke-linecap="round" />
          <line class="tracker-band" x1=${-hw} y1="0" x2=${hw} y2="0"
                stroke=${color} stroke-width="3" stroke-linecap="round"
                style="animation-delay:0.8s;" />
        </g>`;
    }
  } else if (opts.editing) {
    // Editor placeholder: a faint center dot so the user can still see the tracker.
    marker = svg`<circle class="tracker-placeholder" cx="0" cy="0" r=${dotR}
                          fill=${color} fill-opacity="0.25" />`;
  } else {
    // Runtime + no sensors → render nothing.
    marker = svg``;
  }

  return svg`
    <g class="tracker fp-tracker ${opts.editing ? "editing" : ""}"
       data-id=${cssIdent(t.id) ?? nothing}
       transform="translate(${cx} ${cy}) rotate(${angle})">
      ${zone}${marker}
    </g>`;
}

/**
 * Project point (px,py) onto the nearest wall and return the snapped position +
 * the wall's angle (degrees). Returns null if no wall is within `threshold`.
 */
export function snapToWall(
  px: number,
  py: number,
  walls: { x1: number; y1: number; x2: number; y2: number }[],
  threshold: number
): { x: number; y: number; angle: number } | null {
  let best: { x: number; y: number; angle: number } | null = null;
  let bestDist = threshold;
  for (const w of walls) {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((px - w.x1) * dx + (py - w.y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const sx = w.x1 + t * dx;
    const sy = w.y1 + t * dy;
    const dist = Math.hypot(px - sx, py - sy);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x: sx, y: sy, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
    }
  }
  return best;
}
