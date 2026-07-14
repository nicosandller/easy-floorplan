/**
 * Schema-driven form definitions for the editor: one `FormSpec` per element
 * kind, rendered either through HA's `<ha-form>` (native selectors) or the
 * editor's plain-input fallback. Everything here is pure and unit-tested;
 * the editor owns rendering, history routing, and hass-dependent side
 * effects (device-class inference, grid/snap rescale).
 */
import type {
  Floor,
  FloorItem,
  FloorText,
  FloorplanCardConfig,
  Furniture,
  FurnitureType,
  Opening,
  Tracker,
  Wall,
} from "./types";
import {
  DEFAULT_GRID,
  DEFAULT_ITEM_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TRACKER_DOT_SIZE,
} from "./types";
import {
  DEFAULT_LABEL_SIZE,
  defaultIcon,
  normalizePlanRotation,
  openingMotion,
  sliderStyleOf,
} from "./render";
import { defaultItemAction } from "./actions";

/** One ha-form schema item, extended with our label/helper (read by computeLabel). */
export interface FormField {
  name: string;
  label: string;
  helper?: string;
  required?: boolean;
  selector: Record<string, unknown>;
}

/** Continuous controls (typing, sliders) — routed through the burst-history path. */
export function isLiveField(f: FormField): boolean {
  return "text" in f.selector || "number" in f.selector;
}

/** The changed schema keys from ha-form's full-object value-changed payload. */
export function diffFormValue(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly FormField[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    if (next[f.name] !== prev[f.name]) patch[f.name] = next[f.name];
  }
  return patch;
}

/**
 * Per-field cleanup between the form and the config: empty optional strings
 * become undefined; invalid required numbers are dropped (keep the old
 * value); numbers clamp to the selector range; angle wraps to 0..360.
 */
export function normalizeFormPatch(
  patch: Record<string, unknown>,
  fields: readonly FormField[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.name in patch)) continue;
    let v = patch[field.name];
    if ("text" in field.selector || "icon" in field.selector || "entity" in field.selector) {
      if (v === "" || v == null) v = field.required ? "" : undefined;
    } else if ("number" in field.selector) {
      const n = typeof v === "string" && v !== "" ? Number(v) : (v as number | undefined);
      if (typeof n !== "number" || !Number.isFinite(n)) {
        if (field.required) continue;
        v = undefined;
      } else {
        const sel = field.selector.number as { min?: number; max?: number };
        let num = field.name === "angle" ? ((n % 360) + 360) % 360 : n;
        if (sel.min !== undefined && num < sel.min) num = sel.min;
        if (sel.max !== undefined && num > sel.max) num = sel.max;
        v = num;
      }
    } else if ("boolean" in field.selector) {
      v = !!v;
    }
    out[field.name] = v;
  }
  return out;
}

// ---- per-kind form specs ---------------------------------------------------

export interface FormSpec {
  fields: FormField[];
  /** The form's view of the element — effective values, derived fields. */
  data: Record<string, unknown>;
  /** Map a normalized form patch back to config partials. */
  toPatch(patch: Record<string, unknown>): Record<string, unknown>;
}

const identity = (patch: Record<string, unknown>) => patch;

const angleField = (): FormField => ({
  name: "angle",
  label: "Angle",
  selector: { number: { min: 0, max: 360, step: 1, mode: "slider", unit_of_measurement: "°" } },
});

const opt = (value: string, label: string) => ({ value, label });
const dropdown = (...options: { value: string; label: string }[]) => ({
  select: { mode: "dropdown", options },
});

export const FURNITURE_TYPES: FurnitureType[] = [
  "table",
  "roundTable",
  "desk",
  "chair",
  "sofa",
  "bed",
  "wardrobe",
  "rug",
  "plant",
  "fridge",
  "stove",
  "sink",
  "toilet",
  "stairs",
  "tv",
  "sectional",
  "washer",
  "dryer",
  "dishwasher",
  "bathtub",
  "vanity",
  "waterHeater",
  "airHandler",
];

