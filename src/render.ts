import { svg, html, nothing, type SVGTemplateResult, type TemplateResult } from "lit";
import {
  BUILTIN_SYMBOLS,
  FALLBACK_SYMBOL,
  findSymbol,
  renderSymbolParts,
  type SymbolCatalog,
} from "./symbols";
import type {
  FloorplanCardConfig,
  Floor,
  Opening,
  OpeningType,
  SliderStyle,
  ItemKind,
  IconAnimation,
  StateColorRule,
  BadgeContent,
  BadgeEntity,
  ItemReading,
  LabelPosition,
  PressEffect,
  OfflineStyle,
  Furniture,
  Tracker,
  Area,
  AreaPoint,
  Wall,
  RenderHass,
  HassEntity,
  FloorItem,
  FloorText,
  OverlayScale,
  ActionConfig,
} from "./types";
import {
  FURNITURE_COLOR,
  DEFAULT_TRACKER_DOT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_AREA_OPACITY,
  MAX_AREA_ZOOM_FIT,
  MAX_AREA_ZOOM,
  DEFAULT_ZOOMED_OVERLAY_SCALE,
  DEFAULT_AREA_LABEL_SIZE,
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
  DEFAULT_OFFLINE_STYLE,
  BADGE_MIN_LIGHTNESS,
  FURNITURE_GLOW_TRANSMISSION,
  getFloors,
  trackerAxisFraction,
  DEFAULT_RIPPLE_DIRECTION,
  DEFAULT_RIPPLE_WIDTH,
} from "./types";
import { cssColor, cssColorOr, cssNumber, cssIdent, cssEntityId, cssIcon } from "./css-safe";
import { hasAction } from "./actions";
import { SKIN_ACCENT, SKIN_PAPER, SKIN_WALL, MAX_SKIN_WALL_WIDTH } from "./skins";
// The same tolerance #141 uses to decide an opening sits on a wall, so "this
// door is in this wall" means one thing across the card.
import { OPENING_ON_WALL_EPS } from "./dead-space";

export const WALL_THICKNESS = 8;

/**
 * The narrowest an operable sash may be drawn, as a fraction of its opening
 * (issue #218). Not zero: a sash of no width is a fixed pane, which
 * `motion: "fixed"` says outright, and one drawn at a hair's width would read
 * as a rendering fault rather than as a choice.
 */
