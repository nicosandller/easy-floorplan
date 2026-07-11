import "../src/index";
import type { FloorplanCardConfig } from "../src/types";
import { FURNITURE_DEFAULT_SIZE } from "../src/types";

if (!customElements.get("ha-card")) {
  class C extends HTMLElement {
    set header(v: string | undefined) { this._h = v; this._r(); }
    private _h?: string;
    connectedCallback() { this._r(); }
    private _r() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.shadowRoot!.innerHTML = `<style>:host{display:block;background:#fff}</style><slot></slot>`;
    }
  }
  customElements.define("ha-card", C as any);
}
if (!customElements.get("ha-icon")) customElements.define("ha-icon", class extends HTMLElement {} as any);

const TYPES = Object.keys(FURNITURE_DEFAULT_SIZE) as Array<keyof typeof FURNITURE_DEFAULT_SIZE>;
const COLS = 6, CELL = 260;
const furniture = TYPES.map((t, i) => {
  const { w, h } = FURNITURE_DEFAULT_SIZE[t];
  return { id: t, type: t, x: (i % COLS) * CELL + CELL / 2, y: Math.floor(i / COLS) * CELL + CELL / 2, w, h };
});
// both hands of the sectional, side by side
furniture.push({ id: "sectional_left", type: "sectional", hand: "left",
  x: (TYPES.length % COLS) * CELL + CELL / 2, y: Math.floor(TYPES.length / COLS) * CELL + CELL / 2,
  w: 230, h: 180 } as any);

const texts = furniture.map((f) => ({ id: "t_" + f.id, x: f.x, y: f.y + CELL / 2 - 26, text: f.id, size: 15 }));

const config = {
  type: "custom:easy-floorplan-card", title: "Furniture symbols",
  width: COLS * CELL, height: (Math.ceil((TYPES.length + 1) / COLS)) * CELL,
  grid: CELL, walls: [], openings: [], items: [], texts, furniture,
} as unknown as FloorplanCardConfig;

const card = document.createElement("easy-floorplan-card") as any;
card.hass = { states: {}, formatEntityState: () => "" };
card.setConfig(config);
document.getElementById("host")!.appendChild(card);
