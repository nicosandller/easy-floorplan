import { LitElement, html, css, svg, nothing, type TemplateResult } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type {
  HomeAssistant,
  FloorplanCardConfig,
  Floor,
  Wall,
  Opening,
  OpeningType,
  FloorItem,
  FloorText,
  Furniture,
  FurnitureType,
  ItemKind,
  ItemDisplay,
  Tracker,
  TrackerSensor,
} from "./types";
import {
  DEFAULT_CUSTOM_PERCENT,
  DEFAULT_GRID,
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_TRACKER_DOT_SIZE,
  FURNITURE_DEFAULT_SIZE,
  emptyConfig,
  getFloors,
  gridPercentToSnap,
  makeFloor,
  resolveSnap,
  snapToGridPercent,
  trackerPresenceDetected,
  uid,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  renderWallMask,
  openingDefaultOpen,
  renderRipple,
  renderFurniture,
  renderTracker,
  trackerSensorReading,
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

type Tool = "select" | "wall" | "door" | "window" | "tracker";
type SelKind = "wall" | "opening" | "item" | "text" | "furniture" | "tracker";
type Sel = { kind: SelKind; id: string };
type OverlaySel = { kind: "item" | "text"; id: string };

/** Snapshot of an element's position at drag start, for group translation. */
type OrigPos =
  | { kind: "wall"; x1: number; y1: number; x2: number; y2: number }
  | { kind: "pt"; x: number; y: number };

interface Drag {
  /** The element under the pointer (drives snapping); the whole selection moves with it. */
  primary: Sel;
  /** Pointer position (unsnapped, virtual coords) when the drag started. */
  start: { x: number; y: number };
  /** Original positions of every selected element, keyed `${kind}:${id}`. */
  orig: Map<string, OrigPos>;
  /** Set when dragging a single wall endpoint handle. */
  endpoint?: 1 | 2;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Elements copied to the in-memory clipboard (not part of the config). */
interface Clipboard {
  walls: Wall[];
  openings: Opening[];
  items: FloorItem[];
  texts: FloorText[];
  furniture: Furniture[];
  trackers: Tracker[];
}

/** Snap distance (virtual units) for openings onto walls / wall endpoints onto each other. */
const WALL_SNAP = 35;
const ENDPOINT_SNAP = 26;
const HISTORY_MAX = 60;
/** Angle (degrees) within which a drawn wall is snapped flat to horizontal/vertical. */
const WALL_AXIS_SNAP_DEG = 10;

@customElement("easy-floorplan-card-editor")
export class FloorplanCardEditor extends LitElement {
  private static _nextWallMaskId = 0;
  /** Unique mask id so multiple editor instances don't collide. */
  private readonly _wallMaskId = `fp-edit-wall-mask-${FloorplanCardEditor._nextWallMaskId++}`;

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config!: FloorplanCardConfig;
  @state() private _tool: Tool = "select";
  @state() private _selection: Sel[] = [];
  @state() private _activeFloorId!: string;
  @state() private _draft: { x1: number; y1: number; x2: number; y2: number } | null = null;
  /** While dragging the Tracker tool, the rectangle being drawn (top-left corner + opposite corner). */
  @state() private _draftTracker: { x0: number; y0: number; x1: number; y1: number } | null = null;
  /** When true, walls are drawn freely (no horizontal/vertical or corner gravity). */
  @state() private _freeWalls = false;
  /** Default length applied to a freshly placed door/window. User-editable from the context bar. */
  @state() private _defaultOpeningLength = 60;
  @state() private _marquee: Marquee | null = null;
  @state() private _history: FloorplanCardConfig[] = [];
  @state() private _future: FloorplanCardConfig[] = [];
  @state() private _zoom = 1;

  @query("svg") private _svg?: SVGSVGElement;

  private _drag: Drag | null = null;
  /** True when the active marquee should add to (rather than replace) the selection. */
  private _marqueeAdd = false;
  private _clipboard: Clipboard | null = null;
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
    const base = { ...emptyConfig(config.type || "custom:easy-floorplan-card"), ...config };
    // Normalize to the floors model (migrating legacy single-floor configs) and
    // clear the legacy flat arrays so `floors` is the single source of truth.
    const floors = getFloors(base).map((f) => structuredClone(f));
    this._config = {
      ...base,
      floors,
      walls: [],
      openings: [],
      items: [],
      texts: [],
      furniture: [],
      trackers: [],
    };
    if (!this._activeFloorId || !floors.some((f) => f.id === this._activeFloorId)) {
      this._activeFloorId =
        base.defaultFloor && floors.some((f) => f.id === base.defaultFloor)
          ? base.defaultFloor
          : floors[0].id;
    }
  }

  // ---- active floor access -----------------------------------------------

  private _floor(): Floor {
    const floors = this._config.floors ?? [];
    return floors.find((f) => f.id === this._activeFloorId) ?? floors[0];
  }

  /** Discrete change to the active floor's elements (snapshots for undo). */
  private _commitFloor(partial: Partial<Floor>): void {
    this._commit({ ...this._config, floors: this._patchFloors(partial) });
  }

  /** Live change to the active floor's elements (no history snapshot — for dragging). */
  private _emitFloor(partial: Partial<Floor>): void {
    this._emit({ ...this._config, floors: this._patchFloors(partial) });
  }

  private _patchFloors(partial: Partial<Floor>): Floor[] {
    const floors = this._config.floors ?? [];
    // Patch the floor actually being shown. Fall back to the first floor when
    // `_activeFloorId` is stale (matching `_floor()`), so edits are never
    // silently dropped onto a non-existent floor id.
    const active = floors.find((f) => f.id === this._activeFloorId) ?? floors[0];
    return floors.map((f) => (active && f.id === active.id ? { ...f, ...partial } : f));
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

  /**
   * Resolved placement snap step. `snap` is tri-state in the config: unset
   * means "follow the grid" (the default behaviour), `0` is free placement,
   * any other number is a custom step. See {@link resolveSnap}.
   */
  private get _resolvedSnap(): number {
    return resolveSnap(this._config.snap, this.grid);
  }

  /** Which radio option the panel's "Snap to" control shows as active. */
  private get _snapMode(): "grid" | "off" | "custom" {
    const s = this._config.snap;
    if (s == null) return "grid";
    if (s === 0) return "off";
    return "custom";
  }

  private _setSnapMode(mode: "grid" | "off" | "custom"): void {
    if (mode === "grid") {
      this._patchConfig({ snap: undefined });
    } else if (mode === "off") {
      this._patchConfig({ snap: 0 });
    } else {
      // Keep an existing custom value; otherwise seed with the default percent
      // of the current grid (stored as an absolute step).
      const cur = this._config.snap;
      this._patchConfig({
        snap: cur && cur > 0 ? cur : gridPercentToSnap(DEFAULT_CUSTOM_PERCENT, this.grid),
      });
    }
  }

  /** Update the grid; rescale a custom snap so its percentage of the grid is preserved. */
  private _setGrid(newGrid: number): void {
    const patch: Partial<FloorplanCardConfig> = { grid: newGrid };
    if (this._snapMode === "custom") {
      const pct = snapToGridPercent(this._config.snap as number, this.grid);
      patch.snap = gridPercentToSnap(pct, newGrid);
    }
    this._patchConfig(patch);
  }

  private _snap(v: number): number {
    const s = this._resolvedSnap;
    return s > 0 ? Math.round(v / s) * s : v;
  }

  private _toVirtual(ev: PointerEvent, snap = true): { x: number; y: number } {
    const svgEl = this._svg!;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return snap ? { x: this._snap(pt.x), y: this._snap(pt.y) } : { x: pt.x, y: pt.y };
  }

  /** Nearest existing wall endpoint within ENDPOINT_SNAP, or null. */
  private _nearestCorner(rawX: number, rawY: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = ENDPOINT_SNAP;
    for (const w of this._floor().walls) {
      for (const e of [
        { x: w.x1, y: w.y1 },
        { x: w.x2, y: w.y2 },
      ]) {
        const d = Math.hypot(rawX - e.x, rawY - e.y);
        if (d < bestDist) {
          bestDist = d;
          best = { x: e.x, y: e.y };
        }
      }
    }
    return best;
  }

  /** Snap a raw point to a nearby existing wall endpoint, else to the snap step. */
  private _snapWallPoint(rawX: number, rawY: number): { x: number; y: number } {
    return this._nearestCorner(rawX, rawY) ?? { x: this._snap(rawX), y: this._snap(rawY) };
  }

  /**
   * Snap a wall's moving endpoint while drawing. Existing corners win (so rooms
   * close/continue); otherwise, unless free-draw is on, apply "gravity" toward
   * horizontal/vertical relative to the start point. The position itself snaps
   * to the configured snap step (which is the grid by default, or nothing when
   * Snap is Off) — "straighten" only governs the H/V alignment, not snapping.
   */
  private _snapWallEnd(
    x1: number,
    y1: number,
    rawX: number,
    rawY: number
  ): { x: number; y: number } {
    if (this._freeWalls) return { x: this._snap(rawX), y: this._snap(rawY) };
    const corner = this._nearestCorner(rawX, rawY);
    if (corner) return corner;
    const dx = rawX - x1;
    const dy = rawY - y1;
    const t = Math.tan((WALL_AXIS_SNAP_DEG * Math.PI) / 180);
    // Sticky: align flat to an axis when close; the free coordinate snaps to step.
    if (Math.abs(dy) <= Math.abs(dx) * t) return { x: this._snap(rawX), y: y1 }; // horizontal
    if (Math.abs(dx) <= Math.abs(dy) * t) return { x: x1, y: this._snap(rawY) }; // vertical
    return { x: this._snap(rawX), y: this._snap(rawY) };
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
    this._selection = [];
    this._emit(prev);
  }

  private _redo(): void {
    if (!this._future.length) return;
    this._history = [...this._history, structuredClone(this._config)];
    const next = this._future[0];
    this._future = this._future.slice(1);
    this._selection = [];
    this._emit(next);
  }

  // ---- selection ----------------------------------------------------------

  /** The element whose properties show in the panel (the most recent selection). */
  private _primary(): Sel | null {
    return this._selection[this._selection.length - 1] ?? null;
  }

  private _selectOne(sel: Sel): void {
    this._selection = [sel];
  }

  private _toggleSel(sel: Sel): void {
    this._selection = this._isSel(sel.kind, sel.id)
      ? this._selection.filter((s) => !(s.kind === sel.kind && s.id === sel.id))
      : [...this._selection, sel];
  }

  private _clearSel(): void {
    this._selection = [];
  }

  /** Pointer-driven selection: modifier toggles; plain click selects unless already in the set. */
  private _selectForPointer(ev: PointerEvent, sel: Sel): void {
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      this._toggleSel(sel);
      return;
    }
    if (!this._isSel(sel.kind, sel.id)) this._selectOne(sel);
  }

  private _idsOfKind(kind: SelKind): Set<string> {
    return new Set(this._selection.filter((s) => s.kind === kind).map((s) => s.id));
  }

  private _mergeSel(a: Sel[], b: Sel[]): Sel[] {
    const out = [...a];
    for (const s of b) if (!out.some((x) => x.kind === s.kind && x.id === s.id)) out.push(s);
    return out;
  }

  // ---- keyboard nudging ---------------------------------------------------

  private _handleKeyDown(ev: KeyboardEvent): void {
    // The listener is on `window` (capture phase) so HA's dialog can't swallow
    // arrow keys before we see them — the canvas itself isn't focusable. But
    // that also means a hidden/background editor instance would otherwise react,
    // so ignore the event unless this editor is actually visible.
    const checkVisibility = (this as { checkVisibility?: () => boolean }).checkVisibility;
    if (checkVisibility && !checkVisibility.call(this)) return;
    // Don't hijack keys while typing in a field / picker.
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

    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    if (mod && key === "c") {
      if (this._selection.length) {
        ev.preventDefault();
        this._copy();
      }
      return;
    }
    if (mod && key === "v") {
      if (this._clipboard) {
        ev.preventDefault();
        this._paste();
      }
      return;
    }
    if (mod && key === "d") {
      if (this._selection.length) {
        ev.preventDefault();
        this._duplicate();
      }
      return;
    }
    if ((ev.key === "Delete" || ev.key === "Backspace") && this._selection.length) {
      ev.preventDefault();
      this._deleteSelected();
      return;
    }

    if (!this._selection.length) return;
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const d = deltas[ev.key];
    if (!d) return;
    ev.preventDefault();
    // Default nudge is fine (snap step, or 1 unit when free); Shift jumps a grid cell.
    // Default nudge follows the resolved snap (= the grid when unset, or the
    // explicit custom step). Shift always jumps a full grid cell.
    const step = ev.shiftKey ? this.grid : this._resolvedSnap || 1;
    this._nudge(d[0] * step, d[1] * step);
  }

  private _nudge(dx: number, dy: number): void {
    if (!this._selection.length) return;
    const f = this._floor();
    const wIds = this._idsOfKind("wall");
    const oIds = this._idsOfKind("opening");
    const iIds = this._idsOfKind("item");
    const tIds = this._idsOfKind("text");
    const fIds = this._idsOfKind("furniture");
    const trIds = this._idsOfKind("tracker");
    this._commitFloor({
      walls: f.walls.map((w) =>
        wIds.has(w.id) ? { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy } : w
      ),
      openings: f.openings.map((o) => (oIds.has(o.id) ? { ...o, x: o.x + dx, y: o.y + dy } : o)),
      items: f.items.map((it) => (iIds.has(it.id) ? { ...it, x: it.x + dx, y: it.y + dy } : it)),
      texts: f.texts.map((t) => (tIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
      furniture: f.furniture.map((fu) =>
        fIds.has(fu.id) ? { ...fu, x: fu.x + dx, y: fu.y + dy } : fu
      ),
      trackers: (f.trackers ?? []).map((tr) =>
        trIds.has(tr.id) ? { ...tr, x: tr.x + dx, y: tr.y + dy } : tr
      ),
    });
  }

  // ---- canvas (SVG) pointer handling: drawing walls/openings -------------

  /**
   * Best-effort pointer capture. `setPointerCapture` throws NotFoundError when
   * the pointer id isn't active (synthetic events, or HA's dialog re-targeting
   * the pointer), which would abort the rest of the calling handler — we hit
   * exactly that with the tracker tool's drag-to-draw. Capture is an
   * enhancement (smooth dragging past the canvas edge), never a requirement,
   * so failures are safe to swallow.
   */
  private _capturePointer(ev: PointerEvent, target: Element | null = ev.target as Element): void {
    try {
      target?.setPointerCapture?.(ev.pointerId);
    } catch {
      /* pointer not active — drag still works, just without capture */
    }
  }

  /** Best-effort release; pointerup releases capture implicitly anyway. */
  private _releasePointer(ev: PointerEvent, target: Element | null = ev.target as Element): void {
    try {
      target?.releasePointerCapture?.(ev.pointerId);
    } catch {
      /* no active capture — already released by the implicit pointerup release */
    }
  }

  private _onCanvasDown(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const raw = this._toVirtual(ev, false);

    if (this._tool === "wall") {
      const s = this._freeWalls
        ? { x: this._snap(raw.x), y: this._snap(raw.y) }
        : this._snapWallPoint(raw.x, raw.y);
      this._draft = { x1: s.x, y1: s.y, x2: s.x, y2: s.y };
      this._capturePointer(ev);
      return;
    }
    if (this._tool === "door" || this._tool === "window") {
      this._addOpening(this._tool, this._snap(raw.x), this._snap(raw.y));
      return;
    }
    if (this._tool === "tracker") {
      const x = this._snap(raw.x);
      const y = this._snap(raw.y);
      this._draftTracker = { x0: x, y0: y, x1: x, y1: y };
      this._capturePointer(ev);
      return;
    }
    // Select tool, empty canvas: start a marquee (rubber-band) selection.
    this._marqueeAdd = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    this._marquee = { x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y };
    this._capturePointer(ev);
  }

  private _onCanvasMove(ev: PointerEvent): void {
    if (this._tool === "wall" && this._draft) {
      const raw = this._toVirtual(ev, false);
      const s = this._snapWallEnd(this._draft.x1, this._draft.y1, raw.x, raw.y);
      this._draft = { ...this._draft, x2: s.x, y2: s.y };
      return;
    }
    if (this._tool === "tracker" && this._draftTracker) {
      const raw = this._toVirtual(ev, false);
      this._draftTracker = {
        ...this._draftTracker,
        x1: this._snap(raw.x),
        y1: this._snap(raw.y),
      };
      return;
    }
    if (this._marquee) {
      const raw = this._toVirtual(ev, false);
      this._marquee = { ...this._marquee, x1: raw.x, y1: raw.y };
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
        this._commitFloor({ walls: [...this._floor().walls, wall] });
        this._selection = [{ kind: "wall", id: wall.id }];
      }
      return;
    }
    if (this._tool === "tracker" && this._draftTracker) {
      const d = this._draftTracker;
      this._draftTracker = null;
      this._releasePointer(ev);
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      // Reject zero-size drags (a stray click) so the tool doesn't litter the
      // canvas with invisible trackers.
      if (w >= this.grid / 2 && h >= this.grid / 2) {
        this._addTracker(x, y, w, h);
      }
      return;
    }
    if (this._marquee) {
      const m = this._marquee;
      this._marquee = null;
      this._releasePointer(ev);
      const moved = Math.hypot(m.x1 - m.x0, m.y1 - m.y0) > 4;
      if (!moved) {
        // A plain click on empty canvas clears the selection.
        if (!this._marqueeAdd) this._clearSel();
        return;
      }
      const hits = this._elementsInRect(m);
      this._selection = this._marqueeAdd ? this._mergeSel(this._selection, hits) : hits;
      return;
    }
    if (this._drag) {
      this._drag = null;
      this._releasePointer(ev);
    }
  }

  /** All active-floor elements whose center lies inside the marquee rect. */
  private _elementsInRect(m: Marquee): Sel[] {
    const minX = Math.min(m.x0, m.x1);
    const maxX = Math.max(m.x0, m.x1);
    const minY = Math.min(m.y0, m.y1);
    const maxY = Math.max(m.y0, m.y1);
    const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    const f = this._floor();
    const out: Sel[] = [];
    for (const w of f.walls)
      if (inside((w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)) out.push({ kind: "wall", id: w.id });
    for (const o of f.openings) if (inside(o.x, o.y)) out.push({ kind: "opening", id: o.id });
    for (const it of f.items) if (inside(it.x, it.y)) out.push({ kind: "item", id: it.id });
    for (const t of f.texts) if (inside(t.x, t.y)) out.push({ kind: "text", id: t.id });
    for (const fu of f.furniture) if (inside(fu.x, fu.y)) out.push({ kind: "furniture", id: fu.id });
    for (const tr of f.trackers ?? [])
      if (inside(tr.x + tr.w / 2, tr.y + tr.h / 2)) out.push({ kind: "tracker", id: tr.id });
    return out;
  }

  // ---- dragging existing elements ----------------------------------------

  private _startDrag(ev: PointerEvent, sel: Sel, endpoint?: 1 | 2): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    // Endpoint handles always operate on that single wall.
    if (endpoint) this._selectOne(sel);
    else this._selectForPointer(ev, sel);
    this._drag = {
      primary: sel,
      start: this._toVirtual(ev, false),
      orig: this._snapshotSelection(),
      endpoint,
    };
    this._pushHistory();
    this._capturePointer(ev);
  }

  /** Capture the start positions of every selected element on the active floor. */
  private _snapshotSelection(): Map<string, OrigPos> {
    const f = this._floor();
    const m = new Map<string, OrigPos>();
    for (const s of this._selection) {
      if (s.kind === "wall") {
        const w = f.walls.find((x) => x.id === s.id);
        if (w) m.set(`wall:${w.id}`, { kind: "wall", x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2 });
      } else if (s.kind === "opening") {
        const o = f.openings.find((x) => x.id === s.id);
        if (o) m.set(`opening:${o.id}`, { kind: "pt", x: o.x, y: o.y });
      } else if (s.kind === "item") {
        const it = f.items.find((x) => x.id === s.id);
        if (it) m.set(`item:${it.id}`, { kind: "pt", x: it.x, y: it.y });
      } else if (s.kind === "text") {
        const t = f.texts.find((x) => x.id === s.id);
        if (t) m.set(`text:${t.id}`, { kind: "pt", x: t.x, y: t.y });
      } else if (s.kind === "furniture") {
        const fu = f.furniture.find((x) => x.id === s.id);
        if (fu) m.set(`furniture:${fu.id}`, { kind: "pt", x: fu.x, y: fu.y });
      } else {
        // tracker — stored by top-left corner.
        const tr = (f.trackers ?? []).find((x) => x.id === s.id);
        if (tr) m.set(`tracker:${tr.id}`, { kind: "pt", x: tr.x, y: tr.y });
      }
    }
    return m;
  }

  private _applyDrag(ev: PointerEvent): void {
    const drag = this._drag!;
    const p = this._toVirtual(ev, false);
    const f = this._floor();

    // Single wall endpoint handle: snaps to nearby wall corners.
    if (drag.endpoint) {
      const target = this._snapWallPoint(p.x, p.y);
      const walls = f.walls.map((w) => {
        if (w.id !== drag.primary.id) return w;
        return drag.endpoint === 1
          ? { ...w, x1: target.x, y1: target.y }
          : { ...w, x2: target.x, y2: target.y };
      });
      this._emitFloor({ walls });
      return;
    }

    // Single opening: keep the wall-snapping (and angle alignment) behavior.
    if (this._selection.length === 1 && drag.primary.kind === "opening") {
      const orig = drag.orig.get(`opening:${drag.primary.id}`);
      if (orig && orig.kind === "pt") {
        const rawX = orig.x + (p.x - drag.start.x);
        const rawY = orig.y + (p.y - drag.start.y);
        const snap = snapToWall(rawX, rawY, f.walls, WALL_SNAP);
        const openings = f.openings.map((o) =>
          o.id === drag.primary.id
            ? snap
              ? { ...o, x: snap.x, y: snap.y, angle: snap.angle }
              : { ...o, x: this._snap(rawX), y: this._snap(rawY) }
            : o
        );
        this._emitFloor({ openings });
        return;
      }
    }

    // Everything else (single or group): translate all selected by a grid-snapped delta
    // derived from the primary element's reference point.
    const ref = drag.orig.get(`${drag.primary.kind}:${drag.primary.id}`);
    if (!ref) return;
    const refX = ref.kind === "wall" ? ref.x1 : ref.x;
    const refY = ref.kind === "wall" ? ref.y1 : ref.y;
    const dx = this._snap(refX + (p.x - drag.start.x)) - refX;
    const dy = this._snap(refY + (p.y - drag.start.y)) - refY;
    this._emitFloor(this._applyDelta(dx, dy, drag.orig));
  }

  /** Translate every snapshotted element by (dx, dy). */
  private _applyDelta(dx: number, dy: number, orig: Map<string, OrigPos>): Partial<Floor> {
    const f = this._floor();
    return {
      walls: f.walls.map((w) => {
        const o = orig.get(`wall:${w.id}`);
        return o && o.kind === "wall"
          ? { ...w, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
          : w;
      }),
      openings: f.openings.map((el) => {
        const o = orig.get(`opening:${el.id}`);
        return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
      }),
      items: f.items.map((el) => {
        const o = orig.get(`item:${el.id}`);
        return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
      }),
      texts: f.texts.map((el) => {
        const o = orig.get(`text:${el.id}`);
        return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
      }),
      furniture: f.furniture.map((el) => {
        const o = orig.get(`furniture:${el.id}`);
        return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
      }),
      trackers: (f.trackers ?? []).map((el) => {
        const o = orig.get(`tracker:${el.id}`);
        return o && o.kind === "pt" ? { ...el, x: o.x + dx, y: o.y + dy } : el;
      }),
    };
  }

  // ---- overlay drag for items & texts (HTML, not SVG) --------------------

  private _onOverlayDown(ev: PointerEvent, sel: OverlaySel): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    ev.preventDefault();
    this._selectForPointer(ev, sel);
    this._drag = {
      primary: sel,
      start: this._toVirtual(ev, false),
      orig: this._snapshotSelection(),
    };
    this._pushHistory();
    this._capturePointer(ev, ev.currentTarget as Element);
  }

  private _onOverlayMove(ev: PointerEvent): void {
    if (this._drag) this._applyDrag(ev);
  }

  private _onOverlayUp(ev: PointerEvent): void {
    if (this._drag) {
      this._drag = null;
      this._releasePointer(ev, ev.currentTarget as Element);
    }
  }

  // ---- element creation / mutation ---------------------------------------

  private _addOpening(type: OpeningType, x: number, y: number): void {
    const f = this._floor();
    const snap = snapToWall(x, y, f.walls, WALL_SNAP);
    const o: Opening = {
      id: uid(type),
      type,
      x: snap?.x ?? x,
      y: snap?.y ?? y,
      // User-editable from the door/window context bar so opening size can be
      // set BEFORE placing (the previous hardcoded 60 forced place-then-resize).
      length: this._defaultOpeningLength,
      angle: snap?.angle ?? 0,
    };
    this._commitFloor({ openings: [...f.openings, o] });
    this._selection = [{ kind: "opening", id: o.id }];
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
    this._commitFloor({ items: [...this._floor().items, it] });
    this._selection = [{ kind: "item", id: it.id }];
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
    this._commitFloor({ furniture: [...this._floor().furniture, f] });
    this._selection = [{ kind: "furniture", id: f.id }];
    this._tool = "select";
  }

  /**
   * Drop a new Tracker on the active floor sized to the user's drag and
   * select it so the per-element editor (entity pickers + sensor ranges) is
   * immediately reachable. Tool switches back to Select so the user can
   * configure / move the new tracker without re-dragging.
   */
  private _addTracker(x: number, y: number, w: number, h: number): void {
    const tr: Tracker = {
      id: uid("tracker"),
      x,
      y,
      w,
      h,
      angle: 0,
      dotSize: DEFAULT_TRACKER_DOT_SIZE,
    };
    this._commitFloor({ trackers: [...(this._floor().trackers ?? []), tr] });
    this._selection = [{ kind: "tracker", id: tr.id }];
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
    this._commitFloor({ texts: [...this._floor().texts, t] });
    this._selection = [{ kind: "text", id: t.id }];
    this._tool = "select";
  }

  private _deleteSelected(): void {
    if (!this._selection.length) return;
    const f = this._floor();
    const wIds = this._idsOfKind("wall");
    const oIds = this._idsOfKind("opening");
    const iIds = this._idsOfKind("item");
    const tIds = this._idsOfKind("text");
    const fIds = this._idsOfKind("furniture");
    const trIds = this._idsOfKind("tracker");
    this._commitFloor({
      walls: f.walls.filter((w) => !wIds.has(w.id)),
      openings: f.openings.filter((o) => !oIds.has(o.id)),
      items: f.items.filter((i) => !iIds.has(i.id)),
      texts: f.texts.filter((t) => !tIds.has(t.id)),
      furniture: f.furniture.filter((fu) => !fIds.has(fu.id)),
      trackers: (f.trackers ?? []).filter((tr) => !trIds.has(tr.id)),
    });
    this._clearSel();
  }

  // ---- clipboard (copy / paste / duplicate) ------------------------------

  private _copy(): void {
    if (!this._selection.length) return;
    const f = this._floor();
    const wIds = this._idsOfKind("wall");
    const oIds = this._idsOfKind("opening");
    const iIds = this._idsOfKind("item");
    const tIds = this._idsOfKind("text");
    const fIds = this._idsOfKind("furniture");
    const trIds = this._idsOfKind("tracker");
    this._clipboard = structuredClone({
      walls: f.walls.filter((w) => wIds.has(w.id)),
      openings: f.openings.filter((o) => oIds.has(o.id)),
      items: f.items.filter((it) => iIds.has(it.id)),
      texts: f.texts.filter((t) => tIds.has(t.id)),
      furniture: f.furniture.filter((fu) => fIds.has(fu.id)),
      trackers: (f.trackers ?? []).filter((tr) => trIds.has(tr.id)),
    });
  }

  /** Paste the clipboard onto the active floor, offset by one snap step, with fresh ids. */
  private _paste(): void {
    if (!this._clipboard) return;
    const cb = structuredClone(this._clipboard);
    // Offset by the resolved snap so paste lands on the same step as drag.
    // Fall back to the grid when snap is explicitly off (`0`) to avoid overlap.
    const off = this._resolvedSnap || this.grid;
    const f = this._floor();
    const newWalls: Wall[] = cb.walls.map((w) => ({
      ...w,
      id: uid("wall"),
      x1: w.x1 + off,
      y1: w.y1 + off,
      x2: w.x2 + off,
      y2: w.y2 + off,
    }));
    const newOpenings: Opening[] = cb.openings.map((o) => ({
      ...o,
      id: uid(o.type),
      x: o.x + off,
      y: o.y + off,
    }));
    const newItems: FloorItem[] = cb.items.map((it) => ({
      ...it,
      id: uid("item"),
      x: it.x + off,
      y: it.y + off,
    }));
    const newTexts: FloorText[] = cb.texts.map((t) => ({
      ...t,
      id: uid("text"),
      x: t.x + off,
      y: t.y + off,
    }));
    const newFurn: Furniture[] = cb.furniture.map((fu) => ({
      ...fu,
      id: uid("furn"),
      x: fu.x + off,
      y: fu.y + off,
    }));
    const newTrackers: Tracker[] = (cb.trackers ?? []).map((tr) => ({
      ...tr,
      id: uid("tracker"),
      x: tr.x + off,
      y: tr.y + off,
    }));
    this._commitFloor({
      walls: [...f.walls, ...newWalls],
      openings: [...f.openings, ...newOpenings],
      items: [...f.items, ...newItems],
      texts: [...f.texts, ...newTexts],
      furniture: [...f.furniture, ...newFurn],
      trackers: [...(f.trackers ?? []), ...newTrackers],
    });
    this._selection = [
      ...newWalls.map((w) => ({ kind: "wall" as const, id: w.id })),
      ...newOpenings.map((o) => ({ kind: "opening" as const, id: o.id })),
      ...newItems.map((it) => ({ kind: "item" as const, id: it.id })),
      ...newTexts.map((t) => ({ kind: "text" as const, id: t.id })),
      ...newFurn.map((fu) => ({ kind: "furniture" as const, id: fu.id })),
      ...newTrackers.map((tr) => ({ kind: "tracker" as const, id: tr.id })),
    ];
    this._tool = "select";
  }

  private _duplicate(): void {
    this._copy();
    this._paste();
  }

  // ---- floors -------------------------------------------------------------

  /** Add a floor that reuses the current floor's walls (fresh ids) and nothing else. */
  private _addFloor(): void {
    const walls = this._floor().walls.map((w) => ({ ...w, id: uid("wall") }));
    const n = (this._config.floors?.length ?? 1) + 1;
    const floor = makeFloor(`Floor ${n}`, walls);
    const floors = [...(this._config.floors ?? []), floor];
    // Make the new floor active *before* committing so that a synchronous
    // config-changed -> setConfig round-trip keeps the new floor selected.
    this._activeFloorId = floor.id;
    this._clearSel();
    this._commit({ ...this._config, floors });
  }

  private _switchFloor(id: string): void {
    if (id === this._activeFloorId) return;
    this._activeFloorId = id;
    this._clearSel();
  }

  private _renameFloor(id: string, name: string): void {
    this._commit({
      ...this._config,
      floors: (this._config.floors ?? []).map((f) => (f.id === id ? { ...f, name } : f)),
    });
  }

  private _deleteFloor(): void {
    const floors = this._config.floors ?? [];
    if (floors.length <= 1) return;
    const idx = floors.findIndex((f) => f.id === this._activeFloorId);
    const remaining = floors.filter((f) => f.id !== this._activeFloorId);
    this._commit({ ...this._config, floors: remaining });
    this._activeFloorId = remaining[Math.max(0, idx - 1)].id;
    this._clearSel();
  }

  private _updateOpening(id: string, partial: Partial<Opening>): void {
    this._commitFloor({
      openings: this._floor().openings.map((o) => (o.id === id ? { ...o, ...partial } : o)),
    });
  }

  private _updateItem(id: string, partial: Partial<FloorItem>): void {
    this._commitFloor({
      items: this._floor().items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
    });
  }

  private _updateText(id: string, partial: Partial<FloorText>): void {
    this._commitFloor({
      texts: this._floor().texts.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    });
  }

  private _updateFurniture(id: string, partial: Partial<Furniture>): void {
    this._commitFloor({
      furniture: this._floor().furniture.map((f) => (f.id === id ? { ...f, ...partial } : f)),
    });
  }

  private _updateTracker(id: string, partial: Partial<Tracker>): void {
    this._commitFloor({
      trackers: (this._floor().trackers ?? []).map((t) =>
        t.id === id ? { ...t, ...partial } : t
      ),
    });
  }

  /** Patch a single field on one of a tracker's sensor sub-objects (X / Y axis). */
  private _updateTrackerSensor(
    id: string,
    axis: "xSensor" | "ySensor",
    partial: Partial<TrackerSensor> | null,
  ): void {
    const tr = (this._floor().trackers ?? []).find((t) => t.id === id);
    if (!tr) return;
    if (partial === null) {
      this._updateTracker(id, { [axis]: undefined });
      return;
    }
    const cur = tr[axis] ?? { entity: "", min: 0, max: 5 };
    this._updateTracker(id, { [axis]: { ...cur, ...partial } });
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
    return this._selection.some((s) => s.kind === kind && s.id === id);
  }

  /**
   * The second toolbar row: shows controls and hints for whatever you're
   * currently doing — options for the active drawing tool, or actions for the
   * current selection. This keeps contextual controls (which come and go) out
   * of the always-present top row.
   */
  private _renderContextBar(): TemplateResult {
    const t = this._tool;
    let label: string;
    let body: TemplateResult;

    if (t === "wall") {
      label = "Wall";
      body = html`
        <button
          class=${this._freeWalls ? "" : "active"}
          aria-pressed=${!this._freeWalls}
          title="Snap walls to horizontal/vertical and existing corners (off = draw freely)"
          @click=${() => {
            this._freeWalls = !this._freeWalls;
          }}
        >
          straighten
        </button>
        <span class="ctx-hint">Drag to draw. Endpoints snap to nearby corners to close rooms.</span>
      `;
    } else if (t === "tracker") {
      label = "Tracker";
      body = html`
        <span class="ctx-hint"
          >Drag on the canvas to draw the tracked area; bind one or two
          distance sensors in the Element editor.</span
        >
      `;
    } else if (t === "door" || t === "window") {
      label = t === "door" ? "Door" : "Window";
      // Length input here so the user can size openings BEFORE placing them
      // (every new opening defaults to this; previously it was hardcoded).
      body = html`
        <label class="ctx-field">
          Length
          <input
            class="num"
            type="number"
            min="1"
            .value=${String(this._defaultOpeningLength)}
            title="Default length applied to the next ${t} you place"
            @change=${(e: Event) => {
              this._defaultOpeningLength = Math.max(
                1,
                Number((e.target as HTMLInputElement).value) || this._defaultOpeningLength
              );
            }}
          />
        </label>
        <span class="ctx-hint">Click on a wall to drop a ${t}; it snaps onto the wall.</span>
      `;
    } else {
      // Selection actions only — the full per-element editor renders BELOW the
      // canvas in its own area (so the context bar's height stays stable as
      // selections change, and the canvas doesn't jump up and down).
      label = "Select";
      const n = this._selection.length;
      if (n === 0) {
        body = html`<span class="ctx-hint"
          >Click an element to select it, or drag a box to select several.</span
        >`;
      } else {
        body = html`
          <span class="ctx-count">${n} selected</span>
          <button title="Duplicate the selection" @click=${this._duplicate}>⧉ duplicate</button>
          <button class="danger" title="Delete the selection" @click=${this._deleteSelected}>
            🗑 delete
          </button>
          ${n > 1
            ? html`<span class="ctx-hint">Edit elements one at a time.</span>`
            : nothing}
        `;
      }
    }

    return html`
      <div class="context-bar">
        <span class="ctx-label">${label}</span>
        ${body}
        <span class="ctx-divider"></span>
        ${this._renderSnapControl()}
      </div>
    `;
  }

  /**
   * Snap control rendered at the end of the context bar for every tool. The
   * setting governs placement / drag / wall drawing across all tools, so the
   * control needs to be reachable regardless of which tool is active.
   */
  private _renderSnapControl(): TemplateResult {
    const mode = this._snapMode;
    const customPercent = snapToGridPercent(this._config.snap as number, this.grid);
    const opts: { id: "grid" | "off" | "custom"; label: string }[] = [
      { id: "grid", label: "On" },
      { id: "off", label: "Off" },
      { id: "custom", label: "Custom" },
    ];
    const hint =
      mode === "grid"
        ? `Snapping to the ${this.grid}-unit grid.`
        : mode === "off"
          ? "No snapping — free placement."
          : `Snap = ${customPercent}% of grid (${this._resolvedSnap} units).`;
    return html`
      <span class="ctx-field-label">Snap</span>
      <div class="seg" role="group" aria-label="Snap mode">
        ${opts.map(
          (o) => html`
            <button
              class=${mode === o.id ? "active" : ""}
              aria-pressed=${mode === o.id}
              title=${o.id === "grid"
                ? "Snap to the grid"
                : o.id === "off"
                  ? "Free placement"
                  : "Custom step (% of grid)"}
              @click=${() => this._setSnapMode(o.id)}
            >
              ${o.label}
            </button>
          `
        )}
      </div>
      ${mode === "custom"
        ? html`<input
              class="num"
              type="number"
              min="1"
              step="5"
              .value=${String(customPercent)}
              title="Custom snap step, as a percentage of the grid"
              @change=${(e: Event) => {
                const pct = Math.max(
                  1,
                  Number((e.target as HTMLInputElement).value) || DEFAULT_CUSTOM_PERCENT
                );
                this._patchConfig({ snap: gridPercentToSnap(pct, this.grid) });
              }}
            /><span class="ctx-field-label">%</span>`
        : nothing}
      <span class="ctx-hint">${hint}</span>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) return html`${nothing}`;
    const c = this._config;
    const floor = this._floor();
    const floors = c.floors ?? [];
    return html`
      <div class="editor">
        <div class="toolbar">
          <!-- Tools — modes; exactly one is active at a time -->
          <div class="seg" role="group" aria-label="Tool">
            ${(["select", "wall", "door", "window", "tracker"] as Tool[]).map(
              (t) => html`
                <button
                  class=${this._tool === t ? "active" : ""}
                  aria-pressed=${this._tool === t}
                  @click=${() => {
                    this._tool = t;
                    this._draft = null;
                    this._draftTracker = null;
                  }}
                >
                  ${t}
                </button>`
            )}
          </div>

          <span class="divider"></span>

          <!-- Insert — one-shot: drops a new element on the active floor -->
          <div class="group" aria-label="Insert">
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
          </div>

          <span class="spacer"></span>

          <!-- History -->
          <div class="group">
            <button aria-label="Undo" title="Undo" ?disabled=${!this._history.length} @click=${this._undo}>
              ↶
            </button>
            <button aria-label="Redo" title="Redo" ?disabled=${!this._future.length} @click=${this._redo}>
              ↷
            </button>
          </div>

          <span class="divider"></span>

          <!-- Floor -->
          <span class="floors">
            <label>floor</label>
            <select @change=${(e: Event) => this._switchFloor((e.target as HTMLSelectElement).value)}>
              ${floors.map(
                (f) =>
                  html`<option value=${f.id} ?selected=${f.id === this._activeFloorId}>${f.name}</option>`
              )}
            </select>
            <input
              class="floor-name"
              type="text"
              title="Rename floor"
              .value=${floor?.name ?? ""}
              @change=${(e: Event) =>
                this._renameFloor(this._activeFloorId, (e.target as HTMLInputElement).value)}
            />
            <button title="Add a floor (copies the current walls)" @click=${this._addFloor}>+ floor</button>
            <button
              class="danger"
              title="Delete the current floor"
              ?disabled=${floors.length <= 1}
              @click=${this._deleteFloor}
            >
              − floor
            </button>
          </span>

          <span class="divider"></span>

          <!-- Zoom -->
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

        ${this._renderContextBar()}

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
              ${floor.image
                ? svg`<image href=${floor.image} x="0" y="0" width=${c.width} height=${c.height}
                            preserveAspectRatio="none" opacity=${floor.imageOpacity ?? 1} />`
                : nothing}
              ${this._renderGrid()}
              ${floor.furniture.map((f) => this._renderFurnitureSel(f))}
              ${renderWallMask(floor.openings, c.width, c.height, this._wallMaskId)}
              ${floor.walls.map((w) => this._renderWall(w))}
              ${floor.openings.map((o) => this._renderOpeningSel(o))}
              ${(floor.trackers ?? []).map((tr) => this._renderTrackerSel(tr))}
              ${
                this._draftTracker
                  ? svg`<rect class="tracker-draft"
                              x=${Math.min(this._draftTracker.x0, this._draftTracker.x1)}
                              y=${Math.min(this._draftTracker.y0, this._draftTracker.y1)}
                              width=${Math.abs(this._draftTracker.x1 - this._draftTracker.x0)}
                              height=${Math.abs(this._draftTracker.y1 - this._draftTracker.y0)}
                              rx="4" />`
                  : nothing
              }
              ${
                this._draft
                  ? svg`<line x1=${this._draft.x1} y1=${this._draft.y1}
                              x2=${this._draft.x2} y2=${this._draft.y2}
                              class="wall draft" mask=${`url(#${this._wallMaskId})`}
                              stroke-width=${WALL_THICKNESS} />`
                  : nothing
              }
              ${
                this._marquee
                  ? svg`<rect x=${Math.min(this._marquee.x0, this._marquee.x1)}
                              y=${Math.min(this._marquee.y0, this._marquee.y1)}
                              width=${Math.abs(this._marquee.x1 - this._marquee.x0)}
                              height=${Math.abs(this._marquee.y1 - this._marquee.y0)}
                              class="marquee" />`
                  : nothing
              }
            </svg>
            <div class="items">
              ${floor.texts.map((t) => this._renderTextOverlay(t, c))}
              ${floor.items.map((it) => this._renderItemOverlay(it, c))}
            </div>
          </div>
        </div>

        ${this._renderElementEdit()}
        ${this._renderPanel()}
      </div>
    `;
  }

  /**
   * Per-element editor area, rendered BELOW the canvas with a small title.
   * Kept separate from the project panel so users can tell the two apart, and
   * separate from the context bar so the bar's height stays stable across
   * selection changes (the canvas no longer jumps when you click around).
   */
  private _renderElementEdit(): TemplateResult {
    const n = this._selection.length;
    let body: TemplateResult;
    if (n === 0) {
      body = html`<p class="hint">Select an element on the canvas to edit its properties here.</p>`;
    } else if (n > 1) {
      body = html`<p class="hint">
        <b>${n} elements selected.</b> Edit them one at a time, or use the
        Duplicate/Delete buttons in the context bar above.
      </p>`;
    } else {
      body = this._renderSelectionEditor();
    }
    return html`
      <section class="edit-area">
        <h3 class="section-title">Element</h3>
        ${body}
      </section>
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
              mask=${`url(#${this._wallMaskId})`}
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
        ${renderOpening(o, {
          color: selected ? "var(--primary-color, #03a9f4)" : "var(--primary-text-color)",
          open: openingDefaultOpen(o),
        })}
      </g>`;
  }

  /**
   * Render a Tracker in the editor SVG with its zone outline visible (so the
   * user can grab/resize it) plus a hit overlay for drag-to-move and a dashed
   * selection rectangle when active.
   */
  private _renderTrackerSel(tr: Tracker): TemplateResult {
    const selected = this._isSel("tracker", tr.id);
    const xRead = trackerSensorReading(this.hass?.states, tr.xSensor?.entity);
    const yRead = trackerSensorReading(this.hass?.states, tr.ySensor?.entity);
    const xPres = trackerPresenceDetected(this.hass?.states, tr.xSensor?.presence);
    const yPres = trackerPresenceDetected(this.hass?.states, tr.ySensor?.presence);
    return svg`
      <g class="tracker-hit ${selected ? "selected" : ""}"
         @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "tracker", id: tr.id })}>
        ${renderTracker(tr, {
          editing: true,
          xReading: xRead,
          yReading: yRead,
          xPresent: xPres,
          yPresent: yPres,
        })}
        <rect x=${tr.x} y=${tr.y} width=${tr.w} height=${tr.h}
              transform="rotate(${tr.angle ?? 0} ${tr.x + tr.w / 2} ${tr.y + tr.h / 2})"
              class="tracker-hit-rect" />
        ${
          selected
            ? svg`<rect x=${tr.x - 4} y=${tr.y - 4}
                        width=${tr.w + 8} height=${tr.h + 8}
                        transform="rotate(${tr.angle ?? 0} ${tr.x + tr.w / 2} ${tr.y + tr.h / 2})"
                        class="tracker-outline" />`
            : nothing
        }
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
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "item", id: it.id })}
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
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "text", id: t.id })}
        @pointermove=${this._onOverlayMove}
        @pointerup=${this._onOverlayUp}
      >
        ${t.text || "…"}
      </div>
    `;
  }

  private _renderPanel(): TemplateResult {
    return html`
      <section class="panel">
        <h3 class="section-title">Project</h3>
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
            min="1"
            .value=${String(this._config.width)}
            @change=${(e: Event) =>
              this._patchConfig({
                width: Math.max(1, Number((e.target as HTMLInputElement).value) || DEFAULT_WIDTH),
              })}
          />
          <input
            type="number"
            min="1"
            .value=${String(this._config.height)}
            @change=${(e: Event) =>
              this._patchConfig({
                height: Math.max(1, Number((e.target as HTMLInputElement).value) || DEFAULT_HEIGHT),
              })}
          />
        </div>
        <div class="row">
          <label>Grid size</label>
          <input
            type="number"
            min="1"
            .value=${String(this.grid)}
            @change=${(e: Event) =>
              this._setGrid(Math.max(1, Number((e.target as HTMLInputElement).value) || DEFAULT_GRID))}
          />
          <span class="hint">
            Gap between grid lines, in canvas units (canvas is ${this._config.width}×${this._config
              .height}). Smaller = finer grid, more lines.
          </span>
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
        <div class="row">
          <label>Bg image</label>
          <input
            type="text"
            placeholder="/local/floorplan.png or URL"
            .value=${this._floor()?.image ?? ""}
            @change=${(e: Event) =>
              this._commitFloor({ image: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        ${this._floor()?.image
          ? html`<div class="row">
              <label>Image opacity</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                .value=${String(this._floor()?.imageOpacity ?? 1)}
                @input=${(e: Event) =>
                  this._commitFloor({
                    imageOpacity: Number((e.target as HTMLInputElement).value),
                  })}
              />
            </div>`
          : nothing}
      </section>
    `;
  }

  /**
   * Editor fields for the currently-selected element, rendered inline inside the
   * context bar so the user can configure the selection without scrolling away
   * from the canvas. Returns nothing when the selection isn't exactly one
   * element — multi-select and empty-select states are handled by the context
   * bar itself.
   */
  private _renderSelectionEditor(): TemplateResult {
    const sel = this._primary();
    if (!sel || this._selection.length !== 1) return html`${nothing}`;

    if (sel.kind === "opening") {
      const o = this._floor().openings.find((x) => x.id === sel.id);
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
          <label>Sensor</label>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${o.entity ?? ""}
            .includeDomains=${["binary_sensor", "cover"]}
            allow-custom-entity
            @value-changed=${(e: CustomEvent) =>
              this._updateOpening(o.id, { entity: (e.detail.value as string) || undefined })}
          ></ha-entity-picker>
        </div>
        ${o.entity
          ? html`<div class="row">
                <label>Invert</label>
                <input
                  type="checkbox"
                  .checked=${o.invert ?? false}
                  @change=${(e: Event) =>
                    this._updateOpening(o.id, {
                      invert: (e.target as HTMLInputElement).checked || undefined,
                    })}
                />
              </div>
              <div class="row">
                <label>Active color</label>
                <input
                  type="color"
                  .value=${o.activeColor ?? "#03a9f4"}
                  @input=${(e: Event) =>
                    this._updateOpening(o.id, { activeColor: (e.target as HTMLInputElement).value })}
                />
                <input
                  type="text"
                  placeholder="(primary)"
                  .value=${o.activeColor ?? ""}
                  @change=${(e: Event) =>
                    this._updateOpening(o.id, {
                      activeColor: (e.target as HTMLInputElement).value || undefined,
                    })}
                />
              </div>`
          : nothing}
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
      const it = this._floor().items.find((x) => x.id === sel.id);
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
          <label>2nd entity</label>
          <ha-entity-picker
            .hass=${this.hass}
            .value=${it.secondaryEntity ?? ""}
            allow-custom-entity
            @value-changed=${(e: CustomEvent) =>
              this._updateItem(it.id, {
                secondaryEntity: (e.detail.value as string) || undefined,
              })}
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
      const t = this._floor().texts.find((x) => x.id === sel.id);
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
      const f = this._floor().furniture.find((x) => x.id === sel.id);
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

    if (sel.kind === "tracker") {
      const tr = (this._floor().trackers ?? []).find((x) => x.id === sel.id);
      if (!tr) return html`${nothing}`;
      return html`
        ${this._renderTrackerSensorRows(tr, "xSensor", "X sensor")}
        ${this._renderTrackerSensorRows(tr, "ySensor", "Y sensor")}
        <div class="row">
          <label>Width / Height</label>
          <input
            class="num"
            type="number"
            min="10"
            .value=${String(tr.w)}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, {
                w: Math.max(10, Number((e.target as HTMLInputElement).value) || tr.w),
              })}
          />
          <input
            class="num"
            type="number"
            min="10"
            .value=${String(tr.h)}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, {
                h: Math.max(10, Number((e.target as HTMLInputElement).value) || tr.h),
              })}
          />
        </div>
        <div class="row">
          <label>Position</label>
          <input
            class="num"
            type="number"
            .value=${String(Math.round(tr.x))}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, { x: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            .value=${String(Math.round(tr.y))}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, { y: Number((e.target as HTMLInputElement).value) })}
          />
        </div>
        <div class="row">
          <label>Angle</label>
          <input
            type="range"
            min="0"
            max="360"
            .value=${String(tr.angle ?? 0)}
            @input=${(e: Event) =>
              this._updateTracker(tr.id, { angle: Number((e.target as HTMLInputElement).value) })}
          />
          <input
            class="num"
            type="number"
            min="0"
            max="360"
            .value=${String(Math.round(tr.angle ?? 0))}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, {
                angle: ((Number((e.target as HTMLInputElement).value) % 360) + 360) % 360,
              })}
          />
        </div>
        <div class="row">
          <label>Color</label>
          <input
            type="color"
            .value=${tr.color ?? "#03a9f4"}
            @input=${(e: Event) =>
              this._updateTracker(tr.id, { color: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="(primary)"
            .value=${tr.color ?? ""}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, {
                color: (e.target as HTMLInputElement).value || undefined,
              })}
          />
        </div>
        <div class="row">
          <label>Dot size</label>
          <input
            type="range"
            min="6"
            max="40"
            step="1"
            .value=${String(tr.dotSize ?? DEFAULT_TRACKER_DOT_SIZE)}
            @input=${(e: Event) =>
              this._updateTracker(tr.id, {
                dotSize: Number((e.target as HTMLInputElement).value),
              })}
          />
          <input
            class="num"
            type="number"
            min="6"
            max="80"
            .value=${String(tr.dotSize ?? DEFAULT_TRACKER_DOT_SIZE)}
            @change=${(e: Event) =>
              this._updateTracker(tr.id, {
                dotSize:
                  Number((e.target as HTMLInputElement).value) || DEFAULT_TRACKER_DOT_SIZE,
              })}
          />
        </div>
      `;
    }

    // sel.kind === "wall" (or unknown) — no inline editor today; the user can
    // drag the wall or its endpoint handles directly on the canvas.
    return html`<span class="ctx-hint"
      >Drag the line to move it, or the round handles to move an endpoint.</span
    >`;
  }

  /**
   * Editor rows for one of a tracker's two sensor mappings (X or Y). Entity
   * picker is always shown; min / max / invert appear once a sensor entity is
   * set so the panel stays compact while empty.
   */
  private _renderTrackerSensorRows(
    tr: Tracker,
    axis: "xSensor" | "ySensor",
    label: string,
  ): TemplateResult {
    const s = tr[axis];
    return html`
      <div class="row">
        <label>${label}</label>
        <ha-entity-picker
          .hass=${this.hass}
          .value=${s?.entity ?? ""}
          .includeDomains=${["sensor", "input_number", "number"]}
          allow-custom-entity
          @value-changed=${(e: CustomEvent) => {
            const v = (e.detail.value as string) || "";
            if (!v) this._updateTrackerSensor(tr.id, axis, null);
            else this._updateTrackerSensor(tr.id, axis, { entity: v });
          }}
        ></ha-entity-picker>
      </div>
      ${s
        ? html`<div class="row">
            <label>${label} range</label>
            <input
              class="num"
              type="number"
              step="0.01"
              title="Reading at the near edge"
              .value=${String(s.min)}
              @change=${(e: Event) =>
                this._updateTrackerSensor(tr.id, axis, {
                  min: Number((e.target as HTMLInputElement).value),
                })}
            />
            <input
              class="num"
              type="number"
              step="0.01"
              title="Reading at the far edge"
              .value=${String(s.max)}
              @change=${(e: Event) =>
                this._updateTrackerSensor(tr.id, axis, {
                  max: Number((e.target as HTMLInputElement).value),
                })}
            />
            <label class="inline-check">
              <input
                type="checkbox"
                .checked=${s.invert ?? false}
                @change=${(e: Event) =>
                  this._updateTrackerSensor(tr.id, axis, {
                    invert: (e.target as HTMLInputElement).checked || undefined,
                  })}
              />
              invert
            </label>
          </div>
          <div class="row">
            <label>${label} presence</label>
            <ha-entity-picker
              .hass=${this.hass}
              .value=${s.presence?.entity ?? ""}
              .includeDomains=${["binary_sensor", "input_boolean", "device_tracker"]}
              allow-custom-entity
              @value-changed=${(e: CustomEvent) => {
                const v = (e.detail.value as string) || "";
                this._updateTrackerSensor(tr.id, axis, {
                  presence: v ? { entity: v, invert: s.presence?.invert } : undefined,
                });
              }}
            ></ha-entity-picker>
            ${s.presence
              ? html`<label class="inline-check" title="Treat 'off' as detected">
                  <input
                    type="checkbox"
                    .checked=${s.presence.invert ?? false}
                    @change=${(e: Event) =>
                      this._updateTrackerSensor(tr.id, axis, {
                        presence: {
                          entity: s.presence!.entity,
                          invert: (e.target as HTMLInputElement).checked || undefined,
                        },
                      })}
                  />
                  invert
                </label>`
              : nothing}
          </div>`
        : nothing}
    `;
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
    /* generic inline cluster of related controls */
    .group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    /* vertical rule between toolbar groups */
    .divider {
      align-self: stretch;
      width: 1px;
      min-height: 26px;
      margin: 0 4px;
      background: var(--divider-color, #e0e0e0);
    }
    /* tools rendered as a connected segmented control (one active) */
    .seg {
      display: inline-flex;
    }
    .seg button {
      border-radius: 0;
      border-left-width: 0;
    }
    .seg button:first-child {
      border-left-width: 1px;
      border-top-left-radius: 6px;
      border-bottom-left-radius: 6px;
    }
    .seg button:last-child {
      border-top-right-radius: 6px;
      border-bottom-right-radius: 6px;
    }
    /* contextual second row: options/actions for the current tool or selection */
    .context-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 6px;
      padding: 5px 10px;
      min-height: 36px;
      box-sizing: border-box;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
      background: var(--secondary-background-color, #f5f5f5);
    }
    .context-bar .ctx-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--primary-color, #03a9f4);
      padding-right: 8px;
      margin-right: 2px;
      border-right: 1px solid var(--divider-color, #e0e0e0);
    }
    .context-bar .ctx-hint {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .context-bar .ctx-count {
      font-size: 12px;
      color: var(--primary-text-color);
    }
    .context-bar button {
      padding: 4px 10px;
      font-size: 13px;
    }
    /* A label + input pair inline in the context bar (e.g. default Length for
       the Door/Window tools). The <label> wraps both so clicking the text
       focuses the input. */
    .context-bar .ctx-field {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .context-bar .ctx-field input.num {
      width: 60px;
    }
    /* Inline label for a control rendered loose in the context bar (e.g. the
       "Snap" word next to the segmented control). */
    .context-bar .ctx-field-label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .context-bar input.num {
      width: 60px;
    }
    /* Thin vertical rule separating the tool-specific contents from the
       always-on Snap control on the right side of the context bar. */
    .ctx-divider {
      flex: 0 0 1px;
      align-self: stretch;
      min-height: 22px;
      margin: 0 4px;
      background: var(--divider-color, #e0e0e0);
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
      /* Size to the canvas's own aspect ratio rather than forcing a fixed
         viewport-relative height. This avoids the empty band above and below
         the grid that used to appear with the default 1000×600 canvas, and
         leaves room for the Element / Project sections below. The user can
         still drag-resize via the corner handle (resize: both). */
      min-height: 200px;
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
    svg.window,
    svg.tracker {
      cursor: crosshair;
    }
    .grid {
      /* Theme text colour at low opacity so the grid stays visible over a
         background image (and on both light and dark themes); non-scaling-stroke
         keeps the lines a crisp ~1px at any canvas size / zoom. Editor-only —
         the live card never draws a grid. */
      stroke: var(--primary-text-color, #212121);
      stroke-opacity: 0.25;
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
      /* Purely decorative — must never intercept pointers, or a press that lands
         on a grid line would capture the pointer there and break wall drawing. */
      pointer-events: none;
    }
    /* Scoped to <line> so the rule doesn't accidentally match the <svg>,
       which carries the active-tool class (e.g. "wall") on the canvas. A
       bare ".wall" selector matched the SVG too, and because pointer-events
       is inherited in SVG, setting it to none disabled the entire canvas
       — so no pointerdown reached the wall-draw handler. */
    line.wall {
      stroke: var(--primary-text-color);
      /* The wide transparent .wall-hit line beneath handles selection/drag.
         Without this, the visible line (painted on top) swallows clicks on the
         wall body, so you could only grab it just *outside* the body. */
      pointer-events: none;
    }
    line.wall.selected {
      stroke: var(--primary-color, #03a9f4);
    }
    line.wall.draft {
      opacity: 0.5;
      pointer-events: none;
    }
    .fp-door-leaf,
    .fp-leaf-r {
      transform-box: fill-box;
      transition: transform 0.5s ease;
    }
    .fp-door-leaf {
      transform-origin: left center;
    }
    .fp-leaf-r {
      transform-origin: right center;
    }
    .fp-door-leaf rect,
    .fp-leaf-r rect {
      transition: fill 0.5s ease;
    }
    .fp-door-arc {
      transition: stroke-dashoffset 0.5s ease, stroke 0.5s ease;
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
    .floors {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .floors label {
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .floors select,
    .floors .floor-name {
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      border-radius: 6px;
      padding: 6px 8px;
    }
    .floors .floor-name {
      width: 90px;
    }
    .marquee {
      fill: var(--primary-color, #03a9f4);
      fill-opacity: 0.1;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1;
      stroke-dasharray: 4 3;
      pointer-events: none;
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
    /* === Tracker (editor + card share the same animation classes). The zone
       outline is editor-only and added by renderTracker when editing:true; in
       the live card only the marker / line shows. Movement transitions are
       applied to the marker group's transform so the dot/triangle glides
       between sensor updates rather than jumping. === */
    /* Scoped to <g> so the rule doesn't also match the <svg>, which carries
       the active-tool class (e.g. "tracker") for cursor styling. A bare
       ".tracker" matched the SVG too, and pointer-events is inherited in
       SVG — so toggling the tracker tool silently killed every pointerdown
       on the canvas, breaking drag-to-draw. Same trap as line.wall above. */
    g.tracker {
      pointer-events: none;
    }
    .tracker-zone {
      transition: opacity 0.2s ease;
    }
    /* Dim the zone when a configured presence sensor reports "clear" so the
       editor visibly confirms the marker is being gated off — without this,
       a user toggling the mock presence sensor would just see the triangle
       vanish with no other feedback. */
    .tracker-zone.presence-gated {
      opacity: 0.35;
    }
    .tracker-hit {
      cursor: move;
    }
    .tracker-hit-rect {
      /* Transparent fill turns the entire zone into a pointer target for drag,
         without obscuring the dashed outline drawn by the renderer. */
      fill: transparent;
      pointer-events: all;
    }
    .tracker-outline {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .tracker-draft {
      fill: var(--primary-color, #03a9f4);
      fill-opacity: 0.08;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.5;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .tracker-marker {
      transition: transform 0.4s ease-out;
      transform-box: fill-box;
    }
    .tracker-dot {
      animation: fp-tracker-pulse 1.4s ease-in-out infinite;
      transform-box: fill-box;
      transform-origin: center;
    }
    .tracker-ring {
      animation: fp-tracker-ring 2.2s ease-out infinite;
      opacity: 0;
    }
    .tracker-line {
      transition: transform 0.4s ease-out;
    }
    .tracker-line-stroke {
      opacity: 0.45;
      animation: fp-tracker-pulse 1.6s ease-in-out infinite;
    }
    .tracker-band {
      opacity: 0;
      animation: fp-tracker-band 2.2s ease-out infinite;
    }
    .tracker-placeholder {
      opacity: 0.6;
    }
    @keyframes fp-tracker-pulse {
      0%,
      100% {
        transform: scale(0.9);
        opacity: 0.7;
      }
      50% {
        transform: scale(1.1);
        opacity: 1;
      }
    }
    @keyframes fp-tracker-ring {
      0% {
        r: 0;
        opacity: 0.7;
      }
      100% {
        r: var(--fp-tracker-ring-max, 60px);
        opacity: 0;
      }
    }
    @keyframes fp-tracker-band {
      0% {
        opacity: 0.5;
        stroke-width: 1.5;
      }
      100% {
        opacity: 0;
        stroke-width: 14;
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
    /* The panel ("Project" config) and the new element-edit area share the
       same boxed look so the two sections below the canvas read as siblings. */
    .panel,
    .edit-area {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      padding: 10px;
    }
    .section-title {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--secondary-text-color);
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
    /* Compact inline checkbox+label used inside a .row that already has its
       primary <label> on the left (e.g. the Tracker sensor "invert" toggle). */
    .row .inline-check {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color);
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
