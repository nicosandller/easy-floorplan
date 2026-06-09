import type { HomeAssistant, LovelaceCardConfig } from "custom-card-helpers";

export type { HomeAssistant };

/** A straight wall segment in virtual coordinate space. */
export interface Wall {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type OpeningType = "door" | "window";

/**
 * A door or window. Positioned by its center point and rotation so it can be
 * dropped onto (and aligned with) a wall, but it is stored independently.
 */
export interface Opening {
  id: string;
  type: OpeningType;
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
}

export type ItemKind = "light" | "switch" | "sensor" | "binary_sensor" | "climate" | "cover" | "generic";

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
  x: number;
  y: number;
  kind: ItemKind;
  /** Optional override icon (mdi:...). Falls back to the entity's icon. */
  icon?: string;
  /** Optional label override. Falls back to the entity's friendly name. */
  name?: string;
  /** Show the entity state next to the icon. */
  showState?: boolean;
  /** Show the icon badge. When false only the state/label shows. Default true. */
  showIcon?: boolean;
  /** Badge diameter in pixels. Default 34. */
  size?: number;
  /** Icon rotation in degrees. Default 0. */
  angle?: number;
  /** How the device is drawn. Default "badge". */
  display?: ItemDisplay;
  /** Ripple ring color (CSS/hex). Falls back to the primary color. */
  rippleColor?: string;
  /** Max ripple ring diameter in pixels. Default 80. */
  rippleSize?: number;
}

export type ItemDisplay = "badge" | "ripple" | "iconRipple";

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
  | "tv";

/** A gray furniture/fixture diagram placed on the plan. */
export interface Furniture {
  id: string;
  type: FurnitureType;
  x: number;
  y: number;
  /** Width / height in virtual units. */
  w: number;
  h: number;
  /** Rotation in degrees. Default 0. */
  angle?: number;
  /** Stroke/fill color. Defaults to gray so it reads differently from walls. */
  color?: string;
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

export const DEFAULT_TRACKER_DOT_SIZE = 14;

export const DEFAULT_ITEM_SIZE = 34;
export const DEFAULT_TEXT_SIZE = 16;
export const DEFAULT_RIPPLE_SIZE = 80;
export const FURNITURE_COLOR = "#9e9e9e";

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
};

/**
 * A single floor/level. Each floor owns its own set of elements. The canvas
 * size, grid and background are shared across floors (config-level).
 */
export interface Floor {
  id: string;
  name: string;
  /**
   * Optional background image URL (e.g. `/local/floorplan.png` or an external
   * URL) drawn behind the elements — handy for tracing over a real floor plan.
   * It fills the virtual canvas, so match the canvas width/height to the image
   * aspect ratio to avoid distortion.
   */
  image?: string;
  /** Background image opacity, 0–1. Default 1. */
  imageOpacity?: number;
  walls: Wall[];
  openings: Opening[];
  items: FloorItem[];
  texts: FloorText[];
  furniture: Furniture[];
  trackers: Tracker[];
}

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
  /** Canvas background color (CSS / hex). Falls back to the card background. */
  background?: string;
  /**
   * Multi-floor data. When present and non-empty this is the source of truth.
   * When absent, the legacy flat arrays below describe a single implicit floor
   * (kept for backward compatibility with hand-written configs).
   */
  floors?: Floor[];
  /** Id of the floor shown first. Falls back to the first floor. */
  defaultFloor?: string;
  walls: Wall[];
  openings: Opening[];
  items: FloorItem[];
  texts?: FloorText[];
  furniture?: Furniture[];
  trackers?: Tracker[];
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
  };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
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
  };
}

/**
 * Normalize a config into a list of floors. If `floors` is present and
 * non-empty each floor is returned with any missing element arrays
 * backfilled; otherwise the legacy flat arrays are wrapped into a single
 * floor so old single-floor configs keep rendering unchanged.
 */
export function getFloors(c: FloorplanCardConfig): Floor[] {
  if (c.floors && c.floors.length) return c.floors.map(normalizeFloor);
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