/** User-facing labels for furniture types (the enum uses camelCase). */
export const FURNITURE_LABELS: Record<FurnitureType, string> = {
  table: "table",
  roundTable: "round table",
  desk: "desk",
  chair: "chair",
  sofa: "sofa",
  bed: "bed",
  wardrobe: "wardrobe",
  rug: "rug",
  plant: "plant",
  fridge: "fridge",
  stove: "stove",
  sink: "sink",
  toilet: "toilet",
  stairs: "stairs",
  tv: "tv",
  sectional: "sectional (L)",
  washer: "washer",
  dryer: "dryer",
  dishwasher: "dishwasher",
  bathtub: "bathtub",
  vanity: "vanity",
  waterHeater: "water heater",
  airHandler: "air handler",
};

export function openingForm(o: Opening): FormSpec {
  const motion = openingMotion(o);
  const style = sliderStyleOf(o);
  const fields: FormField[] = [
    { name: "type", label: "Type", selector: dropdown(opt("door", "Door"), opt("window", "Window")) },
    { name: "motion", label: "Motion", selector: dropdown(opt("swing", "Swing"), opt("slide", "Slide")) },
    { name: "length", label: "Length", required: true, selector: { number: { min: 1, mode: "box" } } },
  ];
  if (o.type === "door" && motion === "swing") {
    fields.push({
      name: "hinge",
      label: "Hinge",
      selector: dropdown(opt("left", "Left"), opt("right", "Right")),
    });
  }
  if (motion === "swing") {
    fields.push({
      name: "opens",
      label: "Opens",
      selector: dropdown(opt("this", "This side"), opt("other", "Other side")),
    });
  }
  if (motion === "slide") {
    if (style !== "biparting") {
      fields.push({
        name: "slide",
        label: "Slide",
        selector: dropdown(opt("left", "To left"), opt("right", "To right")),
      });
    }
    fields.push({
      name: "style",
      label: "Style",
      selector: dropdown(
        opt("single", "Single"),
        opt("bypass", "Bypass (stack)"),
        opt("biparting", "Biparting (split)")
      ),
    });
  }
  fields.push({
    name: "entity",
    label: "Entity",
    helper: "Type and motion follow the entity's device class",
    selector: { entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } },
  });
  if (o.entity) fields.push({ name: "invert", label: "Invert", selector: { boolean: {} } });
  fields.push(angleField());
  return {
    fields,
    data: {
      type: o.type,
      motion,
      length: o.length,
      hinge: o.flipH ? "right" : "left",
      opens: o.flipV ? "other" : "this",
      slide: o.flipH ? "right" : "left",
      style,
      entity: o.entity ?? "",
      invert: o.invert ?? false,
      angle: o.angle,
    },
    toPatch(patch) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "motion") {
          out.motion = v === "slide" ? "slide" : undefined;
          // sliderStyle only applies while sliding — drop it when switching back.
          if (v !== "slide") out.sliderStyle = undefined;
        } else if (k === "hinge" || k === "slide") out.flipH = v === "right" || undefined;
        else if (k === "opens") out.flipV = v === "other" || undefined;
        else if (k === "style") out.sliderStyle = v === "single" ? undefined : v;
        else if (k === "invert") out.invert = v || undefined;
        else out[k] = v;
      }
      return out;
    },
  };
}

