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
   * Placement snap step in virtual units. When 0 or unset, elements are placed
   * freely (no snapping); when > 0, placement/drag/nudge round to this step.
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
}

export const DEFAULT_WIDTH = 1000;
export const DEFAULT_HEIGHT = 600;
export const DEFAULT_GRID = 20;

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
  };
}

export function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** A fresh, empty floor (optionally seeded with walls). */
export function makeFloor(name: string, walls: Wall[] = []): Floor {
  return { id: uid("floor"), name, walls, openings: [], items: [], texts: [], furniture: [] };
}

/**
 * Normalize a config into a list of floors. If `floors` is present and non-empty
 * it is returned as-is; otherwise the legacy flat arrays are wrapped into a
 * single floor so old single-floor configs keep rendering unchanged.
 */
export function getFloors(c: FloorplanCardConfig): Floor[] {
  if (c.floors && c.floors.length) return c.floors;
  return [
    {
      id: "floor_main",
      name: "Floor 1",
      walls: c.walls ?? [],
      openings: c.openings ?? [],
      items: c.items ?? [],
      texts: c.texts ?? [],
      furniture: c.furniture ?? [],
    },
  ];
}