export const MIN_SASH_SPAN = 0.05;

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
  // Anything that reads the real sun has to watch it. Miss this and the plan
  // is drawn once and then frozen at whatever the sun was doing when the card
  // loaded — the same trap entity-bound furniture (#82) and areas (#6) each
  // fell into, and in its worst form (#145) it is not even frozen: it lurches
  // forward whenever some *other* watched entity moves, so it reads as
  // intermittent rather than broken. HA replaces the state object when an
  // attribute moves, so identity comparison in hassRenderInputsChanged
  // catches it.
  //
  // Sun dimming (#113) reads the elevation. Sunlight reads both halves — the
  // azimuth for the direction, the elevation for whether there is any light —
  // but only while it follows the real sun: a pinned sunBearing reads neither
  // (see sunBearingOf and sunlightStrengthOf), so it needs no subscription.
  if (c.sunDimming || (c.sunlight && !sunIsPinned(c))) ids.add("sun.sun");
  for (const f of getFloors(c)) {
    for (const o of f.openings) {
      if (o.entity) ids.add(o.entity);
      if (o.shutterEntity) ids.add(o.shutterEntity);
      // The opening's second leaf (issues #145, #159). Exactly the trap named
      // above, and the worst version of it: the leaf is not frozen, it catches
      // up whenever some *other* watched entity moves, so it reads as
      // intermittent rather than broken.
      if (o.secondaryEntity) ids.add(o.secondaryEntity);
      if (o.shutterSecondaryEntity) ids.add(o.shutterSecondaryEntity);
    }
    for (const it of f.items) {
      if (it.entity) ids.add(it.entity);
      // Every reading beyond the device's own state (issue #180), legacy
      // second entity included — one pool, so one loop. Same trap as the
      // opening's second leaf above: miss one and that line of the label is
      // not frozen but *intermittent*, catching up only when some other
      // watched entity happens to move.
      if (it.hideEntity) ids.add(it.hideEntity);
      if (it.hideStateEntity) ids.add(it.hideStateEntity);
      if (it.hideBadgeEntity) ids.add(it.hideBadgeEntity);
      for (const r of itemReadings(it)) if (r.entity) ids.add(r.entity);
    }
    // Entity-bound text (issue #225). Same trap as the furniture below and the
    // areas after it: miss this and the number is painted once and then frozen,
    // catching up only when some *other* watched entity happens to move.
    for (const t of f.texts) {
      if (t.entity) ids.add(t.entity);
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
 * One {@link ItemReading}'s text (issue #180), or `""` when the row says
 * nothing yet.
 *
 * The empty answer is load-bearing: the editor adds a reading as a blank row
 * for you to fill in, and a blank row that rendered `entityStateText`'s "—"
 * would put a dash on the plan the moment you clicked "+". So a row with
 * neither an entity nor an attribute draws nothing at all, and only a row that
 * names *something* gets to fail visibly.
 */
export function itemReadingText(
  hass: RenderHass | undefined,
  item: { entity?: string },
  reading: ItemReading,
): string {
  // An attribute with no entity of its own means "this device's own entity",
  // which is what lets one climate show four of its attributes (issue #70's
  // trick, generalised).
  const entity = reading.entity || (reading.attribute ? item.entity : undefined);
  if (!entity) return "";
  return reading.attribute
    ? entityAttributeText(hass, entity, reading.attribute)
    : entityStateText(hass, entity);
}

/**
 * Every reading a device carries **beyond its own state**, as one list
 * (issue #180).
 *
 * There used to be two mechanisms with two different rules: `secondaryEntity`
 * / `secondaryAttribute` — one extra reading, joined to the state line and
 * shown only while `showState` was on — and then `readings`, any number of
 * them, shown always. Two ways to say the same thing, one of them capped at
 * one, is a distinction nothing outside the config format cared about.
 *
 * So there is one pool, and this builds it: the legacy pair first (it was
 * always the *second* reading, so it keeps that place), then `readings` in
 * order. Everything downstream — the label, the badge, the watched-entity set,
 * the editor — reads this rather than either key, which is what makes the
 * legacy pair a spelling rather than a special case.
 *
 * `secondaryAttribute` with no `secondaryEntity` meant "that attribute of this
 * device's own entity"; an {@link ItemReading} with an attribute and no entity
 * means exactly the same thing, so it survives the translation unchanged.
 */
export function itemReadings(item: {
  secondaryEntity?: string;
  secondaryAttribute?: string;
  readings?: ItemReading[];
}): ItemReading[] {
  const legacy: ItemReading[] =
    item.secondaryEntity || item.secondaryAttribute
      ? [{ entity: item.secondaryEntity, attribute: item.secondaryAttribute }]
      : [];
  return [...legacy, ...(item.readings ?? [])];
}

/**
 * A device's own state as text: its `state`, or its `attribute` when one is
 * named (issue #70).
 *
 * The *primary* reading only. Everything else the device shows comes from
 * {@link itemReadings} and is appended by {@link itemBadgeLabel} — this is the
 * one `showState` gates, because it is the one that is the device's own state.
 */
export function itemStateText(
  hass: RenderHass | undefined,
  item: { entity: string; attribute?: string },
): string {
  return item.attribute
    ? entityAttributeText(hass, item.entity, item.attribute)
    : entityStateText(hass, item.entity);
}

/**
 * What a free text label actually draws (issue #225).
 *
 * Unbound it is the words as typed, which is every text on every plan drawn
 * before this existed. Bound to an entity it is that entity's reading —
 * formatted the way Home Assistant formats it anywhere else, so a power sensor
 * reads `1.2 kW` and its display precision is the entity's own setting rather
 * than something to configure again here.
 *
 * With **both**, the words are a prefix: `PV` and a reading of `1.2 kW` draw
 * `PV 1.2 kW`. One rule rather than a placeholder syntax to learn, and it
 * covers the two things people write — a bare number, or a number with a word
 * in front of it saying which number it is.
 *
 * A joining space, not the ` · ` a device's label uses between its own
 * readings: this is one reading with a name, not a list.
 */
export function textLabel(
  hass: RenderHass | undefined,
  t: Pick<FloorText, "text" | "entity" | "attribute">,
): string {
  // `?? ""` rather than `t.text`: an emptied optional text field is stored as
  // absent, so an unbound label with no words has no `text` at all — and this
  // returns a string to every caller, always.
  if (!t.entity) return t.text ?? "";
  const value = t.attribute
    ? entityAttributeText(hass, t.entity, t.attribute)
    : entityStateText(hass, t.entity);
  return t.text ? `${t.text} ${value}` : value;
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
 * How much of an opening's width is actually clear, 0–1 — what {@link
 * wallsLightPassesThrough} cuts out of the wall for light to pass through.
 *
 * Not simply the leaf's `amount`, for two reasons that both arrived with the
 * two-panel sliders (issue #145):
 *
 * **Both panels count.** A door with a sensor per leaf and only its *second*
 * panel open was drawing that panel open while still blocking light outright,
 * because the light asked `entity` and nothing else.
 *
 * **Travel is not the same as clearance.** `biparting` sends each leaf out into
 * a wall, so two open leaves clear the whole opening. The patio styles keep
 * their leaves inside it — each travels a quarter — so even wide open they
 * clear only half. Reading `amount` alone would have `converging` letting
 * through twice the light it draws.
 *
 *  | style                    | both open | one open |
 *  | ------------------------ | --------- | -------- |
 *  | `biparting`              | all of it | half     |
 *  | `biparting-bypass`       | half      | a quarter|
 *  | `converging`             | half      | a quarter|
 *  | hinged double            | all of it | half     |
 *
 * The hinged double joined the table with issue #159, and swings the same way
 * `biparting` slides: each leaf covers its own half of the opening and clears
 * it completely when open, so one open sash of a casement pair lets through
 * half the light.
 *
 * Every other opening keeps `amount` untouched, so a single-leaf swing door, a
 * roll-up and a single-panel slider all behave exactly as they did — as does a
 * single-sensor `biparting` or double sash, where both leaves share one amount
 * and the mean of it is itself.
 */
export function openingClearFraction(o: Opening, amount: number, secondAmount?: number): number {
  // Nothing moves, so nothing is ever clear — whatever a bound sensor says
  // (issue #218). Asked before `amount` is even read, because a fixed pane
  // with a contact on it is exactly the case that would otherwise open.
  if (openingMotion(o) === "fixed") return 0;
  const a1 = Math.max(0, Math.min(1, amount));
  const a2 = Math.max(0, Math.min(1, secondAmount ?? amount));
  // A sash narrower than its frame clears only its own share of the opening
  // (issue #218): swung fully open, a half-width sash leaves half the glass
  // still in place. `openingSashSpan` is 1 for everything else, so this is
  // the identity for every opening that has always filled its frame.
  if (openingMotion(o) === "swing")
    return openingSash(o) === "double" ? (a1 + a2) / 2 : a1 * openingSashSpan(o);
  switch (sliderStyleOf(o)) {
    case "biparting":
      // Each leaf recesses into its own wall, so between them they can clear
      // the opening completely.
      return (a1 + a2) / 2;
    case "biparting-bypass":
    case "converging":
      // Each leaf is a quarter wide and travels a quarter, and stays in the
      // frame — so the pair tops out at half the opening however wide open.
      return (a1 + a2) / 4;
    default:
      return a1;
  }
}

/**
 * How much of an opening's gap a lamp's cast pool passes through — the same
 * question {@link openingClearFraction} answers, except glass admits its
 * whole gap however its sash is sitting, the same rule {@link
 * openingSunFraction} already applies to sunlight and by the same field:
 * {@link openingIsGlazed}. `glazed` means one thing — is this opening glass —
 * and a lamp's light passing through glass same as sunlight does is that one
 * fact read twice, not two different rules that happen to agree.
 *
 * One exception sunlight doesn't need: a **roll-motion** window is a blind,
 * shutter, shade, curtain or awning bound as the opening's own entity (an
 * auto-detected `device_class`, see {@link openingFromDeviceClass}) — a
 * covering standing in for the glass behind it, not the glass itself. Glazed
 * by the same default every window gets, it would read as always-clear no
 * matter how far down it actually is, defeating the one thing binding it was
 * for. So it keeps {@link openingClearFraction}'s answer regardless of
 * `glazed` — the roll-up rule {@link openingClearFraction}'s own docs
 * describe, honoured here too.
 *
 * A shutter — the separate `shutterEntity` layered over an opening — overrides
 * the glass, same priority {@link openingSunFraction} gives it: rolled down,
 * it blocks a lamp's pool same as it blocks the sun, whatever glass sits
 * behind it. `shutter` is `undefined` where none is bound, so an opening
 * without one is judged on itself alone. Unlike the glass rule above, this
 * one is not window-only — any opening with a `shutterEntity` reads it.
 *
 * Every other opening — an ordinary door, an opaque slider, a roll-up —
 * keeps {@link openingClearFraction}'s answer untouched; only real glass,
 * open or shut, is pinned to fully clear.
 */
export function glowClearFraction(
  o: Opening,
  amount: number,
  secondAmount?: number,
  shutter?: number,
): number {
  if (shutter !== undefined && shutter <= 0) return 0;
  if (openingIsGlazed(o) && openingMotion(o) !== "roll") return 1;
  return openingClearFraction(o, amount, secondAmount);
}

/**
 * The same answer as {@link glowClearFraction}, placed: which part of the
 * opening the pool comes through, for {@link wallsLightPassesThrough}.
 *
 * Glass and a shut shutter are whole-opening answers and need no placing —
 * all of it or none of it. Everything else defers to {@link
 * openingClearSpan}, which is where a double door's open leaf stops being
 * drawn as a gap in the middle (issue #219).
 */
export function glowClearSpan(
  o: Opening,
  amount: number,
  secondAmount?: number,
  shutter?: number,
): [number, number] {
  if (shutter !== undefined && shutter <= 0) return [0, 0];
  if (openingIsGlazed(o) && openingMotion(o) !== "roll") return [0, 1];
  return openingClearSpan(o, amount, secondAmount);
}

/**
 * Where the clear part of an opening actually is, as a `[start, end]` pair of
 * fractions along its own length — 0 at the jamb the symbol is drawn from, 1
 * at the other, mirrored by `flipH` exactly as the drawing is.
 *
 * {@link openingClearFraction} says how *much* is clear; this says *where*,
 * and the two always agree on the amount (`end - start` is that fraction).
 *
 * It exists for the double door with a sensor on each leaf (issue #219). Each
 * leaf covers its own half and swings out of it from the middle, so one leaf
 * open clears the half that leaf was covering — not the middle. Placed
 * centrally, as the wall gap always was, a lamp in the next room threw its
 * pool through the shut half of the doorway and half of the open half, which
 * is what the reporter saw.
 *
 * Everything else keeps the centred gap it has always had. That is still an
 * approximation for a slider — a single panel really clears the side it slid
 * away from — but it is one this function is not being asked to fix, and
 * moving those would change how every existing plan lights up. A double door
 * with unequal leaves is the case where centring is not close: it is off by a
 * quarter of the opening, and the door is drawn plainly showing which half is
 * open.
 */
export function openingClearSpan(
  o: Opening,
  amount: number,
  secondAmount?: number,
): [number, number] {
  const clear = openingClearFraction(o, amount, secondAmount);
  const centred: [number, number] = [(1 - clear) / 2, (1 + clear) / 2];
  // A sash narrower than its frame is hinged at one jamb with fixed glass
  // beside it, so what it clears is at *that* jamb — never in the middle,
  // where the pane is (issue #218). Placed rather than centred because it can
  // be: `sashSpan` is new config, so no existing plan can light up
  // differently for it, which is exactly the argument that keeps the centred
  // approximation for everything below.
  if (openingSashSpan(o) < 1) {
    const span: [number, number] = [0, clear];
    return o.flipH ? [1 - span[1], 1 - span[0]] : span;
  }
  if (openingMotion(o) !== "swing" || openingSash(o) !== "double") return centred;
  // Each leaf is hinged at its own jamb and covers its own half, so its
  // projection on the wall shrinks toward that jamb as it swings: the first
  // leaf clears outward from the middle to `0.5 - a1/2`, the second to
  // `0.5 + a2/2`. Both open by the same amount and this *is* the centred
  // span, which is why a single-sensor double door is untouched.
  const a1 = Math.max(0, Math.min(1, amount));
  const a2 = Math.max(0, Math.min(1, secondAmount ?? amount));
  const span: [number, number] = [0.5 - a1 / 2, 0.5 + a2 / 2];
  // `flipH` swaps which jamb each leaf hangs on, so the clear half swaps with
  // it — the same mirror {@link openingMirror} applies to the symbol.
  return o.flipH ? [1 - span[1], 1 - span[0]] : span;
}

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
 *
 * A window is the one exception, and it is the caller's rule rather than this
 * function's: a lamp's pool admits light however the sash is sitting, so a
 * caller wanting that reaches for {@link glowClearFraction} instead of {@link
 * openingClearFraction}. This function itself stays agnostic — it just cuts
 * the gap it is handed.
 *
 * The caller supplies how much of each opening is clear — see
 * {@link openingClearFraction} and {@link glowClearFraction}, which is where a
 * two-panel slider's two sensors are reconciled into one number.
 *
 * It may supply **where** instead: a `[start, end]` pair of fractions along
 * the opening places the gap exactly (see {@link openingClearSpan}), which is
 * what a double door with one leaf open needs — the clear half is that leaf's
 * half, not the middle (issue #219). A plain number is still centred, which is
 * what every caller that has no better answer wants.
 *
 * Centring is an approximation worth naming wherever it is still used. A
 * half-open slider really clears the side it slid away from; `converging` is
 * the sharpest case, since its two leaves stack in the centre and what
 * actually clears is a quarter at each jamb — so the gap is the right *size*
 * and the wrong *place*. Those want more than one interval per opening, which
 * this function's one-gap-per-opening shape still cannot say; the amount of
 * light through the wall is right and where it lands is approximate, which a
 * soft radial pool hides most of.
 */
export function wallsLightPassesThrough(
  walls: readonly Wall[],
  openings: readonly Opening[],
  openAmount: (o: Opening) => number | readonly [number, number],
): Wall[] {
  // Resolve each opening once, not once per wall. `openAmount` reads hass on
  // every call, and asking it inside the wall loop made that walls × openings
  // state lookups per render — hundreds, on a plan of any size, to answer the
  // same handful of questions.
  const open: Array<{ o: Opening; span: [number, number] }> = [];
  for (const o of openings) {
    const answer = openAmount(o);
    // A number is a width with no opinion about placement, so it centres; a
    // pair is a placement already worked out. Both are clamped here rather
    // than trusted, since either can arrive from a caller's own arithmetic.
    const clamp = (v: number) => Math.max(0, Math.min(1, v));
    const span: [number, number] =
      typeof answer === "number"
        ? [(1 - clamp(answer)) / 2, (1 + clamp(answer)) / 2]
        : [clamp(Math.min(answer[0], answer[1])), clamp(Math.max(answer[0], answer[1]))];
    if (span[1] > span[0]) open.push({ o, span });
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
    for (const { o, span } of open) {
      // Openings snap onto walls, but they are stored free of them, so an
      // opening belongs to this wall only if it actually lies on it.
      if (pointWallDist(o.x, o.y, w) > OPENING_ON_WALL_EPS) continue;
      const tc = ((o.x - w.x1) * dx + (o.y - w.y1) * dy) / len2;
      // The span runs along the opening's own axis, and the wall may run the
      // other way: a doorway drawn at 180° has its first jamb at the wall's
      // far end. Project the opening's +x onto the wall to find out which,
      // or a placed gap lands mirrored — invisible until one leaf opens.
      const dirSign =
        Math.cos((o.angle * Math.PI) / 180) * dx + Math.sin((o.angle * Math.PI) / 180) * dy >= 0
          ? 1
          : -1;
      const off = (s: number) => (dirSign * (s - 0.5) * o.length) / len;
      // Running the wall backwards flips the span's ends past each other, so
      // order them after projecting rather than before: taken as given, `b >
      // a` fails and the gap is silently dropped — a doorway that stops
      // letting light through because of the direction its wall was drawn.
      const t0 = tc + off(span[0]);
      const t1 = tc + off(span[1]);
      const a = Math.max(0, Math.min(t0, t1));
      const b = Math.min(1, Math.max(t0, t1));
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
  catalog: SymbolCatalog = BUILTIN_SYMBOLS,
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
          // The symbol says which shape its outline is, so a round-bodied piece
          // casts a round shadow. This used to be a hard-coded list of the three
          // round types, kept in sync by hand with the same list in the glyph.
          const roundBase = findSymbol(catalog, f.type)?.footprint === "ellipse";
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
  item: Partial<FloorItem>, // Fixes strict Pick<> forcing entity in tests
  state: string | undefined,
  hass?: RenderHass
): boolean {
  // Advanced hiding logic
  if (item.enableHideByEntity) {
    const targetEntity = item.hideEntity || item.entity;

    // Read state or specific attribute (fixes ignored hideAttribute)
    let evalState: string | number | undefined = state;
    if (targetEntity && hass && hass.states[targetEntity]) {
      evalState = item.hideAttribute
        ? hass.states[targetEntity].attributes[item.hideAttribute]
        : hass.states[targetEntity].state;
    }

    return checkHideCondition(
      evalState,
      item.hideMode,
      item.hideState,
      item.hideOperator as "<" | "<=" | "==" | "!=" | ">=" | ">" | undefined,
      item.hideThreshold,
      item.hideInvert
    );
  }

  // Legacy fallback
  if (!item.hideWhenInactive) return false;
  // No entity, nothing that can be active — hide.
  if (!item.entity) return true;
  return !entityIsActive(item.entity, state);
}

export function itemBadgeHidden(
  item: Partial<FloorItem>,
  state: string | undefined,
  hass?: RenderHass
): boolean {
  if (!item.enableHideBadgeByEntity) return false;

  let evalState: string | number | undefined = state;
  if (hass) {
    const evalEntity = item.hideBadgeEntity || item.entity;
    if (evalEntity && hass.states[evalEntity]) {
      evalState = item.hideBadgeAttribute && hass.states[evalEntity].attributes
        ? String(hass.states[evalEntity].attributes[item.hideBadgeAttribute])
        : hass.states[evalEntity].state;
    }
  }

  return checkHideCondition(
    evalState,
    item.hideBadgeMode,
    item.hideBadgeMatch, // Ensure this property is correctly mapped in your types, or use hideBadgeState
    item.hideBadgeOperator,
    item.hideBadgeThreshold,
    item.hideBadgeInvert
  );
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
  item: Partial<FloorItem>
): string {
  const parts: string[] = [];
  if (item.showName) {
    const friendly = item.entity ? hass?.states[item.entity]?.attributes?.friendly_name as string | undefined : undefined;
    const name = item.name || friendly || item.entity;
    if (name) parts.push(name);
  }

  // Check hide condition for the state label
  let hideStateText = false;
  if (item.enableHideStateByEntity && hass) {
    const evalEntity = item.hideStateEntity || item.entity;
    let evalValue: string | number | undefined;

    if (evalEntity && hass.states[evalEntity]) {
      evalValue = item.hideStateAttribute && hass.states[evalEntity].attributes
        ? hass.states[evalEntity].attributes[item.hideStateAttribute]
        : hass.states[evalEntity].state;
    }

    hideStateText = checkHideCondition(
      evalValue,
      item.hideStateMode,
      item.hideStateMatch,
      item.hideStateOperator,
      item.hideStateThreshold,
      item.hideStateInvert
    );
  }

  // Add primary state only if showState is active and condition is NOT met
  if (!!item.entity && (item.showState ?? item.kind === "sensor") && !hideStateText) {
    // Assuming itemStateText accepts Partial<FloorItem> or is cast correctly
    parts.push(itemStateText(hass, item as FloorItem));
  }

  // Add additional readings ONLY if the hide condition does NOT apply
  if (!hideStateText) {
    for (const reading of itemReadings(item as FloorItem)) {
      if (reading.showState === false) continue;

      const text = itemReadingText(hass, item as FloorItem, reading);
      if (text) parts.push(text);
    }
  }

  return parts.join(" · ");
}

/**
 * States that mean "the sensor did not answer" rather than a value. A hide
 * rule has to treat these differently from a real reading — see
 * `checkHideCondition`.
 */
const HIDE_OUTAGE_STATES = new Set(["unavailable", "unknown"]);

/**
 * Whether a hide condition — threshold or state match — is currently met.
 * Shared by the whole-item, badge and state-text variants so a fix lands once
 * instead of three times.
 *
 * The rule everywhere here is that an *unevaluable* condition never hides. A
 * device disappearing is the one outcome a user cannot debug from the plan:
 * there is nothing left on screen to point at. So a missing value, a missing
 * threshold, an operator the editor never offered, or a sensor that dropped
 * out all leave the device visible — and `invert` does not get to flip that,
 * because it is not a "no" to be negated, it is the absence of an answer.
 *
 * The one exception is an outage the user *named*. "Hide the badge while the
 * sensor is unavailable" is a real rule people write, so a `stateMatch` of
 * `unavailable`/`unknown` is honoured. Only an unnamed outage is ignored,
 * which keeps "hide unless the sensor says X" from quietly deleting the
 * device the day that sensor is renamed.
 */
export function checkHideCondition(
  evalState: string | number | undefined,
  mode: string = "state",
  stateMatch: string | undefined,
  operator: string = "==",
  threshold: number | undefined,
  invert: boolean = false
): boolean {
  // `== null` on purpose: an attribute read straight off hass can be null as
  // easily as undefined, and neither is something to compare against.
  if (evalState == null || evalState === "") return false;

  let isMet = false;

  if (mode === "threshold") {
    // No threshold, no rule — fail to nothing rather than fall through to
    // state matching, which would compare against something unrelated.
    if (threshold === undefined || threshold === null) return false;
    // Number() covers the outage states too: they are not numbers, so a
    // threshold rule on a dead sensor simply does not fire.
    const numericState = Number(evalState);
    if (!Number.isFinite(numericState)) return false;

    switch (operator) {
      case "<": isMet = numericState < threshold; break;
      case "<=": isMet = numericState <= threshold; break;
      case "==": isMet = numericState === threshold; break;
      case "!=": isMet = numericState !== threshold; break;
      case ">=": isMet = numericState >= threshold; break;
      case ">": isMet = numericState > threshold; break;
      // Not an operator the editor offers. Guessing one would hide devices
      // for a reason the config does not state.
      default: return false;
    }
  } else {
    // State mode. Nothing to match against is nothing to act on — without
    // this, flipping the operator to "!=" before typing a match hides the
    // device, since every state differs from "".
    if (stateMatch == null || String(stateMatch).trim() === "") return false;

    // Same normalisation as matchStateRule (trim, then lowercase), so a hide
    // rule and a colour rule agree about a state with stray whitespace.
    const strState = String(evalState).trim().toLowerCase();
    const strMatch = String(stateMatch).trim().toLowerCase();

    // An outage counts only when it is what the user asked for.
    if (HIDE_OUTAGE_STATES.has(strState) && !HIDE_OUTAGE_STATES.has(strMatch)) {
      return false;
    }

    isMet = operator === "!=" ? strState !== strMatch : strState === strMatch;
  }

  return invert ? !isMet : isMet;
}

/**
 * Whether a device draws a label line at all.
 *
 * Was `showName || (showState ?? kind === "sensor")` written out at each call
 * site, which stopped being the whole truth with issue #180: a device can now
 * have a label from its extra readings alone, both toggles off. The editor
 * offers the label's size and position off this, so getting it wrong hides the
 * controls for a label that is on screen.
 *
 * Deliberately *not* "would `itemBadgeLabel` return something": that depends
 * on live state, and a control that vanishes when a sensor drops out is worse
 * than one that is occasionally offered for an empty line.
 */
export function itemHasLabel(item: {
  kind: ItemKind;
  showName?: boolean;
  showState?: boolean;
  secondaryEntity?: string;
  secondaryAttribute?: string;
  readings?: ItemReading[];
}): boolean {
  if (item.showName) return true;
  if (item.showState ?? item.kind === "sensor") return true;
  // Only the readings that actually print count: a device whose every extra
  // entity is bound for the badge alone draws no label, and should not be
  // offered a label's size and position.
  return itemReadings(item).some((r) => r.showState !== false && (r.entity || r.attribute));
}

/**
 * Where a device's label sits (issue #180), resolving anything unrecognised to
 * the historic `below`.
 *
 * Checked rather than trusted for the same reason {@link pressEffectOf} is: the
 * value becomes a class name, so a hand-edited typo would otherwise land as
 * `label-blow`, match no rule, and leave the label in whatever position the
 * base stylesheet happens to give it.
 */
export function labelPositionOf(item: { labelPosition?: LabelPosition }): LabelPosition {
  const v = item.labelPosition;
  return v === "left" || v === "right" ? v : "below";
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

/** Clamp a config area `labelSize` to the same 8–40 range item labels use. */
export function areaLabelSize(v: unknown): number {
  return Math.min(40, Math.max(8, cssNumber(v, DEFAULT_AREA_LABEL_SIZE)));
}

/**
 * Clamp a config wall `thickness` to the skin-safe range at the render sink:
 * at least 2 units, and never past {@link MAX_SKIN_WALL_WIDTH} — the same
 * ceiling a skin's `--fp-skin-wall-width` observes, and for the same reason
 * (see that constant's comment): a wall wider than the doorway mask's cut
 * would not be fully cleared by its own door or window. The editor's slider
 * already stays inside this range; this guards a hand-edited or imported
 * config that doesn't. Falls back to {@link WALL_THICKNESS} for anything
 * unset or unreadable, via `cssNumber`'s shared style-sink guard.
 */
export function wallThickness(v: unknown): number {
  return Math.min(MAX_SKIN_WALL_WIDTH, Math.max(2, cssNumber(v, WALL_THICKNESS)));
}

/**
 * The `stroke-width` declaration for a wall, or `""` to leave it to the
 * skin. A skin sets `--fp-skin-wall-width` on `.wall` (issue #122), and a
 * CSS declaration always beats an SVG presentation attribute — so writing
 * `stroke-width=` directly on the element, the pre-skins approach, has no
 * effect any more. Same fix {@link areaLabelFontSize} used for `.area-label`:
 * write the value inline only when it says something the skin doesn't, so an
 * untouched wall keeps following the skin and an explicit thickness
 * overrides it.
 */
export function wallStrokeStyle(thickness: unknown): string {
  return thickness === undefined ? "" : `stroke-width:${wallThickness(thickness)};`;
}

// ---- overlay scaling --------------------------------------------------------
//
// The card draws in two layers. The SVG is a viewBox scaled to the stage, so
// walls and furniture are resolution-independent. The overlay on top is HTML —
// it has to be, so badges stay upright under rotation and take pointer events —
// and its measures were plain screen pixels. The two only agree when the card
// renders at roughly its canvas size; at half that, every badge and label is
// twice the size the drawing expects and rooms fill up with colliding text.
//
// `overlayScale: plan` expresses those measures in canvas units instead. The
// plan box becomes a query container and `--fp-u` (declared on the overlay
// inside it, see the card's stylesheet) is one canvas unit as a length, so
// `calc(14 * var(--fp-u))` is 14 canvas units however large the card ends up.

/**
 * Coerce a config `overlayScale`. An **absent** value means `fixed`, which is
 * how every plan drawn before the option existed was laid out.
 *
 * Canvas units are the better default and new plans get them — but they get
 * them *written down* ({@link FloorplanCard.getStubConfig}), not inferred from
 * silence. 1.5.0 changed this function's answer for the missing key instead,
 * and that is not a default for new plans: it is a restyle of every plan in
 * the field, applied on upgrade with nothing on screen to say so. It landed
 * hardest where nobody could have opted out — the editor wrote no key at all
 * for `fixed`, being the default at the time, so *choosing* the old behaviour
 * and never touching the setting left identical YAML, and both flipped
 * together. Badges came out at a third of their size on a card narrower than
 * its canvas, and the number in the editor no longer matched the drawing
 * (issue #192).
 *
 * The rule that follows, and the reason {@link projectDisplayForm} now records
 * whichever value is chosen rather than omitting the default: **a config says
 * what it renders as.** A stored `overlayScale` is immune to whatever this
 * function is ever made to answer for silence.
 */
export function normalizeOverlayScale(v: unknown): OverlayScale {
  return v === "plan" ? "plan" : "fixed";
}

/**
 * A CSS length for one overlay measure: screen px under `fixed`, canvas units
 * under `plan`. `units` is already coerced by the caller (cssNumber and the
 * per-measure clamps), which is what makes this safe to drop into an inline
 * `style` — it interpolates a number, never a config string.
 *
 * The `1px` fallback only matters if a caller ever renders outside `.items`,
 * where `--fp-u` is undefined: without it the whole property is invalid at
 * computed-value time and the measure silently inherits. A wrong-but-visible
 * size is the better failure.
 */
export function overlayLength(units: number, scale: OverlayScale): string {
  return scale === "plan" ? `calc(${units} * var(--fp-u, 1px))` : `${units}px`;
}

/**
 * The `font-size` declaration for a room name, or `""` to leave it to the
 * stylesheet.
 *
 * Room names are the one overlay measure with no config option before
 * `overlayScale` landed, so `card-mod` on `.area-label` was the only way to
 * resize them — and an inline style beats any non-`!important` rule. So the
 * size is written inline only when it says something the stylesheet cannot:
 * canvas units under `plan`, or an explicit `labelSize`. An untouched card
 * keeps its rule, and the override that worked before keeps working.
 */
export function areaLabelFontSize(labelSize: unknown, scale: OverlayScale): string {
  if (scale !== "plan" && labelSize === undefined) return "";
  return `font-size:${overlayLength(areaLabelSize(labelSize), scale)};`;
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
 * Two media_player states differ from its plain on/off pair above (issue
 * #206 follow-up): "paused" is on but not mid-playback, and "idle" is on
 * with nothing loaded at all. mdi:television-play used to claim both, which
 * reads as "playing" for a device doing neither.
 */
const MEDIA_PLAYER_STATE_ICONS: Record<string, string> = {
  paused: "mdi:television-pause",
  idle: "mdi:television",
};

/**
 * A climate entity's icon per HVAC mode (issue #206) — its state carries the
 * mode directly, unlike the on/off domains {@link DOMAIN_STATE_ICONS} covers,
 * so a single on/off pair cannot say "cool" from "heat". Every mode HA's own
 * climate.HVACMode enum defines.
 */
const CLIMATE_MODE_ICONS: Record<string, string> = {
  off: "mdi:power",
  heat: "mdi:fire",
  cool: "mdi:snowflake",
  heat_cool: "mdi:sun-snowflake-variant",
  auto: "mdi:thermostat-auto",
  dry: "mdi:water-percent",
  fan_only: "mdi:fan",
};

/**
 * A weather entity's icon per condition (issue #206) — again a state that
 * carries more than on/off, and one this card had no mapping for at all: a
 * weather item drew the bare `defaultIcon` fallback (a plain circle)
 * whatever the sky was doing. Every condition HA's own weather integrations
 * report (`ATTR_CONDITION_*`).
 */
const WEATHER_CONDITION_ICONS: Record<string, string> = {
  "clear-night": "mdi:weather-night",
  cloudy: "mdi:weather-cloudy",
  exceptional: "mdi:alert-circle-outline",
  fog: "mdi:weather-fog",
  hail: "mdi:weather-hail",
  lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy",
  partlycloudy: "mdi:weather-partly-cloudy",
  pouring: "mdi:weather-pouring",
  rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy",
  "snowy-rainy": "mdi:weather-snowy-rainy",
  sunny: "mdi:weather-sunny",
  windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant",
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
  // A climate entity's state *is* its HVAC mode (issue #206) — "cool",
  // "heat", "dry"… never the generic "on" the fallback test looks for, so
  // every mode but the literal "off" read as off forever: the active
  // highlight never lit, and a configured iconAnimation never played on a
  // unit that was very much running. Every mode HA's own climate.HVACMode
  // enum defines, off excluded.
  climate: new Set(["auto", "cool", "dry", "fan_only", "heat", "heat_cool"]),
  // Same trap, one domain over: a paused or idle player is still switched
  // on, just not mid-playback, and "playing" alone left everything else
  // reading as off. "standby" is the one state that means the device itself
  // dropped to low power, so it stays out.
  media_player: new Set(["on", "idle", "playing", "paused", "buffering"]),
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
 * The `hvac_action` values that mean a climate entity is switched on but not
 * moving any air or heat right now — HA's own HVACAction enum, whose other
 * members (heating, cooling, drying, preheating, defrosting, fan) all
 * describe work in progress.
 */
const CLIMATE_IDLE_ACTIONS = new Set(["idle", "off"]);

/**
 * Whether a climate entity is doing something *right now*, as opposed to
 * merely being set to a mode (issue #235, @GhislainC). Its state is the mode
 * the user asked for — a thermostat sitting at temperature reads "cool" all
 * night — while `hvac_action` is what the hardware is doing about it, so a
 * unit that has reached its setpoint reports `cool` / `idle` together.
 *
 * An entity that reports no `hvac_action` at all is treated as working: the
 * attribute is optional in HA, and the alternative is to silently stop
 * animating every integration that omits it.
 */
function climateIsWorking(attributes: Record<string, unknown> | undefined): boolean {
  const action = attributes?.["hvac_action"];
  if (typeof action !== "string") return true;
  return !CLIMATE_IDLE_ACTIONS.has(action);
}

/**
 * Which animation an item's icon should play right now, or undefined for
 * none. Shared by card and editor. Never animates an inactive (or
 * unavailable) entity — including when the config forces "spin"/"pulse": a
 * spinning fan icon is a claim that the fan is running, so it obeys the same
 * fail-closed rule as the active highlight ({@link entityIsActive}).
 *
 * A climate entity extends that same claim one step further (issue #235): its
 * mode is a *setting*, not a fact about moving air, so an idle unit holding
 * "cool" animates nothing however `iconAnimation` is set. The badge still
 * lights — {@link entityIsActive} is untouched, so the AC still reads as on,
 * it just stops pretending to blow. Only the animation is gated, and only
 * when the entity actually reports `hvac_action`.
 *
 * A climate entity in `fan_only` spins regardless of `iconAnimation`
 * (issue #206 follow-up) — its own fan is what's actually running, the same
 * physical fact that makes a `fan` domain entity spin by default, just
 * decided from this entity's *state* rather than its domain. `none` still
 * wins over it: that is a decision to show no animation at all, not a
 * preference between spin and pulse for this one to override. It is gated by
 * `hvac_action` like every other mode: a fan that has stopped is not spinning
 * whatever the mode says.
 */
export function resolveIconAnimation(
  item: { entity?: string; iconAnimation?: IconAnimation },
  state: string | undefined,
  attributes?: Record<string, unknown>,
): "spin" | "pulse" | undefined {
  const mode = item.iconAnimation ?? "auto";
  if (mode === "none") return undefined;
  if (!entityIsActive(item.entity, state)) return undefined;
  if (item.entity?.split(".")[0] === "climate") {
    if (!climateIsWorking(attributes)) return undefined;
    if (state === "fan_only") return "spin";
  }
  if (mode === "spin" || mode === "pulse") return mode;
  return domainIconAnimation(item.entity);
}

/**
 * Device classes a ripple ring is offered for (issue #127). `motion` and
 * `occupancy` are HA's own binary-sensor classes for someone being there;
 * `presence` is the home/away one. `vibration` joins them (issue #202,
 * @GhislainC): a vibration sensor on a door reports the same thing a ring
 * says — something happened at this spot on the plan — so the ring is as true
 * of it as of a motion sensor.
 */
const RIPPLE_DEVICE_CLASSES = new Set(["motion", "occupancy", "presence", "vibration"]);

/**
 * Whether a device detects something happening where it sits, and so should be
 * offered the ripple ring (issue #127) — the same shape of gate as "Cast
 * light" on a `light`.
 *
 * A `device_tracker` or `person` qualifies on its domain alone; a
 * `binary_sensor` needs the device class to say so, which is what separates a
 * motion or vibration sensor from a door contact or a leak detector. A binary
 * sensor with no device class set therefore does not qualify: it could be
 * anything, and guessing from the entity id would ring doorbells and smoke
 * alarms.
 */
export function isRippleEntity(
  entity: string | undefined,
  deviceClass: string | undefined,
): boolean {
  const domain = entity?.split(".")[0];
  if (domain === "device_tracker" || domain === "person") return true;
  return domain === "binary_sensor" && !!deviceClass && RIPPLE_DEVICE_CLASSES.has(deviceClass);
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
  state?: string,
): string | undefined {
  const domain = entityId.split(".")[0];
  // Climate and weather carry more than on/off in their state (issue #206):
  // a climate's state is its HVAC mode, and a weather entity's is its
  // condition, so a single on/off pair — even a correct one — can only ever
  // say two things about a domain with five or fifteen. Checked ahead of
  // the plain on/off table below, and falling back to it (or, for weather,
  // to state === undefined too) covers a state this card doesn't recognise
  // rather than drawing nothing.
  if (domain === "climate")
    return CLIMATE_MODE_ICONS[state ?? ""] ?? (on ? "mdi:thermostat" : "mdi:power");
  if (domain === "weather") return WEATHER_CONDITION_ICONS[state ?? ""] ?? "mdi:weather-cloudy";
  // paused and idle are both "on" by entityIsActive's own rule (issue #206
  // follow-up) — correctly so — but the play glyph the on/off pair below
  // would give both reads as "playing" for a device doing neither. Checked
  // ahead of that pair; every other active state (playing, buffering, the
  // literal "on") still falls through to it.
  if (domain === "media_player" && state) {
    const stateIcon = MEDIA_PLAYER_STATE_ICONS[state];
    if (stateIcon) return stateIcon;
  }
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
      st?.state,
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
 * Which floor a piece of furniture's click leads to (issue #121), or
 * `undefined` when it leads nowhere.
 *
 * `floors` is bottom-to-top, so `up` is the next entry and `down` the
 * previous. Nothing at that end of the list means no target, and the card
 * draws the piece as ordinary furniture: a staircase on the top floor is still
 * a staircase, but it is not a button, because a button that does nothing is
 * worse than no button.
 *
 * Deliberately not wrapping. A plan's floors are a building, and the top of a
 * building is not above the basement — a stair click that teleported you from
 * the loft to the cellar would be a bug report, not a feature.
 */
export function furnitureFloorTarget(
  f: Pick<Furniture, "goToFloor">,
  floors: readonly { id: string }[],
  activeFloorId: string | undefined,
): string | undefined {
  if (f.goToFloor !== "up" && f.goToFloor !== "down") return undefined;
  const i = floors.findIndex((x) => x.id === activeFloorId);
  if (i < 0) return undefined;
  const next = floors[i + (f.goToFloor === "up" ? 1 : -1)];
  return next?.id;
}

/**
 * Which offline treatment a plan uses (issue #162), resolving anything
 * unrecognised to the default — the value becomes a class name, exactly as
 * {@link pressEffectOf}'s does, so an unchecked string would silently mean
 * "no treatment".
 */
export function offlineStyleOf(c: { offlineStyle?: OfflineStyle }): OfflineStyle {
  const v = c.offlineStyle;
  return v === "dim" || v === "strike" || v === "none" ? v : DEFAULT_OFFLINE_STYLE;
}

/**
 * Whether a device's entity has dropped out (issue #162) — the reporter's
 * "offline" ceiling light. Three things count, because on the plan they are
 * the same thing:
 *
 * - `unavailable` — the integration says the device is not answering;
 * - `unknown` — it is answering but has no reading, which is Home Assistant's
 *   other half of the same story (`isSensorOutage`, and the rule every other
 *   fail-closed reader in this file already follows);
 * - **no state at all** — the entity id is not in `hass`. Renamed, deleted, or
 *   from an integration that failed to load. Today that draws a perfectly
 *   ordinary "off" badge for something that does not exist.
 *
 * A device with no entity bound at all is *not* offline: those are the plain
 * markers issue #39 added, and there is nothing about them to be wrong.
 *
 * The caller passes the state string it already looked up, so this stays pure
 * and the card does not resolve the same entity twice. A card with no `hass`
 * yet must not call this — before the first state arrives everything would
 * read as offline, and the plan would flash grey on load.
 */
export function itemIsOffline(item: { entity?: string }, state: string | undefined): boolean {
  if (!item.entity) return false;
  return state === undefined || isSensorOutage(state);
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
  readings?: ItemReading[];
  badgeEntity?: BadgeEntity;
}

/** What a badge is showing, and which of the device's readings it came from. */
export interface BadgeReading {
  text: string;
  /** `"primary"`, or the index into {@link itemReadings} that supplied it. */
  source: "primary" | number;
}

/**
 * Which reading {@link FloorItem.badgeEntity} points at, as an index into
 * {@link itemReadings} — or `"primary"` for the device's own entity, or
 * `undefined` for "work it out".
 *
 * One place translates the stored value, so the historic `"secondary"` (index
 * 0, from when a device had exactly two entities) and a modern index arrive at
 * the same answer and the card and the editor cannot disagree about it. An
 * index past the end of the pool resolves to nothing rather than silently
 * sliding to another reading — a config that names a reading which no longer
 * exists should show its icon, not a number off some other sensor.
 */
export function badgeEntityIndex(v: BadgeEntity | undefined): "primary" | number | undefined {
  if (v === "primary") return "primary";
  if (v === "secondary") return 0;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
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

  // The other readings, resolved from the same pool the label line uses
  // ({@link itemReadings}), so the badge and the label can never disagree
  // about which entity a reading comes from.
  const readings = itemReadings(item);

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

  /** The numeric value of one reading in the pool, or undefined. */
  const readingAt = (i: number): string | undefined => {
    const r = readings[i];
    if (!r) return undefined;
    const entity = r.entity || (r.attribute ? item.entity : undefined);
    if (!entity) return undefined;
    const st = hass.states[entity];
    const attrs = st?.attributes as Record<string, unknown> | undefined;
    if (r.attribute) {
      const n = numericReading(attrs?.[r.attribute]);
      return n === undefined ? undefined : compactNumber(n);
    }
    const n = numericReading(st?.state);
    return n === undefined ? undefined : formatReading(n, attrs?.unit_of_measurement);
  };

  // An explicit choice reads that entity and stops. Falling through to another
  // would quietly show a different device than the one asked for; no number at
  // all is honest, and the badge draws its icon instead.
  const chosen = badgeEntityIndex(item.badgeEntity);
  if (chosen === "primary") {
    const text = primary();
    return text === undefined ? undefined : { text, source: "primary" };
  }
  if (typeof chosen === "number") {
    const text = readingAt(chosen);
    return text === undefined ? undefined : { text, source: chosen };
  }

  // Nothing chosen: the first candidate with a number wins, the device's own
  // entity first. A plug that reads "on" falls through to its power sensor
  // without anything being configured.
  const own = primary();
  if (own !== undefined) return { text: own, source: "primary" };
  for (let i = 0; i < readings.length; i++) {
    const text = readingAt(i);
    if (text !== undefined) return { text, source: i };
  }
  return undefined;
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
 * How an opening moves — `swing` (hinged door / casement window), `slide`
 * (panels travelling along the wall), `roll` (a curtain leaving the floor
 * plane) or `fixed` (issue #218: it does not). Defaults to `swing`.
 */
export function openingMotion(o: Opening): "swing" | "slide" | "roll" | "fixed" {
  return o.motion ?? "swing";
}

/**
 * How much of a single-sash opening its sash covers, 0..1 (issue #218).
 * Clamped, and 1 for everything that has no leftover pane to speak of: a
 * double sash splits the opening between its two leaves, and sliders and
 * roll-ups have panel arithmetic of their own.
 *
 * A `sashSpan` of 0 would be a window with no opening part, which is what
 * `motion: "fixed"` says properly — so it clamps to the smallest sash that
 * still draws rather than silently becoming a fixed pane.
 */
export function openingSashSpan(o: Opening): number {
  if (openingMotion(o) !== "swing" || openingSash(o) !== "single") return 1;
  const raw = o.sashSpan;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 1;
  return Math.max(MIN_SASH_SPAN, Math.min(1, raw));
}

/**
 * Default open/closed state for an opening with no associated entity: only a
 * swing door is drawn open (the familiar swing symbol); windows and sliding
 * openings are drawn closed (intact glass / panels filling the gap). This
 * preserves the look of a static floor plan — a slider drawn open would read as
 * a hole rather than a door.
 *
 * `invert` flips this picture same as it flips a bound entity's reading
 * ({@link resolveOpeningOpen}) — an unbound opening has no sensor to invert,
 * but the intent is the same either way: "the opposite of what this would
 * otherwise draw." A swing door marked `invert: true` and left unbound draws
 * shut; an unbound window marked the same way draws open.
 */
export function openingDefaultOpen(o: Opening): boolean {
  const natural = o.type === "door" && openingMotion(o) === "swing";
  return o.invert ? !natural : natural;
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
export function sliderStyleOf(o: Opening): SliderStyle {
  return openingMotion(o) === "slide" ? (o.sliderStyle ?? "single") : "single";
}

/**
 * Whether a slider style draws **two** moving panels, and so has a second leaf
 * for `secondaryEntity` to drive (issue #145). `single` and `bypass` both move
 * one panel — bypass's other panel is fixed — so neither qualifies.
 *
 * Takes the style rather than the opening because the editor asks about a style
 * the user has just picked, before it is on any opening.
 */
export function sliderStyleHasTwoLeaves(style: SliderStyle): boolean {
  return style === "biparting" || style === "biparting-bypass" || style === "converging";
}

/**
 * Whether an opening has **two** moving leaves, and so a second one for
 * `secondaryEntity` to drive. The single predicate everything downstream keys
 * off — the editor's field, the card's resolver, which drawing reads the
 * second amount — so widening it is what gives a new shape per-leaf sensors
 * (issue #159).
 *
 * Two shapes qualify, for the same reason:
 *
 * - a **hinged double** — a casement window's two sashes, or the double door
 *   #168 added — each leaf on its own jamb, each with its own contact;
 * - a **two-panel slider** (issue #145), by {@link sliderStyleHasTwoLeaves}.
 *
 * A single-leaf swing door does not: there is nothing to split. Nor does a
 * roll-up, whose curtain is one piece.
 */
export function openingHasTwoLeaves(o: Opening): boolean {
  return openingMotion(o) === "swing"
    ? openingSash(o) === "double"
    : sliderStyleHasTwoLeaves(sliderStyleOf(o));
}

/**
 * The second leaf as an opening in its own right, so it can go through
 * {@link resolveOpeningAmount} / {@link openingIsActive} unchanged rather than
 * threading a "which leaf" argument down the whole resolver chain (issue #145).
 * Shares the geometry and `invert`; only the bound entity differs. Callers must
 * check {@link openingHasTwoLeaves} and a set `secondaryEntity` first — with no
 * entity this resolves to the type default, not to the first leaf's state.
 */
export function secondLeafOf(o: Opening): Opening {
  return { ...o, entity: o.secondaryEntity };
}

/**
 * How many hinged leaves an opening has, when nothing is stated: a window
 * opens with two casement sashes, a door with one leaf.
 *
 * Two different defaults for one field, because they are the two ordinary
 * cases. A window drawn with a single sash is the exception (issue #73); a
 * double door is the exception the other way round, and until now not
 * expressible at all — every door was drawn as one leaf across the whole
 * opening, however wide.
 */
export function defaultSash(type: OpeningType): "single" | "double" {
  return type === "window" ? "double" : "single";
}

/**
 * The leaf count the swing symbol draws. Only hinged openings have leaves, so
 * a slider or a roller reports its type's default and nothing reads it.
 *
 * Supersedes `windowSash`, which answered this for windows only and told
 * doors they were "double" — harmless while the door branch ignored it, and
 * wrong the moment a door could have two leaves.
 */
export function openingSash(o: Opening): "single" | "double" {
  return openingMotion(o) === "swing" ? (o.sash ?? defaultSash(o.type)) : defaultSash(o.type);
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
  invert = false,
): number {
  // The outage check comes first, before `invert` can touch anything: a
  // dropout must fail closed, and inverting one would turn "we don't know"
  // into a shutter drawn wide open (see {@link isSensorOutage}).
  if (!state || isSensorOutage(state.state)) return 0;
  const pos = state.attributes?.current_position;
  if (typeof pos === "number" && Number.isFinite(pos)) {
    const frac = Math.max(0, Math.min(1, pos / 100));
    return invert ? 1 - frac : frac;
  }
  const open =
    state.state === "open" || state.state === "opening" || state.state === "closing" ||
    state.state === "on";
  return (invert ? !open : open) ? 1 : 0;
}

/**
 * Whether the shutter layer wears the accent — drawn (partly) open or still in
 * transit, matching {@link openingIsActive}'s "active = open" semantics.
 *
 * `invert` flips the reading, not the motion: a cover reporting `opening` or
 * `closing` is active either way round, because something is moving out there
 * whichever end of the travel the contact calls "open".
 */
export function shutterActive(
  state: { state: string; attributes?: Record<string, unknown> } | undefined,
  invert = false,
): boolean {
  if (!state || isSensorOutage(state.state)) return false;
  return shutterAmount(state, invert) > 0 || state.state === "opening" || state.state === "closing";
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

/** An opening's two bindable entities, and the actions it may carry. */
type PressableOpening = Pick<
  Opening,
  "entity" | "shutterEntity" | "tapTarget" | "tap_action" | "hold_action" | "double_tap_action"
>;

/** What a gesture on an opening resolves to: an action, and what it acts on. */
export interface OpeningPress {
  /** The entity the action targets. Absent for an action that needs none (navigate, url). */
  entity?: string;
  config: ActionConfig;
}

/**
 * Which action a gesture on an opening performs, and on **which** of its two
 * entities (issue #74 follow-up). An opening can bind the window/door itself
 * and its external shutter; only the first was ever reachable.
 *
 * The rule that shapes the rest: a tap is never *silently* retargeted at the
 * shutter motor. Tapping is the gesture people make by accident, the shutter
 * is real hardware that takes seconds to travel, and moving it because the
 * plan quietly decided the shutter was the more interesting entity is exactly
 * the accidental-hardware-move that issue #47 took out of the device defaults.
 * So by default the tap stays on the opening and the shutter is reached by
 * holding — until {@link Opening.tapTarget} says otherwise, which is a
 * decision rather than an accident.
 *
 * - A configured `*_action` always wins. Its own `entity` picks which of the
 *   two it acts on; without one it acts on the primary.
 * - **primary** is the opening's `entity`, falling back to the shutter, so a
 *   shutter-only opening is pressable at all. `tapTarget: "shutter"` swaps the
 *   two over, but only when both are bound.
 * - **secondary** is whichever one the primary is not, and only exists when
 *   both are bound — otherwise it would be the same entity under another name.
 * - Tap defaults to toggling an open/close-capable `cover`, else more-info
 *   ({@link openingClickAction}); hold defaults to more-info on the secondary;
 *   double-tap defaults to nothing.
 */
export function openingActionForGesture(
  o: PressableOpening,
  gesture: "tap" | "hold" | "double_tap",
  featuresOf: (entityId: string) => number,
): OpeningPress | undefined {
  const opening = o.entity || undefined;
  const shutter = o.shutterEntity || undefined;
  // Only a genuine choice: with one entity bound there is nothing to swap.
  const leadsWithShutter = !!(opening && shutter && o.tapTarget === "shutter");
  const primary = leadsWithShutter ? shutter : (opening ?? shutter);
  const secondary = opening && shutter ? (leadsWithShutter ? opening : shutter) : undefined;
  const configured =
    gesture === "tap" ? o.tap_action : gesture === "hold" ? o.hold_action : o.double_tap_action;
  if (configured) return { entity: configured.entity ?? primary, config: configured };
  if (gesture === "tap") {
    if (!primary) return undefined;
    return {
      entity: primary,
      config: {
        action:
          // Pointing the tap at the shutter opens its dialog; it does not
          // drive the motor. Choosing *which* entity answers is not the same
          // as choosing to move hardware on a tap, and that second decision
          // stays where it is explicit — `tap_action: toggle` (issue #47).
          !leadsWithShutter &&
          openingClickAction(primary, featuresOf(primary)) === "cover-toggle"
            ? "toggle"
            : "more-info",
      },
    };
  }
  // Hold reaches whichever entity the tap left alone.
  if (gesture === "hold" && secondary) return { entity: secondary, config: { action: "more-info" } };
  return undefined;
}

/**
 * What a gesture on a room resolves to (issue #181), or `undefined` for
 * "nothing configured".
 *
 * Tap is the one with a prior claim: an area has zoomed to itself on tap since
 * zooming existed, and plans rely on it. So this answers only for *configured*
 * actions, and the card falls back to the zoom when tap resolves to nothing —
 * which keeps every existing plan behaving exactly as it did, and leaves hold
 * and double-tap free for a room that wants both.
 *
 * The action's own `entity` wins, else the area's. A room bound to a presence
 * sensor can therefore say `tap_action: { action: toggle }` and mean it,
 * without naming the entity twice.
 */
export function areaActionForGesture(
  a: Pick<Area, "entity" | "tap_action" | "hold_action" | "double_tap_action">,
  gesture: "tap" | "hold" | "double_tap",
): { entity?: string; config: ActionConfig } | undefined {
  const configured =
    gesture === "tap" ? a.tap_action : gesture === "hold" ? a.hold_action : a.double_tap_action;
  if (!configured) return undefined;
  return { entity: configured.entity ?? a.entity, config: configured };
}

/**
 * Whether a room does anything a plain zoom would not — i.e. whether any of
 * its three gestures is configured.
 *
 * The card uses it for the `button` role and the tab stop. Not for the *hit
 * target*: every area is already tappable because every area zooms, so unlike
 * an opening there is no affordance here that has to be earned.
 */
export function areaHasActions(
  a: Pick<Area, "tap_action" | "hold_action" | "double_tap_action">,
): boolean {
  return (["tap", "hold", "double_tap"] as const).some((g) =>
    hasAction(areaActionForGesture(a, g)?.config),
  );
}

/**
 * Whether pressing an opening does anything at all — the mirror of
 * {@link itemIsInteractive}, and used for the same things: the hit target, the
 * `button` role and the tab stop. An opening with nothing bound draws no
 * affordance it cannot honour, and a shutter-only opening finally gets one.
 */
export function openingIsPressable(
  o: PressableOpening,
  featuresOf: (entityId: string) => number,
): boolean {
  return (["tap", "hold", "double_tap"] as const).some((g) =>
    hasAction(openingActionForGesture(o, g, featuresOf)?.config),
  );
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
  // Fail closed before applying invert — a stale "open" while we have no
  // reliable reading is worse than showing closed.
  if (openingReadingFailsClosed(o.entity, state)) return false;
  const open = openingEntityReadsOpen(o.entity, state);
  return o.invert ? !open : open;
}

/**
 * States that mean "no reliable reading", so the opening draws shut and
 * `invert` does not get to flip that into a door standing open.
 *
 * The outages every entity can report, plus one the lock domain adds:
 * **`jammed`**, which is a lock that tried to move and could not. The bolt is
 * neither thrown nor withdrawn — or is, and the lock does not know — so it is
 * the same "we do not know" the dropouts are, not a third open/closed reading.
 * Treating it as merely "not unlocked" would leave `invert: true` drawing a
 * jammed front door wide open, which is the one picture a jam must not paint.
 *
 * Lock-domain only: no other domain reports `jammed`, and a hypothetical
 * `sensor.jammed` reading the literal word should keep meaning whatever its
 * own domain says.
 */
function openingReadingFailsClosed(entityId: string, state: string): boolean {
  if (isSensorOutage(state)) return true;
  return entityId.split(".")[0] === "lock" && state === "jammed";
}

/**
 * Whether a bound entity's raw state means "open", by the rules of its domain.
 *
 * A **lock** says it the domain's own way (issue #176): `locked` is a shut
 * door and `unlocked` an open one, and neither word is `on` or `open`, so the
 * generic test called every lock closed forever. The states that count come
 * from {@link entityIsActive} rather than a second list here — that table
 * already answers "is this lock doing its active thing" for devices, and two
 * copies of it would be two chances for a door and its badge to disagree about
 * the same entity.
 *
 * Everything else keeps the generic reading: `on`/`open` are open, and
 * `opening`/`closing` are transient cover states — the cover is in motion and
 * not fully closed, so it draws open.
 */
function openingEntityReadsOpen(entityId: string, state: string): boolean {
  if (entityId.split(".")[0] === "lock") return entityIsActive(entityId, state);
  return state === "on" || state === "open" || state === "opening" || state === "closing";
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
 *
 * `side` picks which face of the wall they hang on: `1` (default) is the far
 * side from the sashes, `-1` the sash's own side, for a window whose outside
 * is the near side of the wall. It flips both the offset and the fold
 * direction, so the panels still swing *away* from the wall either way.
 *
 * `tone2` / `amt2` are the right-hand panel's, for a shutter with a contact on
 * each panel (issue #159). They default to the left's, so a single-sensor
 * shutter folds symmetrically exactly as it always has.
 */
function swingShutter(
  length: number,
  cutH: number,
  tone: string,
  amt: number,
  side: 1 | -1 = 1,
  tone2: string = tone,
  amt2: number = amt
): SVGTemplateResult {
  const half = length / 2;
  const t = 3;
  // Sit the panels beyond the wall band, clear of the sashes on their side.
  const y0 = side * (cutH / 2 + t / 2);
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
        <g class="fp-door-leaf" style="transform:rotate(${side * 90 * amt}deg);">
          <rect x="0" y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
          ${louvers(0, half)}
        </g>
      </g>
      <g transform="translate(${half} ${y0})">
        <g class="fp-leaf-r" style="transform:rotate(${-side * 90 * amt2}deg);">
          <rect x=${-half} y=${-t / 2} width=${half} height=${t} style="fill:${tone2};" />
          ${louvers(-half, half)}
        </g>
      </g>`;
}

/**
 * How far off the wall centre line the shutter badge sits, in canvas units.
 * Clear of the wall band, the hinged panels (which reach ~9) and the roll
 * curtain, so it never lands on the thing it is describing.
 */
export const SHUTTER_MARK_OFFSET = 22;

/**
 * A second offset for the badge, in **screen pixels**, applied on top of
 * {@link SHUTTER_MARK_OFFSET}.
 *
 * Two offsets because two things have to be cleared, and they are measured in
 * different units. The wall and the shutter panels are canvas units and shrink
 * with the plan; the badge is a fixed 22px and does not. With only the canvas
 * offset, a plan drawn on a large canvas in a narrow card pulls the badge so
 * close that its own circle covers the opening underneath — and the opening is
 * a tap target, so it stops being comfortably hittable.
 *
 * Sized against the badge's own radius (11px) plus air, so the opening stays
 * clear at any scale.
 */
export const SHUTTER_MARK_PIXEL_OFFSET = 14;

/**
 * The badge's own size, and its glyph's. In the same unit as
 * {@link SHUTTER_MARK_PIXEL_OFFSET} — screen pixels by default, canvas units
 * under `overlayScale: plan` (#148), which is why the offset above is sized
 * against it: both have to answer to the same choice or the badge lands on the
 * opening at one scale and floats away at another.
 */
export const SHUTTER_MARK_SIZE = 22;
export const SHUTTER_MARK_ICON_SIZE = 15;

/**
 * The direction the shutter badge is pushed, as a unit vector in **screen**
 * space — the opening's normal, mirrored by `flipV` like the drawn shutter,
 * then turned by the plan's own display rotation (issue #33), since the badge
 * lives in the HTML overlay and does not rotate with the SVG.
 */
export function shutterMarkNormal(
  o: Pick<Opening, "angle" | "flipV">,
  rot: PlanRotation = 0,
): { x: number; y: number } {
  const s = o.flipV ? -1 : 1;
  const rad = (o.angle * Math.PI) / 180;
  const n = { x: -Math.sin(rad) * s, y: Math.cos(rad) * s };
  // The linear half of rotatePlanPoint: (x,y) → (−y,x) at 90°, and so on.
  if (rot === 90) return { x: -n.y, y: n.x };
  if (rot === 180) return { x: -n.x, y: -n.y };
  if (rot === 270) return { x: n.y, y: -n.x };
  return n;
}

/**
 * Where an opening's shutter badge sits, in plan coordinates (issue #74
 * follow-up).
 *
 * The badge is HTML, not SVG — it holds a real `ha-icon` and has to stay
 * upright and screen-sized — so the position is worked out here rather than
 * falling out of the symbol's own transform. It follows the shutter to the
 * outside of the wall: the offset is taken along the opening's normal and
 * mirrored by `flipV`, which is what moves the drawn shutter too.
 */
export function shutterMarkPoint(
  o: Pick<Opening, "x" | "y" | "angle" | "flipV">,
  offset: number = SHUTTER_MARK_OFFSET,
): { x: number; y: number } {
  const dy = (o.flipV ? -1 : 1) * offset;
  const rad = (o.angle * Math.PI) / 180;
  return { x: o.x - Math.sin(rad) * dy, y: o.y + Math.cos(rad) * dy };
}

/**
 * Whether an opening earns a shutter badge: both entities bound, and not
 * switched off (issue #74 follow-up).
 *
 * The badge exists because the second entity is otherwise invisible — the plan
 * draws the shutter, but nothing says the symbol answers to two different
 * things, so press-and-hold is a gesture you would have to already know about
 * to find. With one entity bound there is no second thing to reveal.
 *
 * On by default, because a discoverability aid nobody switches on helps
 * nobody. Off is for the plan where every window has a shutter and the icons
 * become the loudest thing on it; the gestures keep working either way.
 */
export function hasShutterMark(
  o: Pick<Opening, "entity" | "shutterEntity" | "showShutterIcon">,
): boolean {
  return !!(o.entity && o.shutterEntity) && (o.showShutterIcon ?? true);
}

/** Last-resort shutter glyphs, for an entity with no device class of its own. */
const SHUTTER_FALLBACK_ICON = { on: "mdi:window-shutter-open", off: "mdi:window-shutter" };

/** The same, for an opening's own badge — a door reads as a door, glass as glass. */
const OPENING_FALLBACK_ICON: Record<OpeningType, { on: string; off: string }> = {
  door: { on: "mdi:door-open", off: "mdi:door-closed" },
  window: { on: "mdi:window-open", off: "mdi:window-closed" },
};

/**
 * The badge glyph for one bound entity: the author's override first, then the
 * entity's **own** icon resolved exactly as Home Assistant resolves it —
 * registry override, then the icon on the state, then the domain/device-class
 * default — and a state-aware pair as the last resort.
 *
 * Shared by both badges an opening can draw, because "show whatever this
 * entity shows everywhere else in HA" is the same promise either time. `open`
 * is the already-inverted reading, so a sensor wired the other way round still
 * picks the right half of every pair.
 */
function markIcon(
  entityId: string,
  configured: string | undefined,
  st: { state: string; attributes?: Record<string, unknown> } | undefined,
  open: boolean,
  fallback: { on: string; off: string },
  registryIcon?: string,
): string {
  // The author's own choice first, as it is for a device (issue #106) — the
  // one candidate that is a decision rather than a default.
  const chosen = cssIcon(configured);
  if (chosen) return chosen;
  const registry = cssIcon(registryIcon);
  if (registry) return registry;
  const attr = cssIcon(st?.attributes?.icon);
  if (attr) return attr;
  return (
    entityDefaultIcon(entityId, st?.attributes?.device_class as string | undefined, open) ??
    (open ? fallback.on : fallback.off)
  );
}

/**
 * The glyph for an opening's shutter badge — the shutter entity's **own**
 * icon, resolved exactly as Home Assistant resolves it, so the badge shows
 * whatever that entity shows everywhere else in HA: the registry override
 * first, then the icon on the state, then the domain/device-class default.
 *
 * State-aware at every level: HA's own defaults are pairs (a `shutter` cover
 * reads `window-shutter-open` while open), so the glyph itself carries the
 * open/closed reading rather than only its colour. `open` is the already
 * inverted reading from {@link shutterAmount}, so a reed contact wired the
 * other way round still picks the right half of the pair.
 */
export function shutterMarkIcon(
  o: Pick<Opening, "shutterEntity" | "shutterIcon">,
  st: { state: string; attributes?: Record<string, unknown> } | undefined,
  open: boolean,
  registryIcon?: string,
): string {
  return markIcon(
    o.shutterEntity ?? "",
    o.shutterIcon,
    st,
    open,
    SHUTTER_FALLBACK_ICON,
    registryIcon,
  );
}

/**
 * Whether an opening draws a badge for its **own** entity (issue #154
 * follow-up).
 *
 * Off unless asked for, unlike the shutter's: the symbol already carries the
 * state for anything that stays on screen while it moves. A roll-up is the
 * case that doesn't — its curtain leaves the floor plane, so wide open there
 * is only a coloured track line left, which is a lot to read across a room.
 */
export function hasOpeningMark(o: Pick<Opening, "entity" | "showIcon">): boolean {
  return !!o.entity && (o.showIcon ?? false);
}

/**
 * The glyph for that badge — the opening entity's own icon, on the same terms
 * as the shutter's, falling back to a door/window pair for an entity with no
 * device class to speak for it.
 */
export function openingMarkIcon(
  o: Pick<Opening, "type" | "entity" | "icon">,
  st: { state: string; attributes?: Record<string, unknown> } | undefined,
  open: boolean,
  registryIcon?: string,
): string {
  return markIcon(
    o.entity ?? "",
    o.icon,
    st,
    open,
    OPENING_FALLBACK_ICON[o.type] ?? OPENING_FALLBACK_ICON.door,
    registryIcon,
  );
}

/**
 * Where that badge sits, and which way it is pushed: the mirror image of the
 * shutter's, on the other face of the wall.
 *
 * Not a style choice — it is what keeps the two badges apart. A shutter hangs
 * outside, so its badge follows it there; the opening belongs to the room, so
 * its own badge sits inside. An opening drawing both then has one on each
 * side, at any angle and under any `flipV`, without either having to know the
 * other exists.
 */
export function openingMarkPoint(
  o: Pick<Opening, "x" | "y" | "angle" | "flipV">,
): { x: number; y: number } {
  return shutterMarkPoint(o, -SHUTTER_MARK_OFFSET);
}

export function openingMarkNormal(
  o: Pick<Opening, "angle" | "flipV">,
  rot: PlanRotation = 0,
): { x: number; y: number } {
  const n = shutterMarkNormal(o, rot);
  return { x: -n.x, y: -n.y };
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
   *
   * `accent` is the shutter's own — it may read differently from the sash it
   * covers — and falls back to the opening's. `flip` hangs hinged panels on
   * the sash's own side of the wall; the roll curtain ignores it, being drawn
   * symmetrically about the wall line.
   */
  shutter?: {
    amount: number;
    active?: boolean;
    style?: "roll" | "swing";
    accent?: string;
    flip?: boolean;
    /**
     * The hinged shutter's **other** panel, when it has a contact of its own
     * (issue #159) — the second half of a pair of persiane, one folded back
     * and one still across the glass. Omitted, both panels share `amount` and
     * `active`, which is what a single-sensor shutter has always drawn. The
     * roll curtain ignores it: a rolling slat band is one piece.
     */
    second?: { amount: number; active?: boolean };
  };
  /**
   * The opening's second leaf, when it has a sensor of its own — a biparting
   * slider's other panel (issue #145), or the other sash of a hinged double
   * (issue #159). Omitted — the only case before those issues — leaves both
   * leaves sharing `amount` and `active`, so a single-entity opening moves
   * symmetrically exactly as it always has. Ignored by anything with one leaf.
   */
  second?: { amount: number; active?: boolean };
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
  // The second leaf's own state, when it has a sensor of its own (issues #145,
  // #159). Omitted it mirrors the first, which is what every opening drew
  // before there was a second sensor to read. Resolved here rather than inside
  // a branch because two shapes now have two leaves — sliding panels and a
  // hinged double — and both read the same pair.
  const amt2 = style.second ? Math.max(0, Math.min(1, style.second.amount)) : amt;
  const tone2 = style.second
    ? cssColorOr(style.second.active ? accent : color, SKIN_ACCENT)
    : tone;

  let body: SVGTemplateResult;
  if (openingMotion(o) === "swing") {
    // One symbol for every hinged opening. A single-sash window (issue #73)
    // and a plain door draw the same thing; so do a double door and a pair of
    // casement leaves. The differences are the leaf count and the jambs, so
    // those are what this branch decides — rather than three near-copies of
    // the same markup, which is how the door came to have no way of being a
    // double at all.
    const two = openingSash(o) === "double";
    // One leaf spans the opening; two split it. A single sash may also be
    // narrower than its frame (issue #218), the rest of which is fixed glass.
    // The arc radius follows, because it is the path the leaf's own tip
    // sweeps — a half-width sash sweeps a half-width quarter-circle.
    const span = openingSashSpan(o);
    const leafW = two ? half : o.length * span;
    const arcLen = (Math.PI / 2) * leafW;
    // Revealed via stroke-dashoffset so each arc "draws on" as its leaf opens.
    // Each arc is drawn from its own leaf's state, so a pair of casement sashes
    // with a contact each traces two different arcs (issue #159).
    const arc = (d: string, tn: string, a: number) => svg`<path class="fp-door-arc" d=${d}
              fill="none" stroke-width="1.5" stroke-dasharray=${arcLen}
              style="stroke:${tn};stroke-dashoffset:${arcLen * (1 - a)};" />`;
    // Jambs are what say "glass": a door is drawn by its leaf and arc alone,
    // and that is what tells the two symbols apart at a glance.
    const jambs =
      o.type === "window"
        ? svg`
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />`
        : nothing;
    body = svg`
        ${jambs}
        ${
          two
            ? // Two leaves hinged at opposite jambs, meeting in the middle when
              // shut and each tracing its own quarter circle outward.
              svg`${arc(`M 0 0 A ${half} ${half} 0 0 0 ${-half} ${-half}`, tone, amt)}${arc(
                `M 0 0 A ${half} ${half} 0 0 1 ${half} ${-half}`,
                tone2,
                amt2
              )}`
            : // Hinged at the −x jamb, so the tip starts `leafW` along the wall
              // and ends `leafW` out from it. At full span that is exactly the
              // arc this drew before `sashSpan` existed.
              arc(`M ${-half + leafW} 0 A ${leafW} ${leafW} 0 0 0 ${-half} ${-leafW}`, tone, amt)
        }
        ${
          // The pane the sash does not cover: fixed glass, drawn in the base
          // colour because it never opens and so is never the active part.
          // Nothing at full span, which is every opening that predates this.
          span < 1
            ? svg`<line x1=${-half + leafW} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width=${o.type === "window" ? 1.5 : 2.5} />`
            : nothing
        }
        <!-- leaf hinged at the left jamb (flipH mirrors it to the right one) -->
        <g transform="translate(${-half} 0)">
          <g class="fp-door-leaf" style="transform:rotate(${-90 * amt}deg);">
            <rect x="0" y="-1.25" width=${leafW} height="2.5" style="fill:${tone};" />
          </g>
        </g>
        ${
          two
            ? // The other leaf, on its own sensor when it has one (issue #159):
              // a casement pair with a contact per sash draws left-open /
              // right-shut, exactly as a two-sensor slider parts unevenly.
              svg`<g transform="translate(${half} 0)">
          <g class="fp-leaf-r" style="transform:rotate(${90 * amt2}deg);">
            <rect x=${-half} y="-1.25" width=${half} height="2.5" style="fill:${tone2};" />
          </g>
        </g>`
            : nothing
        }
      `;
  } else if (openingMotion(o) === "fixed") {
    // A window that does not open (issue #218): a bay window, a picture
    // window, a sealed pane. Jambs and glass, no leaf, no arc, no track —
    // there is nothing here that could move, which is the whole statement.
    //
    // Drawn from `color` rather than `tone` on purpose: `tone` is the accent a
    // moving part wears while it is open, and this one is never either. A
    // fixed pane with a contact bound to it (people do bind them, for the tap
    // target and the badge) must not light up as though it had swung.
    const t = o.type === "window" ? 1.5 : 2.5; // glass vs solid panel
    body = svg`
        ${
          o.type === "window"
            ? svg`
        <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />
        <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
              stroke=${color} stroke-width="2" />`
            : nothing
        }
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width=${t} />`;
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
        <!-- Track: stays when the curtain is up so the gap still reads as an
             opening — and wears the accent while the cover is open or moving
             (issue #154). Wide open the curtain has scaled away to nothing, so
             this line is the *only* mark left: drawn in the base colour it read
             exactly like a shut garage, which is the one thing it must not do.
             Full strength when accented, since a 0.6 tint of the accent reads
             as neither colour. -->
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${tone} stroke-width="0.75" opacity=${active ? 1 : 0.6} />
        ${rollCurtain(o.length, tone, amt)}`;
  } else {
    // Sliding — the last of the three motions, so the fallback.
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
      body = svg`
        ${jambs}
        <!-- track -->
        <line x1=${-half} y1="0" x2=${half} y2="0"
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <g class="fp-slide-panel" style="transform:translateX(${-half * amt}px);">
          <rect x=${-half} y=${-t / 2} width=${half} height=${t} style="fill:${tone};" />
        </g>
        <g class="fp-slide-panel" style="transform:translateX(${half * amt2}px);">
          <rect x="0" y=${-t / 2} width=${half} height=${t} style="fill:${tone2};" />
        </g>`;
    } else if (sliderStyle === "biparting-bypass") {
      // Biparting over fixed panels (issue #145) — the patio / bay slider. The
      // opening divides into four: a fixed panel at each jamb on the front
      // track, and two moving panels on the back track that meet in the middle
      // and part until each sits over the fixed panel on its side. Nothing
      // recesses into the wall, so travel is a quarter of the opening rather
      // than half, and even wide open the outer quarters stay glazed — which is
      // the whole difference from `biparting` and the reason it can't be faked
      // by clamping that one's travel.
      const off = 1.75; // half the gap between the two tracks, as in bypass
      const q = half / 2; // one panel: the opening splits into four
      body = svg`
        ${jambs}
        <!-- tracks -->
        <line x1=${-half} y1=${-off} x2=${half} y2=${-off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <line x1=${-half} y1=${off} x2=${half} y2=${off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <!-- fixed panels: outer quarters, front track. Never accented, even
             wide open — the accent marks what has moved, and lighting these
             would accent exactly the half that is still glazed shut. -->
        <rect x=${-half} y=${off - t / 2} width=${q} height=${t} fill=${color} />
        <rect x=${half - q} y=${off - t / 2} width=${q} height=${t} fill=${color} />
        <!-- moving panels: inner quarters, back track -->
        <g class="fp-slide-panel" style="transform:translateX(${-q * amt}px);">
          <rect x=${-q} y=${-off - t / 2} width=${q} height=${t} style="fill:${tone};" />
        </g>
        <g class="fp-slide-panel" style="transform:translateX(${q * amt2}px);">
          <rect x="0" y=${-off - t / 2} width=${q} height=${t} style="fill:${tone2};" />
        </g>`;
    } else if (sliderStyle === "converging") {
      // Two moving panels and nothing else (issue #145) — the slider whose
      // leaves are both operable. They ride parallel tracks, so neither blocks
      // the other, and they travel *toward* each other until they stack over
      // the middle half: the mirror image of `biparting-bypass`, which clears
      // the middle and leaves the ends glazed.
      //
      // Travel is a quarter, not a panel's full width, and that is the whole
      // design of this style. A leaf physically can slide its own width, right
      // across its neighbour — but then two open leaves simply swap sides and
      // cover the opening again, which is the one thing a floor plan must not
      // draw. Parking each at the halfway point makes both-open the case it
      // reads as: stacked in the middle, a quarter clear at each jamb. The
      // price is that a single open leaf draws a quarter clear rather than the
      // half it could reach, and that is the right way round — under-promising
      // the gap you can walk through beats inventing one that isn't there.
      const off = 1.75; // half the gap between the two tracks, as in bypass
      const q = half / 2; // each panel parks over the middle half
      body = svg`
        ${jambs}
        <!-- tracks -->
        <line x1=${-half} y1=${-off} x2=${half} y2=${-off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <line x1=${-half} y1=${off} x2=${half} y2=${off}
              stroke=${color} stroke-width="0.75" opacity="0.6" />
        <!-- both panels move, so both take the accent on their own state:
             front track travels right, back track left, and they meet. -->
        <g class="fp-slide-panel" style="transform:translateX(${q * amt}px);">
          <rect x=${-half} y=${off - t / 2} width=${half} height=${t} style="fill:${tone};" />
        </g>
        <g class="fp-slide-panel" style="transform:translateX(${-q * amt2}px);">
          <rect x="0" y=${-off - t / 2} width=${half} height=${t} style="fill:${tone2};" />
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
  }
  // Orientation mirrors are applied as a single scale wrapper inside the
  // place-into-position transform, so the base symbol (drawn once, centered at
  // the origin) reflects into any of the four hinge/swing orientations.
  // External shutter layer (issue #74): the roll curtain rides on top of the
  // sash so a shut shutter visibly covers an open window. Its own
  // active/accent state is independent of the window's.
  if (style.shutter) {
    const shutterTone = cssColorOr(
      style.shutter.active ? (style.shutter.accent ?? accent) : color,
      SKIN_ACCENT
    );
    const shutterAmt = Math.max(0, Math.min(1, style.shutter.amount));
    // The hinged pair's other panel, on its own contact when it has one
    // (issue #159); without one it folds with the first, as before.
    const second = style.shutter.second;
    const shutterTone2 = second
      ? cssColorOr(
          second.active ? (style.shutter.accent ?? accent) : color,
          SKIN_ACCENT
        )
      : shutterTone;
    const shutterAmt2 = second ? Math.max(0, Math.min(1, second.amount)) : shutterAmt;
    body = svg`${body}${
      style.shutter.style === "swing"
        ? swingShutter(
            o.length,
            cutH,
            shutterTone,
            shutterAmt,
            style.shutter.flip ? -1 : 1,
            shutterTone2,
            shutterAmt2
          )
        : rollCurtain(o.length, shutterTone, shutterAmt)
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

/**
 * The rotation a plan is actually drawn at, given which way the screen is
 * (issue #237).
 *
 * `rotation` is the answer for both orientations until one of the two
 * overrides says otherwise, so a config that sets neither behaves exactly as
 * it did before this existed — including a config that sets no rotation at
 * all, which is most of them. An override written with no value at all
 * (`rotationPortrait:`, which YAML parses to `null`) counts as not set.
 *
 * `portrait` is `undefined` where the question cannot be asked (a card
 * rendered without a window, which is every test in this suite and the
 * server-side pass in some setups). That falls back to `rotation` rather than
 * guessing an orientation, because guessing wrong rotates the plan.
 */
export function resolvePlanRotation(
  c: Pick<FloorplanCardConfig, "rotation" | "rotationPortrait" | "rotationLandscape">,
  portrait?: boolean
): PlanRotation {
  const base = normalizePlanRotation(c.rotation);
  if (portrait === undefined) return base;
  const override = portrait ? c.rotationPortrait : c.rotationLandscape;
  // `== null`, not `=== undefined`: a key written with no value —
  // `rotationPortrait:` — parses to `null`, and the card's own numeric guard
  // lets it through (it only rejects non-numbers that are not nullish, the
  // same way an empty `trackers:` is treated as unset rather than malformed).
  // Read as a value it would normalize to 0 and *silently override* the base
  // rotation, which is the one thing an unset override must never do.
  return override == null ? base : normalizePlanRotation(override);
}

/**
 * The two ways a `MediaQueryList` can be listened to. Duck-typed rather than
 * taking the DOM interface, so this is reachable from a node test — which is
 * the whole reason it is a function instead of four lines inside the card's
 * `connectedCallback` (issue #237).
 */
export interface OrientationQuery {
  addEventListener?: (type: "change", fn: (e: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", fn: (e: { matches: boolean }) => void) => void;
  addListener?: (fn: (e: { matches: boolean }) => void) => void;
  removeListener?: (fn: (e: { matches: boolean }) => void) => void;
}

/**
 * Subscribe to a media query, returning the matching unsubscribe (issue #237).
 *
 * `MediaQueryList` has only been an `EventTarget` since Safari 14 / Chrome 39;
 * older WebViews carry the deprecated `addListener` alone. That matters here
 * more than it usually would, because the devices this feature exists for —
 * wall tablets, an old phone propped in a hallway — are exactly the ones
 * likely to be running one, and calling a missing method would throw out of
 * `connectedCallback` and take the card's whole render with it.
 *
 * Add and remove are chosen the same way, so a listener registered through the
 * legacy API is removed through it too: crossing them leaves the listener
 * attached to a card that is gone.
 *
 * Where neither exists this subscribes to nothing and returns a no-op. The
 * card reads the query's current value *before* calling this, so that case is
 * still right on load — it just stops following the device being turned.
 */
export function subscribeOrientation(
  q: OrientationQuery,
  fn: (e: { matches: boolean }) => void
): () => void {
  if (typeof q.addEventListener === "function") {
    q.addEventListener("change", fn);
    return () => q.removeEventListener?.("change", fn);
  }
  if (typeof q.addListener === "function") {
    q.addListener(fn);
    return () => q.removeListener?.(fn);
  }
  return () => {};
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

// ---- where the light comes from ------------------------------------------

/** Where the sun sits when nothing says otherwise — south-east, a low morning. */
export const DEFAULT_SUN_BEARING = 135;

/**
 * Elevation at which the light is at full strength. Between the horizon and
 * here it fades in, so sunrise and sunset are a ramp rather than a switch —
 * and a sun one degree up does not throw the same light as a midday one.
 */
export const SUN_ELEVATION_FULL = 12;

/**
 * A live `sun.sun` attribute as a number, or `undefined` when it is not a
 * reading at all.
 *
 * The allowlist is the whole point, and it is why this is one function rather
 * than two: `Number(null)`, `Number("")` and `Number(false)` are all **0**,
 * and 0 is a meaningful value for both attributes an outage can hand us — the
 * horizon exactly for the elevation, due north for the azimuth. Coercing
 * blindly turns "we do not know" into a confident wrong answer, so each
 * caller gets `undefined` and applies its own fail-bright default.
 */
function liveSunAttribute(value: unknown): number | undefined {
  const usable = typeof value === "number" || (typeof value === "string" && value.trim() !== "");
  if (!usable) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * How much sunlight there is, 0..1, from `sun.sun`'s **elevation**.
 *
 * The azimuth says where the light comes from; only the elevation says
 * whether there is any. Without it a plan kept its beams all night, pointing
 * at a sun that had set hours ago — the picture was of a sun that never moved
 * below the horizon, only around it.
 *
 * Below the horizon: nothing. It reads `sun.sun` whether or not the bearing
 * was pinned, because pinning an angle says *where* the sun is, not
 * *whether* it is up.
 *
 * A missing or unreadable elevation returns full strength, matching
 * {@link sunBrightness}: an outage should leave the plan lit and legible, not
 * stuck in a night that never ends. {@link liveSunAttribute} is what keeps 0
 * — the horizon exactly — from being confused with a reading that never came.
 */
export function sunlightStrength(elevation: unknown): number {
  const e = liveSunAttribute(elevation);
  if (e === undefined) return 1;
  if (e <= 0) return 0;
  if (e >= SUN_ELEVATION_FULL) return 1;
  const t = e / SUN_ELEVATION_FULL;
  return t * t * (3 - 2 * t);
}

/**
 * A compass bearing as a direction vector in **plan** space, given where north
 * is on this plan.
 *
 * Bearings are clockwise from north (0 = N, 90 = E), the convention Home
 * Assistant's `sun.sun` azimuth already uses. `north` is the plan's own
 * orientation, also clockwise, so a plan drawn with north to the right sets
 * `north: 90` and every bearing turns with it. Without that, a sun angle would
 * be a statement about the drawing rather than about the house, and the same
 * house drawn sideways would be lit from the wrong side.
 */
export function planDirection(bearing: number, north = 0): { x: number; y: number } {
  const t = ((bearing + north) * Math.PI) / 180;
  // North is up the canvas (0, −1) before the plan's own rotation.
  return { x: Math.sin(t), y: -Math.cos(t) };
}

/**
 * The sun's compass bearing for the relief: an explicit `sunBearing` when the
 * plan states one, else `sun.sun`'s live azimuth, else {@link
 * DEFAULT_SUN_BEARING}.
 *
 * Config first, deliberately. A live sun is the better picture — shadows swing
 * through the day, which is most of the charm — but it is also a picture that
 * changes while you are trying to lay a plan out, and at night there is no
 * sensible answer at all. Stating an angle is how you get a plan that looks
 * the same every time you open it.
 */
export function sunBearingOf(cfg: Pick<FloorplanCardConfig, "sunBearing">, azimuth?: unknown): number {
  if (sunIsPinned(cfg)) return cfg.sunBearing as number;
  // Through the same allowlist as the elevation, and for a sharper reason:
  // Number(null) is 0, and 0 is due north — a real bearing. Coerced blindly,
  // a dead sun.sun does not fall back, it lights the house from the north
  // and looks entirely deliberate while doing it.
  return liveSunAttribute(azimuth) ?? DEFAULT_SUN_BEARING;
}

/** Whether the plan states its own sun angle rather than following the real one. */
export function sunIsPinned(cfg: Pick<FloorplanCardConfig, "sunBearing">): boolean {
  return typeof cfg.sunBearing === "number" && Number.isFinite(cfg.sunBearing);
}

/**
 * How strong the light is for this plan: the sky's answer while the plan
 * follows the real sun, and **always full** once it pins its own angle.
 *
 * A stated bearing is a decision about the picture rather than a reading of
 * the sky — it says where the light goes and, by saying so, that it stays.
 * Fading such a plan out at dusk would half-follow a sun it had already
 * declined to follow, and leave a plan that is simply dark all evening with
 * no control on screen that explains why.
 */
export function sunlightStrengthOf(
  cfg: Pick<FloorplanCardConfig, "sunBearing">,
  elevation: unknown,
): number {
  return sunIsPinned(cfg) ? 1 : sunlightStrength(elevation);
}

// ---- sunlight through the openings ----------------------------------------
//
// The sun is far enough away that its rays arrive parallel, which is what
// makes this exact rather than an impression: a wall's shadow is precisely
// that wall translated along the light, and the patch a window admits is
// precisely its gap translated the same way. No ray casting, no per-pixel
// work — two polygon families and a mask.

/**
 * How far light reaches into the plan, as a fraction of its shorter side, for
 * a sun at {@link SUN_REACH_REF} degrees.
 *
 * A patch of sun on a floor is bounded by the room, not by the drawing: it is
 * about as deep as the opening is tall divided by the tangent of the sun's
 * angle, which for an ordinary window and an ordinary sun is a stripe a few
 * paces long — not one that crosses the whole house (issue #185). This used
 * to be 0.55 of the plan and flat all the way, so a single window lit every
 * room in line with it at exactly the brightness it lit the first.
 */
export const SUN_REACH = 0.34;
/**
 * The sun angle {@link SUN_REACH} describes — a mid-morning sun. Reach is
 * scaled from here by {@link sunReachScale}.
 */
export const SUN_REACH_REF = 30;
/**
 * How far the falloff spreads ACROSS the beam, as a multiple of **half** the
 * gap's width — the other half of the ellipse the light dies into.
 *
 * Half, because a gradient's `gradientTransform` scales its *semi*-axes: the
 * ellipse reaches this far from the beam's middle, and the beam only has half
 * its width to give on each side. Handed the whole width it ran nearly twice
 * as wide as the polygon carrying it, so the outline sliced through light at
 * about half strength all the way up both flanks — the hard diagonal edge in
 * issue #206. Anything above 1 puts that edge back.
 *
 * The falloff is an ellipse fitted to the beam, not a circle. That is the
 * whole difference between a rounded tip and a flat one, and it took four
 * attempts to find because a circle centred on the opening is nearly a
 * straight edge by the time it has travelled far enough to matter: on the
 * plan that reopened issue #185, a radius of 163 bowed 13px across a 129-wide
 * window, 10% of the width. An ellipse squashed to the beam's own proportions
 * curves on the scale of its WIDTH instead, which is what reads as round.
 *
 * A shade under 1 means the light has died just inside the gap's own edges,
 * so the patch has soft flanks as well as a soft tip.
 */
export const SUN_ACROSS = 0.95;
/** How dark the plan goes where no sunlight lands. */
export const SUN_SHADE = 0.16;
/** How strongly the sunlit patches are tinted. */
export const SUN_PATCH_OPACITY = 0.37;
/**
 * Default colours: the same warm white a lamp with no colour of its own casts
 * (issue #6), and a plain black for the shade so it darkens whatever is under
 * it rather than tinting it. Both skinnable, both overridable per plan.
 */
export const SUN_LIGHT_COLOR = "var(--fp-skin-sunlight, #ffd9a0)";
export const SUN_SHADE_COLOR = "var(--fp-skin-sunshade, #000)";

/**
 * A usable reach fraction: {@link cssNumber}'s coercion, then bounded.
 *
 * The lower bound is not zero. A reach of zero is a beam with no length,
 * which is a gradient with no extent and a polygon folded onto its own mouth
 * — legal SVG that draws nothing, and indistinguishable on screen from the
 * feature being broken. The upper bound is what keeps a typo like `40` from
 * asking the browser for a polygon sixteen thousand units long.
 */
export function sunReachFraction(value: unknown): number {
  return Math.max(0.02, Math.min(1.5, cssNumber(value, SUN_REACH)));
}

/**
 * How far the light from `o` actually travels before a wall stops it, capped
 * at `max`.
 *
 * The falloff has to be measured against this rather than against a fraction
 * of the plan, or a room shallower than the reach gets a patch that is still
 * at full brightness when the far wall cuts it — a hard bar across the floor,
 * which is the thing issue #185 keeps being reopened about. Fading over the
 * distance the light has to cross means the patch is always faint by the time
 * it ends, whatever size the room is.
 *
 * The same idea as {@link glowReach} for a lamp, but a single ray rather than
 * a visibility polygon: the beam is already bounded sideways by the wall
 * shadows, so the only unknown is how far down the middle it gets.
 */
export function sunTravelDistance(
  o: Opening,
  dir: { x: number; y: number },
  walls: readonly Wall[],
  max: number,
): number {
  let nearest = max;
  for (const w of walls) {
    const t = rayWallHit(o.x, o.y, dir.x, dir.y, w);
    // A wall the opening itself sits in reports a hit at ~0; the epsilon in
    // rayWallHit already drops those, but a gap's own wall can still graze.
    if (t !== undefined && t > 1 && t < nearest) nearest = t;
  }
  return nearest;
}

/**
 * How far the light reaches for a sun at `elevation`, as a multiple of the
 * base reach.
 *
 * The steeper the sun, the shorter the patch — that is the whole reason a
 * midday sun does not lay a stripe across the house, and it is the reason
 * issue #185 gives for the beams looking wrong. Depth goes as `1/tan(e)`, so
 * this is that ratio against {@link SUN_REACH_REF}: a 30° sun reaches exactly
 * the base, a 60° one a little over half as far, a 10° evening sun nearly
 * twice as far and raking.
 *
 * Clamped at both ends. Near the horizon the tangent runs away to infinity
 * and would throw a beam of unbounded length for a sun that is barely up;
 * near the zenith it collapses to nothing, and a patch that vanishes entirely
 * at noon reads as a bug rather than as physics.
 *
 * An unreadable elevation returns 1 — the base reach — for the same reason
 * {@link sunlightStrength} returns full strength: an outage should leave the
 * plan looking ordinary.
 */
export function sunReachScale(elevation: unknown): number {
  const e = liveSunAttribute(elevation);
  if (e === undefined) return 1;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const scale = Math.tan(rad(SUN_REACH_REF)) / Math.tan(rad(Math.max(1, Math.min(89, e))));
  return Math.max(0.45, Math.min(1.9, scale));
}

/**
 * **How much** of an opening lets sunlight in, 0..1 of its gap.
 *
 * A fraction rather than a yes/no, because a door open a crack is not a door
 * standing open: read as a boolean it flooded the room exactly as if it were,
 * since both the wall gap and the beam were then taken at full width. The
 * three rules, in the order they override each other:
 *
 * - a **shutter** that is all the way down stops everything, whatever the
 *   glass says — that is what a shutter is for, and a window behind a closed
 *   one is as dark as a wall;
 * - **glass** admits its whole gap however its sash is sitting, which is the
 *   reason this cannot reuse the lamp rule ({@link wallsLightPassesThrough}'s
 *   `openAmount`) unchanged: that one asks whether there is a *hole*, and a
 *   closed window is not a hole;
 * - anything **opaque** admits exactly as far as it is open.
 *
 * Feed it a clear fraction rather than a raw `amount` ({@link
 * openingClearFraction}) and the sliding styles come out right too — the
 * travel a leaf has is not the gap it clears.
 */
export function openingSunFraction(
  o: Pick<Opening, "type" | "glazed" | "sunlight">,
  amount: number,
  /** How far the external shutter is open, or `undefined` when none is bound. */
  shutter?: number,
): number {
  // Above every other rule, because it is the one that is a decision rather
  // than a reading: an opening switched out of the sunlight is wall to it,
  // however open, however glazed (issue #177).
  if (o.sunlight === false) return 0;
  if (shutter !== undefined && shutter <= 0) return 0;
  if (openingIsGlazed(o)) return 1;
  return Math.max(0, Math.min(1, amount));
}

/**
 * Whether an opening lets any sunlight in at all — {@link
 * openingSunFraction} above zero. Kept as its own name because "does this let
 * light in" is the question most callers are actually asking.
 */
export function openingAdmitsSun(
  o: Pick<Opening, "type" | "glazed" | "sunlight">,
  amount: number,
  shutter?: number,
): boolean {
  return openingSunFraction(o, amount, shutter) > 0;
}

/**
 * Whether an opening is glass. A window is, by definition; a door is not,
 * unless it says so — which patio and French doors do. They are drawn as
 * doors because that is how they swing, and treating them as opaque left the
 * sunniest side of a house dark: every one of them is a wall of glass.
 */
export function openingIsGlazed(o: Pick<Opening, "type" | "glazed">): boolean {
  return o.glazed ?? o.type === "window";
}

/** The two ends of an opening's gap, in plan coordinates. */
function openingEnds(o: Opening): [AreaPoint, AreaPoint] {
  const rad = (o.angle * Math.PI) / 180;
  const hx = (Math.cos(rad) * o.length) / 2;
  const hy = (Math.sin(rad) * o.length) / 2;
  return [
    { x: o.x - hx, y: o.y - hy },
    { x: o.x + hx, y: o.y + hy },
  ];
}

/**
 * Ray-casting point-in-polygon test. Points exactly on an edge may resolve
 * either way (not a documented guarantee) — every caller only needs an
 * approximate "did this land inside" answer, not exact edge semantics.
 *
 * Here rather than in `editor-geometry`, which is where it started and which
 * still re-exports it: it moved when the sunlight needed it, and while the
 * sunlight has since stopped asking (see {@link sunReachesOpening}), moving it
 * back would only churn that module's imports for nothing.
 */
export function pointInPolygon(points: readonly AreaPoint[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i]!;
    const pj = points[j]!;
    const intersects =
      pi.y > y !== pj.y > y && x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Whether the sun reaches this opening's outside face at all — the test that
 * decides whether it is a *source* (issues #177 / #178).
 *
 * The sun is outside the building, so the only openings that admit it are the
 * ones it shines on directly: trace back along the light from the opening's
 * centre and if that ray meets a wall, this opening is standing behind
 * something. Interior doors are, always — there is a façade between them and
 * the sky. So are the openings on the shaded side of the house.
 *
 * Deliberately against the **uncut** walls, not the ones {@link
 * wallsLightPassesThrough} has opened up: a doorway lined up with a window is
 * not a second sun. Light does reach it, and it does go through — the beam
 * from the window carries on through the gap, because that wall's shadow has
 * the same gap cut in it. What must not happen is the doorway *re-emitting* at
 * its own full width, which is how a 20-wide sliver came out the other side of
 * a 120-wide door as a 120-wide flood, and how a window on the dark façade
 * came to throw a patch of sunlight out into the garden.
 *
 * The one wall that must not count is the opening's **own**, since the ray
 * starts on that wall's centre line and so meets it at zero distance. That is
 * the test — a hit right at the ray's origin, on a wall this opening lies on —
 * and not merely "a wall within a wall's thickness", which would also wave
 * through the wall meeting it at a corner. An opening a few units from a
 * corner then answered "the sun reaches me" to a sun the return wall was
 * squarely in front of, and threw its beam back out of the house: the very
 * bug above, in the one place the shortcut applied.
 */
export function sunReachesOpening(
  o: Pick<Opening, "x" | "y">,
  walls: readonly Wall[],
  dir: { x: number; y: number },
): boolean {
  for (const w of walls) {
    // `dir` is a unit vector, so the hit distance is in plan units.
    const hit = rayWallHit(o.x, o.y, -dir.x, -dir.y, w);
    if (hit === undefined) continue;
    const own = hit <= OPENING_ON_WALL_EPS && pointWallDist(o.x, o.y, w) <= OPENING_ON_WALL_EPS;
    if (!own) return false;
  }
  return true;
}

/**
 * Which way the light **travels**, as a plan-space vector.
 *
 * A bearing says where the sun *is*; the light goes the other way, so this is
 * the far side of the compass from it. Getting that backwards is not a subtle
 * error — it lights the house from precisely the wrong side, and it did: with
 * the sun in the south-west, the beams came in through the north-east windows.
 */
export function sunLightDirection(
  cfg: Pick<FloorplanCardConfig, "north" | "sunBearing">,
  azimuth?: unknown,
): { x: number; y: number } {
  return planDirection(sunBearingOf(cfg, azimuth) + 180, cfg.north ?? 0);
}

/** A segment swept along the light: the shape both a beam and a shadow are. */
function sweep(a: AreaPoint, b: AreaPoint, dir: { x: number; y: number }, reach: number): AreaPoint[] {
  return [
    a,
    b,
    { x: b.x + dir.x * reach, y: b.y + dir.y * reach },
    { x: a.x + dir.x * reach, y: a.y + dir.y * reach },
  ];
}

/**
 * The patch of light an opening admits: its gap, swept along the sun.
 *
 * Swept in one direction only — the way the light travels — so an opening on
 * the sunlit side of the house throws its patch into the room, and one on the
 * shaded side throws it out of the house, where it lands on ground that is lit
 * anyway. That asymmetry is the sun's, not an approximation of it.
 */
export function sunBeamPolygon(
  o: Opening,
  dir: { x: number; y: number },
  reach: number,
  /**
   * How much of the gap is clear, 0..1 — see {@link openingSunFraction}. The
   * patch narrows about the opening's centre, matching the gap {@link
   * wallsLightPassesThrough} leaves in the wall for the same fraction.
   */
  clear = 1,
): AreaPoint[] {
  const [a, b] = openingEnds(o);
  const f = Math.max(0, Math.min(1, clear));
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const at = (p: AreaPoint) => ({ x: mx + (p.x - mx) * f, y: my + (p.y - my) * f });
  return sweep(at(a), at(b), dir, reach);
}

/**
 * The shadow a wall casts: the wall, swept along the sun. Exact for parallel
 * light, which is why the beams can simply be cut by these rather than traced.
 *
 * Feed it the walls {@link wallsLightPassesThrough} hands back rather than the
 * raw ones, and an open doorway stops casting a shadow across the room behind
 * it — the same treatment a lamp already gets (#143).
 */
export function sunShadowPolygon(
  w: Wall,
  dir: { x: number; y: number },
  reach: number,
): AreaPoint[] {
  return sweep({ x: w.x1, y: w.y1 }, { x: w.x2, y: w.y2 }, dir, reach);
}

/** `points` for an SVG polygon. */
function polyPoints(pts: readonly AreaPoint[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

/**
 * Sunlight falling through the windows and doors (and the shade everywhere it
 * does not reach).
 *
 * Two layers over one geometry:
 * - a **shade** across the plan, punched through wherever light lands, so the
 *   rooms the sun never enters read as the darker ones;
 * - the **patches** themselves, tinted warm.
 *
 * Both are cut by the wall shadows, so a wall standing in the light shades
 * what is behind it. The wall band is drawn thick, so the shadow polygons are
 * widened to match — otherwise light would leak along every wall's edge.
 *
 * `pointer-events: none` on the group is not optional: this spans the canvas,
 * and without it every tappable opening underneath stops answering. Same
 * lesson as the sun-dim rect (#108).
 */
/** Everything the sunlight layer needs that isn't the plan's own geometry. */
export interface SunlightOptions {
  /** Which way the light travels — see {@link sunLightDirection}. */
  dir: { x: number; y: number };
  openAmount: (o: Opening) => number;
  /** How far each opening's shutter is open, or undefined where none is bound. */
  shutterOpen: (o: Opening) => number | undefined;
  /**
   * How strong the light is, 0..1 — see {@link sunlightStrength}. At 0 there
   * is no layer at all rather than a transparent one.
   */
  strength?: number;
  /**
   * How far the light carries, as a fraction of the plan's shorter side.
   * Defaults to {@link SUN_REACH}; the card scales it by the sun's height
   * (see {@link sunReachScale}).
   */
  reach?: number;
  light?: string;
  /**
   * `null` draws the light without darkening anything else — the patches
   * alone, on a plan that stays as bright as it was. The shade is the half
   * that changes how the *whole* plan reads, so it is the half worth being
   * able to decline.
   */
  shade?: string | null;
}

export function renderSunlight(
  walls: readonly Wall[],
  openings: readonly Opening[],
  width: number,
  height: number,
  id: string,
  opts: SunlightOptions,
): SVGTemplateResult | typeof nothing {
  const { dir, openAmount, shutterOpen, strength = 1 } = opts;
  const paint = {
    light: opts.light ?? SUN_LIGHT_COLOR,
    // `?? ` would swallow the explicit null that means "no shade at all".
    shade: opts.shade === undefined ? SUN_SHADE_COLOR : opts.shade,
  };
  // Below the horizon there is nothing to let in, so there is nothing to draw
  // — not a layer at zero opacity, which would still cost every polygon.
  if (strength <= 0) return nothing;
  // Coerced and bounded at the sink, so no caller can put a NaN into a
  // coordinate. `sunReach` is hand-editable YAML: "wide" or a stray NaN made
  // every far corner NaN — in the polygon *and* in the gradient that fades
  // it — and a negative one did something quieter and worse, sweeping the
  // beam backwards so the light left through the wall it came in by.
  const reach = Math.min(width, height) * sunReachFraction(opts.reach);
  // Doorways already subtracted, so an open door casts no shadow across the
  // room behind it. Windows too — glass casts none whatever its sash is doing.
  // How much of each gap is clear, asked once and used for both families —
  // the wall keeps whatever the opening does not clear, and the beam is
  // exactly what it does. Read as a yes/no this let a door open a crack pass
  // the light of one standing wide open, since both the gap and the patch
  // were then taken at full width.
  const clear = (o: Opening) => openingSunFraction(o, openAmount(o), shutterOpen(o));
  const blockers = wallsLightPassesThrough(walls, openings, clear);
  const shadowPolys = blockers.map((w) => sunShadowPolygon(w, dir, reach));
  // Only the openings the sun actually shines on are sources — see
  // {@link sunReachesOpening}, which asks it of the *uncut* walls. Testing the
  // cut ones (which is what standing in a shadow polygon amounts to) made a
  // second sun of every opening that happened to line up with a window: the
  // doorway behind it re-emitted at its own full width, and a window on the
  // shaded façade threw a patch out of the house (issues #177 / #178).
  // One slot per opening, holes included — NOT compacted, for exactly the
  // reason renderSunDimMask spells out above (issue #119). Filtering to the
  // lit ones renumbers every later beam the moment a door opens, which
  // rewrites the `id` on an existing <linearGradient> and leaves the polygon
  // that referenced it pointing at a paint server the browser has already
  // cached under that name. Here the symptom would be this very feature
  // failing: a beam painted flat and full-length again, and only the ones
  // *after* the door that moved — the fade looking intermittent rather than
  // broken. Emitting the holes in place keeps DOM positions stable too.
  //
  // Each beam keeps the opening it came from: the fade runs from that
  // opening's own centre along the light, so every patch dims over its own
  // length rather than sharing one gradient across the plan.
  const beams = openings.map((o, i) => {
    if (!(clear(o) > 0 && sunReachesOpening(o, walls, dir))) return undefined;
    // How far the light gets before a wall stops it. The falloff is measured
    // against this, so a patch is faint by the time it ends however deep or
    // shallow the room is.
    const along = sunTravelDistance(o, dir, blockers, reach);
    // …and how wide it is, measured across the light rather than along the
    // wall: a gap seen obliquely admits a narrower beam than its own length.
    const [ga, gb] = openingEnds(o);
    const gx = gb.x - ga.x;
    const gy = gb.y - ga.y;
    const width = Math.abs(gx * dir.y - gy * dir.x) * clear(o);
    // Half of it, because the gradient below is scaled by *semi*-axes: the
    // ellipse reaches `across` from the beam's middle, and the beam only has
    // half its width to give on each side (issue #206).
    const halfWidth = width / 2;
    return {
      // The outline runs past the falloff, so the ellipse is what bounds the
      // patch and never the polygon's flat far edge.
      points: polyPoints(sunBeamPolygon(o, dir, along + o.length, clear(o))),
      cx: o.x,
      cy: o.y,
      along,
      across: Math.max(1, halfWidth * SUN_ACROSS),
      angle: (Math.atan2(dir.y, dir.x) * 180) / Math.PI,
      lightId: `${id}-b${i}`,
      shadeId: `${id}-s${i}`,
      fadeId: `${id}-f${i}`,
    };
  });
  if (!beams.some((b) => b !== undefined)) return nothing;
  const shadows = shadowPolys.map(polyPoints);
  const pad = WALL_THICKNESS;
  const shadeId = `${id}-shade`;
  const shadowId = `${id}-shadow`;
  const x = -pad;
  const y = -pad;
  const w = width + pad * 2;
  const h = height + pad * 2;
  // A whole tag per call. Emitting a half-open `<rect …` from one template and
  // its remaining attributes from another does not concatenate: lit parses
  // every template on its own, so the tag never closes and the rest lands as
  // stray text — which is how both masks came to have no white ground at all,
  // and so hid the very layers they were meant to shape.
  const cover = (fill: string, extra: SVGTemplateResult | typeof nothing = nothing) =>
    svg`<rect x=${x} y=${y} width=${w} height=${h} fill=${fill}>${extra}</rect>`;
  // Widened by a wall's own width: the polygon starts at the centre line, and
  // without this the light leaks along both edges of every wall it passes.
  const shadowPoly = (p: string, paint: string) =>
    svg`<polygon points=${p} fill=${paint} stroke=${paint} stroke-width=${WALL_THICKNESS} />`;
  // The falloff, as an ellipse fitted to the beam rather than a circle.
  //
  // A unit circle is mapped onto the beam's own frame — rotated to point down
  // the light, stretched to its reach along, squashed to the gap's width
  // across. So its iso-lines curve on the scale of the beam's WIDTH, which is
  // what makes the tip read as round; a true circle centred on the opening is
  // nearly a straight edge by the time it gets there, which is what every
  // earlier attempt drew and what kept reading as a hard stop.
  //
  // It reaches zero at the far end, so nothing bounds the patch except the
  // light giving out — and the flanks dim too, because SUN_ACROSS is under 1.
  const fade = (
    b: { fadeId: string; cx: number; cy: number; along: number; across: number; angle: number },
    gid: string,
    color: string,
  ) => svg`<radialGradient id=${gid} gradientUnits="userSpaceOnUse" cx="0" cy="0" r="1"
              gradientTransform=${`translate(${b.cx} ${b.cy}) rotate(${b.angle}) scale(${b.along} ${b.across})`}>
          <stop offset="0" stop-color=${color} stop-opacity="1" />
          <stop offset="0.45" stop-color=${color} stop-opacity="0.55" />
          <stop offset="1" stop-color=${color} stop-opacity="0" />
        </radialGradient>`;
  // Only built when it is going to be used: the shade mask is the one that
  // needs every beam *and* every shadow, so declining the shade halves the
  // shapes this emits rather than hiding them behind an opacity of zero.
  const shade =
    paint.shade === null
      ? nothing
      : svg`
      <!-- Where the shade shows: everywhere, minus the patches of light, plus
           back wherever a wall stands in one. The order is the whole logic. -->
      <mask id=${shadeId} maskUnits="userSpaceOnUse" x=${x} y=${y} width=${w} height=${h}>
        ${cover("#fff")}
        ${beams.map((b) => (b ? fade(b, b.shadeId, "#000") : nothing))}
        ${beams.map((b) =>
          b
            ? svg`<polygon points=${b.points} fill=${`url(#${b.shadeId})`} />`
            : nothing
        )}
        ${shadows.map((p) => shadowPoly(p, "#fff"))}
      </mask>`;
  return svg`
    <defs>
      ${shade}
      <!-- The wall shadows again, for the warm patches themselves. -->
      <mask id=${shadowId} maskUnits="userSpaceOnUse" x=${x} y=${y} width=${w} height=${h}>
        ${cover("#fff")}
        ${shadows.map((p) => shadowPoly(p, "#000"))}
      </mask>
    </defs>
    <g class="fp-sunlight">
      ${
        paint.shade === null
          ? nothing
          : svg`<rect x=${x} y=${y} width=${w} height=${h}
            style=${`fill:${cssColorOr(paint.shade, SUN_SHADE_COLOR)};`}
            opacity=${SUN_SHADE * strength} mask=${`url(#${shadeId})`} />`
      }
      <g mask=${`url(#${shadowId})`} opacity=${SUN_PATCH_OPACITY * strength}>
        ${beams.map((b) =>
          b
            ? fade(b, b.lightId, cssColorOr(paint.light, SUN_LIGHT_COLOR))
            : nothing
        )}
        ${beams.map((b) =>
          b
            ? svg`<polygon class="fp-sunbeam" points=${b.points}
                            fill=${`url(#${b.lightId})`} />`
            : nothing
        )}
      </g>
    </g>`;
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

/** Neutral (unzoomed) result of {@link areaZoomTransform} — identity view. */
export const IDENTITY_ZOOM: AreaZoomTransform = { scale: 1, txPercent: 0, tyPercent: 0 };

export interface AreaZoomTransform {
  /** Uniform scale applied to the whole plan. */
  scale: number;
  /** Translation as a percentage of the transformed element's own box (so it
   *  is resolution-independent — see the CSS `translate()` percentage rule). */
  txPercent: number;
  tyPercent: number;
}

/**
 * A CSS `translate(%) scale()` pair that frames an area's bounding box inside
 * the `w`×`h` canvas ("zoom in to an area on tap"). Applied with
 * `transform-origin: 0 0` to a wrapper around both the SVG and the HTML
 * overlay, so both layers — which are positioned in two different ways —
 * reframe identically instead of drifting apart.
 *
 * Uses `rotatePlanPoint` on the area's own points rather than the raw
 * `points` array so this lines up with a rotated plan (issue #33): the
 * overlay already remaps every point through the same function, and the SVG
 * layer carries the matching group transform.
 *
 * `padFrac` pads the bounding box (as a fraction of its own larger
 * dimension) so the zoomed room isn't cropped edge-to-edge; `maxScale`
 * caps how far a small room can zoom in. Never zooms *out* past 1x — an
 * area bigger than the canvas simply fills it edge-to-edge.
 *
 * The pan is clamped so the plan's own edge never moves inside the visible
 * box — centering a room near a corner would otherwise pan the wrapper past
 * the canvas and show bare card background where the plan should be. At
 * `scale === 1` the clamp range collapses to exactly `[0, 0]`, so a room too
 * big to zoom into (taller or wider than the canvas) reports no pan either —
 * without this, tapping such a room would slide the plan sideways for no
 * zoom at all.
 */
export function areaZoomTransform(
  points: readonly AreaPoint[],
  w: number,
  h: number,
  rot: PlanRotation,
  padFrac = 0.15,
  maxScale = MAX_AREA_ZOOM_FIT,
  /**
   * A room's own zoom, overriding the fit (issue #222). Undefined keeps the
   * fitted scale, which is every room that has not asked for something else.
   * Pass it through {@link resolveAreaZoom} rather than raw config.
   */
  explicitScale?: number
): AreaZoomTransform {
  if (!points.length) return IDENTITY_ZOOM;
  const rotated = points.map((p) => rotatePlanPoint(p.x, p.y, w, h, rot));
  const d = rotatedCanvasSize(w, h, rot);
  const xs = rotated.map((p) => p.x);
  const ys = rotated.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * padFrac;
  const bw = Math.max(maxX - minX + pad * 2, 1);
  const bh = Math.max(maxY - minY + pad * 2, 1);
  // The room's own zoom wins over the fit when it has one: the fit is a guess
  // at a good framing, and this is someone saying the guess was wrong.
  // Centring is unaffected — this sets how close, not where (issue #222).
  const fitted = Math.max(1, Math.min(maxScale, Math.min(d.w / bw, d.h / bh)));
  const scale = explicitScale ?? fitted;
  // A non-finite input (NaN/Infinity coordinates from a hand-edited config)
  // must never reach the style sink: --fp-inv-zoom:NaN invalidates the whole
  // custom property, and .item's transform is built from it, so every device
  // badge on the plan would lose its centering along with the scale.
  if (!Number.isFinite(scale)) return IDENTITY_ZOOM;
  const cxFrac = (minX + maxX) / 2 / d.w;
  const cyFrac = (minY + maxY) / 2 / d.h;
  // Range collapses to [0, 0] at scale === 1, so an unzoomable room (bigger
  // than the canvas along its binding axis) reports no pan.
  const clamp = (t: number) => Math.min(0, Math.max(100 * (1 - scale), t));
  return {
    scale,
    txPercent: clamp(50 - scale * cxFrac * 100),
    tyPercent: clamp(50 - scale * cyFrac * 100),
  };
}

/**
 * A room's configured zoom, clamped, or `undefined` when it has none and the
 * fit should stand (issue #222).
 *
 * Below 1 is clamped **to 1**, not honoured and not refused: it would zoom
 * *out* past the whole plan, which is what the zoom-out button is for, and 1
 * is the nearest thing to it that means anything. A non-finite value is the
 * one case that does fall back to the fit, on the same reasoning as {@link
 * areaZoomTransform}'s own guard — a NaN scale reaches a style sink and takes
 * the overlay's centring down with it.
 */
export function resolveAreaZoom(a: Pick<Area, "zoom">): number | undefined {
  const raw = a.zoom;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  return Math.max(1, Math.min(MAX_AREA_ZOOM, raw));
}

/**
 * What the overlay counter-scales by while the plan is zoomed — the value
 * behind `--fp-inv-zoom` (issue #222).
 *
 * `1 / zoomScale` is the counter-scale that holds the overlay at the size it
 * has at full plan, which is what zooming has always done. `zoomedOverlayScale`
 * multiplies that, so 1 keeps today's behaviour exactly and 1.5 draws every
 * badge, label and tracker half again as large *while zoomed only*.
 *
 * Unzoomed it returns 1 rather than the multiplier: the setting is about the
 * zoomed view, and applying it at full plan would resize every plan that set
 * it the moment it was set. A non-finite or non-positive multiplier is
 * ignored for the same reason the transform guards its own scale — this value
 * lands in a custom property that the badge transform is built from.
 */
export function zoomedOverlayScale(zoomScale: number, multiplier?: number): number {
  if (!Number.isFinite(zoomScale) || zoomScale <= 1) return 1;
  const m =
    typeof multiplier === "number" && Number.isFinite(multiplier) && multiplier > 0
      ? multiplier
      : DEFAULT_ZOOMED_OVERLAY_SCALE;
  return (1 / zoomScale) * m;
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
 * A furniture diagram: the symbol named by `f.type`, drawn as line art inside
 * its w\u00d7h box, centered at the origin and then translated and rotated into
 * place. Defaults to gray so it reads differently from black walls.
 *
 * Every glyph is data now (issue #90) \u2014 one JSON file per symbol under
 * `furniture/`, plus whatever a config's own `symbols:` adds. `override` is the
 * entity-driven color resolved by the caller (issue #82) \u2014 see
 * {@link furnitureColor}; the editor passes nothing and keeps the static look
 * while you are drawing.
 *
 * An unknown type draws the plain box with no detail, which is what the old
 * hand-written `switch`'s `default` case did: a config naming a symbol that was
 * never installed leaves a placeholder you can see and move, rather than an
 * invisible hole in the plan.
 */
export function renderFurniture(
  f: Furniture,
  override?: string,
  catalog: SymbolCatalog = BUILTIN_SYMBOLS,
): SVGTemplateResult {
  const color = override ?? f.color ?? FURNITURE_COLOR;
  const parts = renderSymbolParts(findSymbol(catalog, f.type) ?? FALLBACK_SYMBOL, f.w, f.h, color);

  // `hand: "left"` is the same symbol reflected, not a second drawing \u2014 which is
  // what the L-shaped sectional's two hands always were, and it now works on any
  // symbol. A mirror is uniform in |scale|, so strokes keep their width.
  const mirror = f.hand === "left" ? " scale(-1 1)" : "";

  return svg`<g class=${`fp-furniture fp-furniture-${cssIdent(f.type) ?? "unknown"}`}
                data-id=${cssIdent(f.id) ?? nothing}
                data-entity=${cssEntityId(f.entity) ?? nothing}
                transform="translate(${f.x} ${f.y}) rotate(${f.angle ?? 0})${mirror}">${parts}</g>`;
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
  direction: number,
  width: number,
  rings = 3,
  scale: OverlayScale = "fixed"
): TemplateResult {
  function wrapAngle(value: number): number {
    return ((value % 360) + 360) % 360
  }
  function clamp(value: number, min: number, max: number): number {
    return Math.max(Math.min(value, max), min);
  }

  const size = overlayLength(cssNumber(sizePx, DEFAULT_RIPPLE_SIZE), scale);

  // direction gets wrapped, since 0° and 360° are actually the same
  const direction_ = wrapAngle(cssNumber(direction, DEFAULT_RIPPLE_DIRECTION));

  // width gets clamped, since a width of 0° and 360° is not the same and should not wrap
  const width_ = clamp(cssNumber(width, DEFAULT_RIPPLE_WIDTH), 0, 360);

  return html`
    <div
      class="ripple ${active ? "active" : ""}"
      style="width:${size};height:${size};--fp-ripple-color:${cssColorOr(color, SKIN_ACCENT)};--fp-ripple-direction:${direction_};--fp-ripple-width:${width_}"
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
  /**
   * Whole-plan display rotation the tracker is drawn under (issue #33). The
   * marker lives inside the rotated SVG group, so a text label would turn
   * with the plan while every other piece of text stays upright; the label
   * counter-rotates by this (and the tracker's own `angle`) to read level.
   * Default 0 — the editor always shows the plan as drawn.
   */
  planRotation?: PlanRotation;
}

/**
 * Longest label a tracker draws. Initials are two or three letters; anything
 * longer would spread past the dot, and every other user-supplied value here
 * is clamped too.
 */
export const TRACKER_LABEL_MAX = 3;

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
    // A label rides in the triangle's place: same class, so it pulses and
    // glides like the dot it replaces. The paint-order stroke is a halo in
    // the card's own background color, keeping initials readable over busy
    // plans without a box around them; its width follows dotR so it neither
    // thins out on big dots nor swallows the letters on small ones. The text
    // counter-rotates the tracker's own angle and the plan rotation, so the
    // initials read level like every other text on the card.
    const label = t.label?.trim().slice(0, TRACKER_LABEL_MAX);
    const upright = -(angle + (opts.planRotation ?? 0));
    const dot = label
      ? svg`<text class="tracker-dot" text-anchor="middle" dominant-baseline="central"
              font-size=${dotR * 1.6} font-weight="700" fill=${color}
              stroke="var(--fp-skin-card-bg, #fff)" stroke-width=${dotR * 0.25}
              paint-order="stroke" pointer-events="none"
              transform="rotate(${upright})">${label}</text>`
      : svg`<polygon class="tracker-dot" points=${tri} fill=${color} />`;
    marker = svg`
      <g class="tracker-marker" style="transform:translate(${mx}px, ${my}px);">
        <circle class="tracker-ring" cx="0" cy="0" r="0"
                fill="none" stroke=${color} stroke-width="1.5"
                style="--fp-tracker-ring-max:${ringMax}px;" />
        <circle class="tracker-ring" cx="0" cy="0" r="0"
                fill="none" stroke=${color} stroke-width="1.5"
                style="--fp-tracker-ring-max:${ringMax}px; animation-delay:0.7s;" />
        ${dot}
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
