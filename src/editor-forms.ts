/**
 * Schema-driven form definitions for the editor: one `FormSpec` per element
 * kind, rendered either through HA's `<ha-form>` (native selectors) or the
 * editor's plain-input fallback. Everything here is pure and unit-tested;
 * the editor owns rendering, history routing, and hass-dependent side
 * effects (device-class inference, grid/snap rescale).
 */
import type {
  Area,
  BadgeEntity,
  Floor,
  FloorItem,
  FloorText,
  FloorplanCardConfig,
  Furniture,
  Opening,
  SliderStyle,
  Tracker,
  Wall,
} from "./types";
import {
  BUILTIN_SYMBOLS,
  findSymbol,
  symbolList,
  type SymbolCatalog,
  type SymbolDef,
} from "./symbols";
import {
  DEFAULT_AREA_OPACITY,
  DEFAULT_AREA_LABEL_SIZE,
  DEFAULT_GRID,
  DEFAULT_ITEM_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_GLOW_RADIUS,
  DEFAULT_TEXT_SIZE,
  DEFAULT_TRACKER_DOT_SIZE,
  DEFAULT_SUN_MIN,
  DEFAULT_SUN_MAX,
  DEFAULT_PRESS_EFFECT,
} from "./types";
import {
  DEFAULT_LABEL_SIZE,
  WALL_THICKNESS,
  badgeContentOf,
  domainIconAnimation,
  isPresenceEntity,
  normalizeOverlayScale,
  normalizePlanRotation,
  openingActionForGesture,
  openingMotion,
  openingHasTwoPanels,
  sliderStyleHasTwoPanels,
  pressEffectOf,
  sliderStyleOf,
  shutterStyleOf,
  windowSash,
} from "./render";
import { defaultItemAction } from "./actions";
import { DEFAULT_SKIN, SKINS, findSkin, MAX_SKIN_WALL_WIDTH } from "./skins";

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

/**
 * Every symbol the picker and the type dropdown offer, grouped by room and
 * alphabetical inside each group.
 *
 * Derived from the catalogue rather than hand-listed (issue #90). The two lists
 * that used to live here — an ordering array and a label map — had to be edited
 * for every new glyph, and only the label map was exhaustiveness-checked: a type
 * added to the union but forgotten in the array simply never appeared in the
 * editor, silently. A symbol now carries its own name and category.
 */
export function furnitureChoices(catalog: SymbolCatalog = BUILTIN_SYMBOLS): SymbolDef[] {
  return symbolList(catalog);
}

/** A symbol's display name, falling back to its raw id for an unknown type. */
export function furnitureLabel(type: string, catalog: SymbolCatalog = BUILTIN_SYMBOLS): string {
  return findSymbol(catalog, type)?.name ?? type;
}

/**
 * `featuresOf` reads an entity's `supported_features`, the one hass-derived
 * fact this form needs: it decides whether a tap on a `cover` toggles it or
 * opens more-info, so it is what lets the Tap field name the default the card
 * would *actually* take rather than a guess. Defaults to "no features", which
 * is what a form rendered without hass can honestly say.
 */
