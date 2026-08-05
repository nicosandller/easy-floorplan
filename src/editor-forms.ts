/**
 * Schema-driven form definitions for the editor: one `FormSpec` per element
 * kind, rendered either through HA's `<ha-form>` (native selectors) or the
 * editor's plain-input fallback. Everything here is pure and unit-tested;
 * the editor owns rendering, history routing, and hass-dependent side
 * effects (device-class inference, grid/snap rescale).
 */
import type {
  Area,
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
  DEFAULT_AREA_OPACITY,
  DEFAULT_GRID,
  DEFAULT_ITEM_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_GLOW_RADIUS,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TRACKER_DOT_SIZE,
  DEFAULT_SUN_MIN,
  DEFAULT_SUN_MAX,
} from "./types";
import {
  DEFAULT_LABEL_SIZE,
  badgeContentOf,
  defaultIcon,
  normalizePlanRotation,
  openingMotion,
  sliderStyleOf,
  shutterStyleOf,
  windowSash,
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
    if (
      "text" in field.selector ||
      "icon" in field.selector ||
      "entity" in field.selector ||
      "attribute" in field.selector
    ) {
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
  "fishTank",
  "piano",
  "hotTub",
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
  fishTank: "fish tank",
  piano: "piano",
  hotTub: "hot tub",
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
    {
      name: "motion",
      label: "Motion",
      selector: dropdown(
        opt("swing", "Swing"),
        opt("slide", "Slide"),
        opt("roll", "Roll up (garage / shutter)")
      ),
    },
    { name: "length", label: "Length", required: true, selector: { number: { min: 1, mode: "box" } } },
  ];
  if (o.type === "window" && motion === "swing") {
    fields.push({
      name: "sash",
      label: "Sashes",
      helper: "Single = one full-width sash (issue #73)",
      selector: dropdown(opt("double", "Double (two leaves)"), opt("single", "Single sash")),
    });
  }
  // Hinge applies to anything with ONE hinged leaf: doors, and single-sash windows.
  if (motion === "swing" && (o.type === "door" || windowSash(o) === "single")) {
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
  // Offered on doors too: French doors and patio doors get shutters as well.
  // A hinged shutter usually reports through a contact sensor, so binary
  // sensors belong in the picker next to covers (issue #74).
  fields.push({
    name: "shutterEntity",
    label: "Shutter",
    helper: "External shutter over this opening — a cover, or a contact sensor",
    selector: { entity: { filter: [{ domain: ["cover", "binary_sensor"] }] } },
  });
  if (o.shutterEntity) {
    fields.push({
      name: "shutterStyle",
      label: "Shutter type",
      helper: "Hinged panels fold back against the wall; roll-up slats disappear upward",
      selector: dropdown(opt("swing", "Hinged (louvered panels)"), opt("roll", "Roll-up (slats)")),
    });
  }
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
      sash: windowSash(o),
      entity: o.entity ?? "",
      shutterEntity: o.shutterEntity ?? "",
      shutterStyle: shutterStyleOf(o),
      invert: o.invert ?? false,
      angle: o.angle,
    },
    toPatch(patch) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "motion") {
          out.motion = v === "slide" || v === "roll" ? v : undefined;
          // sliderStyle only applies while sliding — drop it when switching away.
          if (v !== "slide") out.sliderStyle = undefined;
        } else if (k === "sash") out.sash = v === "single" ? "single" : undefined;
        else if (k === "hinge" || k === "slide") out.flipH = v === "right" || undefined;
        else if (k === "opens") out.flipV = v === "other" || undefined;
        else if (k === "style") out.sliderStyle = v === "single" ? undefined : v;
        else if (k === "invert") out.invert = v || undefined;
        else out[k] = v;
      }
      return out;
    },
  };
}

/**
 * When `it` sits inside a Home Assistant area-linked {@link Area} on the
 * plan, `areaScope` narrows the `entity`/`secondaryEntity` pickers to that HA
 * area's entities — but never to an empty list, and never hiding the entity
 * already bound (see {@link areaScopedEntity}). `include_entities` on the entity selector is the
 * assumed-but-unverified `<ha-form>` equivalent of `ha-entity-picker`'s own
 * `.includeEntities` property — see areas.md decision #5.
 */
