import { svg, html, type SVGTemplateResult, type TemplateResult } from "lit";
import type {
  FloorplanCardConfig,
  SectionalHand,
  Opening,
  ItemKind,
  Furniture,
  Tracker,
  RenderHass,
} from "./types";
import { FURNITURE_COLOR, DEFAULT_TRACKER_DOT_SIZE, getFloors, trackerAxisFraction } from "./types";

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
  for (const f of getFloors(c)) {
    for (const o of f.openings) if (o.entity) ids.add(o.entity);
    for (const it of f.items) {
      if (it.entity) ids.add(it.entity);
      if (it.secondaryEntity) ids.add(it.secondaryEntity);
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

/** State text for an item: primary entity, plus secondary (e.g. humidity) when set. */
export function itemStateText(
  hass: RenderHass | undefined,
  item: { entity: string; secondaryEntity?: string },
): string {
  const primary = entityStateText(hass, item.entity);
  if (!item.secondaryEntity) return primary;
  return `${primary} · ${entityStateText(hass, item.secondaryEntity)}`;
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
 * Clamp a config `labelSize` to the editor's 8–40 px range at the render
 * sink. The editor already clamps, but a hand-edited / imported config
 * bypasses it — and this value lands in an inline `style` attribute, so a
 * string like `"20px;color:red"` must coerce to a plain number, never pass
 * through (review feedback on #62; same surface #65 hardens).
 */
export function itemLabelSize(v: unknown): number {
  const n = typeof v === "string" && v !== "" ? Number(v) : (v as number | undefined);
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_LABEL_SIZE;
  return Math.min(40, Math.max(8, n));
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
 * Icon precedence shared by card and editor: config override → the user's
 * entity-registry icon → entity's explicit icon → device_class-implied icon
 * ("show as") → the kind default. The on-state comes from {@link entityIsActive},
 * so domains that never say "on" (lock/vacuum/camera) reach their active icons here.
 *
 * The registry override lives at `hass.entities[id].icon` and never reaches
 * `attributes.icon`, so a user who set an icon in Settings → Entities sees it
 * everywhere in HA except here. HA's own `entityIcon()` prefers it over the
 * integration's icon; so must we. `registryIcon` is passed in because this helper
 * takes the state object, not `hass`.
 */
export function resolveItemIcon(
  item: { entity?: string; kind: ItemKind; icon?: string },
  st: { state: string; attributes: Record<string, unknown> } | undefined,
  registryIcon?: string,
): string {
  if (item.icon) return item.icon;
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
export function openingMotion(o: Opening): "swing" | "slide" {
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

/** HA `cover` / `binary_sensor` device classes that read as a window (glass). */
const WINDOW_DEVICE_CLASSES = new Set(["window", "blind", "shade", "shutter", "curtain", "awning"]);
/** Device classes that roll / slide rather than swing. */
const SLIDING_DEVICE_CLASSES = new Set([
  "garage",
  "garage_door",
  "blind",
  "shade",
  "shutter",
  "curtain",
]);

/**
 * Default opening `type` and `motion` inferred from a bound entity's HA
 * `device_class` (mirrors how HA itself picks icons/behaviour from it). Window-
 * like classes render as a window; rolling/sliding classes default to `slide`.
 * Unknown / missing classes fall back to a swing door. `motion: undefined`
 * means swing (the default).
 */
export function openingFromDeviceClass(deviceClass: string | undefined): {
  type: Opening["type"];
  motion: "slide" | undefined;
} {
  return {
    type: WINDOW_DEVICE_CLASSES.has(deviceClass ?? "") ? "window" : "door",
    motion: SLIDING_DEVICE_CLASSES.has(deviceClass ?? "") ? "slide" : undefined,
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
  /** Accent color used while `active` (default the HA primary color). */
  accent?: string;
}

/**
 * Render a door or window as an SVG group centered at the origin, then translated
 * and rotated into place. The wall behind the opening is cut away by the host via
 * an SVG mask (see {@link renderWallMask}), so this draws only the symbol — jambs,
 * swing arc and the moving leaf/sash, which carry CSS classes so the host's styles
 * can transition them smoothly between open and closed.
 */
export function renderOpening(o: Opening, style: OpeningStyle): SVGTemplateResult {
  const { color, open = true, active = false, accent = "var(--primary-color, #03a9f4)" } = style;
  const half = o.length / 2;
  const cutH = WALL_THICKNESS + 4;
  // The moving parts take the accent color when actively open (sensor-driven).
  const tone = active ? accent : color;
  // Fraction open (0..1) drives partial swing/slide. Defaults to the binary
  // `open` so callers that don't pass `amount` render exactly as before.
  const amt = Math.max(0, Math.min(1, style.amount ?? (open ? 1 : 0)));

  let body: SVGTemplateResult;
  if (o.type === "window" && openingMotion(o) === "swing") {
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
  const { sx, sy } = openingMirror(o);
  return svg`<g transform="translate(${o.x} ${o.y}) rotate(${o.angle})">
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
 * Build an SVG `<mask>` (white field with a black rect at each opening) that, when
 * applied to the wall layer, removes the wall pixels behind doors/windows so a gap
 * shows through — including any background image. Shared by the live card and the
 * editor so both cut walls identically. Wrap the wall strokes in
 * `<g mask="url(#id)">` (or set `mask="url(#id)"` on each wall line).
 */
export function renderWallMask(
  openings: Opening[],
  width: number,
  height: number,
  id: string
): SVGTemplateResult {
  const cutH = WALL_THICKNESS + 4;
  return svg`
    <defs>
      <mask id=${id} maskUnits="userSpaceOnUse">
        <rect x="0" y="0" width=${width} height=${height} fill="white" />
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

export function renderFurniture(f: Furniture): SVGTemplateResult {
  const color = f.color ?? FURNITURE_COLOR;
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
  return svg`<g transform="translate(${f.x} ${f.y}) rotate(${f.angle ?? 0})">${base}${detail}</g>`;
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
      style="width:${sizePx}px;height:${sizePx}px;--fp-ripple-color:${color};"
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
  const color = t.color ?? "var(--primary-color, #03a9f4)";
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
    <g class="tracker ${opts.editing ? "editing" : ""}"
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
