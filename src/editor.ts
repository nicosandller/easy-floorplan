import { LitElement, html, css, svg, nothing, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  FloorplanCardConfig,
  Wall,
  Opening,
  OpeningType,
  FloorItem,
  FloorText,
  Furniture,
  FurnitureType,
  ItemKind,
  ItemDisplay,
} from "./types";
import {
  DEFAULT_GRID,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  FURNITURE_DEFAULT_SIZE,
  emptyConfig,
  uid,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  renderRipple,
  renderFurniture,
  defaultIcon,
  kindFromEntity,
  snapToWall,
} from "./render";

const FURNITURE_TYPES: FurnitureType[] = [
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
];

/** User-facing labels for furniture types (the enum uses camelCase). */
const FURNITURE_LABELS: Record<FurnitureType, string> = {
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
};

type Tool = "select" | "wall" | "door" | "window";
type Selection =
  | { kind: "wall"; id: string }
  | { kind: "opening"; id: string }
  | { kind: "item"; id: string }
  | { kind: "text"; id: string }
  | { kind: "furniture"; id: string }
  | null;

type OverlaySel = { kind: "item" | "text"; id: string };

interface Drag {
  selection: Exclude<Selection, null>;
  dx: number;
  dy: number;
  endpoint?: 1 | 2;
}

/** Snap distance (virtual units) for openings onto walls / wall endpoints onto each other. */
const WALL_SNAP = 35;
const ENDPOINT_SNAP = 26;
const HISTORY_MAX = 60;

