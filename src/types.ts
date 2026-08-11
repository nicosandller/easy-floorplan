import type { HomeAssistant as BaseHomeAssistant, LovelaceCardConfig } from "custom-card-helpers";

/**
 * A single entity's state object. Reached by indexed access off the base `hass`
 * so we don't take a direct dependency on `home-assistant-js-websocket`, which
 * is only a transitive dep via `custom-card-helpers`.
 */
export type HassEntity = BaseHomeAssistant["states"][string];

/**
 * `custom-card-helpers` 1.9 predates `formatEntityState`, which real HA has
 * carried since 2023.9 and which this card relies on. Declare it rather than
 * casting at every use.
 */
export interface HomeAssistant extends BaseHomeAssistant {
  /**
   * HA's own state formatter. It applies the entity registry's display
   * precision, the locale's number format, the blank before a unit and the
   * wording of `unavailable` — none of which live on the state object. HA
   * hands out a placeholder that echoes the raw state until translations and
   * the registry load, then replaces the function whenever an input changes.
   */
  formatEntityState(stateObj: HassEntity, state?: string): string;
  /**
   * The entity registry as the frontend exposes it. `custom-card-helpers` does
   * not declare it, though HA has handed it to cards since 2023.4. It carries
   * the user's per-entity icon override, which never appears in the state's
   * `attributes`.
   */
  entities?: Record<string, { icon?: string } | undefined>;
}

/** The slice of `hass` the card draws from. */
export interface RenderHass {
  states: Record<string, HassEntity | undefined>;
  formatEntityState(stateObj: HassEntity): string;
}

/** A straight wall segment in virtual coordinate space. */
export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * Stroke width in virtual units. Defaults to {@link WALL_THICKNESS}
   * (render.ts) when unset, and clamped there (`wallThickness`) to at most
   * `MAX_SKIN_WALL_WIDTH` (skins.ts): the doorway mask that cuts this wall's
   * own doors and windows is sized off the shared `WALL_THICKNESS` constant,
   * not per-wall, so a wall drawn wider than that ceiling would not be fully
   * cleared by its own opening. Raise the ceiling only alongside that mask.
   */
  thickness?: number;
}

export type OpeningType = "door" | "window";

/**
 * A door or window. Positioned by its center point and rotation so it can be
 * dropped onto (and aligned with) a wall, but it is stored independently.
 */
export interface Opening {
  id: string;
  /** The kind of opening: a `door` (single leaf) or a `window` (two leaves / glass). */
  type: OpeningType;
  /**
   * How the opening moves. `swing` (default) is a hinged door / casement window;
   * `slide` is a sliding door / sliding window whose panel(s) travel along the
   * wall (see {@link sliderStyle}); `roll` is a roll-up cover — garage door,
   * roller shutter — whose slatted curtain leaves the floor plane (issue #45),
   * drawn thinning toward the track line as it opens.
   */
  motion?: "swing" | "slide" | "roll";
  x: number;
  y: number;
  /** Length along the wall, in virtual units. */
  length: number;
  /** Rotation in degrees, 0 = horizontal. */
  angle: number;
  /**
   * Optional entity (e.g. a contact `binary_sensor` or a `cover`) whose state
   * drives whether the opening is drawn open or closed. When unset, doors are
   * drawn open (swing symbol) and windows closed, matching a static floor plan.
   */
  entity?: string;
  /** Flip the open/closed interpretation of `entity` (for inverted sensors). */
  invert?: boolean;
  /** Color of the leaf/sash and swing arc while actively open. Falls back to the primary color. */
  activeColor?: string;
  /**
   * Mirror the symbol left↔right in the opening's local frame. For a swing door
   * this moves the hinge to the other jamb; for a slider it reverses the slide
   * direction. Absent = the default orientation (hinge/anchor at the left jamb).
   */
  flipH?: boolean;
  /**
   * Mirror the symbol across the wall line, so the door opens into the room on
   * the other side. Absent = the default (swings toward the −y / "near" side).
   */
  flipV?: boolean;
  /**
   * Swing windows only: how many sashes. `double` (the default, today's look)
   * draws two casement leaves meeting in the middle; `single` draws one sash
   * hinged at a jamb (issue #73) — `flipH` picks which jamb. Ignored for
   * doors and for sliding / rolling openings.
   */
  sash?: "single" | "double";
  /**
   * An external shutter sharing this opening's wall gap (issue #74): a
   * `cover` (roller shutter / tapparella) or a `binary_sensor` contact on a
   * hinged shutter (persiana). `entity` keeps driving the opening itself, so
   * an open window behind a closed shutter renders both truthfully.
   */
  shutterEntity?: string;
  /**
   * How that shutter is drawn (issue #74):
   * - `roll` — a slatted curtain that rolls up out of the floor plane.
   * - `swing` — louvered panels hinged at the jambs, **outside** the wall,
   *   swinging outward (the shutters you fold back against the façade).
   *
   * Defaults from the bound entity: a `binary_sensor` can only say
   * open/closed, which is what a hinged shutter reports, so it defaults to
   * `swing`; a position-carrying `cover` defaults to `roll`. Set explicitly
   * to override. See {@link shutterStyleOf}.
   */
  shutterStyle?: "roll" | "swing";
  /**
   * Flip the open/closed interpretation of {@link shutterEntity}, exactly as
   * {@link invert} does for `entity`. Not the same switch: a reed contact on a
   * hinged shutter commonly reports `on` when the panels are **shut** (the
   * magnet only meets its contact when they are folded together), while the
   * window behind it reports the other way round. One flag could not describe
   * both.
   */
  shutterInvert?: boolean;
  /**
   * Colour of the shutter while it is (partly) open. Falls back to
   * {@link activeColor}, then the skin accent — so a plan that only wants one
   * accent still sets one, and a plan that wants the shutter to read
   * separately from the sash it covers can say so.
   */
  shutterActiveColor?: string;
  /**
   * Hinged shutters only: put the panels on the sash's **own** side of the
   * wall instead of the far side (the default). Shutters live outside, and
   * which side of a wall "outside" is depends on the room — a window drawn
   * with `flipV` opens the other way, and its shutters follow it.
   *
   * Ignored by the roll curtain, which is drawn symmetrically about the wall
   * line and so looks identical either way.
   */
  shutterFlipV?: boolean;
  /**
   * With both entities bound, which one the gestures lead with — the
   * window/door itself (the default), or the shutter. The other one moves to
   * hold. Meaningless with only one bound, since there is nothing to choose
   * between.
   *
   * The default is the opening because a tap is the gesture people make by
   * accident and the shutter is real hardware that takes seconds to travel
   * (issue #47). Naming the shutter here is the opposite of an accident, so
   * the choice is honoured — it opens the shutter's dialog rather than driving
   * the motor. Moving it on a tap is a further step, and stays with
   * {@link tap_action}.
   */
  tapTarget?: OpeningTapTarget;
  /**
   * Lovelace actions for the opening (issue #74 follow-up). Same shape as
   * {@link FloorItem.tap_action}; an action's own `entity` picks which of
   * `entity` / `shutterEntity` it acts on. Defaults: tap opens/toggles the
   * primary entity, hold shows more-info for the shutter when both are bound,
   * double-tap does nothing. See {@link openingActionForGesture}.
   */
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
  /**
   * Sliding openings only (`motion: "slide"`): how the panels are arranged.
   * - `single` (default) — one panel slides aside into the wall.
   * - `bypass` — two panels on parallel tracks; one slides behind the other
   *   (patio-door style).
   * - `biparting` — two panels meet in the middle and part, each recessing into
   *   the wall on its own side.
   * Ignored for swinging openings.
   */
  sliderStyle?: "single" | "bypass" | "biparting";
}