export function itemForm(it: FloorItem): FormSpec {
  const display = it.display ?? "badge";
  const fields: FormField[] = [
    { name: "entity", label: "Entity", required: true, selector: { entity: {} } },
    {
      name: "secondaryEntity",
      label: "Second entity",
      helper: "Shown next to the primary state",
      selector: { entity: {} },
    },
    { name: "icon", label: "Icon", selector: { icon: { placeholder: defaultIcon(it.kind) } } },
    { name: "name", label: "Name", selector: { text: {} } },
    {
      name: "size",
      label: "Size",
      selector: { number: { min: 16, max: 160, step: 2, mode: "slider", unit_of_measurement: "px" } },
    },
    angleField(),
    {
      name: "display",
      label: "Display",
      selector: dropdown(
        opt("badge", "Icon badge"),
        opt("ripple", "Ripple"),
        opt("iconRipple", "Icon + ripple")
      ),
    },
  ];
  if (display !== "badge") {
    fields.push({
      name: "rippleSize",
      label: "Ripple size",
      selector: { number: { min: 40, max: 400, step: 4, mode: "slider", unit_of_measurement: "px" } },
    });
  }
  fields.push(
    { name: "showIcon", label: "Show icon", selector: { boolean: {} } },
    { name: "showState", label: "Show state", selector: { boolean: {} } },
    {
      name: "showName",
      label: "Show name",
      helper: "Adds the device's name to the label line",
      selector: { boolean: {} },
    }
  );
  // Label size only matters while a label line renders.
  if (it.showName || (it.showState ?? it.kind === "sensor")) {
    fields.push({
      name: "labelSize",
      label: "Label size",
      selector: { number: { min: 8, max: 40, step: 1, mode: "slider", unit_of_measurement: "px" } },
    });
  }
  fields.push(
    {
      name: "tap_action",
      label: "Tap action",
      selector: { ui_action: { default_action: defaultItemAction(it.entity).action } },
    },
    { name: "hold_action", label: "Hold action", selector: { ui_action: { default_action: "none" } } },
    {
      name: "double_tap_action",
      label: "Double-tap action",
      selector: { ui_action: { default_action: "none" } },
    }
  );
  return {
    fields,
    data: {
      entity: it.entity,
      secondaryEntity: it.secondaryEntity ?? "",
      icon: it.icon ?? "",
      name: it.name ?? "",
      size: it.size ?? DEFAULT_ITEM_SIZE,
      angle: it.angle ?? 0,
      display,
      rippleSize: it.rippleSize ?? DEFAULT_RIPPLE_SIZE,
      showIcon: it.showIcon ?? true,
      showState: it.showState ?? false,
      showName: it.showName ?? false,
      labelSize: it.labelSize ?? DEFAULT_LABEL_SIZE,
      tap_action: it.tap_action,
      hold_action: it.hold_action,
      double_tap_action: it.double_tap_action,
    },
    toPatch: identity,
  };
}

export function textForm(t: FloorText): FormSpec {
  return {
    fields: [
      { name: "text", label: "Text", required: true, selector: { text: {} } },
      {
        name: "size",
        label: "Size",
        selector: { number: { min: 8, max: 200, mode: "slider", unit_of_measurement: "px" } },
      },
      angleField(),
    ],
    data: { text: t.text, size: t.size ?? DEFAULT_TEXT_SIZE, angle: t.angle ?? 0 },
    toPatch: identity,
  };
}

export function furnitureForm(f: Furniture): FormSpec {
  return {
    fields: [
      {
        name: "type",
        label: "Type",
        selector: {
          select: {
            mode: "dropdown",
            options: FURNITURE_TYPES.map((t) => ({ value: t, label: FURNITURE_LABELS[t] })),
          },
        },
      },
      // L-shaped sectional only (#40): which side the chaise extends on,
      // facing the sofa from the front. Conditional, in the same shape
      // openingForm uses for its hinge / slide fields.
      ...(f.type === "sectional"
        ? [
            {
              name: "hand",
              label: "Chaise side",
              helper: "Facing the sofa from the front",
              selector: dropdown(opt("right", "right"), opt("left", "left")),
            },
          ]
        : []),
      { name: "w", label: "Width", required: true, selector: { number: { min: 10, mode: "box" } } },
      { name: "h", label: "Height", required: true, selector: { number: { min: 10, mode: "box" } } },
      angleField(),
    ],
    data:
      f.type === "sectional"
        ? { type: f.type, hand: f.hand ?? "right", w: f.w, h: f.h, angle: f.angle ?? 0 }
        : { type: f.type, w: f.w, h: f.h, angle: f.angle ?? 0 },
    toPatch: identity,
  };
}