export function openingForm(o: Opening, featuresOf: (entityId: string) => number = () => 0): FormSpec {
  const motion = openingMotion(o);
  const style = sliderStyleOf(o);
  const twoPanels = openingHasTwoPanels(o);
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
    // A two-panel slider moves both ways at once, so there is no direction to
    // pick — `flipH` only swaps which panel each sensor drives (issue #145).
    if (!twoPanels) {
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
        opt("biparting", "Biparting (into the walls)"),
        opt("biparting-bypass", "Biparting (over fixed panels)"),
        opt("converging", "Converging (both panels stack in the middle)")
      ),
    });
  }
  fields.push({
    name: "entity",
    label: "Entity",
    helper: twoPanels
      ? "Drives the first panel; type and motion follow its device class"
      : "Type and motion follow the entity's device class",
    selector: { entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } },
  });
  // One sensor per leaf (issue #145). Only a two-panel style has a second
  // moving panel to drive, and only once the first is bound — a slider whose
  // *second* panel alone has a sensor would be more confusing than useful.
  if (twoPanels && o.entity) {
    fields.push({
      name: "secondaryEntity",
      label: "Second panel",
      helper: "Its own sensor for the other panel — leave empty to move both together",
      selector: { entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } },
    });
  }
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
    // Which face of the wall hinged panels hang on. Only asked for hinged
    // shutters: the roll curtain is drawn symmetrically about the wall line,
    // so the answer would change nothing on screen.
    if (shutterStyleOf(o) === "swing") {
      fields.push({
        name: "shutterSide",
        label: "Shutter side",
        helper: "Which side of the wall the panels hang on",
        selector: dropdown(opt("far", "Away from the sash"), opt("near", "Same side as the sash")),
      });
    }
    // Its own switch, not the opening's: a reed contact on a hinged shutter
    // routinely reads `on` when the panels are shut, while the window behind
    // it reads the other way round.
    fields.push({ name: "shutterInvert", label: "Invert shutter", selector: { boolean: {} } });
  }
  if (o.entity) fields.push({ name: "invert", label: "Invert", selector: { boolean: {} } });
  fields.push(angleField());
  // With both bound, which one a press leads with. Only a real question when
  // there are two entities to choose between — and the reason it exists: the
  // shutter used to be reachable by hold alone, which is not discoverable and
  // is awkward on a wall tablet.
  if (o.entity && o.shutterEntity) {
    // The badge that makes the second entity visible. On by default; the
    // switch is for a plan where every window has one and they start to shout.
    fields.push({
      name: "showShutterIcon",
      label: "Shutter icon",
      helper: "Shows the shutter's state beside the opening, and opens it when tapped",
      selector: { boolean: {} },
    });
    // Only worth asking once the badge is actually drawn. Left empty the badge
    // follows the entity, whose default glyph changes with the state — an
    // override is one glyph for both, which is why it is not the default.
    if (o.showShutterIcon ?? true) {
      fields.push({
        name: "shutterIcon",
        label: "Icon",
        helper: "Overrides the shutter entity's own icon, which changes with its state",
        selector: { icon: {} },
      });
    }
    fields.push({
      name: "tapTarget",
      label: "Tap opens",
      helper: "The other one moves to press-and-hold. Opens the dialog; use Tap action below to move the shutter itself",
      selector: dropdown(
        opt("opening", o.type === "door" ? "The door" : "The window"),
        opt("shutter", "The shutter")
      ),
    });
  }
  // Actions, once there is anything to act on. The tap default names what the
  // card would do untouched — toggle for an open/close cover, more-info
  // otherwise — so the field never claims a default the card doesn't take.
  if (o.entity || o.shutterEntity) {
    fields.push(
      {
        name: "tap_action",
        label: "Tap action",
        selector: {
          ui_action: {
            default_action:
              openingActionForGesture(o, "tap", featuresOf)?.config.action ?? "none",
          },
        },
      },
      {
        name: "hold_action",
        label: "Hold action",
        // With both bound, holding reaches whichever entity the tap does not.
        // With only one, there is nothing left for hold to open.
        helper: o.entity && o.shutterEntity ? "Opens the entity the tap doesn't" : undefined,
        selector: {
          ui_action: {
            default_action: o.entity && o.shutterEntity ? "more-info" : "none",
          },
        },
      },
      {
        name: "double_tap_action",
        label: "Double-tap action",
        selector: { ui_action: { default_action: "none" } },
      }
    );
  }
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
      secondaryEntity: o.secondaryEntity ?? "",
      shutterEntity: o.shutterEntity ?? "",
      shutterStyle: shutterStyleOf(o),
      shutterSide: o.shutterFlipV ? "near" : "far",
      shutterInvert: o.shutterInvert ?? false,
      showShutterIcon: o.showShutterIcon ?? true,
      shutterIcon: o.shutterIcon ?? "",
      tapTarget: o.tapTarget ?? "opening",
      invert: o.invert ?? false,
      angle: o.angle,
      tap_action: o.tap_action,
      hold_action: o.hold_action,
      double_tap_action: o.double_tap_action,
    },
    toPatch(patch) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(patch)) {
        if (k === "shutterEntity") {
          out.shutterEntity = v;
          // Everything that only means something *with* a shutter goes with
          // it. Left behind, a stale invert or side would silently reapply to
          // whatever shutter is bound next.
          if (!v) {
            out.shutterStyle = undefined;
            out.shutterFlipV = undefined;
            out.shutterInvert = undefined;
            out.shutterActiveColor = undefined;
            // Nothing left to lead with, so the choice goes too — otherwise it
            // would silently point the tap at the next shutter bound here.
            out.tapTarget = undefined;
            // Same for the badge and its glyph: there is nothing to badge.
            out.showShutterIcon = undefined;
            out.shutterIcon = undefined;
          }
        } else if (k === "shutterSide") out.shutterFlipV = v === "near" || undefined;
        else if (k === "shutterInvert") out.shutterInvert = v || undefined;
        // The opening is the default, so it stays out of the YAML.
        else if (k === "tapTarget") out.tapTarget = v === "shutter" ? "shutter" : undefined;
        // Shown is the default: only "off" is worth writing down.
        else if (k === "showShutterIcon") out.showShutterIcon = v ? undefined : false;
        else if (k === "motion") {
          out.motion = v === "slide" || v === "roll" ? v : undefined;
          // sliderStyle only applies while sliding — drop it when switching
          // away, and with it the second panel's sensor (issue #145).
          if (v !== "slide") {
            out.sliderStyle = undefined;
            out.secondaryEntity = undefined;
          }
        } else if (k === "sash") out.sash = v === "single" ? "single" : undefined;
        else if (k === "hinge" || k === "slide") out.flipH = v === "right" || undefined;
        else if (k === "opens") out.flipV = v === "other" || undefined;
        else if (k === "style") {
          out.sliderStyle = v === "single" ? undefined : v;
          // Only a two-panel style has a second moving panel to bind. Asked of
          // the style itself, so a style added later can't be forgotten here.
          if (!sliderStyleHasTwoPanels(v as SliderStyle)) out.secondaryEntity = undefined;
        }
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

/**
 * The badge as one choice (issue #127), collapsing the three switches that
 * used to spell it out — `display`, `badgeContent` and `iconAnimation`.
 *
 * They were never three independent questions: `iconAnimation` only means
 * something while the badge holds an icon, `badgeContent` means nothing at all
 * while `display: ripple` draws no badge, and picking "Value" left an "Animate
 * icon" dropdown on screen that did nothing. What is left is one question —
 * *what is in the badge* — with the animation as three of its answers.
 *
 * The ring is the one genuinely separate axis (a spinning fan icon inside a
 * ripple is a real combination), so it stays its own toggle rather than
 * becoming options that would multiply this list by two.
 *
 * There is no `auto`: "auto" is a fact about the config format, not about what
 * the user is looking at. The dropdown names the animation the card is
 * actually playing — a fan reads *spinning*, a media player *pulsing* — by
 * resolving `auto` through {@link domainIconAnimation}. Nothing about the card
 * changes; `auto` stays the default `render.ts` applies to configs nobody has
 * touched.
 *
 * The config keys are untouched: this is the editor's view of them, so every
 * existing YAML — including combinations this dropdown cannot name — keeps
 * rendering exactly as before.
 */
export type BadgeMode = "icon" | "spin" | "pulse" | "value" | "none";

/** {@link BadgeMode} for an item, reading the three keys it stands in for. */
function badgeModeOf(it: FloorItem): BadgeMode {
  // A ripple-only device draws no badge, whatever `badgeContent` says.
  if ((it.display ?? "badge") === "ripple") return "none";
  const content = badgeContentOf(it);
  if (content !== "icon") return content;
  const anim = it.iconAnimation ?? "auto";
  if (anim === "spin" || anim === "pulse") return anim;
  // "auto" (and an absent key) shows as whatever it resolves to for this
  // entity, so the menu never says one thing while the badge does another.
  return anim === "auto" ? (domainIconAnimation(it.entity) ?? "icon") : "icon";
}

/** Whether the device draws a ripple ring — the other half of `display`. */
export function itemHasRipple(it: FloorItem): boolean {
  return (it.display ?? "badge") !== "badge";
}

/** The three config keys implied by a badge mode + ring choice. */
function badgeModePatch(mode: BadgeMode, ripple: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {
    badgeContent: mode === "value" ? "value" : mode === "none" ? "none" : "icon",
    // Touching the badge retires the `showIcon` boolean it replaced (issue
    // #106), so a migrated config carries one setting rather than two that
    // could later be edited into disagreeing. Configs nobody touches keep
    // working through badgeContentOf's fallback.
    showIcon: undefined,
    display: !ripple ? "badge" : mode === "none" ? "ripple" : "iconRipple",
  };
  // Only the icon modes say anything about animation; "Value"/"Nothing" leave
  // the stored setting alone, so switching away and back does not lose it.
  if (mode !== "value" && mode !== "none") out.iconAnimation = mode === "icon" ? "none" : mode;
  return out;
}

/**
 * What the badge is reading *right now*, for the "Badge reads" row (issue
 * #136). Resolved off `hass` at the call site, like {@link itemForm}'s
 * `deviceClass`, because this file stays pure.
 *
 * `source` is load-bearing rather than cosmetic. A plug whose badge shows its
 * power sensor through {@link badgeReading}'s fallback has no `badgeEntity`
 * stored, so a dropdown defaulting to "primary" would name the switch while
 * the badge shows watts — and the next unrelated edit would write that down
 * and drop the reading to an icon.
 */
export interface BadgeSourceInfo {
  source: BadgeEntity;
  /** Friendly names, falling back to the entity ids when hass has none. */
  primaryLabel?: string;
  secondaryLabel?: string;
}

/**
 * `deviceClass` is the entity's HA device class, the one hass-derived fact the
 * device form needs: it is what separates a motion sensor from a door contact,
 * and so decides whether the ripple ring is offered at all (issue #127). The
 * editor reads it off `hass` at the call site, as it already does for openings.
 * `badgeSource` is the second such fact — see {@link BadgeSourceInfo}.
 */
export function itemForm(
  it: FloorItem,
  areaScope?: AreaEntityScope,
  deviceClass?: string,
  badgeSource?: BadgeSourceInfo
): FormSpec {
  const ripple = itemHasRipple(it);
  const presence = isPresenceEntity(it.entity, deviceClass);
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
    // The icon is *not* here: it sits by the state rules that can override it
    // (issue #127), rendered by the editor next to them.
    { name: "name", label: "Name", selector: { text: {} } },
    {
      name: "size",
      label: "Size",
      selector: { number: { min: 16, max: 160, step: 2, mode: "slider", unit_of_measurement: "px" } },
    },
    angleField(),
    {
      name: "badgeMode",
      label: "Badge shows",
      helper:
        "Animations play only while the entity is active. Value puts the reading in the badge, falling back to the icon when there is no number",
      selector: dropdown(
        opt("icon", "Icon, still"),
        opt("spin", "Icon, spinning"),
        opt("pulse", "Icon, pulsing"),
        opt("value", "Value"),
        opt("none", "Nothing")
      ),
    },
  ];
  // Which entity the value comes from (issue #136) — offered only where it is
  // a real question: the badge has to be showing a value, and the device has
  // to have a second entity to choose between. Most devices never see this.
  //
  // The options name the entities rather than offering an "Automatic", the
  // precedent from #127's dropdown above: "auto" is a fact about the config
  // format, not about what the user is looking at.
  if (badgeModeOf(it) === "value" && it.secondaryEntity) {
    fields.push({
      name: "badgeEntity",
      label: "Badge reads",
      helper: "Which of this device's entities the badge shows",
      selector: dropdown(
        opt("primary", badgeSource?.primaryLabel || it.entity || "Main entity"),
        opt("secondary", badgeSource?.secondaryLabel || it.secondaryEntity)
      ),
    });
  }
  // A presence device can ring the spot it watches (issue #127) — the same
  // shape of option as "Cast light" below, offered only where it means
  // something. A ring on a thermostat says "someone is here", which is a lie.
  if (presence) {
    fields.push({
      name: "ripple",
      label: "Ripple",
      // "Presence detected" rather than "the sensor is on": this is offered to
      // a device_tracker and a person too, and neither of those is a sensor.
      helper: "Draws a pulsing ring while presence is detected here",
      selector: { boolean: {} },
    });
    if (ripple) {
      fields.push({
        name: "rippleSize",
        label: "Ripple size",
        selector: {
          number: { min: 40, max: 400, step: 4, mode: "slider", unit_of_measurement: "px" },
        },
      });
    }
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
      name: it.name ?? "",
      size: it.size ?? DEFAULT_ITEM_SIZE,
      angle: it.angle ?? 0,
      badgeMode: badgeModeOf(it),
      // The stored choice, else the entity the badge is *actually* reading —
      // never a bare "primary" default, which would contradict the canvas for
      // every device relying on the fallback. See {@link BadgeSourceInfo}.
      badgeEntity: it.badgeEntity ?? badgeSource?.source ?? "primary",
      ripple,
      rippleSize: it.rippleSize ?? DEFAULT_RIPPLE_SIZE,
      glow: it.glow ?? false,
      glowRadius: it.glowRadius ?? DEFAULT_GLOW_RADIUS,
      glowColor: it.glowColor ?? "",
      hideWhenInactive: it.hideWhenInactive ?? false,
      showState: it.showState ?? false,
      showName: it.showName ?? false,
      labelSize: it.labelSize ?? DEFAULT_LABEL_SIZE,
      tap_action: it.tap_action,
      hold_action: it.hold_action,
      double_tap_action: it.double_tap_action,
    },
    // "Badge shows" and "Ripple" are the editor's spelling of three config
    // keys (issue #127) — expand them back. Either control alone is a complete
    // statement about both, so the untouched one is read off the item.
    toPatch: (patch) => {
      if (!("badgeMode" in patch) && !("ripple" in patch)) return patch;
      const { badgeMode, ripple: ring, ...rest } = patch;
      return {
        ...rest,
        ...badgeModePatch(
          (badgeMode as BadgeMode | undefined) ?? badgeModeOf(it),
          ring === undefined ? ripple : !!ring
        ),
      };
    },
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
export function furnitureForm(
  f: Furniture,
  areaScope?: AreaEntityScope,
  catalog: SymbolCatalog = BUILTIN_SYMBOLS
): FormSpec {
  const choices = furnitureChoices(catalog);
  // A piece whose symbol this install doesn't have keeps its own id in the
  // list, so opening the form doesn't silently retype it to whatever sorts
  // first — the config would then be quietly rewritten on the next commit.
  const options = choices.some((s) => s.id === f.type)
    ? choices.map((s) => ({ value: s.id, label: s.name }))
    : [{ value: f.type, label: `${f.type} (missing)` }, ...choices.map((s) => ({ value: s.id, label: s.name }))];
  return {
    fields: [
      {
        name: "type",
        label: "Type",
        selector: { select: { mode: "dropdown", options } },
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
      // Only while the name renders — same rule the item form uses for its
      // label size.
      ...((a.showName ?? true)
        ? [
            {
              name: "labelSize",
              label: "Name size",
              selector: {
                number: { min: 8, max: 40, step: 1, mode: "slider" as const, unit_of_measurement: "px" },
              },
            },
          ]
        : []),
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
      labelSize: a.labelSize ?? DEFAULT_AREA_LABEL_SIZE,
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
    fields: [
      coord("x1", "Start X"),
      coord("y1", "Start Y"),
      coord("x2", "End X"),
      coord("y2", "End Y"),
      {
        name: "thickness",
        label: "Thickness",
        // Capped at MAX_SKIN_WALL_WIDTH, not a rounder number: past that a
        // wall stops being fully cleared by its own door or window (the
        // doorway mask's cut is sized off the shared WALL_THICKNESS
        // constant, not per-wall — see render.ts's wallThickness).
        selector: {
          number: { min: 2, max: MAX_SKIN_WALL_WIDTH, step: 1, mode: "slider", unit_of_measurement: "px" },
        },
      },
    ],
    data: {
      x1: Math.round(w.x1),
      y1: Math.round(w.y1),
      x2: Math.round(w.x2),
      y2: Math.round(w.y2),
      thickness: w.thickness ?? WALL_THICKNESS,
    },
    // Keep the default out of the YAML so untouched walls stay terse.
    toPatch: (p) =>
      "thickness" in p && p.thickness === WALL_THICKNESS ? { ...p, thickness: undefined } : p,
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
 * How a device answers a press (issue #134). Its own one-field form for the
 * same reason the skin has one — the editor places it in the Project section,
 * and it belongs to the plan rather than to any element.
 *
 * "Ink ripple" rather than plain "Ripple": a device already has a **Ripple**
 * toggle of its own, the presence ring, and two controls in one editor sharing
 * a name would be a genuinely confusing pair.
 */
export function projectPressForm(c: FloorplanCardConfig): FormSpec {
  return {
    fields: [
      {
        name: "pressEffect",
        label: "Press effect",
        helper: "Feedback when a device is pressed. Only devices that do something respond",
        selector: dropdown(
          opt("scale", "Press in"),
          opt("ripple", "Ink ripple"),
          opt("flash", "Flash"),
          opt("none", "None")
        ),
      },
    ],
    data: { pressEffect: pressEffectOf(c) },
    // The default stays out of the YAML, as the skin's does.
    toPatch: (p) =>
      "pressEffect" in p && p.pressEffect === DEFAULT_PRESS_EFFECT
        ? { ...p, pressEffect: undefined }
        : p,
  };
}

/**
 * Built-in skins (issue #122). Its own one-field form so the editor can put it
 * at the top of the Project section, directly above the Background colour it
 * interacts with — the skin supplies the paper, `background` overrides it.
 */
export function projectSkinForm(c: FloorplanCardConfig): FormSpec {
  const current = findSkin(c.skin) ?? SKINS[0];
  return {
    fields: [
      {
        name: "skin",
        label: "Skin",
        helper: current.description,
        selector: dropdown(...SKINS.map((s) => opt(s.id, s.label))),
      },
    ],
    // An id we don't ship reads back as Default, matching what it renders as.
    data: { skin: current.id },
    toPatch: (p) =>
      // Default is the absence of a skin, so it stays out of the YAML.
      "skin" in p && p.skin === DEFAULT_SKIN ? { ...p, skin: undefined } : p,
  };
}

/**
 * Display-only options, a separate form so the editor can render them as the
 * very last Project rows — set-once choices for how the card is shown (a wall
 * tablet's orientation, a dashboard tile's size), not day-to-day editing, so
 * they stay out of the way.
 */
export function projectDisplayForm(c: FloorplanCardConfig): FormSpec {
  return {
    fields: [
      {
        name: "rotation",
        label: "Rotate display",
        helper: "Rotates the live card only — editing stays as drawn",
        selector: dropdown(opt("0", "0°"), opt("90", "90°"), opt("180", "180°"), opt("270", "270°")),
      },
      {
        name: "overlayScale",
        label: "Badge & label size",
        helper: `Canvas units scale badges and labels with the drawing — use it when the card renders smaller than its ${c.width}-wide canvas`,
        selector: dropdown(opt("fixed", "Fixed pixels"), opt("plan", "Canvas units")),
      },
    ],
    data: {
      rotation: String(normalizePlanRotation(c.rotation)),
      overlayScale: normalizeOverlayScale(c.overlayScale),
    },
    toPatch: (p) => {
      let out = p;
      if ("rotation" in out)
        // Stored as a number; 0 means "not rotated", so keep it out of the YAML.
        out = { ...out, rotation: out.rotation === "0" ? undefined : Number(out.rotation) };
      // "fixed" is the default, so keep it out of the YAML too.
      if ("overlayScale" in out && out.overlayScale === "fixed")
        out = { ...out, overlayScale: undefined };
      return out;
    },
  };
}

/**
 * Dead spaces (issue #88). Its own one-field form for the same reason the skin
 * and rotation have theirs: it is a plan-wide drawing convention, set once,
 * rather than a property of anything on the canvas.
 */
export function projectDeadSpaceForm(c: FloorplanCardConfig): FormSpec {
  return {
    fields: [
      {
        name: "showDeadSpaces",
        label: "Mark dead spaces",
        helper:
          "Hatches any space the walls close off that no door or window opens onto",
        selector: { boolean: {} },
      },
    ],
    data: { showDeadSpaces: c.showDeadSpaces ?? false },
    // Off is the default, so it stays out of the YAML until switched on.
    toPatch: (p) =>
      "showDeadSpaces" in p && !p.showDeadSpaces ? { ...p, showDeadSpaces: undefined } : p,
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