/**
 * Which of an opening's two entities its gestures lead with — see
 * {@link Opening.tapTarget}. Named by role rather than by entity id, like
 * {@link BadgeEntity}, so renaming an entity in Home Assistant cannot orphan
 * the choice.
 */
export type OpeningTapTarget = "opening" | "shutter";

export type ItemKind =
  | "light"
  | "switch"
  | "sensor"
  | "binary_sensor"
  | "climate"
  | "cover"
  | "media_player"
  | "fan"
  | "camera"
  | "lock"
  | "humidifier"
  | "vacuum"
  | "generic";

/** An entity icon placed on the plan. */
export interface FloorItem {
  id: string;
  entity: string;
  /**
   * Optional second entity (e.g. a humidity sensor paired with a temperature
   * entity). When set and the state is shown, both values are displayed in the
   * same element. The primary `entity` drives on/off state and click actions.
   */
  secondaryEntity?: string;
  /**
   * Show this attribute of `entity` instead of its state (issue #70) — e.g. a
   * climate's `current_temperature` rather than "heat". Formatted through
   * HA's own attribute formatter when available.
   */
  attribute?: string;
  /**
   * Attribute for the second reading. Applies to `secondaryEntity` when set,
   * else to `entity` — so one climate device can show
   * `current_temperature · current_humidity` without a second entity.
   */
  secondaryAttribute?: string;
  /**
   * Threshold colors for the label line (issue #68), highest matching `above`
   * wins; an entry without `above` is the default. Evaluated against the
   * displayed value (the attribute when `attribute` is set, else the state):
   *
   * ```yaml
   * stateColor:
   *   - above: 26
   *     color: red
   *   - above: 24
   *     color: orange
   *   - color: white
   * ```
   *
   * Rules may also match an exact state instead of a threshold, for entities
   * whose value is not a number:
   *
   * ```yaml
   * stateColor:
   *   - state: open
   *     color: red
   *   - color: green
   * ```
   *
   * Colors pass through the style-injection allowlist (#64) at render time.
   */
  stateColor?: StateColorRule[];
  x: number;
  y: number;
  kind: ItemKind;
  /** Optional override icon (mdi:...). Falls back to the entity's icon. */
  icon?: string;
  /** Optional label override. Falls back to the entity's friendly name. */
  name?: string;
  /** Show the entity state next to the icon. */
  showState?: boolean;
  /**
   * Show the device's name in the label line (issue #61) — the `name`
   * override, else the entity's friendly name. Combines with `showState` as
   * "Name · state". Default false.
   */
  showName?: boolean;
  /** Label line font size in pixels (issue #59). Default 12. */
  labelSize?: number;
  /**
   * @deprecated Superseded by {@link badgeContent} (issue #106), which is the
   * same switch with a third position. Still honoured when `badgeContent` is
   * absent, so every existing config keeps rendering identically —
   * {@link badgeContentOf} owns that fallback.
   */
  showIcon?: boolean;
  /**
   * What the badge holds (issue #106):
   *
   * - `"icon"` (default) — the glyph, as always;
   * - `"value"` — the device's reading, rounded and compact, *inside* the
   *   badge: a thermostat reads `21°` in the same circle `stateColor` already
   *   paints red while it heats, instead of a text line hanging underneath.
   *   Which reading is worked out per domain by {@link badgeValue}; when
   *   nothing numeric is available the badge falls back to its icon, so this
   *   can never leave an empty circle;
   * - `"none"` — no badge at all, label only (the old `showIcon: false`).
   */
  badgeContent?: BadgeContent;
  /**
   * Which of this device's own entities the badge reads while
   * `badgeContent: "value"` (issue #136) — the main `entity`, or
   * {@link secondaryEntity}.
   *
   * Absent means "work it out", which is what {@link badgeValue} has always
   * done: the first candidate with a number wins, so a switch that reads "on"
   * already falls through to its power sensor. That guess is usually right,
   * but it is only a guess, and there was no way to overrule it when the main
   * entity happens to be numeric too.
   *
   * Set, it is the *only* entity read. No falling back to the other one:
   * having asked for the power sensor, being shown the switch instead would
   * be worse than being shown the icon — which is what a device with no
   * number to display falls back to anyway.
   */
  badgeEntity?: BadgeEntity;
  /**
   * Hide this device on the live card while its entity is inactive (issue
   * #55), so a busy room only shows what is actually doing something. The
   * editor always draws it — dimmed — or it could never be selected again.
   * "Active" is the same domain-aware test the badge highlight uses
   * ({@link entityIsActive}), so a lock reads unlocked, a vacuum cleaning.
   */
  hideWhenInactive?: boolean;
  /** Badge diameter in pixels. Default 34. */
  size?: number;
  /** Icon rotation in degrees. Default 0. */
  angle?: number;
  /**
   * How the device is drawn. Default "badge".
   *
   * The ripple modes render on any entity. The editor only *offers* them on a
   * presence device (issue #127) — a ring says "someone is there" — so a ring
   * on anything else is a YAML-only choice.
   */
  display?: ItemDisplay;
  /**
   * Animate the icon while the entity is active (issue #48). "auto" (the
   * default) applies HA-like defaults per domain — a running fan spins; a
   * media player or vacuum pulses while active (for a media player that
   * means `playing` or plain `on`, matching the badge highlight);
   * "spin"/"pulse" force that animation (still only while active); "none"
   * disables it.
   *
   * "auto" has no counterpart in the editor's menu (issue #127): it shows the
   * animation auto resolves to for this entity instead of the word, and writes
   * that value out the moment the badge dropdown is touched. Editing anything
   * else leaves the key alone, so a config keeps its "auto" — and its meaning —
   * until someone actually decides about the animation.
   */
  iconAnimation?: IconAnimation;
  /**
   * Badge color while the entity is active (issue #79). Falls back to the
   * theme's active color — the yellow every device shares by default, which
   * makes lights, covers and switches hard to tell apart at a glance.
   * Same meaning as {@link Opening.activeColor}.
   */
  activeColor?: string;
  /** Ripple ring color (CSS/hex). Falls back to `activeColor`, then the primary color. */
  rippleColor?: string;
  /** Max ripple ring diameter in pixels. Default 80. */
  rippleSize?: number;
  /**
   * Cast a pool of light onto the plan from this device's position (issue #6).
   *
   * The room is not tinted as a whole — the light falls where the device sits,
   * so several lights in one room each cast their own pool and the pools mix
   * where they overlap. That handles an open-plan room, or one lamp warm and
   * another cool, which a single room-wide fill cannot express.
   *
   * The device's own `x`/`y` are the position, so a light icon already placed
   * on the plan needs nothing but this flag.
   */
  glow?: boolean;
  /** Radius of the cast pool in canvas units. Default {@link DEFAULT_GLOW_RADIUS}. */
  glowRadius?: number;
  /**
   * Color for a light that cannot report one — a brightness-only or on/off
   * bulb. A color-capable light always paints its own `rgb_color` instead.
   * Defaults to {@link DEFAULT_GLOW_COLOR}, a warm white.
   */
  glowColor?: string;
  /** Lovelace actions. Defaults: tap = toggle (controllable domains) or more-info; hold/double = none. */
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}