export function trackerForm(tr: Tracker): FormSpec {
  return {
    fields: [
      { name: "w", label: "Width", required: true, selector: { number: { min: 10, mode: "box" } } },
      { name: "h", label: "Height", required: true, selector: { number: { min: 10, mode: "box" } } },
      { name: "x", label: "X", required: true, selector: { number: { mode: "box" } } },
      { name: "y", label: "Y", required: true, selector: { number: { mode: "box" } } },
      angleField(),
      {
        name: "dotSize",
        label: "Dot size",
        selector: { number: { min: 6, max: 80, mode: "slider", unit_of_measurement: "px" } },
      },
    ],
    data: {
      w: tr.w,
      h: tr.h,
      x: Math.round(tr.x),
      y: Math.round(tr.y),
      angle: tr.angle ?? 0,
      dotSize: tr.dotSize ?? DEFAULT_TRACKER_DOT_SIZE,
    },
    toPatch: identity,
  };
}

export function wallForm(w: Wall): FormSpec {
  const coord = (name: string, label: string): FormField => ({
    name,
    label,
    required: true,
    selector: { number: { mode: "box" } },
  });
  return {
    fields: [coord("x1", "Start X"), coord("y1", "Start Y"), coord("x2", "End X"), coord("y2", "End Y")],
    data: { x1: Math.round(w.x1), y1: Math.round(w.y1), x2: Math.round(w.x2), y2: Math.round(w.y2) },
    toPatch: identity,
  };
}

export function projectForm(c: FloorplanCardConfig): FormSpec {
  return {
    fields: [
      { name: "title", label: "Title", selector: { text: {} } },
      { name: "width", label: "Canvas width", required: true, selector: { number: { min: 1, mode: "box" } } },
      { name: "height", label: "Canvas height", required: true, selector: { number: { min: 1, mode: "box" } } },
      {
        name: "grid",
        label: "Grid size",
        required: true,
        helper: `Gap between grid lines, in canvas units (canvas is ${c.width}×${c.height}). Smaller = finer grid.`,
        selector: { number: { min: 1, mode: "box" } },
      },
    ],
    data: { title: c.title ?? "", width: c.width, height: c.height, grid: c.grid ?? DEFAULT_GRID },
    toPatch: identity,
  };
}

/**
 * Display rotation (issue #33), a separate one-field form so the editor can
 * render it as the very last Project row — it's a set-once option for wall
 * tablets, not day-to-day editing, so it stays out of the way.
 */
export function projectRotationForm(c: FloorplanCardConfig): FormSpec {
  return {
    fields: [
      {
        name: "rotation",
        label: "Rotate display",
        helper: "Rotates the live card only — editing stays as drawn",
        selector: dropdown(opt("0", "0°"), opt("90", "90°"), opt("180", "180°"), opt("270", "270°")),
      },
    ],
    data: { rotation: String(normalizePlanRotation(c.rotation)) },
    toPatch: (p) =>
      "rotation" in p
        ? // Stored as a number; 0 means "not rotated", so keep it out of the YAML.
          { ...p, rotation: p.rotation === "0" ? undefined : Number(p.rotation) }
        : p,
  };
}

export function floorImageForm(f: Floor): FormSpec {
  const fields: FormField[] = [
    { name: "image", label: "Bg image", helper: "/local/floorplan.png or URL", selector: { text: {} } },
  ];
  if (f.image) {
    fields.push({
      name: "imageOpacity",
      label: "Image opacity",
      selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
    });
  }
  return { fields, data: { image: f.image ?? "", imageOpacity: f.imageOpacity ?? 1 }, toPatch: identity };
}