@customElement("easy-floorplan-card-editor")
export class FloorplanCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: FloorplanCardConfig;
  @state() private _tool: Tool = "select";
  @state() private _selection: Selection = null;
  @state() private _draft: { x1: number; y1: number; x2: number; y2: number } | null = null;
  @state() private _history: FloorplanCardConfig[] = [];
  @state() private _future: FloorplanCardConfig[] = [];
  @state() private _zoom = 1;

  @query("svg") private _svg?: SVGSVGElement;

  private _drag: Drag | null = null;
  private _onKeyDown = (ev: KeyboardEvent) => this._handleKeyDown(ev);

  public connectedCallback(): void {
    super.connectedCallback();
    // Capture phase so HA's dialog can't swallow the arrow keys before we see them.
    window.addEventListener("keydown", this._onKeyDown, true);
  }

  public disconnectedCallback(): void {
    window.removeEventListener("keydown", this._onKeyDown, true);
    super.disconnectedCallback();
  }

  public setConfig(config: FloorplanCardConfig): void {
    this._config = { ...emptyConfig(config.type || "custom:easy-floorplan-card"), ...config };
  }

  protected firstUpdated(): void {
    void this._ensurePickers();
  }

  /**
   * `ha-entity-picker` / `ha-icon-picker` are only defined after HA loads an
   * entities-card editor. Force that load so both pickers work inside our editor.
   */
  private async _ensurePickers(): Promise<void> {
    if (customElements.get("ha-entity-picker") && customElements.get("ha-icon-picker")) return;
    const helpers = await (window as unknown as { loadCardHelpers?: () => Promise<any> })
      .loadCardHelpers?.();
    if (!helpers) return;
    const card = await helpers.createCardElement({ type: "entities", entities: [] });
    await card.constructor?.getConfigElement?.();
    this.requestUpdate();
  }

  private get grid(): number {
    return this._config.grid ?? DEFAULT_GRID;
  }

  private _snap(v: number): number {
    const g = this.grid;
    return Math.round(v / g) * g;
  }

  private _toVirtual(ev: PointerEvent, snap = true): { x: number; y: number } {
    const svgEl = this._svg!;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return snap ? { x: this._snap(pt.x), y: this._snap(pt.y) } : { x: pt.x, y: pt.y };
  }

  /** Snap a raw point to a nearby existing wall endpoint, else to the grid. */
  private _snapWallPoint(rawX: number, rawY: number): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let bestDist = ENDPOINT_SNAP;
    for (const w of this._config.walls) {
      for (const e of [
        { x: w.x1, y: w.y1 },
        { x: w.x2, y: w.y2 },
      ]) {
        const d = Math.hypot(rawX - e.x, rawY - e.y);
        if (d < bestDist) {
          bestDist = d;
          best = e;
        }
      }
    }
    return best ?? { x: this._snap(rawX), y: this._snap(rawY) };
  }

  // ---- config mutation + history ----------------------------------------

  private _emit(config: FloorplanCardConfig): void {
    this._config = config;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config }, bubbles: true, composed: true })
    );
  }

  private _pushHistory(): void {
    this._history = [...this._history, structuredClone(this._config)].slice(-HISTORY_MAX);
    this._future = [];
  }

  /** Discrete change: snapshot for undo, then emit. */
  private _commit(config: FloorplanCardConfig): void {
    this._pushHistory();
    this._emit(config);
  }

  private _undo(): void {
    if (!this._history.length) return;
    this._future = [structuredClone(this._config), ...this._future];
    const prev = this._history[this._history.length - 1];
    this._history = this._history.slice(0, -1);
    this._selection = null;
    this._emit(prev);
  }

  private _redo(): void {
    if (!this._future.length) return;
    this._history = [...this._history, structuredClone(this._config)];
    const next = this._future[0];
    this._future = this._future.slice(1);
    this._selection = null;
    this._emit(next);
  }

  // ---- keyboard nudging ---------------------------------------------------

  private _handleKeyDown(ev: KeyboardEvent): void {
    if (!this._selection) return;
    // Don't hijack arrows while typing in a field / picker.
    const path = ev.composedPath();
    if (
      path.some((el) => {
        const tag = (el as HTMLElement).tagName?.toLowerCase();
        return (
          tag === "input" ||
          tag === "textarea" ||
          tag === "select" ||
          tag === "ha-entity-picker" ||
          tag === "ha-icon-picker"
        );
      })
    )
      return;

    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = deltas[ev.key];
    if (!d) return;
    ev.preventDefault();
    const step = ev.shiftKey ? 1 : this.grid;
    this._nudge(d[0] * step, d[1] * step);
  }

  private _nudge(dx: number, dy: number): void {
    const sel = this._selection;
    if (!sel) return;
    if (sel.kind === "wall") {
      this._commit({
        ...this._config,
        walls: this._config.walls.map((w) =>
          w.id === sel.id ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
        ),
      });
    } else if (sel.kind === "opening") {
      this._commit({
        ...this._config,
        openings: this._config.openings.map((o) =>
          o.id === sel.id ? { ...o, x: o.x + dx, y: o.y + dy } : o
        ),
      });
    } else if (sel.kind === "item") {
      this._commit({
        ...this._config,
        items: this._config.items.map((it) =>
          it.id === sel.id ? { ...it, x: it.x + dx, y: it.y + dy } : it
        ),
      });
    } else if (sel.kind === "text") {
      this._commit({
        ...this._config,
        texts: (this._config.texts ?? []).map((t) =>
          t.id === sel.id ? { ...t, x: t.x + dx, y: t.y + dy } : t
        ),
      });
    } else {
      this._commit({
        ...this._config,
        furniture: (this._config.furniture ?? []).map((f) =>
          f.id === sel.id ? { ...f, x: f.x + dx, y: f.y + dy } : f
        ),
      });
    }
  }

  // ---- canvas (SVG) pointer handling: drawing walls/openings -------------

  private _onCanvasDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const raw = this._toVirtual(ev, false);

    if (this._tool === "wall") {
      const s = this._snapWallPoint(raw.x, raw.y);
      this._draft = { x1: s.x, y1: s.y, x2: s.x, y2: s.y };
      (ev.target as Element).setPointerCapture?.(ev.pointerId);
      return;
    }
    if (this._tool === "door" || this._tool === "window") {
      this._addOpening(this._tool, this._snap(raw.x), this._snap(raw.y));
      return;
    }
    this._selection = null;
  }

  private _onCanvasMove(ev: PointerEvent): void {
    if (this._tool === "wall" && this._draft) {
      const raw = this._toVirtual(ev, false);
      const s = this._snapWallPoint(raw.x, raw.y);
      this._draft = { ...this._draft, x2: s.x, y2: s.y };
      return;
    }
    if (this._drag) this._applyDrag(ev);
  }

  private _onCanvasUp(ev: PointerEvent): void {
    if (this._tool === "wall" && this._draft) {
      const d = this._draft;
      this._draft = null;
      if (d.x1 !== d.x2 || d.y1 !== d.y2) {
        const wall: Wall = { id: uid("wall"), ...d };
        this._commit({ ...this._config, walls: [...this._config.walls, wall] });
        this._selection = { kind: "wall", id: wall.id };
      }
      return;
    }
    if (this._drag) {
      this._drag = null;
      (ev.target as Element).releasePointerCapture?.(ev.pointerId);
    }
  }

  // ---- dragging existing elements ----------------------------------------

  private _startDrag(ev: PointerEvent, selection: Exclude<Selection, null>, endpoint?: 1 | 2): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    this._selection = selection;
    const p = this._toVirtual(ev, false);
    let ax = 0;
    let ay = 0;
    if (selection.kind === "wall") {
      const w = this._config.walls.find((x) => x.id === selection.id)!;
      ax = endpoint === 2 ? w.x2 : w.x1;
      ay = endpoint === 2 ? w.y2 : w.y1;
    } else if (selection.kind === "opening") {
      const o = this._config.openings.find((x) => x.id === selection.id)!;
      ax = o.x;
      ay = o.y;
    } else if (selection.kind === "furniture") {
      const f = (this._config.furniture ?? []).find((x) => x.id === selection.id)!;
      ax = f.x;
      ay = f.y;
    } else {
      const it = this._config.items.find((x) => x.id === selection.id)!;
      ax = it.x;
      ay = it.y;
    }
    this._drag = { selection, dx: p.x - ax, dy: p.y - ay, endpoint };
    this._pushHistory();
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
  }

  private _applyDrag(ev: PointerEvent): void {
    const drag = this._drag!;
    const p = this._toVirtual(ev, false);
    const x = this._snap(p.x - drag.dx);
    const y = this._snap(p.y - drag.dy);

    if (drag.selection.kind === "wall") {
      const target = this._snapWallPoint(p.x - drag.dx, p.y - drag.dy);
      const walls = this._config.walls.map((w) => {
        if (w.id !== drag.selection.id) return w;
        if (drag.endpoint === 1) return { ...w, x1: target.x, y1: target.y };
        if (drag.endpoint === 2) return { ...w, x2: target.x, y2: target.y };
        const ddx = x - w.x1;
        const ddy = y - w.y1;
        return { ...w, x1: x, y1: y, x2: w.x2 + ddx, y2: w.y2 + ddy };
      });
      this._emit({ ...this._config, walls });
    } else if (drag.selection.kind === "opening") {
      const snap = snapToWall(p.x - drag.dx, p.y - drag.dy, this._config.walls, WALL_SNAP);
      const openings = this._config.openings.map((o) => {
        if (o.id !== drag.selection.id) return o;
        return snap ? { ...o, x: snap.x, y: snap.y, angle: snap.angle } : { ...o, x, y };
      });
      this._emit({ ...this._config, openings });
    } else if (drag.selection.kind === "furniture") {
      const furniture = (this._config.furniture ?? []).map((f) =>
        f.id === drag.selection.id ? { ...f, x, y } : f
      );
      this._emit({ ...this._config, furniture });
    } else if (drag.selection.kind === "item") {
      const items = this._config.items.map((it) =>
        it.id === drag.selection.id ? { ...it, x, y } : it
      );
      this._emit({ ...this._config, items });
    } else {
      const texts = (this._config.texts ?? []).map((t) =>
        t.id === drag.selection.id ? { ...t, x, y } : t
      );
      this._emit({ ...this._config, texts });
    }
  }

  // ---- overlay drag for items & texts (HTML, not SVG) --------------------

  private _onOverlayDown(ev: PointerEvent, sel: OverlaySel, ax: number, ay: number): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    ev.preventDefault();
    this._selection = sel;
    const p = this._toVirtual(ev, false);
    this._drag = { selection: sel, dx: p.x - ax, dy: p.y - ay };
    this._pushHistory();
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  }

  private _onOverlayMove(ev: PointerEvent): void {
    const k = this._drag?.selection.kind;
    if (k === "item" || k === "text") this._applyDrag(ev);
  }

  private _onOverlayUp(ev: PointerEvent): void {
    if (this._drag) {
      this._drag = null;
      (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId);
    }
  }

  // ---- element creation / mutation ---------------------------------------

  private _addOpening(type: OpeningType, x: number, y: number): void {
    const snap = snapToWall(x, y, this._config.walls, WALL_SNAP);
    const o: Opening = {
      id: uid(type),
      type,
      x: snap?.x ?? x,
      y: snap?.y ?? y,
      length: 60,
      angle: snap?.angle ?? 0,
    };
    this._commit({ ...this._config, openings: [...this._config.openings, o] });
    this._selection = { kind: "opening", id: o.id };
    this._tool = "select";
  }

  private _addItem(kind: ItemKind): void {
    const it: FloorItem = {
      id: uid("item"),
      entity: "",
      x: this._snap(this._config.width / 2),
      y: this._snap(this._config.height / 2),
      kind,
      showState: kind === "sensor",
      showIcon: true,
      size: DEFAULT_ITEM_SIZE,
    };
    this._commit({ ...this._config, items: [...this._config.items, it] });
    this._selection = { kind: "item", id: it.id };
    this._tool = "select";
  }

  private _addFurniture(type: FurnitureType): void {
    const size = FURNITURE_DEFAULT_SIZE[type];
    const f: Furniture = {
      id: uid("furn"),
      type,
      x: this._snap(this._config.width / 2),
      y: this._snap(this._config.height / 2),
      w: size.w,
      h: size.h,
      angle: 0,
    };
    this._commit({ ...this._config, furniture: [...(this._config.furniture ?? []), f] });
    this._selection = { kind: "furniture", id: f.id };
    this._tool = "select";
  }

  private _addText(): void {
    const t: FloorText = {
      id: uid("text"),
      x: this._snap(this._config.width / 2),
      y: this._snap(this._config.height / 2),
      text: "Label",
      size: DEFAULT_TEXT_SIZE,
    };
    this._commit({ ...this._config, texts: [...(this._config.texts ?? []), t] });
    this._selection = { kind: "text", id: t.id };
    this._tool = "select";
  }

  private _deleteSelected(): void {
    const sel = this._selection;
    if (!sel) return;
    if (sel.kind === "wall")
      this._commit({ ...this._config, walls: this._config.walls.filter((w) => w.id !== sel.id) });
    else if (sel.kind === "opening")
      this._commit({
        ...this._config,
        openings: this._config.openings.filter((o) => o.id !== sel.id),
      });
    else if (sel.kind === "item")
      this._commit({ ...this._config, items: this._config.items.filter((i) => i.id !== sel.id) });
    else if (sel.kind === "furniture")
      this._commit({
        ...this._config,
        furniture: (this._config.furniture ?? []).filter((f) => f.id !== sel.id),
      });
    else
      this._commit({
        ...this._config,
        texts: (this._config.texts ?? []).filter((t) => t.id !== sel.id),
      });
    this._selection = null;
  }

  private _updateOpening(id: string, partial: Partial<Opening>): void {
    this._commit({
      ...this._config,
      openings: this._config.openings.map((o) => (o.id === id ? { ...o, ...partial } : o)),
    });
  }

  private _updateItem(id: string, partial: Partial<FloorItem>): void {
    this._commit({
      ...this._config,
      items: this._config.items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
    });
  }

  private _updateText(id: string, partial: Partial<FloorText>): void {
    this._commit({
      ...this._config,
      texts: (this._config.texts ?? []).map((t) => (t.id === id ? { ...t, ...partial } : t)),
    });
  }

  private _updateFurniture(id: string, partial: Partial<Furniture>): void {
    this._commit({
      ...this._config,
      furniture: (this._config.furniture ?? []).map((f) =>
        f.id === id ? { ...f, ...partial } : f
      ),
    });
  }

  private _patchConfig(partial: Partial<FloorplanCardConfig>): void {
    this._commit({ ...this._config, ...partial });
  }

  // ---- rendering ----------------------------------------------------------

  private _renderGrid(): TemplateResult[] {
    const lines: TemplateResult[] = [];
    const { width, height } = this._config;
    const g = this.grid;
    for (let x = 0; x <= width; x += g)
      lines.push(svg`<line x1=${x} y1="0" x2=${x} y2=${height} class="grid" />`);
    for (let y = 0; y <= height; y += g)
      lines.push(svg`<line x1="0" y1=${y} x2=${width} y2=${y} class="grid" />`);
    return lines;
  }

  private _isSel(kind: string, id: string): boolean {
    return this._selection?.kind === kind && this._selection.id === id;
  }

  protected render(): TemplateResult {
    if (!this._config) return html`${nothing}`;
    const c = this._config;
    return html`
      <div class="editor">
        <div class="toolbar">
          ${(["select", "wall", "door", "window"] as Tool[]).map(
            (t) => html`
              <button
                class=${this._tool === t ? "active" : ""}
                @click=${() => {
                  this._tool = t;
                  this._draft = null;
                }}
              >
                ${t}
              </button>`
          )}
          <span class="spacer"></span>
          <button title="Undo" ?disabled=${!this._history.length} @click=${this._undo}>↶ undo</button>
          <button title="Redo" ?disabled=${!this._future.length} @click=${this._redo}>↷ redo</button>
          <button @click=${() => this._addItem("generic")}>+ device</button>
          <button @click=${this._addText}>+ text</button>
          <select
            class="furn-add"
            @change=${(e: Event) => {
              const v = (e.target as HTMLSelectElement).value as FurnitureType | "";
              if (v) this._addFurniture(v);
              (e.target as HTMLSelectElement).value = "";
            }}
          >
            <option value="">+ furniture…</option>
            ${FURNITURE_TYPES.map((t) => html`<option value=${t}>${FURNITURE_LABELS[t]}</option>`)}
          </select>
          <button class="danger" ?disabled=${!this._selection} @click=${this._deleteSelected}>
            delete
          </button>
          <span class="zoom">
            <label>zoom</label>
            <input
              type="range"
              min="0.5"
              max="3"
              step="0.1"
              .value=${String(this._zoom)}
              @input=${(e: Event) => {
                this._zoom = Number((e.target as HTMLInputElement).value);
              }}
            />
            <span class="zoom-val">${Math.round(this._zoom * 100)}%</span>
          </span>
        </div>

        <div class="canvas-wrap">
          <div class="stage" style="aspect-ratio: ${c.width} / ${c.height}; width:${this._zoom * 100}%;">
            <svg
              viewBox="0 0 ${c.width} ${c.height}"
              preserveAspectRatio="none"
              class=${this._tool}
              @pointerdown=${this._onCanvasDown}
              @pointermove=${this._onCanvasMove}
              @pointerup=${this._onCanvasUp}
            >
              <rect
                x="0"
                y="0"
                width=${c.width}
                height=${c.height}
                fill=${c.background ?? "var(--card-background-color, #fff)"}
              />
              ${this._renderGrid()}
              ${(c.furniture ?? []).map((f) => this._renderFurnitureSel(f))}
              ${c.walls.map((w) => this._renderWall(w))}
              ${c.openings.map((o) => this._renderOpeningSel(o))}
              ${
                this._draft
                  ? svg`<line x1=${this._draft.x1} y1=${this._draft.y1}
                              x2=${this._draft.x2} y2=${this._draft.y2}
                              class="wall draft" stroke-width=${WALL_THICKNESS} />`
                  : nothing
              }
            </svg>
            <div class="items">
              ${(c.texts ?? []).map((t) => this._renderTextOverlay(t, c))}
              ${c.items.map((it) => this._renderItemOverlay(it, c))}
            </div>
          </div>
        </div>

        ${this._renderPanel()}
      </div>
    `;
  }

  private _renderWall(w: Wall): TemplateResult {
    const selected = this._isSel("wall", w.id);
    return svg`
      <g>
        <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
              class="wall-hit"
              @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "wall", id: w.id })} />
        <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
              class="wall ${selected ? "selected" : ""}"
              stroke-width=${WALL_THICKNESS} stroke-linecap="round" />
        ${
          selected
            ? svg`
                <circle cx=${w.x1} cy=${w.y1} r="9" class="handle"
                        @pointerdown=${(e: PointerEvent) =>
                          this._startDrag(e, { kind: "wall", id: w.id }, 1)} />
                <circle cx=${w.x2} cy=${w.y2} r="9" class="handle"
                        @pointerdown=${(e: PointerEvent) =>
                          this._startDrag(e, { kind: "wall", id: w.id }, 2)} />`
            : nothing
        }
      </g>`;
  }

  private _renderOpeningSel(o: Opening): TemplateResult {
    const selected = this._isSel("opening", o.id);
    return svg`
      <g class="opening-hit"
         @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "opening", id: o.id })}>
        ${renderOpening(
          o,
          selected ? "var(--primary-color, #03a9f4)" : "var(--primary-text-color)",
          "var(--card-background-color, #fff)"
        )}
      </g>`;
  }

  private _renderFurnitureSel(f: Furniture): TemplateResult {
    const selected = this._isSel("furniture", f.id);
    return svg`
      <g class="furn-hit ${selected ? "selected" : ""}"
         @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "furniture", id: f.id })}>
        ${renderFurniture(f)}
        ${
          selected
            ? svg`<rect x=${f.x - f.w / 2 - 4} y=${f.y - f.h / 2 - 4}
                        width=${f.w + 8} height=${f.h + 8}
                        transform="rotate(${f.angle ?? 0} ${f.x} ${f.y})"
                        class="furn-outline" />`
            : nothing
        }
      </g>`;
  }

  private _renderItemOverlay(it: FloorItem, c: FloorplanCardConfig): TemplateResult {
    const selected = this._isSel("item", it.id);
    const icon = it.icon ?? defaultIcon(it.kind);
    const label = it.name || it.entity || it.kind;
    const size = it.size ?? DEFAULT_ITEM_SIZE;
    const showIcon = it.showIcon ?? true;
    const display = it.display ?? "badge";
    const rippleColor = it.rippleColor ?? "var(--primary-color, #03a9f4)";
    const rippleSize = it.rippleSize ?? DEFAULT_RIPPLE_SIZE;

    const badge = html`<div
      class="badge ${showIcon ? "" : "ghost"}"
      style="width:${size}px;height:${size}px;transform:rotate(${it.angle ?? 0}deg);"
    >
      <ha-icon icon=${icon} style="--mdc-icon-size:${Math.round(size * 0.62)}px;"></ha-icon>
    </div>`;

    // Editor always previews the ripple animated so its effect is visible.
    let visual: TemplateResult;
    if (display === "ripple") {
      visual = renderRipple(true, rippleColor, rippleSize);
    } else if (display === "iconRipple") {
      visual = html`<div class="stack">
        ${renderRipple(true, rippleColor, rippleSize)}
        <div class="stack-icon">${badge}</div>
      </div>`;
    } else {
      visual = badge;
    }

    return html`
      <div
        class="edit-item ${selected ? "selected" : ""}"
        style="left:${(it.x / c.width) * 100}%; top:${(it.y / c.height) * 100}%;"
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "item", id: it.id }, it.x, it.y)}
        @pointermove=${this._onOverlayMove}
        @pointerup=${this._onOverlayUp}
      >
        ${visual}
        <span class="ilabel">${label}</span>
      </div>
    `;
  }

  private _renderTextOverlay(t: FloorText, c: FloorplanCardConfig): TemplateResult {
    const selected = this._isSel("text", t.id);
    return html`
      <div
        class="edit-text ${selected ? "selected" : ""}"
        style="left:${(t.x / c.width) * 100}%; top:${(t.y / c.height) * 100}%;
               font-size:${t.size ?? DEFAULT_TEXT_SIZE}px;
               color:${t.color ?? "var(--primary-text-color)"};
               transform:translate(-50%,-50%) rotate(${t.angle ?? 0}deg);"
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "text", id: t.id }, t.x, t.y)}
        @pointermove=${this._onOverlayMove}
        @pointerup=${this._onOverlayUp}
      >
        ${t.text || "…"}
      </div>
    `;
  }

  private _renderPanel(): TemplateResult {
    return html`
      <div class="panel">
        <div class="row">
          <label>Title</label>
          <input
            type="text"
            .value=${this._config.title ?? ""}
            @change=${(e: Event) =>
              this._patchConfig({ title: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        <div class="row">
          <label>Canvas W / H</label>
          <input
            type="number"
            .value=${String(this._config.width)}
            @change=${(e: Event) =>
              this._patchConfig({
                width: Number((e.target as HTMLInputElement).value) || DEFAULT_WIDTH,
              })}
          />
          <input
            type="number"
            .value=${String(this._config.height)}
            @change=${(e: Event) =>
              this._patchConfig({
                height: Number((e.target as HTMLInputElement).value) || DEFAULT_HEIGHT,
              })}
          />
        </div>
        <div class="row">
          <label>Grid</label>
          <input
            type="number"
            .value=${String(this.grid)}
            @change=${(e: Event) =>
              this._patchConfig({
                grid: Number((e.target as HTMLInputElement).value) || DEFAULT_GRID,
              })}
          />
        </div>
        <div class="row">
          <label>Background</label>
          <input
            type="color"
            .value=${this._config.background ?? "#ffffff"}
            @input=${(e: Event) => this._patchConfig({ background: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="#ffffff or empty"
            .value=${this._config.background ?? ""}
            @change=${(e: Event) =>
              this._patchConfig({ background: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        <hr />
        ${this._renderSelectionProps()}
      </div>
    `;
  }

  private _renderSelectionProps(): TemplateResult {
    const sel = this._selection;
    if (!sel)
      return html`<p class="hint">
        Pick a tool to draw. Wall ends snap to nearby wall corners — start a new wall on an existing
        corner to continue the perimeter. Switch to <b>select</b> to move or delete things. With
        something selected, <b>arrow keys</b> nudge it (hold <b>Shift</b> for 1-unit steps).
      </p>`;

    if (sel.kind === "opening") {
      const o = this._config.openings.find((x) => x.id === sel.id);
      if (!o) return html`${nothing}`;
      return html`
        <div class="row">
          <label>Type</label>
          <select
            .value=${o.type}
            @change=${(e: Event) =>
              this._updateOpening(o.id, {
                type: (e.target as HTMLSelectElement).value as OpeningType,
              })}
          >
            <option value="door">door</option>
            <option value="window">window</option>
          </select>
        </div>
        <div class="row">
          <label>Length</label>
          <input
            type="number"
            .value=${String(o.length)}
            @change=${(e: Event) =>
              this._updateOpening(o.id, { length: Number((e.target as HTMLInputElement).value) })}
          />
        </div>
        <div class="row">
          <label>Angle</label>
          <input
            type="range"
            min="0"
            max="360"
            .value=${String(o.angle)}
            @input=${(e: Event) =>
              this._updateOpening(o.id, { angle: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="0"
            max="360"
            step="1"
            .value=${String(Math.round(o.angle))}
            @change=${(e: Event) =>
              this._updateOpening(o.id, {
                angle: ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360,
              })}
          />
        </div>
      `;
    }

    if (sel.kind === "item") {
      const it = this._config.items.find((x) => x.id === sel.id);
      if (!it) return html`${nothing}`;
      return html`
        <div class="row">
          <label>Entity</label>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${it.entity}
            allow-custom-entity
            @value-changed=${(e: CustomEvent) => {
              const entity = e.detail.value as string;
              this._updateItem(it.id, { entity, kind: kindFromEntity(entity) });
            }}
          ></ha-entity-picker>
        </div>
        <div class="row">
          <label>Icon</label>
          ${customElements.get("ha-icon-picker")
            ? html`<ha-icon-picker
                .hass=${this.hass}
                .value=${it.icon ?? ""}
                placeholder=${defaultIcon(it.kind)}
                @value-changed=${(e: CustomEvent) =>
                  this._updateItem(it.id, { icon: (e.detail.value as string) || undefined })}
              ></ha-icon-picker>`
            : html`<input
                type="text"
                placeholder="mdi:lightbulb (optional)"
                .value=${it.icon ?? ""}
                @change=${(e: Event) =>
                  this._updateItem(it.id, {
                    icon: (e.target as HTMLInputElement).value || undefined,
                  })}
              />`}
        </div>
        <div class="row">
          <label>Name</label>
          <input
            type="text"
            placeholder="(optional)"
            .value=${it.name ?? ""}
            @change=${(e: Event) =>
              this._updateItem(it.id, { name: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        <div class="row">
          <label>Size</label>
          <input
            type="range"
            min="16"
            max="96"
            step="2"
            .value=${String(it.size ?? DEFAULT_ITEM_SIZE)}
            @input=${(e: Event) =>
              this._updateItem(it.id, { size: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="16"
            max="160"
            .value=${String(it.size ?? DEFAULT_ITEM_SIZE)}
            @change=${(e: Event) =>
              this._updateItem(it.id, {
                size: Number((e.target as HTMLInputElement).value) || DEFAULT_ITEM_SIZE,
              })}
          />
        </div>
        <div class="row">
          <label>Angle</label>
          <input
            type="range"
            min="0"
            max="360"
            .value=${String(it.angle ?? 0)}
            @input=${(e: Event) =>
              this._updateItem(it.id, { angle: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="0"
            max="360"
            .value=${String(Math.round(it.angle ?? 0))}
            @change=${(e: Event) =>
              this._updateItem(it.id, {
                angle: ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360,
              })}
          />
        </div>
        <div class="row">
          <label>Display</label>
          <select
            .value=${it.display ?? "badge"}
            @change=${(e: Event) =>
              this._updateItem(it.id, {
                display: (e.target as HTMLSelectElement).value as ItemDisplay,
              })}
          >
            <option value="badge">Icon badge</option>
            <option value="ripple">Ripple</option>
            <option value="iconRipple">Icon + ripple</option>
          </select>
        </div>
        ${(it.display ?? "badge") !== "badge"
          ? html`
              <div class="row">
                <label>Ripple color</label>
                <input
                  type="color"
                  .value=${it.rippleColor ?? "#03a9f4"}
                  @input=${(e: Event) =>
                    this._updateItem(it.id, { rippleColor: (e.target as HTMLInputElement).value })}
                />
                <input
                  type="text"
                  placeholder="(primary)"
                  .value=${it.rippleColor ?? ""}
                  @change=${(e: Event) =>
                    this._updateItem(it.id, {
                      rippleColor: (e.target as HTMLInputElement).value || undefined,
                    })}
                />
              </div>
              <div class="row">
                <label>Ripple size</label>
                <input
                  type="range"
                  min="40"
                  max="240"
                  step="4"
                  .value=${String(it.rippleSize ?? DEFAULT_RIPPLE_SIZE)}
                  @input=${(e: Event) =>
                    this._updateItem(it.id, {
                      rippleSize: Number((e.target as HTMLInputElement).value),
                    })}
                />
                <input
                  class="num"
                  type="number"
                  min="40"
                  max="400"
                  .value=${String(it.rippleSize ?? DEFAULT_RIPPLE_SIZE)}
                  @change=${(e: Event) =>
                    this._updateItem(it.id, {
                      rippleSize:
                        Number((e.target as HTMLInputElement).value) || DEFAULT_RIPPLE_SIZE,
                    })}
                />
              </div>
            `
          : nothing}
        <div class="row">
          <label>Show icon</label>
          <input
            type="checkbox"
            .checked=${it.showIcon ?? true}
            @change=${(e: Event) =>
              this._updateItem(it.id, { showIcon: (e.target as HTMLInputElement).checked })}
          />
        </div>
        <div class="row">
          <label>Show state</label>
          <input
            type="checkbox"
            .checked=${it.showState ?? false}
            @change=${(e: Event) =>
              this._updateItem(it.id, { showState: (e.target as HTMLInputElement).checked })}
          />
        </div>
      `;
    }

    if (sel.kind === "text") {
      const t = (this._config.texts ?? []).find((x) => x.id === sel.id);
      if (!t) return html`${nothing}`;
      return html`
        <div class="row">
          <label>Text</label>
          <input
            type="text"
            .value=${t.text}
            @input=${(e: Event) =>
              this._updateText(t.id, { text: (e.target as HTMLInputElement).value })}
          />
        </div>
        <div class="row">
          <label>Size</label>
          <input
            type="range"
            min="8"
            max="80"
            .value=${String(t.size ?? DEFAULT_TEXT_SIZE)}
            @input=${(e: Event) =>
              this._updateText(t.id, { size: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="8"
            max="200"
            .value=${String(t.size ?? DEFAULT_TEXT_SIZE)}
            @change=${(e: Event) =>
              this._updateText(t.id, {
                size: Number((e.target as HTMLInputElement).value) || DEFAULT_TEXT_SIZE,
              })}
          />
        </div>
        <div class="row">
          <label>Color</label>
          <input
            type="color"
            .value=${t.color ?? "#000000"}
            @input=${(e: Event) =>
              this._updateText(t.id, { color: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="(theme default)"
            .value=${t.color ?? ""}
            @change=${(e: Event) =>
              this._updateText(t.id, { color: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        <div class="row">
          <label>Angle</label>
          <input
            type="range"
            min="0"
            max="360"
            .value=${String(t.angle ?? 0)}
            @input=${(e: Event) =>
              this._updateText(t.id, { angle: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="0"
            max="360"
            .value=${String(Math.round(t.angle ?? 0))}
            @change=${(e: Event) =>
              this._updateText(t.id, {
                angle: ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360,
              })}
          />
        </div>
      `;
    }

    if (sel.kind === "furniture") {
      const f = (this._config.furniture ?? []).find((x) => x.id === sel.id);
      if (!f) return html`${nothing}`;
      return html`
        <div class="row">
          <label>Type</label>
          <select
            .value=${f.type}
            @change=${(e: Event) =>
              this._updateFurniture(f.id, {
                type: (e.target as HTMLSelectElement).value as FurnitureType,
              })}
          >
            ${FURNITURE_TYPES.map((t) => html`<option value=${t}>${FURNITURE_LABELS[t]}</option>`)}
          </select>
        </div>
        <div class="row">
          <label>Width / Height</label>
          <input
            class="num"
            type="number"
            min="10"
            .value=${String(f.w)}
            @change=${(e: Event) =>
              this._updateFurniture(f.id, { w: Number((e.target as HTMLInputElement).value) || f.w })}
          />
          <input
            class="num"
            type="number"
            min="10"
            .value=${String(f.h)}
            @change=${(e: Event) =>
              this._updateFurniture(f.id, { h: Number((e.target as HTMLInputElement).value) || f.h })}
          />
        </div>
        <div class="row">
          <label>Angle</label>
          <input
            type="range"
            min="0"
            max="360"
            .value=${String(f.angle ?? 0)}
            @input=${(e: Event) =>
              this._updateFurniture(f.id, { angle: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="0"
            max="360"
            .value=${String(Math.round(f.angle ?? 0))}
            @change=${(e: Event) =>
              this._updateFurniture(f.id, {
                angle: ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360,
              })}
          />
        </div>
        <div class="row">
          <label>Color</label>
          <input
            type="color"
            .value=${f.color ?? "#9e9e9e"}
            @input=${(e: Event) =>
              this._updateFurniture(f.id, { color: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="(gray)"
            .value=${f.color ?? ""}
            @change=${(e: Event) =>
              this._updateFurniture(f.id, {
                color: (e.target as HTMLInputElement).value || undefined,
              })}
          />
        </div>
      `;
    }

    return html`<p class="hint">
      Wall selected — drag the line to move it, or drag the round handles to move an endpoint
      (endpoints snap to other wall corners). Use <b>delete</b> to remove it.
    </p>`;
  }

  static styles = css`
    .editor {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .toolbar {
      display: flex;
      gap: 4px;
      align-items: center;
      flex-wrap: wrap;
    }
    .toolbar .spacer {
      flex: 1;
    }
    button {
      cursor: pointer;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      border-radius: 6px;
      padding: 6px 10px;
      text-transform: capitalize;
    }
    button.active {
      background: var(--primary-color, #03a9f4);
      color: #fff;
      border-color: var(--primary-color, #03a9f4);
    }
    button.danger {
      color: var(--error-color, #db4437);
    }
    button[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .canvas-wrap {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      overflow: auto;
      resize: both;
      height: 62vh;
      min-height: 320px;
      background: var(--secondary-background-color, #f5f5f5);
      display: flex;
      align-items: flex-start;
      justify-content: flex-start;
    }
    .stage {
      position: relative;
      width: 100%;
      flex: 0 0 auto;
      margin: auto;
      touch-action: none;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    svg.wall,
    svg.door,
    svg.window {
      cursor: crosshair;
    }
    .grid {
      stroke: var(--divider-color, #e0e0e0);
      stroke-width: 0.5;
    }
    .wall {
      stroke: var(--primary-text-color);
    }
    .wall.selected {
      stroke: var(--primary-color, #03a9f4);
    }
    .wall.draft {
      opacity: 0.5;
      pointer-events: none;
    }
    .wall-hit {
      stroke: transparent;
      stroke-width: 22;
      cursor: move;
    }
    .opening-hit {
      cursor: move;
    }
    .furn-hit {
      cursor: move;
    }
    .furn-outline {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .zoom {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .zoom label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .zoom input[type="range"] {
      width: 90px;
    }
    .zoom-val {
      font-size: 12px;
      color: var(--secondary-text-color);
      min-width: 34px;
    }
    .furn-add {
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      border-radius: 6px;
      padding: 6px 8px;
      cursor: pointer;
    }
    .handle {
      fill: var(--primary-color, #03a9f4);
      stroke: #fff;
      stroke-width: 1.5;
      cursor: grab;
    }
    .items {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .edit-item {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      cursor: move;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      touch-action: none;
    }
    .badge {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--card-background-color, #fff);
      border: 1.5px solid var(--divider-color, #ccc);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary-text-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
    }
    .edit-item.selected .badge {
      border-color: var(--primary-color, #03a9f4);
      border-width: 2.5px;
    }
    .badge.ghost {
      opacity: 0.35;
      border-style: dashed;
    }
    .stack {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stack-icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ripple {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ripple .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--fp-ripple-color);
      opacity: 0;
    }
    .ripple.active .ring {
      animation: fp-ripple 1.8s ease-out infinite;
    }
    .ripple .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--fp-ripple-color);
      opacity: 0.4;
    }
    .ripple.active .dot {
      opacity: 0.9;
    }
    @keyframes fp-ripple {
      0% {
        transform: scale(0.15);
        opacity: 0.7;
      }
      100% {
        transform: scale(1);
        opacity: 0;
      }
    }
    .edit-text {
      position: absolute;
      pointer-events: auto;
      cursor: move;
      white-space: nowrap;
      font-weight: 500;
      line-height: 1;
      padding: 2px;
      touch-action: none;
    }
    .edit-text.selected {
      outline: 1.5px dashed var(--primary-color, #03a9f4);
      outline-offset: 2px;
    }
    ha-icon {
      --mdc-icon-size: 22px;
    }
    .ilabel {
      font-size: 11px;
      line-height: 1;
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      color: var(--secondary-text-color);
      white-space: nowrap;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .panel {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      padding: 10px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .row label {
      flex: 0 0 90px;
      font-size: 13px;
      color: var(--secondary-text-color);
    }
    .row input[type="text"],
    .row input[type="number"],
    .row select {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      border-radius: 4px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
    }
    ha-entity-picker,
    ha-icon-picker {
      flex: 1;
      min-width: 0;
    }
    .row input.num {
      flex: 0 0 64px;
    }
    .hint {
      font-size: 13px;
      color: var(--secondary-text-color);
      line-height: 1.5;
    }
    hr {
      border: none;
      border-top: 1px solid var(--divider-color, #eee);
      margin: 10px 0;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-card-editor": FloorplanCardEditor;
  }
}