export type ItemDisplay = "badge" | "ripple" | "iconRipple";

/** What a device badge holds — see {@link FloorItem.badgeContent} (issue #106). */
export type BadgeContent = "icon" | "value" | "none";

/**
 * Which of a device's two entities feeds its value badge — see
 * {@link FloorItem.badgeEntity} (issue #136). Named by role rather than by
 * entity id so renaming an entity in Home Assistant cannot orphan the choice.
 */
export type BadgeEntity = "primary" | "secondary";

/**
 * One colour rule for {@link FloorItem.stateColor} / {@link Furniture.stateColor}.
 *
 * A rule matches either a numeric threshold (`above`) or an exact state
 * (`state`); a rule with neither is the default. `state` covers non-numeric
 * entities — a cover reading "open", a media player "playing" (issue #79) —
 * while `above` covers readings like temperature or soil moisture (#68, #82).
 */
export interface StateColorRule {
  /** Applies when the numeric value is strictly greater. */
  above?: number;
  /** Applies when the value equals this exactly (case-insensitive). */
  state?: string;
  color: string;
  /**
   * Icon to show while this rule matches (issue #106) — "blinds open" and
   * "blinds closed" as two glyphs, not just two colours. Optional: a rule
   * without one only changes the colour, exactly as before.
   *
   * Only {@link FloorItem} reads this; furniture and areas share this rule
   * shape but draw polygons, so an `icon` on their rules is ignored.
   */
  icon?: string;
}

export type IconAnimation = "auto" | "none" | "spin" | "pulse";

/**
 * A Lovelace action (tap/hold/double_tap). Typed loosely on purpose: HA has
 * renamed fields over time (call-service→perform-action, service_data→data)
 * and unknown fields must pass through the card untouched.
 */
export interface ActionConfig {
  action: string;
  entity?: string;
  navigation_path?: string;
  url_path?: string;
  perform_action?: string;
  service?: string;
  data?: Record<string, unknown>;
  service_data?: Record<string, unknown>;
  target?: Record<string, unknown>;
  confirmation?: { text?: string } | boolean;
  [key: string]: unknown;
}

/** A free text label placed on the plan. */
export interface FloorText {
  id: string;
  x: number;
  y: number;
  text: string;
  /** Font size in pixels. Default 16. */
  size?: number;
  /** Text color (CSS color / hex). Falls back to the theme text color. */
  color?: string;
  /** Rotation in degrees. Default 0. */
  angle?: number;
}

export type FurnitureType =
  | "table"
  | "roundTable"
  | "desk"
  | "chair"
  | "sofa"
  | "bed"
  | "wardrobe"
  | "rug"
  | "plant"
  | "fridge"
  | "stove"
  | "sink"
  | "toilet"
  | "stairs"
  | "tv"
  | "washer"
  | "dryer"
  | "dishwasher"
  | "waterHeater"
  | "airHandler"
  | "bathtub"
  | "vanity"
  | "sectional"
  | "fishTank"
  | "piano"
  | "hotTub";

/**
 * Which end of an L-shaped sectional the chaise sits on, facing the sofa from
 * the front. Only meaningful for `type: "sectional"`; defaults to `"right"`.
 */
export type SectionalHand = "left" | "right";

/** A gray furniture/fixture diagram placed on the plan. */
export interface Furniture {
  id: string;
  type: FurnitureType;
  /** L-shaped sectional only: which side the chaise extends on. Default `right`. */
  hand?: SectionalHand;
  x: number;
  y: number;
  /** Width / height in virtual units. */
  w: number;
  h: number;
  /** Rotation in degrees. Default 0. */
  angle?: number;
  /** Stroke/fill color. Defaults to gray so it reads differently from walls. */
  color?: string;
  /**
   * Optional entity that makes the drawing live (issue #82) — a soil sensor on
   * a plant, a water temperature sensor on a fish tank, a contact sensor on a
   * cabinet. Drives {@link stateColor} and {@link activeColor}; furniture has
   * no click action, so an unbound piece is still just a gray diagram.
   */
  entity?: string;
  /**
   * Threshold/state colors for the drawing, in the same shape as
   * {@link FloorItem.stateColor}. Evaluated against `entity`'s state; takes
   * precedence over {@link activeColor} and {@link color}.
   */
  stateColor?: StateColorRule[];
  /** Color while `entity` is active. Used when no {@link stateColor} rule matches. */
  activeColor?: string;
}