/**
 * Scoping applied to an element's entity pickers because it sits inside an
 * Area linked to a Home Assistant area (issue #83). `name` is shown to the
 * user so the narrowed list is never a mystery.
 */
export interface AreaEntityScope {
  entities: string[];
  name?: string;
}

/**
 * Entity selector for an element inside a linked Area.
 *
 * Two rules keep the scoping from becoming a trap:
 * - an **empty** area list means "don't filter at all". `include_entities: []`
 *   renders a picker with *nothing* in it — not even searchable — which is
 *   what happens whenever the linked HA area has no entities assigned (very
 *   common: many setups assign areas to devices only, or not at all).
 * - the currently bound entity is **always** included, so opening an existing
 *   element never shows an empty box just because that entity lives elsewhere.
 */
function areaScopedEntity(
  scope: AreaEntityScope | undefined,
  current?: string
): Record<string, unknown> {
  if (!scope?.entities.length) return { entity: {} };
  const include = current && !scope.entities.includes(current)
    ? [...scope.entities, current]
    : scope.entities;
  return { entity: { include_entities: include } };
}

/** Helper text telling the user their picker is area-scoped, and how to undo it. */
function areaScopeHelper(scope: AreaEntityScope | undefined, base?: string): string | undefined {
  if (!scope?.entities.length) return base;
  const where = scope.name ? `the ${scope.name} area` : "this area";
  const note = `Only entities in ${where} — turn off “Filter entities” on the area to see all`;
  return base ? `${base}. ${note}` : note;
}

