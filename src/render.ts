import { svg, html, type SVGTemplateResult, type TemplateResult } from "lit";
import type { Opening, ItemKind, Furniture } from "./types";
import { FURNITURE_COLOR } from "./types";

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
 * Render a door or window as an SVG group centered at the origin, then translated
 * and rotated into place. A background-colored "cut" masks the wall so the opening
 * reads as a gap, then the symbol (window panes / door swing) is drawn on top.
 *
 * @param bg  Color used to mask the wall behind the opening (the card background).
 */
export function renderOpening(o: Opening, color: string, bg: string): SVGTemplateResult {
  const half = o.length / 2;
  const cutH = WALL_THICKNESS + 4;
  // Mask out the wall segment behind the opening.
  const cut = svg`<rect x=${-half} y=${-cutH / 2} width=${o.length} height=${cutH} fill=${bg} />`;

  const body =
    o.type === "window"
      ? svg`
          ${cut}
          <!-- jambs -->
          <line x1=${-half} y1=${-cutH / 2} x2=${-half} y2=${cutH / 2}
                stroke=${color} stroke-width="2" />
          <line x1=${half} y1=${-cutH / 2} x2=${half} y2=${cutH / 2}
                stroke=${color} stroke-width="2" />
          <!-- glass (double line) -->
          <line x1=${-half} y1="-2.5" x2=${half} y2="-2.5" stroke=${color} stroke-width="1.5" />
          <line x1=${-half} y1="2.5" x2=${half} y2="2.5" stroke=${color} stroke-width="1.5" />
        `
      : svg`
          ${cut}
          <!-- door leaf, hinged at left jamb -->
          <line x1=${-half} y1="0" x2=${-half} y2=${-o.length}
                stroke=${color} stroke-width="2.5" />
          <!-- swing arc -->
          <path d="M ${-half} ${-o.length} A ${o.length} ${o.length} 0 0 1 ${half} 0"
                fill="none" stroke=${color} stroke-width="1.5" opacity="0.7" />
        `;
  return svg`<g transform="translate(${o.x} ${o.y}) rotate(${o.angle})">${body}</g>`;
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