/**
 * A live position tracker driven by 1 or 2 distance sensors aimed along
 * orthogonal axes. The user draws a rectangular tracked area on the floor
 * plan and binds an HA distance entity to each axis; the card linearly
 * maps each sensor's `[min, max]` reading to the corresponding edge-to-edge
 * span of the rectangle.
 *
 * With both sensors configured the card animates a pulsating triangle with
 * ripple rings at the resolved (x, y) inside the zone. With only one
 * sensor configured it animates a faint pulsating line spanning the
 * unknown axis (we know the target sits *somewhere* on that line).
 *
 * The zone rectangle is visible only in the editor; the live card renders
 * only the tracked-object animation.
 */
export interface Tracker {
  id: string;
  /** Top-left in virtual units. */
  x: number;
  y: number;
  /** Size in virtual units. */
  w: number;
  h: number;
  /** Rotation in degrees. Default 0. */
  angle?: number;
  /** Marker / ripple color (CSS / hex). Falls back to the primary color. */
  color?: string;
  /** Marker diameter in pixels. Default 14. */
  dotSize?: number;
  /** Distance sensor mapped to the X axis (rectangle's horizontal span). */
  xSensor?: TrackerSensor;
  /** Distance sensor mapped to the Y axis (rectangle's vertical span). */
  ySensor?: TrackerSensor;
}

/**
 * A single distance sensor mapping. `[min, max]` reading values map
 * linearly to the edge-to-edge span of the tracker rectangle along the
 * sensor's axis. `invert: true` flips the mapping (max → min edge).
 *
 * Optionally a `presence` entity gates the marker: when any configured
 * presence on the tracker reports "not detected" the animation is hidden
 * entirely (the zone outline still shows in the editor). This handles the
 * common case where a radar / mmWave device exposes both `sensor.*_distance`
 * and `binary_sensor.*_occupancy` as siblings — gating on the latter
 * suppresses ghost markers when the room is empty.
 */
export interface TrackerSensor {
  entity: string;
  /** Sensor reading when the target is at the "near" edge. */
  min: number;
  /** Sensor reading when the target is at the "far" edge. */
  max: number;
  /** Flip the mapping so that `max` corresponds to the near edge. */
  invert?: boolean;
  /**
   * Optional binary entity (`binary_sensor.*`, `input_boolean`, etc.) whose
   * "not detected" state hides the marker animation. When unset, the marker
   * is never gated by presence — only by whether a distance reading is
   * available.
   */
  presence?: TrackerPresence;
}

/**
 * A presence / occupancy gate bound to a tracker sensor. `entity` is read as
 * a binary on/off state (with `invert` to flip inverted-logic sensors). When
 * the entity is `unavailable` / `unknown` we treat it as "not detected" —
 * better to hide a possibly-stale marker than to leave it showing during a
 * sensor outage.
 */
export interface TrackerPresence {
  entity: string;
  /** Treat "off" / "clear" as detected (for inverted-logic sensors). */
  invert?: boolean;
}

/** A vertex of an {@link Area} polygon, in virtual canvas units. */
export interface AreaPoint {
  x: number;
  y: number;
}

/**
 * A named room polygon, drawn point-by-point in the editor and closed by
 * clicking back on the starting vertex. Distinct from a {@link Floor} (a
 * whole level/story) the same way Home Assistant's own "area" (room) sits
 * inside a "floor" — see {@link Area.haArea}.
 */
export interface Area {
  id: string;
  /** Vertices in drawing order, virtual canvas units. Implicitly closed (last -> first). */
  points: AreaPoint[];
  /** Display name. Mirrors the linked HA area's name when `haArea` is set. */
  name?: string;
  /** Show the name label on the plan, centered on the polygon. Default true. */
  showName?: boolean;
  /**
   * Name label font size. Px under `overlayScale: fixed`, canvas units under
   * `plan`. Default {@link DEFAULT_AREA_LABEL_SIZE}. A room name had no size
   * control at all before this, which left "hide it" as the only answer to a
   * label wider than its room.
   */
  labelSize?: number;
  /** Fill color. Falls back to the theme primary color. */
  color?: string;
  /** Fill opacity, 0-1. Default {@link DEFAULT_AREA_OPACITY}. */
  opacity?: number;
  /**
   * Optional link to a Home Assistant area (its registry `area_id`). Selecting
   * one names this Area after it (same convention as {@link Floor.haFloor}).
   * Whether it also scopes the entity picker is controlled by
   * {@link filterEntities}.
   */
  haArea?: string;
  /**
   * With `haArea` linked, scope the entity picker (for devices placed inside
   * this polygon) to that HA area's entities. Default true. Has no effect
   * without a linked `haArea`.
   */
  filterEntities?: boolean;
  /**
   * Optional entity that makes the room itself live (issue #6) — a presence
   * sensor that lights the room while it is occupied, an air quality sensor
   * that reddens it when readings go bad. Drives {@link stateColor} and
   * {@link activeColor}; an unbound area is still just a static polygon.
   */
  entity?: string;
  /**
   * Threshold/state colors for the fill, in the same shape as
   * {@link FloorItem.stateColor}. Evaluated against `entity`'s state; takes
   * precedence over {@link activeColor} and {@link color}.
   */
  stateColor?: StateColorRule[];
  /** Fill color while `entity` is active. Used when no {@link stateColor} rule matches. */
  activeColor?: string;
  /**
   * Fill opacity while `entity` resolves a color, 0-1. Lets a room lift out of
   * the plan while it is live without permanently darkening it when it is not.
   * Falls back to {@link opacity}.
   */
  activeOpacity?: number;
  /**
   * Static outline color for the polygon. No outline is drawn by default, so
   * existing plans render unchanged.
   */
  borderColor?: string;
  /** Outline width in canvas units. Defaults to {@link DEFAULT_AREA_BORDER_WIDTH}. */
  borderWidth?: number;
  /**
   * Where a resolved live color paints: the `fill` (default, and the only
   * behaviour before this option existed), the `border`, or `both`. Use
   * `border` for a room that outlines itself while occupied without tinting
   * everything inside it — which reads better on a busy plan.
   */
  highlight?: "fill" | "border" | "both";
}

/**
 * Whether a device inside `area` should have its entity picker scoped to the
 * linked HA area's entities: only once an HA area is actually linked, and
 * only while {@link Area.filterEntities} hasn't been turned off (defaults on).
 */
export function areaFiltersEntities(
  area: Pick<Area, "haArea" | "filterEntities"> | undefined
): boolean {
  return !!area?.haArea && (area.filterEntities ?? true);
}

/**
 * Sun elevation (degrees) the dimming ramp spans (issue #113). Civil twilight
 * is -6°, so this covers roughly the hour around sunrise/sunset when the light
 * outside actually changes — below it is night, above it is day.
 */