export function itemForm(it: FloorItem, areaScope?: AreaEntityScope): FormSpec {
  const display = it.display ?? "badge";
  const fields: FormField[] = [
    {
      name: "entity",
      label: "Entity",
      required: true,
      helper: areaScopeHelper(areaScope),
      selector: areaScopedEntity(areaScope, it.entity),
    },
    {
      name: "attribute",
      label: "Attribute",
      helper: "Show this attribute instead of the state (e.g. current_temperature)",
      selector: { attribute: { entity_id: it.entity } },
    },
    {
      name: "secondaryEntity",
      label: "Second entity",
      helper: areaScopeHelper(areaScope, "Shown next to the primary state"),
      selector: areaScopedEntity(areaScope, it.secondaryEntity),
    },
    {
      name: "secondaryAttribute",
      label: "2nd attribute",
      helper: "From the second entity, or this entity if none",
      selector: { attribute: { entity_id: it.secondaryEntity || it.entity } },
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
    {
      name: "iconAnimation",
      label: "Animate icon",
      helper: "Plays only while the entity is active",
      selector: dropdown(
        opt("auto", "Auto (fan spins; media & vacuum pulse)"),
        opt("none", "None"),
        opt("spin", "Spin"),
        opt("pulse", "Pulse")
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
  // A light can cast a pool of light onto the plan from where it sits (issue
  // #6). Offered only for lights, since nothing else has a color to cast.
  if (it.kind === "light" || it.entity?.startsWith("light.")) {
    fields.push({
      name: "glow",
      label: "Cast light",
      helper: "Pools the light's own color onto the plan; overlapping lights mix",
      selector: { boolean: {} },
    });
    if (it.glow) {
      fields.push(
        {
          name: "glowRadius",
          label: "Light radius",
          selector: { number: { min: 20, max: 600, step: 10, mode: "slider" } },
        },
        {
          name: "glowColor",
          label: "Light color",
          helper: "Only for bulbs that can't report a color; others use their own",
          selector: { text: {} },
        }
      );
    }
  }
  fields.push(
    {
      name: "badgeContent",
      label: "Badge shows",
      helper: "Value puts the reading in the badge; falls back to the icon when there is no number",
      selector: dropdown(opt("icon", "Icon"), opt("value", "Value"), opt("none", "Nothing")),
    },
    {
      name: "hideWhenInactive",
      label: "Only when active",
      helper: "Hide on the card while the entity is off/idle (still editable here)",
      selector: { boolean: {} },
    },
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
      attribute: it.attribute ?? "",
      secondaryAttribute: it.secondaryAttribute ?? "",
      icon: it.icon ?? "",
      name: it.name ?? "",
      size: it.size ?? DEFAULT_ITEM_SIZE,
      angle: it.angle ?? 0,
      display,
      iconAnimation: it.iconAnimation ?? "auto",
      rippleSize: it.rippleSize ?? DEFAULT_RIPPLE_SIZE,
      glow: it.glow ?? false,
      glowRadius: it.glowRadius ?? DEFAULT_GLOW_RADIUS,
      glowColor: it.glowColor ?? "",
      badgeContent: badgeContentOf(it),
      hideWhenInactive: it.hideWhenInactive ?? false,
      showState: it.showState ?? false,
      showName: it.showName ?? false,
      labelSize: it.labelSize ?? DEFAULT_LABEL_SIZE,
      tap_action: it.tap_action,
      hold_action: it.hold_action,
      double_tap_action: it.double_tap_action,
    },
    // Touching "Badge shows" retires the `showIcon` boolean it replaced (issue
    // #106), so a migrated config carries one setting rather than two that
    // could later be edited into disagreeing. Configs nobody touches keep
    // working through badgeContentOf's fallback.
    toPatch: (patch) =>
      "badgeContent" in patch ? { ...patch, showIcon: undefined } : patch,
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

/**
 * `areaEntities` scopes the entity picker to a linked HA area, exactly as in
 * {@link itemForm} — a plant drawn inside the Living Room offers the Living
 * Room's sensors first.
 */
export function furnitureForm(f: Furniture, areaScope?: AreaEntityScope): FormSpec {
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
      // Optional entity that makes the drawing live (issue #82) — a soil
      // sensor on a plant, a contact sensor on a cabinet. Last, because most
      // furniture is decoration and never binds anything.
      {
        name: "entity",
        label: "Entity",
        helper: areaScopeHelper(areaScope, "Optional — lets the drawing change color with a sensor"),
        selector: areaScopedEntity(areaScope, f.entity),
      },
    ],
    data: {
      type: f.type,
      ...(f.type === "sectional" ? { hand: f.hand ?? "right" } : {}),
      w: f.w,
      h: f.h,
      angle: f.angle ?? 0,
      entity: f.entity ?? "",
    },
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

/**
 * Name/visibility/opacity fields for an Area (a room polygon). Only the color
 * stays a bespoke row in the editor's selection editor, same as every other
 * color field in this file (see `textForm`'s caller).
 *
 * The name doubles as the HA-area link, so with `haAreaNames` it's a `select`
 * with `custom_value` — HA renders that as a combo box you can also type into,
 * which is what makes the field look and behave like the rest of the form
 * (a bespoke row outside `ha-form` can't match HA's own field rendering).
 * Without any HA areas to offer there's nothing to pick from, so it degrades
 * to a plain text field rather than an empty dropdown.
 */
export function areaNameForm(a: Area, haAreaNames: readonly string[] = []): FormSpec {
  const nameSelector = haAreaNames.length
    ? {
        select: {
          options: haAreaNames.map((n) => ({ value: n, label: n })),
          custom_value: true,
          mode: "dropdown",
          sort: false,
        },
      }
    : { text: {} };
  return {
    fields: [{ name: "name", label: "Name", selector: nameSelector }],
    data: { name: a.name ?? "" },
    toPatch: identity,
  };
}

/**
 * The Area's remaining style fields. Split from {@link areaNameForm} so the
 * editor can slot the HA-link status line directly beneath the name it
 * describes; both halves still render through `ha-form`.
 */
export function areaForm(a: Area): FormSpec {
  return {
    fields: [
      { name: "showName", label: "Show name", selector: { boolean: {} } },
      {
        name: "opacity",
        label: "Fill opacity",
        selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
      },
      // Optional entity that makes the room itself live (issue #6) — a presence
      // sensor that lights the room while it is occupied. Last, because most
      // areas are just outlines and never bind anything.
      {
        name: "entity",
        label: "Entity",
        helper: "Optional — lets the room fill change color with a sensor",
        selector: { entity: {} },
      },
      // Only meaningful once something drives the colour. Offered here rather
      // than in the editor's colour rows because both are plain selectors, and
      // "Active opacity" belongs beside "Fill opacity".
      ...(a.entity
        ? [
            {
              name: "activeOpacity",
              label: "Active opacity",
              helper: "Fill opacity while the entity resolves a color",
              selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
            },
            {
              name: "highlight",
              label: "Highlight",
              helper: "Border only outlines the room without tinting what's inside",
              selector: dropdown(
                opt("fill", "Fill"),
                opt("border", "Border only"),
                opt("both", "Fill and border")
              ),
            },
          ]
        : []),
    ],
    data: {
      showName: a.showName ?? true,
      opacity: a.opacity ?? DEFAULT_AREA_OPACITY,
      entity: a.entity ?? "",
      activeOpacity: a.activeOpacity ?? a.opacity ?? DEFAULT_AREA_OPACITY,
      highlight: a.highlight ?? "fill",
    },
    // "fill" is the default, so keep it out of the YAML.
    toPatch: (p) => ("highlight" in p && p.highlight === "fill" ? { ...p, highlight: undefined } : p),
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

/**
 * Follow the real sun (issue #113). Its own form so the editor can put it
 * beside the other project settings, and so the two brightness sliders appear
 * only once the toggle is on — they mean nothing otherwise.
 */
export function projectSunForm(c: FloorplanCardConfig): FormSpec {
  const fields: FormField[] = [
    {
      name: "sunDimming",
      label: "Follow the sun",
      helper: "Dims the plan at night, using your Home Assistant's own sunrise and sunset",
      selector: { boolean: {} },
    },
  ];
  if (c.sunDimming) {
    fields.push(
      {
        name: "sunBrightnessMin",
        label: "Night brightness",
        selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
      },
      {
        name: "sunBrightnessMax",
        label: "Day brightness",
        selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
      }
    );
  }
  return {
    fields,
    data: {
      sunDimming: c.sunDimming ?? false,
      sunBrightnessMin: c.sunBrightnessMin ?? DEFAULT_SUN_MIN,
      sunBrightnessMax: c.sunBrightnessMax ?? DEFAULT_SUN_MAX,
    },
    // Off is the default, so keep the whole feature out of the YAML until it
    // is switched on — including the two sliders it drags along with it.
    toPatch: (p) =>
      "sunDimming" in p && !p.sunDimming
        ? { ...p, sunDimming: undefined, sunBrightnessMin: undefined, sunBrightnessMax: undefined }
        : p,
  };
}

export function floorImageForm(f: Floor): FormSpec {
  const fields: FormField[] = [
    { name: "image", label: "Bg image", helper: "/local/floorplan.png or URL", selector: { text: {} } },
  ];
  if (f.image) {
    fields.push({
      name: "imageFit",
      label: "Image fit",
      helper: "Per floor, so scans of different resolutions can each fit properly",
      selector: dropdown(
        opt("stretch", "Stretch to canvas (may distort)"),
        opt("contain", "Fit inside (keep proportions)"),
        opt("cover", "Fill canvas (keep proportions, crop)")
      ),
    });
    fields.push({
      name: "imageOpacity",
      label: "Image opacity",
      selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } },
    });
  }
  return {
    fields,
    data: {
      image: f.image ?? "",
      imageFit: f.imageFit ?? "stretch",
      imageOpacity: f.imageOpacity ?? 1,
    },
    // "stretch" is the default, so keep it out of the YAML.
    toPatch: (p) => ("imageFit" in p && p.imageFit === "stretch" ? { ...p, imageFit: undefined } : p),
  };
}
