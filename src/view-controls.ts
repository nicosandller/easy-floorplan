import { css, html, svg, type TemplateResult } from "lit";
import type { PlanAppearance } from "./line-art";
import type { PlanRotation } from "./render";

interface ViewControls {
  view: "2d" | "3d";
  appearance: PlanAppearance;
  rotation: PlanRotation;
  canReset: boolean;
  exportEnabled: boolean;
  setView: (view: "2d" | "3d") => void;
  setAppearance: (appearance: PlanAppearance) => void;
  rotate: (step: -90 | 90) => void;
  reset: () => void;
  download: () => void;
}

const turn = (mirror = false) => svg`<svg viewBox="0 0 24 24" aria-hidden="true">
  <g transform=${mirror ? "translate(24 0) scale(-1 1)" : ""}>
    <path d="M4 10a8 8 0 1 1 1.8 7.1M4 4v6h6" />
  </g></svg>`;
const reset = svg`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10 12 3l8 7v10h-6v-6h-4v6H4Z" /></svg>`;
const download = svg`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4" /></svg>`;

export function renderViewControls(p: ViewControls): TemplateResult {
  return html`<nav class="view-controls" aria-label="Floorplan display">
    <div class="view-choices">
      <div class="view-segment" role="group" aria-label="View">
        <button type="button" aria-label="2D plan" aria-pressed=${p.view === "2d"}
          @click=${() => p.setView("2d")}>2D</button>
        <button type="button" aria-label="3D isometric" aria-pressed=${p.view === "3d"}
          @click=${() => p.setView("3d")}>3D</button>
      </div>
      <div class="view-segment" role="group" aria-label="Appearance">
        <button type="button" aria-pressed=${p.appearance === "normal"}
          @click=${() => p.setAppearance("normal")}>Normal</button>
        <button type="button" aria-pressed=${p.appearance === "line-art"}
          @click=${() => p.setAppearance("line-art")}>Line art</button>
      </div>
    </div>
    <div class="view-actions">
      <div class="view-rotation" role="group" aria-label="Rotate view">
        <button type="button" aria-label="Rotate left" title="Rotate left 90°"
          @click=${() => p.rotate(-90)}>${turn()}</button>
        <output aria-live="polite" aria-label="View rotation">${p.rotation}°</output>
        <button type="button" aria-label="Rotate right" title="Rotate right 90°"
          @click=${() => p.rotate(90)}>${turn(true)}</button>
      </div>
      <button class="view-reset" type="button" aria-label="Reset view"
        title="Restore the default view and appearance" ?disabled=${!p.canReset} @click=${p.reset}>${reset}</button>
      ${p.exportEnabled ? html`<button class="view-download" type="button" aria-label="Download SVG"
        title="Download a static line-art SVG" @click=${p.download}>${download}</button>` : ""}
    </div>
  </nav>`;
}

export const viewControlStyles = css`
  .view-controls {
    /* A zoomed room may paint past the stage; controls remain above it. */
    position: relative;
    z-index: 2;
    background: var(--card-background-color, #fff);
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 10px 20px;
    padding: 12px;
    border-top: 1px solid var(--divider-color, #e2e7ea);
    color: var(--primary-text-color, #26343d);
  }
  .view-choices, .view-actions { display: flex; align-items: center; gap: 8px; }
  .view-choices { flex-wrap: wrap; min-width: 0; gap: 6px; }
  .view-actions { flex-wrap: wrap; justify-content: flex-end; min-width: 0; margin-left: auto; }
  .view-segment {
    display: flex;
    padding: 3px;
    gap: 2px;
    border-radius: 10px;
    background: var(--secondary-background-color, #f1f4f5);
    border: 1px solid var(--divider-color, #e2e7ea);
  }
  .view-controls button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    box-sizing: border-box;
    border: 1px solid transparent;
    border-radius: 7px;
    padding: 8px;
    font: inherit;
    font-size: 13px;
    font-weight: 500;
    line-height: 1.2;
    white-space: nowrap;
    color: inherit;
    background: transparent;
    cursor: pointer;
    touch-action: manipulation;
  }
  .view-controls button[aria-pressed="true"] {
    background: var(--card-background-color, #fff);
    border-color: var(--divider-color, #d6dfe3);
    box-shadow: 0 1px 3px #00000012;
    font-weight: 700;
  }
  .view-segment button { padding-inline: 7px; }
  @media (hover: hover) {
    .view-controls button:hover:not(:disabled) {
      border-color: var(--primary-color, #387969);
    }
  }
  .view-controls button:focus-visible {
    outline: 2px solid var(--primary-color, #387969);
    outline-offset: 2px;
  }
  .view-controls button:disabled { opacity: .35; cursor: default; }
  .view-rotation { display: flex; align-items: center; }
  .view-rotation output { width: 38px; text-align: center; font-size: 12px; font-variant-numeric: tabular-nums; }
  .view-actions button { padding: 8px; }
  .view-actions .view-download { border-left-color: var(--divider-color, #e2e7ea); border-radius: 0 7px 7px 0; }
  .view-controls svg {
    position: static;
    inset: auto;
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.65;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
`;