export const SUN_ELEVATION_NIGHT = -6;
export const SUN_ELEVATION_DAY = 6;
/** Plan brightness at night / in daylight when `sunDimming` is on. */
export const DEFAULT_SUN_MIN = 0.45;
export const DEFAULT_SUN_MAX = 1;

/**
 * How a device answers a press (issue #134):
 *
 * - `scale` — dips to {@link PRESS_SCALE} and springs back, the feedback HA's
 *   own Tile card and every touch OS uses.
 * - `ripple` — an ink circle spreads from the point you touched.
 * - `flash` — a halo of the skin's accent, with no movement at all.
 * - `none` — the pre-#134 behaviour, nothing.
 */
export type PressEffect = "scale" | "ripple" | "flash" | "none";

/** On by default: the issue asked for feedback, so "no feedback" is the opt-out. */
export const DEFAULT_PRESS_EFFECT: PressEffect = "scale";

/**
 * How far a pressed device shrinks. Deep enough to read at a 34px badge,
 * shallow enough not to look like the icon is falling over.
 */
export const PRESS_SCALE = 0.92;

/**
 * Press feedback timing. The release is deliberately far slower than the
 * press: a tap can be over in 30ms, and with a symmetric transition it would
 * finish before a screen ever painted it. Dipping instantly and easing back
 * out makes even the quickest tap visible.
 */
export const PRESS_IN_MS = 80;
export const PRESS_OUT_MS = 260;

export const DEFAULT_AREA_OPACITY = 0.25;
/** Area name label size, matching the hard-coded value it replaces. */
export const DEFAULT_AREA_LABEL_SIZE = 14;
export const DEFAULT_AREA_BORDER_WIDTH = 3;

/** Radius of a light's cast pool, in canvas units (issue #6). */
export const DEFAULT_GLOW_RADIUS = 140;
/**
 * Warm white, for a light that cannot report a color of its own — as the skin's
 * token (issue #122) so Tron's pools read cyan rather than tungsten, with the
 * original hex as the fallback so an unskinned plan is unchanged.
 */
export const DEFAULT_GLOW_COLOR = "var(--fp-skin-glow, #ffd9a0)";
/**
 * Opacity band a light's `brightness` maps into at the center of its pool.
 *
 * Not 0–1: a lamp dimmed to 10% would be invisible, and "I can't see it" reads
 * worse than "it's dim". The ceiling keeps a bright lamp from burying the
 * furniture and icons it sits on top of.
 */
export const GLOW_MIN_OPACITY = 0.18;
export const GLOW_MAX_OPACITY = 0.6;

/**
 * Smallest share of its configured `glowRadius` a lamp's pool shrinks to as it
 * dims (issue #123). Dimming a lamp draws the light *in* as well as thinning
 * it, which is what dimming looks like in a room.
 *
 * Floored for the same reason {@link GLOW_MIN_OPACITY} is: a lamp at 5% would
 * otherwise collapse to a dot under its own icon and read as switched off.
 * `glowRadius` stays the full-brightness size, so a lamp at 100% — and any
 * bulb that reports no brightness at all — is unaffected.
 */
export const GLOW_MIN_RADIUS = 0.5;

/**
 * How far a light's `brightness` may darken its **badge** colour (issue #106,
 * @ombre33): a lamp at full brightness badges its true `rgb_color`, one dimmed
 * to nothing badges this fraction of it.
 *
 * A floor, not zero, for the same reason {@link GLOW_MIN_OPACITY} is: a badge
 * that fades to black is a badge you can no longer identify, and a barely-lit
 * lamp should still read as *that* lamp.
 */
export const BADGE_MIN_LIGHTNESS = 0.45;

/**
 * How much of a light pool passes **through** furniture (issue #106,
 * @MrMcFlyy) — see {@link renderGlowMask}, which paints this as the mask's
 * grey level.
 *
 * A dial, not a switch, and both ends have been reported as bugs. At 1 a warm
 * pool floods every sofa in the room and furniture reads as highlighted, which
 * is #108. At 0 furniture is a hole in the light — darker than the floor
 * around it, so a lit table looks shadowed, which is what reopened this. In
 * between, light lands on furniture while its own gray still reads as gray.
 */
export const FURNITURE_GLOW_TRANSMISSION = 0.5;

export const DEFAULT_TRACKER_DOT_SIZE = 14;

export const DEFAULT_ITEM_SIZE = 34;
export const DEFAULT_TEXT_SIZE = 16;
export const DEFAULT_RIPPLE_SIZE = 80;
/** Neutral gray, so furniture reads differently from the walls. Skinnable (#122). */
export const FURNITURE_COLOR = "var(--fp-skin-furniture, #9e9e9e)";

/** Default width/height per furniture type, in virtual units. */
export const FURNITURE_DEFAULT_SIZE: Record<FurnitureType, { w: number; h: number }> = {
  table: { w: 120, h: 80 },
  roundTable: { w: 100, h: 100 },
  desk: { w: 120, h: 60 },
  chair: { w: 44, h: 44 },
  sofa: { w: 170, h: 72 },
  bed: { w: 150, h: 200 },
  wardrobe: { w: 120, h: 55 },
  rug: { w: 180, h: 120 },
  plant: { w: 44, h: 44 },
  fridge: { w: 60, h: 64 },
  stove: { w: 64, h: 64 },
  sink: { w: 64, h: 48 },
  toilet: { w: 48, h: 68 },
  stairs: { w: 90, h: 170 },
  tv: { w: 110, h: 18 },
  washer: { w: 60, h: 62 },
  dryer: { w: 60, h: 62 },
  dishwasher: { w: 60, h: 60 },
  waterHeater: { w: 52, h: 52 },
  airHandler: { w: 60, h: 56 },
  bathtub: { w: 150, h: 76 },
  vanity: { w: 110, h: 55 },
  sectional: { w: 230, h: 180 },
  fishTank: { w: 100, h: 40 },
  piano: { w: 140, h: 60 },
  hotTub: { w: 120, h: 120 },
};

/**
 * A single floor/level. Each floor owns its own set of elements. The canvas
 * size, grid and background are shared across floors (config-level).
 */
