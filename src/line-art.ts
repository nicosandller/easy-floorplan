import { css, nothing, svg, type SVGTemplateResult } from "lit";
import { elevate, type IsoSolid, type Pt } from "./projection";

export type PlanAppearance = "normal" | "line-art";
export const normalizeAppearance = (value: unknown): PlanAppearance => value === "line-art" ? value : "normal";
export const LINE_INK = "#28343e";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);
const path = (a: Pt, b: Pt) => `M${fmt(a.x)} ${fmt(a.y)}L${fmt(b.x)} ${fmt(b.y)}`;

/**
 * Index exposed edges once for the whole scene. A hidden cap can join either
 * two straight wall chunks or two faces meeting at a corner: only the latter
 * needs an upright outline. The joined-wall renderer suppresses both caps.
 */
export function solidEdgeRenderer(solids: readonly IsoSolid[], ink = "#222222") {
  const incident = new Map<string, Pt[]>();
  const key = (s: IsoSolid, p: Pt) => `${s.kind}:${fmt(s.z0)}:${fmt(s.z1)}:${fmt(p.x)},${fmt(p.y)}`;
  for (const s of solids) {
    if (s.kind === "panel" || s.kind === "glass" || s.kind === "opening-hit") continue;
    for (let i = 0; i < s.base.length; i++) {
      if (s.hiddenEdges?.includes(i)) continue;
      const a = s.base[i], b = s.base[(i + 1) % s.base.length];
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-9) continue;
      const direction = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
      for (const p of [a, b]) {
        const k = key(s, p);
        const directions = incident.get(k) ?? [];
        directions.push(direction);
        incident.set(k, directions);
      }
    }
  }
  const corners = new Set<string>();
  for (const [k, directions] of incident) {
    const first = directions[0];
    if (directions.some(d => Math.abs(first.x * d.y - first.y * d.x) > 1e-6)) corners.add(k);
  }
  return (s: IsoSolid) => solidEdges(s, ink, p => corners.has(key(s, p)));
}

/** Outline real box edges, leaving the renderer's internal wall chunks seamless. */
function solidEdges(s: IsoSolid, ink: string, isCorner: (p: Pt) => boolean): SVGTemplateResult | typeof nothing {
  if (s.kind === "panel" || s.kind === "glass" || s.kind === "opening-hit" || s.base.length < 3) return nothing;
  const n = s.base.length;
  const center = s.base.reduce((p, q) => ({ x: p.x + q.x / n, y: p.y + q.y / n }), { x: 0, y: 0 });
  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    if (s.hiddenEdges?.includes(i)) continue;
    const a = s.base[i], b = s.base[(i + 1) % n];
    const topA = elevate(a, s.z1), topB = elevate(b, s.z1);
    lines.push(path(topA, topB));
    let nx = b.y - a.y, ny = a.x - b.x;
    if (nx * (center.x - a.x) + ny * (center.y - a.y) > 0) { nx = -nx; ny = -ny; }
    if (nx + ny <= 0) continue;
    const bottomA = elevate(a, s.z0), bottomB = elevate(b, s.z0);
    lines.push(path(bottomA, bottomB));
    if (!s.hiddenEdges?.includes((i + n - 1) % n) || isCorner(a)) lines.push(path(bottomA, topA));
    if (!s.hiddenEdges?.includes((i + 1) % n) || isCorner(b)) lines.push(path(bottomB, topB));
  }
  return svg`<path class="solid-edges" d=${lines.join(" ")} fill="none" stroke=${ink}
    stroke-width="1" pointer-events="none" />`;
}

/** Canvas-only overrides. Device status colours and the surrounding HA theme survive. */
export const lineArtStyles = css`
  .plan.line-art {
    --fp-line-ink: #28343e;
    --fp-skin-bg: #fff;
    --fp-skin-wall: var(--fp-line-ink);
    --fp-skin-wall-filter: none;
    --fp-skin-furniture: var(--fp-line-ink);
    --fp-skin-text: var(--fp-line-ink);
    --fp-skin-badge-bg: #fff;
    --fp-skin-badge-border: #c3cdd2;
    --fp-skin-badge-shadow: 0 1px 3px #152d401a;
    --primary-text-color: var(--fp-line-ink);
    --secondary-text-color: #51626d;
    --card-background-color: #fff;
    --fp-wall-opacity: 1;
  }
  .line-art .fp-floor-image { filter: grayscale(1); }
  .line-art .fp-area { stroke: var(--fp-line-ink); stroke-width: 0.6; }
  .line-art .fp-iso-face { fill: #fff; stroke: none; }
  .line-art .fp-iso-shade { display: none; }
  .line-art .fp-iso-panel, .line-art .fp-iso-glass {
    fill: #fff;
    fill-opacity: 1;
    stroke: var(--fp-iso-color, var(--fp-line-ink));
    stroke-width: 1;
  }
  .line-art .fp-furniture [fill]:not([fill="none"]):not([stroke="none"]) {
    fill: #fff;
    fill-opacity: 1;
  }
  .line-art .area-label {
    color: var(--fp-line-ink);
    text-shadow: 0 1px 2px #fff, 0 -1px 2px #fff, 1px 0 2px #fff, -1px 0 2px #fff;
  }
`;
