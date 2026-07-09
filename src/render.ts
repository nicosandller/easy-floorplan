import { svg, html, type SVGTemplateResult, type TemplateResult } from "lit";
import type { Opening, ItemKind, Furniture, Tracker } from "./types";
import { FURNITURE_COLOR, DEFAULT_TRACKER_DOT_SIZE, trackerAxisFraction } from "./types";

export const WALL_THICKNESS = 8;

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
    default:
      return "mdi:circle";
  }
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

/**
 * How far open an opening should be drawn, as a fraction 0..1, driving partial
 * swing / slide for position-aware `cover` entities. When the entity exposes a
 * numeric `current_position` (0–100) that maps linearly to the fraction (with
 * `invert` flipping it); otherwise it collapses to the binary
 * {@link resolveOpeningOpen} (0 or 1). With no entity/state it uses the type
 * default; an `unavailable`/`unknown` outage fails closed (0), ignoring any
 * stale position.
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
export function renderFurniture(f: Furniture): SVGTemplateResult {
  const color = f.color ?? FURNITURE_COLOR;
  const w = f.w;
  const h = f.h;
  const hw = w / 2;
  const hh = h / 2;

  const roundBase = f.type === "roundTable" || f.type === "plant";
  const base = roundBase
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