export interface Floor {
  id: string;
  name: string;
  /**
   * Optional link to a Home Assistant floor (its registry `floor_id`).
   * Selecting one in the editor names this floor after it; the id is kept so
   * future features (e.g. area filtering, per-floor entity defaults) can use
   * the association. Purely additive — nothing renders differently today.
   */
  haFloor?: string;
  /**
   * Short label for the card's floor-switcher button (issue #67), e.g. "GF" —
   * the full `name` stays as the tooltip. Falls back to `name`.
   */
  short?: string;
  /**
   * Accent color for this floor's switcher button while active (issue #67).
   * Passes through the style-injection allowlist (#64). Falls back to the
   * theme primary color.
   */
  color?: string;
  /**
   * Optional background image URL (e.g. `/local/floorplan.png` or an external
   * URL) drawn behind the elements — handy for tracing over a real floor plan.
   */
  image?: string;
  /**
   * How the background image maps onto the virtual canvas (issue #86).
   *
   * The canvas width/height are config-level but `image` is per-floor, so a
   * multi-floor plan whose scans differ in resolution cannot pick one canvas
   * ratio that suits them all — at least one floor gets squashed. This is
   * per-floor precisely so each scan can choose for itself.
   *
   * - **`stretch`** (default) — fill the canvas, distorting if the ratios
   *   disagree. Kept as the default because existing plans were traced over a
   *   stretched image; changing it under them would shift every wall.
   * - **`contain`** — scale to fit, preserving the image's own aspect ratio.
   *   Letterboxes: the canvas may show through on two sides.
   * - **`cover`** — fill the canvas preserving aspect ratio, cropping the
   *   overflow.
   */
  imageFit?: "stretch" | "contain" | "cover";
  /** Background image opacity, 0–1. Default 1. */
  imageOpacity?: number;
  walls: Wall[];
  openings: Opening[];
  items: FloorItem[];
  texts: FloorText[];
  furniture: Furniture[];
  trackers: Tracker[];
  areas: Area[];
}

/** Sizing mode for the HTML overlay layer. See {@link FloorplanCardConfig.overlayScale}. */
export type OverlayScale = "fixed" | "plan";

export interface FloorplanCardConfig extends LovelaceCardConfig {
  type: string;
  title?: string;
  /** Virtual canvas size; the SVG viewBox uses these. Drawing is resolution-independent. */
  width: number;
  height: number;
  /** Visible editor grid spacing in virtual units (purely a visual guide). */
  grid?: number;
  /**
   * Placement snap step in virtual (canvas) units. Tri-state:
   * - **unset** — placement/drag/nudge snap to the visible `grid` (the default).
   * - **`0`** — free placement (no snapping anywhere).
   * - **`> 0`** — snap to this custom step (absolute units).
   *
   * The editor presents a custom step as a percentage of the grid (e.g. `50` %
   * of a `20` grid is stored here as `10`), but the stored value is always
   * absolute. Resolve with {@link resolveSnap}.
   */
  snap?: number;
  /**
   * Rotate the *displayed* card in 90° steps (issue #33), e.g. to show a
   * landscape plan on a portrait wall tablet. Coordinates stay unrotated —
   * the editor always shows the plan as drawn. Values other than
   * 0/90/180/270 are normalized (see normalizePlanRotation).
   */
  rotation?: number;
  /**
   * Built-in skin id (issue #122), e.g. `odnetnin`, `pastel`, `tron`. Restyles
   * the whole plan at once — paper, walls, badges, accents — by supplying the
   * fallbacks every element already reads.
   *
   * Unset (or an id we don't ship) means the default look, which follows the
   * Home Assistant theme exactly as it always has. A skin only ever supplies
   * fallbacks, so any colour set on an element itself still wins. See
   * `src/skins.ts`.
   */
  skin?: string;
  /**
   * How the HTML overlay (badges, labels, room names, text) is sized.
   *
   * - **`fixed`** (default) — screen pixels, whatever size the card renders at.
   * - **`plan`** — canvas units, so the overlay scales with the drawing exactly
   *   as the SVG does.
   *
   * `fixed` is the historic behaviour and is right when the card renders at
   * roughly its canvas size. It falls apart below that: a plan drawn at 980
   * wide and rendered 510 wide draws every wall at half size while a 14px room
   * name stays 14px, so labels collide with the badges and each other. `plan`
   * makes the two layers shrink together. Default stays `fixed` so no existing
   * card changes appearance on upgrade.
   */
  overlayScale?: OverlayScale;
  /** Canvas background color (CSS / hex). Falls back to the skin's paper, then the card background. */
  background?: string;
  /**
   * Hatch the plan's dead spaces (issue #88): every region the walls close off
   * completely that no door or window opens onto — the void behind a boxed-in
   * stairwell, a service shaft, the pocket left between two rooms.
   *
   * There is nothing to place and nothing stored: the regions are derived from
   * the walls and openings on every render (see `src/dead-space.ts`), so
   * cutting a doorway into a shaft stops it being dead the moment the door is
   * placed, and moving a wall moves the hatching with it.
   *
   * Off by default, and not because the detection is in doubt. A plan that
   * marks its doorways as plain gaps in the wall rather than with door symbols
   * is a perfectly ordinary plan, and it is *also*, read literally, a house
   * with no way in — turning this on by default would hatch such a plan end to
   * end on upgrade. Whether the walls tell the whole story is the author's call
   * to make, so it is theirs to switch on.
   */
  showDeadSpaces?: boolean;
  /**
   * Follow the real sun (issue #113): dim the plan through dusk and brighten
   * it through dawn, tracking the **Home Assistant instance's** own sunrise
   * and sunset rather than the viewer's browser.
   *
   * Driven by `sun.sun`'s `elevation` attribute, which Home Assistant already
   * computes continuously from the instance's latitude, longitude and clock.
   * That is the whole reason not to read timestamps and interpolate: elevation
   * is the smooth signal, it comes from the server, and a phone in another
   * timezone showing the same dashboard sees the same picture.
   */
  sunDimming?: boolean;
  /**
   * Plan brightness once the sun is fully down, 0-1. Default
   * {@link DEFAULT_SUN_MIN}. Not 0: a plan you cannot read at night is worse
   * than one that is merely dim.
   */
  sunBrightnessMin?: number;
  /** Plan brightness in full daylight, 0-1. Default {@link DEFAULT_SUN_MAX}. */
  sunBrightnessMax?: number;
  /**
   * What a device does when you press it (issue #134). Tapping used to change
   * nothing on screen until the entity itself came back — which on a cover or
   * a slow bulb is long enough to wonder whether the tap registered at all.
   *
   * Plan-wide rather than per-device: it is a property of how the dashboard
   * feels, not of any one lamp, and a plan where half the devices answer
   * differently would read as broken. Default {@link DEFAULT_PRESS_EFFECT}.
   *
   * Applies only to devices that actually *do* something — see
   * {@link itemIsInteractive}. Feedback promising an action that never comes is
   * worse than none.
   */
  pressEffect?: PressEffect;
  /**
   * Multi-floor data. When present and non-empty this is the source of truth.
   * When absent, the legacy flat arrays below describe a single implicit floor
   * (kept for backward compatibility with hand-written configs).
   */
  floors?: Floor[];
  /** Id of the floor shown first. Falls back to the first floor. */
  defaultFloor?: string;
  walls?: Wall[];
  openings?: Opening[];
  items?: FloorItem[];
  texts?: FloorText[];
  furniture?: Furniture[];
  trackers?: Tracker[];
  areas?: Area[];
}

export const DEFAULT_WIDTH = 1000;
export const DEFAULT_HEIGHT = 600;
export const DEFAULT_GRID = 20;
/**
 * Default for the **Custom** snap mode, as a percentage of the grid — i.e. half
 * a grid cell. The editor expresses custom snap relative to the grid; the stored
 * `snap` value remains an absolute step in canvas units.
 */
export const DEFAULT_CUSTOM_PERCENT = 50;

/**
 * Resolve a `snap` config value into the effective step that placement / drag
 * / nudge / wall drawing should use, given the visible `grid`.
 *
 * - `null` / `undefined` → follow the visible grid (most intuitive default).
 * - `0` → free placement (no snapping).
 * - any other number → that exact step (absolute, in canvas units).
 */
export function resolveSnap(snap: number | null | undefined, grid: number): number {
  return snap == null ? grid : snap;
}

/**
 * Express a custom (absolute) snap step as a percentage of the grid, for the
 * editor UI. `50` means "half a grid cell". Rounded to a whole percent.
 */
export function snapToGridPercent(snap: number, grid: number): number {
  if (grid <= 0) return 100;
  return Math.round((snap / grid) * 100);
}

/**
 * Convert a percentage-of-grid back into an absolute snap step (canvas units),
 * clamped to a sensible minimum so the step is never zero/negative.
 */
export function gridPercentToSnap(percent: number, grid: number): number {
  return Math.max(1, Math.round((grid * percent) / 100));
}

/** A Home Assistant floor-registry entry (the subset this card uses). */
export interface HaFloorInfo {
  floor_id: string;
  name: string;
  /** Vertical ordering in HA (ground = 0, upstairs = 1, basement = -1, …). */
  level?: number | null;
}

/**
 * List the Home Assistant floors from a `hass` object, sorted by level then
 * name. Older HA versions (before the floor registry was exposed on `hass`)
 * and the dev harness simply yield `[]`, so callers can hide the control when
 * there is nothing to link to. Typed loosely because `custom-card-helpers`'
 * HomeAssistant type predates `hass.floors`.
 */
export function haFloorsOf(hass: unknown): HaFloorInfo[] {
  const floors = (hass as { floors?: Record<string, HaFloorInfo> } | null | undefined)?.floors;
  if (!floors || typeof floors !== "object") return [];
  return Object.values(floors)
    .filter((f): f is HaFloorInfo => !!f && typeof f.floor_id === "string" && typeof f.name === "string")
    .sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.name.localeCompare(b.name));
}

/** A Home Assistant area-registry entry (the subset this card uses). */
export interface HaAreaInfo {
  area_id: string;
  name: string;
}

/**
 * List the Home Assistant areas from a `hass` object, sorted by name. Mirrors
 * {@link haFloorsOf} exactly: `custom-card-helpers`' HomeAssistant type predates
 * `hass.areas` too, and older HA / the dev harness simply yield `[]`.
 */
export function haAreasOf(hass: unknown): HaAreaInfo[] {
  const areas = (hass as { areas?: Record<string, HaAreaInfo> } | null | undefined)?.areas;
  if (!areas || typeof areas !== "object") return [];
  return Object.values(areas)
    .filter((a): a is HaAreaInfo => !!a && typeof a.area_id === "string" && typeof a.name === "string")
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a typed room name to a Home Assistant area, so the Area panel can
 * offer one combined name-with-autocomplete field instead of a separate name
 * box and HA-area dropdown: whatever the user types is the display name, and
 * if it happens to name a real HA area we link to it too.
 *
 * Matching is exact first, then case-insensitive, then case-insensitive with
 * surrounding whitespace collapsed — so "living  room" still finds "Living
 * Room" — and returns `undefined` for free-text names that match nothing.
 *
 * NOTE: Home Assistant allows two areas to share a name (e.g. a "Bathroom" on
 * each floor). Names therefore can't disambiguate them, and the first match in
 * `haAreasOf` order (sorted by name, so effectively arbitrary between equals)
 * wins. That ambiguity is inherent to naming an area by name; picking the
 * other one means renaming it in HA.
 */
/**
 * Resolve the HA-area link for an Area form patch that may carry a new `name`.
 * The name field doubles as the link, so committing a name also decides
 * `haArea`: a name matching an HA area links it (adopting that area's exact
 * spelling), anything else clears the link and stands as a plain label.
 * Patches that don't touch `name` pass through untouched.
 */
export function areaNamePatch(
  patch: Record<string, unknown>,
  areas: readonly HaAreaInfo[]
): Record<string, unknown> {
  if (!("name" in patch)) return patch;
  const typed = (patch.name ?? "").toString().trim();
  const ha = matchHaAreaByName(areas, typed);
  return { ...patch, name: ha ? ha.name : typed || undefined, haArea: ha?.area_id };
}

export function matchHaAreaByName(
  areas: readonly HaAreaInfo[],
  name: string | undefined
): HaAreaInfo | undefined {
  const raw = (name ?? "").trim();
  if (!raw) return undefined;
  const exact = areas.find((a) => a.name === raw);
  if (exact) return exact;
  const lower = raw.toLowerCase();
  const ci = areas.find((a) => a.name.toLowerCase() === lower);
  if (ci) return ci;
  const loose = lower.replace(/\s+/g, " ");
  return areas.find((a) => a.name.trim().toLowerCase().replace(/\s+/g, " ") === loose);
}

/**
 * The shape of `hass.entities`/`hass.devices` this card needs to resolve an
 * entity's effective Home Assistant area — the entity registry's own
 * `area_id` override, else its device's `area_id`. Neither is declared by
 * `custom-card-helpers`, so callers take `hass: unknown` like {@link haFloorsOf}.
 */
interface HaRegistryHass {
  entities?: Record<string, { device_id?: string | null; area_id?: string | null } | undefined>;
  devices?: Record<string, { area_id?: string | null } | undefined>;
}

/**
 * The effective Home Assistant area for an entity: its own registry override
 * when set, else the area of the device it belongs to. `undefined` when
 * neither resolves (no registry entry, or unassigned to any area).
 */
export function entityHaAreaId(hass: unknown, entityId: string): string | undefined {
  const h = hass as HaRegistryHass | null | undefined;
  const ent = h?.entities?.[entityId];
  if (!ent) return undefined;
  if (ent.area_id) return ent.area_id;
  const dev = ent.device_id ? h?.devices?.[ent.device_id] : undefined;
  return dev?.area_id ?? undefined;
}

/** Every entity id (out of the entity registry) whose effective HA area is `areaId`. */
export function entityIdsInHaArea(hass: unknown, areaId: string): string[] {
  const h = hass as HaRegistryHass | null | undefined;
  const entities = h?.entities;
  if (!entities || typeof entities !== "object") return [];
  return Object.keys(entities).filter((id) => entityHaAreaId(hass, id) === areaId);
}

export function emptyConfig(type: string): FloorplanCardConfig {
  return {
    type,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    grid: DEFAULT_GRID,
    walls: [],
    openings: [],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [],
  };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Structural equality for JSON-shaped config data. A missing key and an
 * `undefined` value compare equal, because a YAML round-trip through HA's
 * dialog drops undefined-valued keys.
 */
export function configsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => configsEqual(v, b[i]));
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  for (const k of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
    if (!configsEqual(ra[k], rb[k])) return false;
  }
  return true;
}

/** A fresh, empty floor (optionally seeded with walls). */
export function makeFloor(name: string, walls: Wall[] = []): Floor {
  return {
    id: uid("floor"),
    name,
    walls,
    openings: [],
    items: [],
    texts: [],
    furniture: [],
    trackers: [],
    areas: [],
  };
}

/**
 * Backfill any missing element arrays on a floor. Hand-written YAML configs
 * (and configs saved by older card versions, from before an element type
 * existed) routinely omit arrays like `texts` or `trackers`; the render paths
 * map over them directly, so a missing array would crash the card/editor.
 */
function normalizeFloor(f: Floor): Floor {
  return {
    ...f,
    walls: f.walls ?? [],
    openings: f.openings ?? [],
    items: f.items ?? [],
    texts: f.texts ?? [],
    furniture: f.furniture ?? [],
    trackers: f.trackers ?? [],
    areas: f.areas ?? [],
  };
}

/**
 * Repair missing / duplicated floor ids (issue #66). Hand-reordering floors
 * in YAML is done by cut-and-paste, which routinely drops an `id:` line or
 * pastes the same block twice. A missing id makes every by-id lookup miss
 * (floor switching dead); a duplicated one is worse — the editor patches
 * *every* floor sharing the id, so edits silently land on the wrong floor.
 * Backfill deterministically from the position so the repair is stable
 * across renders and persists on the next editor commit.
 */
function ensureFloorIds(floors: Floor[]): Floor[] {
  const seen = new Set<string>();
  return floors.map((f, i) => {
    let id = f.id || `floor_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    return id === f.id ? f : { ...f, id };
  });
}

/**
 * Reorder a floor one step up/down the list (issue #66), or null when the
 * move is a no-op (unknown id, or already at that end).
 */
export function moveFloor(
  floors: readonly Floor[],
  id: string,
  delta: -1 | 1
): Floor[] | null {
  const idx = floors.findIndex((f) => f.id === id);
  const to = idx + delta;
  if (idx < 0 || to < 0 || to >= floors.length) return null;
  const next = [...floors];
  const [f] = next.splice(idx, 1);
  next.splice(to, 0, f!);
  return next;
}

/**
 * Normalize a config into a list of floors. If `floors` is present and
 * non-empty each floor is returned with any missing element arrays
 * backfilled and ids repaired ({@link ensureFloorIds}); otherwise the legacy
 * flat arrays are wrapped into a single floor so old single-floor configs
 * keep rendering unchanged.
 */
export function getFloors(c: FloorplanCardConfig): Floor[] {
  if (c.floors && c.floors.length) return ensureFloorIds(c.floors.map(normalizeFloor));
  return [
    {
      id: "floor_main",
      name: "Floor 1",
      walls: c.walls ?? [],
      openings: c.openings ?? [],
      items: c.items ?? [],
      texts: c.texts ?? [],
      furniture: c.furniture ?? [],
      trackers: c.trackers ?? [],
      areas: c.areas ?? [],
    },
  ];
}

/**
 * Resolve a tracker presence gate into a tri-state:
 * - `null` — no presence gate configured for this sensor (caller treats as
 *   "not gated", i.e. always allow the marker).
 * - `true` — entity reports detected (`on`, `open`, `home`, `detected`).
 * - `false` — entity reports clear, or is `unavailable` / `unknown` (fail
 *   closed: hide the marker rather than show a stale position).
 *
 * `invert: true` flips detected ↔ clear for sensors wired with reversed
 * semantics. Unavailable / unknown is **never** inverted — those always
 * mean "we don't know", which always gates the marker off.
 */
export function trackerPresenceDetected(
  states: Record<string, { state: string } | undefined> | undefined,
  presence: TrackerPresence | null | undefined,
): boolean | null {
  if (!presence) return null;
  const raw = states?.[presence.entity]?.state;
  if (raw == null || raw === "unavailable" || raw === "unknown") return false;
  // Common "detected" states across binary_sensor device classes
  // (occupancy/motion/presence/etc.) plus input_boolean's plain on.
  const detected =
    raw === "on" || raw === "open" || raw === "home" || raw === "detected";
  return presence.invert ? !detected : detected;
}

/**
 * Resolve a sensor reading into a 0..1 fraction along its axis, applying
 * `min`/`max` mapping, clamping, and `invert`. Returns `null` when the
 * sensor is missing, the reading isn't a finite number, or the span is
 * zero (mis-configured) — callers fall back to neutral / unknown states.
 */
export function trackerAxisFraction(
  sensor: TrackerSensor | undefined,
  reading: number | null | undefined,
): number | null {
  if (!sensor) return null;
  if (reading == null || !Number.isFinite(reading)) return null;
  const span = sensor.max - sensor.min;
  if (span === 0) return null;
  const f = (reading - sensor.min) / span;
  const clamped = Math.max(0, Math.min(1, f));
  return sensor.invert ? 1 - clamped : clamped;
}
