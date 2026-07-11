import { LitElement, html, css, svg, nothing, type TemplateResult, type PropertyValues } from "lit";
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
  SectionalHand,
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
  configsEqual,
  emptyConfig,
  getFloors,
  gridPercentToSnap,
  makeFloor,
  haFloorsOf,
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
  openingMotion,
  sliderStyleOf,
  openingFromDeviceClass,
  renderRipple,
  renderFurniture,
  renderTracker,
  trackerSensorReading,
  defaultIcon,
  kindFromEntity,
  resolveItemIcon,
  snapToWall,
  collectWatchedEntities,
  hassRenderInputsChanged,
} from "./render";
import {
  ENDPOINT_SNAP,
  applyDelta,
  elementsInRect,
  nearestCorner,
  snapWallEnd,
  type OrigPos,
  type Rect,
  type Sel,
  type SelKind,
} from "./editor-geometry";

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
  "sectional",
  "washer",
  "dryer",
  "dishwasher",
  "bathtub",
  "vanity",
  "waterHeater",
  "airHandler",
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
  sectional: "sectional (L)",
  washer: "washer",
  dryer: "dryer",
  dishwasher: "dishwasher",
  bathtub: "bathtub",
  vanity: "vanity",
  waterHeater: "water heater",
  airHandler: "air handler",
};

type Tool = "select" | "wall" | "door" | "window" | "tracker";
type OverlaySel = { kind: "item" | "text"; id: string };

/** Toolbar metadata per tool: mdi icon + label (icons make the modes scannable). */
const TOOL_META: Record<Tool, { icon: string; label: string }> = {
  select: { icon: "mdi:cursor-default", label: "Select" },
  wall: { icon: "mdi:wall", label: "Wall" },
  door: { icon: "mdi:door", label: "Door" },
  window: { icon: "mdi:window-closed-variant", label: "Window" },
  tracker: { icon: "mdi:crosshairs-gps", label: "Tracker" },
};

/** Icon shown in the Element header per selected element kind. */
const SEL_KIND_ICON: Record<SelKind, string> = {
  wall: "mdi:wall",
  opening: "mdi:door",
  item: "mdi:lightbulb-outline",
  text: "mdi:format-text",
  furniture: "mdi:sofa-outline",
  tracker: "mdi:crosshairs-gps",
};

interface Drag {
  /** The element under the pointer (drives snapping); the whole selection moves with it. */
  primary: Sel;
  /** Pointer position (unsnapped, virtual coords) when the drag started. */
  start: { x: number; y: number };
  /** Original positions of every selected element, keyed `${kind}:${id}`. */
  orig: Map<string, OrigPos>;
  /** Set when dragging a single wall endpoint handle. */
  endpoint?: 1 | 2;
  /** Set once the drag actually moved something (history snapshots lazily). */
  moved?: boolean;
  /** The exact history entry this drag pushed, so cancel can remove it by identity. */
  snapshot?: FloorplanCardConfig;
  /** The redo stack as it stood before the drag's history push cleared it. */
  priorFuture?: FloorplanCardConfig[];
}

type Marquee = Rect;

/** Elements copied to the in-memory clipboard (not part of the config). */
interface Clipboard {
  walls: Wall[];
  openings: Opening[];
  items: FloorItem[];
  texts: FloorText[];
  furniture: Furniture[];
  trackers: Tracker[];
}

/** Snap distance (virtual units) for openings onto walls. */
const WALL_SNAP = 35;
const HISTORY_MAX = 60;
/** Angle (degrees) within which a drawn wall is snapped flat to horizontal/vertical. */
const WALL_AXIS_SNAP_DEG = 10;

/**
 * True when the event's composed path sits in a form field / picker — keys
 * typed there belong to the field, not the canvas.
 */
function isTypingPath(path: EventTarget[]): boolean {
  return path.some((el) => {
    const node = el as HTMLElement;
    const tag = node.tagName?.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "ha-entity-picker" ||
      tag === "ha-icon-picker" ||
      node.isContentEditable === true
    );
  });
}

@customElement("easy-floorplan-card-editor")
export class FloorplanCardEditor extends LitElement {
  private static _nextWallMaskId = 0;
  /** Unique mask id so multiple editor instances don't collide. */
  private readonly _wallMaskId = `fp-edit-wall-mask-${FloorplanCardEditor._nextWallMaskId++}`;

  @property({ attribute: false }) public hass?: HomeAssistant;
  /** Entity ids this plan displays; used to skip irrelevant hass updates. */
  private _watchedEntities: Set<string> = new Set();
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
  /** Floor gear popover (rename / delete floor) visibility. */
  @state() private _floorMenuOpen = false;
  /** "+ Add" popover (device / text / furniture glyphs) visibility. */
  @state() private _addMenuOpen = false;
  /** Project section expanded? Collapsed by default — page settings are touched rarely. */
  @state() private _projectOpen = false;
  /**
   * Expanded (fullscreen) editing. HA renders the card config editor in a
   * narrow dialog (~480–560px), which is cramped for a visual canvas editor.
   * When true the `.editor` root is promoted to the top layer so the canvas
   * gets real room and the element/project sections dock beside it.
   */
  @state() private _fullscreen = false;

  @query(".editor") private _editorEl?: HTMLElement;
  @query("svg") private _svg?: SVGSVGElement;
  @query(".canvas-wrap") private _canvasWrap?: HTMLElement;

  private _drag: Drag | null = null;
  /** Pointer driving the current gesture; others are ignored while it's active. */
  private _gesturePointer: number | null = null;
  /** True when the active marquee should add to (rather than replace) the selection. */
  private _marqueeAdd = false;
  private _clipboard: Clipboard | null = null;
  private _onKeyDown = (ev: KeyboardEvent) => this._handleKeyDown(ev);
  private _onHostKeyDown = (ev: KeyboardEvent) => {
    // Bubble-phase backstop for Escape typed in a form field while fullscreen.
    // The capture listener above lets those through so an open picker/select
    // overlay can close itself and absorb the key; one that bubbles this far
    // was declined by every overlay, and the host sits below HA's dialog in
    // the bubble path — contain it here or the dialog closes underneath the
    // top-layer workspace (and a dirty config pops an invisible confirm
    // behind it). Park focus on the canvas (not a bare blur, which would
    // strand focus on `body`) so the next Escape runs the normal cascade.
    if (ev.key !== "Escape" || !this._fullscreen) return;
    if (!isTypingPath(ev.composedPath())) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._canvasWrap?.focus();
  };
  private _onFocusIn = (ev: FocusEvent) => {
    // While the fullscreen popover is up, anything that pulls focus outside the
    // editor (Tab past the last control, a dialog opening above) lands on UI
    // hidden behind the top layer. Collapse instead of leaving the user blind.
    if (this._fullscreen && !ev.composedPath().includes(this)) this._fullscreen = false;
  };

  public connectedCallback(): void {
    super.connectedCallback();
    // Capture phase so HA's dialog can't swallow the arrow keys before we see them.
    window.addEventListener("keydown", this._onKeyDown, true);
    // Bubble phase on the host: fires only after the editor's own form
    // overlays had their chance to absorb the key (see _onHostKeyDown).
    this.addEventListener("keydown", this._onHostKeyDown);
    window.addEventListener("focusin", this._onFocusIn);
  }

  public disconnectedCallback(): void {
    window.removeEventListener("keydown", this._onKeyDown, true);
    this.removeEventListener("keydown", this._onHostKeyDown);
    window.removeEventListener("focusin", this._onFocusIn);
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
    // A setConfig that isn't the echo of our own emission is an external change
    // (YAML-tab edit, a different card loaded into the dialog): stale undo/redo
    // snapshots would silently revert it, so drop them.
    if (this._lastEmitted && config !== this._lastEmitted && !configsEqual(config, this._lastEmitted)) {
      this._history = [];
      this._future = [];
      this._liveEditKey = null;
    }
    this._watchedEntities = collectWatchedEntities(this._config);
  }

  /**
   * HA replaces `hass` on every state change in the instance; the editor's
   * render is expensive (full SVG + panels). Skip ticks that can't change
   * anything we draw. Entity pickers keep the `hass` they last rendered with —
   * acceptable, the registry data they browse changes rarely.
   */
  protected shouldUpdate(changed: PropertyValues): boolean {
    if (!(changed.size === 1 && changed.has("hass"))) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    if (!prev || !this.hass) return true;
    // The HA-floor link select reads the floor registry.
    const floorsOf = (h: HomeAssistant) => (h as { floors?: unknown }).floors;
    if (floorsOf(prev) !== floorsOf(this.hass)) return true;
    return hassRenderInputsChanged(prev, this.hass, this._watchedEntities);
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
    // Upgrade the plain-input fallbacks in place whenever a picker element
    // gets defined later (by us or by another editor the user opened).
    for (const tag of ["ha-entity-picker", "ha-icon-picker"]) {
      if (!customElements.get(tag)) {
        void customElements.whenDefined(tag).then(() => this.requestUpdate());
      }
    }
  }

  /**
   * Promote the expanded editor into the top layer. `position: fixed` alone is
   * not enough: HA's edit dialog puts a `transform` on its surface to offset
   * the safe areas, and any transform makes that surface the containing block
   * for fixed descendants — so a "full-viewport" overlay would fill the narrow
   * dialog instead. A popover escapes it. Collapsing drops the attribute, which
   * hides the popover on its own. Browsers without the API keep the fixed
   * fallback, which is already correct on the mobile dialog (transform: none).
   */
  protected updated(): void {
    // Re-asserted on every render while fullscreen (not just the transition):
    // idempotent via :popover-open, and it self-heals if the browser
    // force-hid the popover, e.g. across a disconnect/reconnect.
    if (!this._fullscreen) return;
    const el = this._editorEl;
    if (!el?.isConnected || typeof el.showPopover !== "function") return;
    if (!el.matches(":popover-open")) {
      try {
        el.showPopover();
      } catch {
        // Top layer unavailable — the fixed-position styles still apply.
      }
    }
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
    return nearestCorner(this._floor().walls, rawX, rawY, ENDPOINT_SNAP);
  }

  /** Snap a raw point to a nearby existing wall endpoint, else to the snap step. */
  private _snapWallPoint(rawX: number, rawY: number): { x: number; y: number } {
    return this._nearestCorner(rawX, rawY) ?? { x: this._snap(rawX), y: this._snap(rawY) };
  }

  /** See {@link snapWallEnd}: corners win, then axis gravity, then the snap step. */
  private _snapWallEnd(
    x1: number,
    y1: number,
    rawX: number,
    rawY: number
  ): { x: number; y: number } {
    return snapWallEnd(
      this._floor().walls,
      x1,
      y1,
      rawX,
      rawY,
      (v) => this._snap(v),
      this._freeWalls,
      WALL_AXIS_SNAP_DEG,
      ENDPOINT_SNAP
    );
  }

  // ---- config mutation + history ----------------------------------------

  /** The config most recently dispatched, to recognize HA's setConfig echo. */
  private _lastEmitted?: FloorplanCardConfig;

  private _emit(config: FloorplanCardConfig): void {
    this._config = config;
    // Recompute here, not just in setConfig: real HA deep-equal-skips the
    // setConfig echo of our own emission, so entities bound during the
    // session would otherwise never enter the watched set.
    this._watchedEntities = collectWatchedEntities(config);
    // Emit without the legacy flat arrays: `floors` is the source of truth,
    // and empty stubs would otherwise be persisted into the user's YAML.
    const out = { ...config };
    for (const key of ["walls", "openings", "items", "texts", "furniture", "trackers"] as const) {
      if (!out[key]?.length) delete out[key];
    }
    this._lastEmitted = out;
    this.dispatchEvent(
      new CustomEvent("config-changed", { detail: { config: out }, bubbles: true, composed: true })
    );
  }

  /** Key of the in-progress live-edit burst (one history snapshot per burst). */
  private _liveEditKey: string | null = null;

  private _pushHistory(burstKey: string | null = null): void {
    this._history = [...this._history, structuredClone(this._config)].slice(-HISTORY_MAX);
    this._future = [];
    this._liveEditKey = burstKey;
  }

  /** Discrete change: snapshot for undo, then emit. */
  private _commit(config: FloorplanCardConfig): void {
    this._pushHistory();
    this._emit(config);
  }

  private _undo(): void {
    this._liveEditKey = null;
    if (!this._history.length) return;
    this._future = [structuredClone(this._config), ...this._future];
    const prev = this._history[this._history.length - 1];
    this._history = this._history.slice(0, -1);
    this._selection = [];
    this._emit(prev);
  }

  private _redo(): void {
    this._liveEditKey = null;
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
    // Selection changes end any live-edit burst: re-selecting the same
    // element later must start a new undo step, not extend the old one.
    this._liveEditKey = null;
  }

  private _toggleSel(sel: Sel): void {
    this._selection = this._isSel(sel.kind, sel.id)
      ? this._selection.filter((s) => !(s.kind === sel.kind && s.id === sel.id))
      : [...this._selection, sel];
    this._liveEditKey = null;
  }

  private _clearSel(): void {
    this._selection = [];
    this._liveEditKey = null;
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
    const path = ev.composedPath();
    // Only react while the user is actually working in the editor — the event
    // must originate inside it (the canvas is focusable, so canvas work counts).
    // A window-level listener sees every key on the page; without this, keys
    // leak in from HA UI stacked above (more-info dialog, quick-bar). The
    // deliberate cost: shortcuts are dead until the first click inside the
    // editor after the dialog opens.
    if (!path.includes(this)) {
      // While fullscreen the workspace owns the screen: an Escape that fires
      // from `body` (focus dropped after a blur or a dead-space click) must
      // collapse it rather than reach — and close — HA's dialog hidden
      // underneath. A dialog stacked above us is unaffected: it takes focus,
      // and the focusin guard has already collapsed fullscreen by then.
      if (this._fullscreen && ev.key === "Escape") {
        ev.preventDefault();
        ev.stopPropagation();
        this._fullscreen = false;
      }
      return;
    }
    // Don't hijack keys while typing in a field / picker. Escape is not
    // swallowed here even in fullscreen: HA's pickers hold focus while their
    // dropdown is open and close it on their own Escape (absorbing the
    // event), so a capture-phase swallow starves them and leaves an orphaned
    // dropdown that focus can't escape. Escapes no overlay absorbs are
    // contained by the bubble-phase host listener (_onHostKeyDown) before
    // they can reach — and close — HA's dialog.
    if (isTypingPath(path)) return;

    const mod = ev.ctrlKey || ev.metaKey;
    const key = ev.key.toLowerCase();
    // While a gesture is live, any keyboard mutation (paste, delete, nudge,
    // undo…) would interleave with the drag's emits and history snapshot —
    // ignore them all; Escape below still cancels the gesture itself.
    const gestureActive = !!(this._drag || this._draft || this._draftTracker || this._marquee);
    if (gestureActive && ev.key !== "Escape" && !(mod && key === "c")) return;
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
    // Undo / redo — the toolbar buttons exist, but the keyboard is what
    // everyone reaches for first. Ctrl/Cmd+Z, Shift for redo, plus Ctrl+Y.
    if (mod && key === "z") {
      ev.preventDefault();
      if (ev.shiftKey) this._redo();
      else this._undo();
      return;
    }
    if (mod && key === "y") {
      ev.preventDefault();
      this._redo();
      return;
    }
    if (ev.key === "Escape") {
      // Close an open popover first, then cancel an in-progress draft /
      // marquee, then clear the selection. Only swallow the key when it
      // actually did something, so HA's dialog still closes on Escape when
      // there's nothing to cancel.
      if (this._floorMenuOpen || this._addMenuOpen) {
        ev.preventDefault();
        ev.stopPropagation();
        this._floorMenuOpen = false;
        this._addMenuOpen = false;
        return;
      }
      if (this._draft || this._draftTracker || this._marquee || this._drag) {
        ev.preventDefault();
        ev.stopPropagation();
        this._cancelGesture();
      } else if (this._selection.length) {
        ev.preventDefault();
        ev.stopPropagation();
        this._clearSel();
      } else if (this._fullscreen) {
        // Nothing left to cancel — collapse the full-screen workspace before
        // letting a further Escape reach (and close) HA's edit dialog.
        ev.preventDefault();
        ev.stopPropagation();
        this._fullscreen = false;
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
    // One gesture at a time: a second touch must not hijack the state machine.
    if (this._gesturePointer !== null) return;
    this._canvasWrap?.focus();
    const raw = this._toVirtual(ev, false);

    if (this._tool === "wall") {
      const s = this._freeWalls
        ? { x: this._snap(raw.x), y: this._snap(raw.y) }
        : this._snapWallPoint(raw.x, raw.y);
      this._draft = { x1: s.x, y1: s.y, x2: s.x, y2: s.y };
      this._gesturePointer = ev.pointerId;
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
      this._gesturePointer = ev.pointerId;
      this._capturePointer(ev);
      return;
    }
    // Select tool, empty canvas: start a marquee (rubber-band) selection.
    this._marqueeAdd = ev.shiftKey || ev.ctrlKey || ev.metaKey;
    this._marquee = { x0: raw.x, y0: raw.y, x1: raw.x, y1: raw.y };
    this._gesturePointer = ev.pointerId;
    this._capturePointer(ev);
  }

  /**
   * Abort any in-progress gesture. A moved drag is rolled back to the exact
   * pre-drag config (restoring wall-snap angle changes too) and its own
   * history snapshot — matched by identity, in case something else pushed in
   * between — is dropped, so a canceled drag leaves no trace in undo.
   */
  private _cancelGesture(): void {
    this._gesturePointer = null;
    this._draft = null;
    this._draftTracker = null;
    this._marquee = null;
    const drag = this._drag;
    this._drag = null;
    if (drag?.moved && drag.snapshot) {
      this._history = this._history.filter((c) => c !== drag.snapshot);
      this._emit(drag.snapshot);
      // The push at first movement cleared the redo stack; a canceled drag
      // must be a complete no-op, so put it back.
      this._future = drag.priorFuture ?? [];
    }
  }

  private _onPointerCancel(ev: PointerEvent): void {
    if (this._gesturePointer !== null && ev.pointerId !== this._gesturePointer) return;
    this._cancelGesture();
  }

  /** True when this event belongs to a pointer other than the gesture's. */
  private _foreignPointer(ev: PointerEvent): boolean {
    return this._gesturePointer !== null && ev.pointerId !== this._gesturePointer;
  }

  private _onCanvasMove(ev: PointerEvent): void {
    if (this._foreignPointer(ev)) return;
    // A gesture with no buttons held means pointerup never reached us
    // (alt-tab, dialog retarget) — treat it as canceled instead of letting
    // the element chase the hovering mouse.
    if (ev.buttons === 0 && (this._drag || this._draft || this._draftTracker || this._marquee)) {
      this._cancelGesture();
      return;
    }
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
    if (this._foreignPointer(ev)) return;
    this._gesturePointer = null;
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
      this._liveEditKey = null;
      return;
    }
    if (this._drag) {
      this._drag = null;
      this._releasePointer(ev);
    }
  }

  /** All active-floor elements whose center lies inside the marquee rect. */
  private _elementsInRect(m: Marquee): Sel[] {
    return elementsInRect(this._floor(), m);
  }

  // ---- dragging existing elements ----------------------------------------

  private _startDrag(ev: PointerEvent, sel: Sel, endpoint?: 1 | 2): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    if (this._gesturePointer !== null) return;
    this._canvasWrap?.focus();
    // Endpoint handles always operate on that single wall.
    if (endpoint) this._selectOne(sel);
    else this._selectForPointer(ev, sel);
    this._drag = {
      primary: sel,
      start: this._toVirtual(ev, false),
      orig: this._snapshotSelection(),
      endpoint,
    };
    this._gesturePointer = ev.pointerId;
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
    // First *effective* movement: snapshot for undo now, not at pointerdown,
    // so a plain selection click — including the ~1px jitter real clicks and
    // taps produce — doesn't spam history or wipe the redo stack. Threshold
    // matches the marquee's click-vs-drag test.
    if (!drag.moved) {
      if (Math.hypot(p.x - drag.start.x, p.y - drag.start.y) <= 4) return;
      drag.moved = true;
      drag.priorFuture = this._future;
      this._pushHistory();
      drag.snapshot = this._history[this._history.length - 1];
    }
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
    return applyDelta(this._floor(), dx, dy, orig);
  }

  // ---- overlay drag for items & texts (HTML, not SVG) --------------------

  private _onOverlayDown(ev: PointerEvent, sel: OverlaySel): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    // preventDefault suppresses native mousedown focusing, so focus explicitly.
    ev.preventDefault();
    if (this._gesturePointer !== null) return;
    this._canvasWrap?.focus();
    this._selectForPointer(ev, sel);
    this._drag = {
      primary: sel,
      start: this._toVirtual(ev, false),
      orig: this._snapshotSelection(),
    };
    this._gesturePointer = ev.pointerId;
    this._capturePointer(ev, ev.currentTarget as Element);
  }

  private _onOverlayMove(ev: PointerEvent): void {
    if (this._foreignPointer(ev)) return;
    if (ev.buttons === 0 && this._drag) {
      // Missed pointerup (see _onCanvasMove) — cancel rather than chase.
      this._cancelGesture();
      return;
    }
    if (this._drag) this._applyDrag(ev);
  }

  private _onOverlayUp(ev: PointerEvent): void {
    if (this._foreignPointer(ev)) return;
    this._gesturePointer = null;
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

  /**
   * Link the active floor to a Home Assistant floor (issue #24). Linking also
   * names the floor after the HA floor — the point of the association — while
   * a later manual rename sticks (we never re-sync silently). Unlinking keeps
   * the current name.
   */
  private _linkHaFloor(haFloorId: string): void {
    const ha = haFloorsOf(this.hass).find((f) => f.floor_id === haFloorId);
    this._commit({
      ...this._config,
      floors: (this._config.floors ?? []).map((f) =>
        f.id === this._activeFloorId
          ? { ...f, haFloor: ha?.floor_id, ...(ha ? { name: ha.name } : {}) }
          : f
      ),
    });
  }

  /** HA-floor link row for the floor gear popover; hidden when HA exposes no floors. */
  private _renderHaFloorRow(floor: Floor): TemplateResult {
    const haFloors = haFloorsOf(this.hass);
    if (!haFloors.length) return html`${nothing}`;
    return html`
      <div class="pop-row">
        <label>HA floor</label>
        <select
          .value=${floor?.haFloor ?? ""}
          @change=${(e: Event) => this._linkHaFloor((e.target as HTMLSelectElement).value)}
        >
          <option value="" ?selected=${!floor?.haFloor}>(not linked)</option>
          ${haFloors.map(
            (f) =>
              html`<option value=${f.floor_id} ?selected=${floor?.haFloor === f.floor_id}>
                ${f.name}
              </option>`
          )}
        </select>
      </div>
    `;
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

  private _updateWall(id: string, partial: Partial<Wall>): void {
    this._commitFloor({
      walls: this._floor().walls.map((w) => (w.id === id ? { ...w, ...partial } : w)),
    });
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

  /**
   * Every new pointer interaction ends the current live-edit burst, so two
   * separate drags of the same slider (or two picker sessions on the same
   * color field) become two undo steps instead of silently merging into one.
   * Canvas gestures stop propagation before reaching this, but they snapshot
   * history themselves. `_liveEditKey` is non-reactive — no render triggered.
   */
  private _onEditorPointerDown = (): void => {
    this._liveEditKey = null;
  };

  /**
   * Live variants for continuous controls (sliders, color pickers, typing):
   * one undo snapshot per edit burst — keyed by element and fields — then
   * plain emits, instead of a full-config clone per input event.
   */
  private _beginLive(kind: string, id: string, partial: object): void {
    const key = `${kind}:${id}:${Object.keys(partial).sort().join(",")}`;
    if (this._liveEditKey !== key) this._pushHistory(key);
  }

  private _updateOpeningLive(id: string, partial: Partial<Opening>): void {
    this._beginLive("opening", id, partial);
    this._emitFloor({
      openings: this._floor().openings.map((o) => (o.id === id ? { ...o, ...partial } : o)),
    });
  }

  private _updateItemLive(id: string, partial: Partial<FloorItem>): void {
    this._beginLive("item", id, partial);
    this._emitFloor({
      items: this._floor().items.map((it) => (it.id === id ? { ...it, ...partial } : it)),
    });
  }

  private _updateTextLive(id: string, partial: Partial<FloorText>): void {
    this._beginLive("text", id, partial);
    this._emitFloor({
      texts: this._floor().texts.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    });
  }

  private _updateFurnitureLive(id: string, partial: Partial<Furniture>): void {
    this._beginLive("furniture", id, partial);
    this._emitFloor({
      furniture: this._floor().furniture.map((f) => (f.id === id ? { ...f, ...partial } : f)),
    });
  }

  private _updateTrackerLive(id: string, partial: Partial<Tracker>): void {
    this._beginLive("tracker", id, partial);
    this._emitFloor({
      trackers: (this._floor().trackers ?? []).map((t) => (t.id === id ? { ...t, ...partial } : t)),
    });
  }

  private _patchConfigLive(partial: Partial<FloorplanCardConfig>): void {
    this._beginLive("config", "", partial);
    this._emit({ ...this._config, ...partial });
  }

  private _patchFloorLive(partial: Partial<Floor>): void {
    this._beginLive("floor", this._activeFloorId, partial);
    this._emitFloor(partial);
  }

  // ---- rendering ----------------------------------------------------------

  // ---- zoom ----------------------------------------------------------------

  private _setZoom(z: number): void {
    this._zoom = Math.min(3, Math.max(0.5, Math.round(z * 100) / 100));
  }

  /** Ctrl/Cmd + wheel zooms the canvas (also catches trackpad pinch); plain wheel scrolls. */
  private _onCanvasWheel(ev: WheelEvent): void {
    if (!ev.ctrlKey && !ev.metaKey) return;
    ev.preventDefault();
    this._setZoom(this._zoom - Math.sign(ev.deltaY) * 0.1);
  }

  /** Reset to 100% (where the stage fits the wrap width) and scroll home. */
  private _fitView(): void {
    this._setZoom(1);
    this._canvasWrap?.scrollTo({ top: 0, left: 0 });
  }

  /** One-line description of the selected element for the Element header. */
  private _selectionSummary(sel: Sel): string {
    const f = this._floor();
    switch (sel.kind) {
      case "wall": {
        const w = f.walls.find((x) => x.id === sel.id);
        return w ? `Wall · ${Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1))} units` : "Wall";
      }
      case "opening": {
        const o = f.openings.find((x) => x.id === sel.id);
        if (!o) return "Opening";
        return `${o.type === "door" ? "Door" : "Window"} · ${Math.round(o.length)} units`;
      }
      case "item": {
        const it = f.items.find((x) => x.id === sel.id);
        return it?.entity ? `Device · ${it.entity}` : "Device";
      }
      case "text": {
        const t = f.texts.find((x) => x.id === sel.id);
        const txt = t?.text ?? "";
        if (!txt) return "Text";
        return `Text · “${txt.length > 24 ? `${txt.slice(0, 24)}…` : txt}”`;
      }
      case "furniture": {
        const fu = f.furniture.find((x) => x.id === sel.id);
        if (!fu) return "Furniture";
        const label = FURNITURE_LABELS[fu.type];
        return `${label.charAt(0).toUpperCase()}${label.slice(1)} · ${Math.round(fu.w)}×${Math.round(fu.h)}`;
      }
      default: {
        const tr = (f.trackers ?? []).find((x) => x.id === sel.id);
        return tr ? `Tracker · ${Math.round(tr.w)}×${Math.round(tr.h)}` : "Tracker";
      }
    }
  }

  /** Cached grid templates; rebuilding hundreds of lines on every render is wasteful. */
  private _gridCache: { key: string; lines: TemplateResult[] } | null = null;

  private _renderGrid(): TemplateResult[] {
    const { width, height } = this._config;
    const g = this.grid;
    // This runs on every render — including every pointermove while drawing
    // or dragging. The grid only depends on canvas size + spacing, so return
    // the same template array until one of those changes; Lit then sees
    // identical items and skips diffing the (potentially hundreds of) lines.
    const key = `${width}x${height}x${g}`;
    if (this._gridCache?.key === key) return this._gridCache.lines;
    const lines: TemplateResult[] = [];
    for (let x = 0; x <= width; x += g)
      lines.push(svg`<line x1=${x} y1="0" x2=${x} y2=${height} class="grid" />`);
    for (let y = 0; y <= height; y += g)
      lines.push(svg`<line x1="0" y1=${y} x2=${width} y2=${y} class="grid" />`);
    this._gridCache = { key, lines };
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
      // Tool hints only — the per-element editor AND its actions (duplicate /
      // delete) live in the Element section below the canvas, so the bar's
      // height stays stable and the selection has a single home.
      label = "Select";
      const n = this._selection.length;
      body =
        n === 0
          ? html`<span class="ctx-hint"
              >Click an element to select it, or drag a box to select several.</span
            >`
          : html`
              <span class="ctx-count">${n} selected</span>
              <span class="ctx-hint">Properties and actions are in the Element section below.</span>
            `;
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
    const floorEmpty =
      !floor.walls.length &&
      !floor.openings.length &&
      !floor.items.length &&
      !floor.texts.length &&
      !floor.furniture.length &&
      !(floor.trackers ?? []).length;
    return html`
      <div
        class="editor ${this._fullscreen ? "fullscreen" : ""}"
        popover=${this._fullscreen ? "manual" : nothing}
        @pointerdown=${this._onEditorPointerDown}
      >
        ${this._floorMenuOpen || this._addMenuOpen
          ? html`<div
              class="pop-backdrop"
              @click=${() => {
                this._floorMenuOpen = false;
                this._addMenuOpen = false;
              }}
            ></div>`
          : nothing}
        <div class="toolbar">
          <!-- Tools — modes; exactly one is active at a time -->
          <div class="seg" role="group" aria-label="Tool">
            ${(["select", "wall", "door", "window", "tracker"] as Tool[]).map(
              (t) => html`
                <button
                  class=${this._tool === t ? "active" : ""}
                  aria-pressed=${this._tool === t}
                  title=${TOOL_META[t].label}
                  @click=${() => {
                    this._tool = t;
                    this._draft = null;
                    this._draftTracker = null;
                  }}
                >
                  <ha-icon icon=${TOOL_META[t].icon}></ha-icon>${TOOL_META[t].label}
                </button>`
            )}
          </div>

          <span class="divider"></span>

          <!-- Expand: break out of HA's narrow config dialog into a full-screen
               workspace. Kept next to the tools so it's reachable even when the
               toolbar wraps at dialog width. -->
          <button
            class=${this._fullscreen ? "active expand-toggle" : "expand-toggle"}
            aria-pressed=${this._fullscreen}
            title=${this._fullscreen ? "Exit full screen (Esc)" : "Edit full screen — more room for the canvas"}
            @click=${() => this._toggleFullscreen()}
          >
            <ha-icon icon=${this._fullscreen ? "mdi:fullscreen-exit" : "mdi:fullscreen"}></ha-icon>
            ${this._fullscreen ? "Exit" : "Expand"}
          </button>

          <span class="divider"></span>

          <!-- Insert — one popover for everything droppable on the floor -->
          <span class="pop-wrap">
            <button
              aria-haspopup="true"
              aria-expanded=${this._addMenuOpen}
              @click=${() => {
                this._addMenuOpen = !this._addMenuOpen;
                this._floorMenuOpen = false;
              }}
            >
              + Add
            </button>
            ${this._addMenuOpen ? this._renderAddMenu() : nothing}
          </span>

          <span class="spacer"></span>

          <!-- History -->
          <div class="group">
            <button aria-label="Undo" title="Undo (Ctrl/Cmd+Z)" ?disabled=${!this._history.length} @click=${this._undo}>
              <ha-icon icon="mdi:undo"></ha-icon>
            </button>
            <button aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)" ?disabled=${!this._future.length} @click=${this._redo}>
              <ha-icon icon="mdi:redo"></ha-icon>
            </button>
          </div>

          <span class="divider"></span>

          <!-- Floor — switch + add inline; rename/delete behind the gear -->
          <span class="floors pop-wrap">
            <label>floor</label>
            <select @change=${(e: Event) => this._switchFloor((e.target as HTMLSelectElement).value)}>
              ${floors.map(
                (f) =>
                  html`<option value=${f.id} ?selected=${f.id === this._activeFloorId}>${f.name}</option>`
              )}
            </select>
            <button
              aria-label="Add floor"
              title="Add a floor (copies the current walls)"
              @click=${this._addFloor}
            >
              +
            </button>
            <button
              aria-label="Floor settings"
              title="Rename or delete this floor"
              aria-haspopup="true"
              aria-expanded=${this._floorMenuOpen}
              @click=${() => {
                this._floorMenuOpen = !this._floorMenuOpen;
                this._addMenuOpen = false;
              }}
            >
              <ha-icon icon="mdi:cog-outline"></ha-icon>
            </button>
            ${this._floorMenuOpen
              ? html`<div class="pop">
                  ${this._renderHaFloorRow(floor)}
                  <div class="pop-row">
                    <label>Rename</label>
                    <input
                      class="floor-name"
                      type="text"
                      .value=${floor?.name ?? ""}
                      @change=${(e: Event) =>
                        this._renameFloor(this._activeFloorId, (e.target as HTMLInputElement).value)}
                    />
                  </div>
                  <button
                    class="danger pop-action"
                    ?disabled=${floors.length <= 1}
                    @click=${() => {
                      this._deleteFloor();
                      this._floorMenuOpen = false;
                    }}
                  >
                    <ha-icon icon="mdi:delete-outline"></ha-icon> Delete this floor
                  </button>
                </div>`
              : nothing}
          </span>
        </div>

        ${this._renderContextBar()}

        <div class="workspace">
        <div class="canvas-outer">
        <div class="canvas-wrap" tabindex="0" @wheel=${this._onCanvasWheel}>
          <div class="stage" style="aspect-ratio: ${c.width} / ${c.height}; width:${this._zoom * 100}%;">
            <svg
              viewBox="0 0 ${c.width} ${c.height}"
              preserveAspectRatio="none"
              class=${this._tool}
              @pointerdown=${this._onCanvasDown}
              @pointermove=${this._onCanvasMove}
              @pointerup=${this._onCanvasUp}
              @pointercancel=${this._onPointerCancel}
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
        ${floorEmpty && !this._draft && !this._draftTracker
          ? html`<div class="empty-hint">
              <div>
                <b>Draw your first room:</b> pick the <b>Wall</b> tool and drag on the canvas.<br />
                Then drop doors, windows and devices onto it.
              </div>
            </div>`
          : nothing}
        <div class="zoom-overlay">
          <button aria-label="Zoom out" title="Zoom out" @click=${() => this._setZoom(this._zoom - 0.25)}>
            <ha-icon icon="mdi:minus"></ha-icon>
          </button>
          <button class="zoom-val-btn" title="Reset zoom to 100%" @click=${() => this._setZoom(1)}>
            ${Math.round(this._zoom * 100)}%
          </button>
          <button aria-label="Zoom in" title="Zoom in" @click=${() => this._setZoom(this._zoom + 0.25)}>
            <ha-icon icon="mdi:plus"></ha-icon>
          </button>
          <button aria-label="Fit to view" title="Fit to view" @click=${this._fitView}>
            <ha-icon icon="mdi:fit-to-screen-outline"></ha-icon>
          </button>
        </div>
        </div>

        <div class="side">
          ${this._renderElementEdit()}
          ${this._renderPanel()}
        </div>
        </div>
      </div>
    `;
  }

  /**
   * `ha-entity-picker` when defined, else a plain entity-id input — mirrors
   * the icon-picker fallback so entity binding never silently dead-ends when
   * the helper load fails or the editor runs outside HA.
   */
  private _renderEntityPicker(
    value: string,
    onChange: (entity: string) => void,
    includeDomains?: string[]
  ): TemplateResult {
    if (customElements.get("ha-entity-picker")) {
      return html`<ha-entity-picker
        .hass=${this.hass}
        .value=${value}
        .includeDomains=${includeDomains}
        allow-custom-entity
        @value-changed=${(e: CustomEvent) => onChange((e.detail.value as string) ?? "")}
      ></ha-entity-picker>`;
    }
    return html`<input
      type="text"
      placeholder="sensor.example"
      .value=${value}
      @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
    />`;
  }

  /** Toggle the full-screen workspace. */
  private _toggleFullscreen(): void {
    this._fullscreen = !this._fullscreen;
    if (this._fullscreen && this._canvasWrap) {
      // A drag-resized canvas carries inline width/height that would defeat
      // the fullscreen flex fill.
      this._canvasWrap.style.width = "";
      this._canvasWrap.style.height = "";
    }
    // Any open toolbar popover would be orphaned by the layout change.
    this._floorMenuOpen = false;
    this._addMenuOpen = false;
  }

  /** The "+ Add" popover: device, text, then every furniture type as its real glyph. */
  private _renderAddMenu(): TemplateResult {
    const close = () => {
      this._addMenuOpen = false;
    };
    return html`
      <div class="pop left add-pop">
        <button
          class="add-entry"
          @click=${() => {
            this._addItem("generic");
            close();
          }}
        >
          <ha-icon icon="mdi:lightbulb-outline"></ha-icon> Device
        </button>
        <button
          class="add-entry"
          @click=${() => {
            this._addText();
            close();
          }}
        >
          <ha-icon icon="mdi:format-text"></ha-icon> Text
        </button>
        <div class="add-furn-grid">
          ${FURNITURE_TYPES.map((t) => {
            const size = FURNITURE_DEFAULT_SIZE[t];
            // Glyphs are drawn centered at the origin; pad the viewBox a bit
            // (tv draws its stand below the box, plants overflow slightly).
            const pad = Math.max(size.w, size.h) * 0.25 + 6;
            const vb = `${-size.w / 2 - pad} ${-size.h / 2 - pad} ${size.w + pad * 2} ${size.h + pad * 2}`;
            return html`
              <button
                class="furn-cell"
                title=${FURNITURE_LABELS[t]}
                @click=${() => {
                  this._addFurniture(t);
                  close();
                }}
              >
                <svg viewBox=${vb}>
                  ${renderFurniture({ id: "preview", type: t, x: 0, y: 0, w: size.w, h: size.h })}
                </svg>
                <span>${FURNITURE_LABELS[t]}</span>
              </button>
            `;
          })}
        </div>
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
    const sel = this._primary();
    if (n === 0 || !sel) {
      return html`
        <section class="edit-area">
          <h3 class="section-title">Element</h3>
          <p class="hint">Select an element on the canvas to edit its properties here.</p>
        </section>
      `;
    }
    // Header names the selection and carries its actions, so everything about
    // the selected element lives in one place (the context bar stays tool-only).
    const summary = n > 1 ? `${n} elements selected` : this._selectionSummary(sel);
    const icon = n > 1 ? "mdi:select-group" : SEL_KIND_ICON[sel.kind];
    return html`
      <section class="edit-area">
        <div class="edit-head">
          <ha-icon icon=${icon}></ha-icon>
          <span class="edit-title">${summary}</span>
          <span class="head-spacer"></span>
          <button aria-label="Duplicate" title="Duplicate (Ctrl/Cmd+D)" @click=${this._duplicate}>
            <ha-icon icon="mdi:content-duplicate"></ha-icon>
          </button>
          <button class="danger" aria-label="Delete" title="Delete (Del)" @click=${this._deleteSelected}>
            <ha-icon icon="mdi:delete-outline"></ha-icon>
          </button>
        </div>
        ${n > 1
          ? html`<p class="hint">
              Edit elements one at a time. Drag any selected element to move the whole group.
            </p>`
          : html`<div class="rows">${this._renderSelectionEditor()}</div>`}
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
          // Draw sliding openings partly open in the editor so the slide
          // direction and panel style are visible — a closed slider looks
          // symmetric, which would make the Slide / Style controls appear inert.
          amount: openingMotion(o) === "slide" ? 0.55 : undefined,
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
    const st = it.entity ? this.hass?.states[it.entity] : undefined;
    const icon = resolveItemIcon(it, st);
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
        @pointercancel=${this._onPointerCancel}
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
        @pointercancel=${this._onPointerCancel}
      >
        ${t.text || "…"}
      </div>
    `;
  }

  private _renderPanel(): TemplateResult {
    // Collapsed by default — page-level settings are touched rarely, and
    // collapsing them keeps the Element editor close to the canvas.
    return html`
      <section class="panel">
        <button
          class="section-toggle"
          aria-expanded=${this._projectOpen}
          @click=${() => {
            this._projectOpen = !this._projectOpen;
          }}
        >
          <ha-icon icon=${this._projectOpen ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
          <span class="section-title-inline">Project</span>
          ${this._projectOpen
            ? nothing
            : html`<span class="section-summary"
                >${this._config.title || "Untitled"} · ${this._config.width}×${this._config.height}</span
              >`}
        </button>
        ${this._projectOpen ? this._renderPanelBody() : nothing}
      </section>
    `;
  }

  private _renderPanelBody(): TemplateResult {
    return html`
      <div class="rows panel-body">
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
        <div class="row wide">
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
            @input=${(e: Event) =>
              this._patchConfigLive({ background: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="#ffffff or empty"
            .value=${this._config.background ?? ""}
            @change=${(e: Event) =>
              this._patchConfig({ background: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        <div class="row wide">
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
                  this._patchFloorLive({
                    imageOpacity: Number((e.target as HTMLInputElement).value),
                  })}
              />
            </div>`
          : nothing}
      </div>
    `;
  }

  /**
   * Shared "Angle" row (slider + number box) used by every rotatable element.
   * Centralizes the wrap-to-0..360 math and guards the number box against a
   * cleared field — `Number("")` is 0 but `Number("abc")`/partial input is
   * NaN, which previously got stored and broke the element's transform.
   */
  private _renderAngleRow(
    value: number,
    apply: (angle: number) => void,
    applyLive: (angle: number) => void = apply
  ): TemplateResult {
    const current = Math.round(value);
    return html`
      <div class="row">
        <label>Angle</label>
        <input
          type="range"
          min="0"
          max="360"
          .value=${String(value)}
          @input=${(e: Event) => applyLive(Number((e.target as HTMLInputElement).value))}
        />
        <input
          class="num"
          type="number"
          min="0"
          max="360"
          .value=${String(current)}
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const n = Number(input.value);
            if (input.value !== "" && Number.isFinite(n)) apply(((n % 360) + 360) % 360);
            else input.value = String(current);
          }}
        />
      </div>
    `;
  }

  /**
   * Editor fields for the currently-selected element, rendered in the Element
   * section below the canvas (docked beside it in fullscreen). Returns nothing
   * when the selection isn't exactly one element — multi-select and
   * empty-select states are handled by the Element header itself.
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
          <label>Motion</label>
          <select
            .value=${openingMotion(o)}
            @change=${(e: Event) => {
              const motion = (e.target as HTMLSelectElement).value as "swing" | "slide";
              // sliderStyle only applies while sliding — drop it when switching
              // back to swing so the config stays clean.
              this._updateOpening(o.id, {
                motion: motion === "slide" ? "slide" : undefined,
                ...(motion === "swing" ? { sliderStyle: undefined } : {}),
              });
            }}
          >
            <option value="swing">swing</option>
            <option value="slide">slide</option>
          </select>
        </div>
        <div class="row">
          <label>Length</label>
          <input
            type="number"
            min="1"
            .value=${String(o.length)}
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const n = Number(input.value);
              // A cleared / invalid field would store 0 or NaN — an invisible
              // opening that's impossible to click again. Keep the old length.
              if (input.value !== "" && n >= 1) this._updateOpening(o.id, { length: n });
              else input.value = String(o.length);
            }}
          />
        </div>
        ${o.type === "door" && openingMotion(o) === "swing"
          ? html`
              <div class="row">
                <label>Hinge</label>
                <select
                  .value=${o.flipH ? "right" : "left"}
                  @change=${(e: Event) =>
                    this._updateOpening(o.id, {
                      flipH: (e.target as HTMLSelectElement).value === "right" || undefined,
                    })}
                >
                  <option value="left">left</option>
                  <option value="right">right</option>
                </select>
              </div>`
          : nothing}
        ${openingMotion(o) === "swing"
          ? html`
              <div class="row">
                <label>Opens</label>
                <select
                  .value=${o.flipV ? "other" : "this"}
                  @change=${(e: Event) =>
                    this._updateOpening(o.id, {
                      flipV: (e.target as HTMLSelectElement).value === "other" || undefined,
                    })}
                >
                  <option value="this">this side</option>
                  <option value="other">other side</option>
                </select>
              </div>`
          : nothing}
        ${openingMotion(o) === "slide"
          ? html`
              ${sliderStyleOf(o) !== "biparting"
                ? html`
                    <div class="row">
                      <label>Slide</label>
                      <select
                        .value=${o.flipH ? "right" : "left"}
                        @change=${(e: Event) =>
                          this._updateOpening(o.id, {
                            flipH: (e.target as HTMLSelectElement).value === "right" || undefined,
                          })}
                      >
                        <option value="left">to left</option>
                        <option value="right">to right</option>
                      </select>
                    </div>`
                : nothing}
              <div class="row">
                <label>Style</label>
                <select
                  .value=${sliderStyleOf(o)}
                  @change=${(e: Event) => {
                    const v = (e.target as HTMLSelectElement).value;
                    this._updateOpening(o.id, {
                      sliderStyle: v === "single" ? undefined : (v as "bypass" | "biparting"),
                    });
                  }}
                >
                  <option value="single">single</option>
                  <option value="bypass">bypass (stack)</option>
                  <option value="biparting">biparting (split)</option>
                </select>
              </div>`
          : nothing}
        <div class="row wide">
          <label>Entity</label>
          ${this._renderEntityPicker(
            o.entity ?? "",
            (value) => {
              const entity = value || undefined;
              // Infer type/motion from the entity's HA device_class (e.g. a
              // `cover` with device_class `window` → a window; a `garage`
              // roller → a sliding door). Only when the class is known, so we
              // never clobber a hand-set type with a guess.
              const dc = entity
                ? (this.hass?.states[entity]?.attributes?.device_class as string | undefined)
                : undefined;
              this._updateOpening(o.id, { entity, ...(dc ? openingFromDeviceClass(dc) : {}) });
            },
            ["binary_sensor", "cover"]
          )}
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
                    this._updateOpeningLive(o.id, {
                      activeColor: (e.target as HTMLInputElement).value,
                    })}
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
        ${this._renderAngleRow(
          o.angle,
          (angle) => this._updateOpening(o.id, { angle }),
          (angle) => this._updateOpeningLive(o.id, { angle })
        )}
      `;
    }

    if (sel.kind === "item") {
      const it = this._floor().items.find((x) => x.id === sel.id);
      if (!it) return html`${nothing}`;
      return html`
        <div class="row wide">
          <label>Entity</label>
          ${this._renderEntityPicker(it.entity, (entity) =>
            this._updateItem(it.id, { entity, kind: kindFromEntity(entity) })
          )}
        </div>
        <div class="row wide">
          <label>2nd entity</label>
          ${this._renderEntityPicker(it.secondaryEntity ?? "", (value) =>
            this._updateItem(it.id, { secondaryEntity: value || undefined })
          )}
        </div>
        <div class="row wide">
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
              this._updateItemLive(it.id, { size: Number((e.target as HTMLInputElement).value) })}
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
        ${this._renderAngleRow(
          it.angle ?? 0,
          (angle) => this._updateItem(it.id, { angle }),
          (angle) => this._updateItemLive(it.id, { angle })
        )}
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
                    this._updateItemLive(it.id, {
                      rippleColor: (e.target as HTMLInputElement).value,
                    })}
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
                    this._updateItemLive(it.id, {
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
              this._updateTextLive(t.id, { text: (e.target as HTMLInputElement).value })}
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
              this._updateTextLive(t.id, { size: Number((e.target as HTMLInputElement).value) })}
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
              this._updateTextLive(t.id, { color: (e.target as HTMLInputElement).value })}
          />
          <input
            type="text"
            placeholder="(theme default)"
            .value=${t.color ?? ""}
            @change=${(e: Event) =>
              this._updateText(t.id, { color: (e.target as HTMLInputElement).value || undefined })}
          />
        </div>
        ${this._renderAngleRow(
          t.angle ?? 0,
          (angle) => this._updateText(t.id, { angle }),
          (angle) => this._updateTextLive(t.id, { angle })
        )}
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
        ${f.type === "sectional"
          ? html`
              <div class="row">
                <label title="Which side the chaise extends on, facing the sofa from the front">
                  Chaise side
                </label>
                <select
                  .value=${f.hand ?? "right"}
                  @change=${(e: Event) =>
                    this._updateFurniture(f.id, {
                      hand: (e.target as HTMLSelectElement).value as SectionalHand,
                    })}
                >
                  <option value="right">right</option>
                  <option value="left">left</option>
                </select>
              </div>
            `
          : nothing}
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
        ${this._renderAngleRow(
          f.angle ?? 0,
          (angle) => this._updateFurniture(f.id, { angle }),
          (angle) => this._updateFurnitureLive(f.id, { angle })
        )}
        <div class="row">
          <label>Color</label>
          <input
            type="color"
            .value=${f.color ?? "#9e9e9e"}
            @input=${(e: Event) =>
              this._updateFurnitureLive(f.id, { color: (e.target as HTMLInputElement).value })}
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
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const n = Number(input.value);
              // A cleared/garbled field must not teleport the tracker to 0.
              if (input.value !== "" && Number.isFinite(n)) this._updateTracker(tr.id, { x: n });
              else input.value = String(Math.round(tr.x));
            }}
          />
          <input
            class="num"
            type="number"
            .value=${String(Math.round(tr.y))}
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const n = Number(input.value);
              if (input.value !== "" && Number.isFinite(n)) this._updateTracker(tr.id, { y: n });
              else input.value = String(Math.round(tr.y));
            }}
          />
        </div>
        ${this._renderAngleRow(
          tr.angle ?? 0,
          (angle) => this._updateTracker(tr.id, { angle }),
          (angle) => this._updateTrackerLive(tr.id, { angle })
        )}
        <div class="row">
          <label>Color</label>
          <input
            type="color"
            .value=${tr.color ?? "#03a9f4"}
            @input=${(e: Event) =>
              this._updateTrackerLive(tr.id, { color: (e.target as HTMLInputElement).value })}
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
              this._updateTrackerLive(tr.id, {
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

    if (sel.kind === "wall") {
      const w = this._floor().walls.find((x) => x.id === sel.id);
      if (!w) return html`${nothing}`;
      const length = Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
      // One coordinate input; a cleared / invalid field restores the old value.
      const coord = (value: number, apply: (n: number) => void) => html`
        <input
          class="num"
          type="number"
          .value=${String(Math.round(value))}
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            const n = Number(input.value);
            if (input.value !== "" && Number.isFinite(n)) apply(n);
            else input.value = String(Math.round(value));
          }}
        />
      `;
      return html`
        <div class="row">
          <label>Start X / Y</label>
          ${coord(w.x1, (x1) => this._updateWall(w.id, { x1 }))}
          ${coord(w.y1, (y1) => this._updateWall(w.id, { y1 }))}
        </div>
        <div class="row">
          <label>End X / Y</label>
          ${coord(w.x2, (x2) => this._updateWall(w.id, { x2 }))}
          ${coord(w.y2, (y2) => this._updateWall(w.id, { y2 }))}
        </div>
        <div class="row">
          <label>Length</label>
          <input
            class="num"
            type="number"
            min="1"
            .value=${String(length)}
            @change=${(e: Event) => {
              const input = e.target as HTMLInputElement;
              const n = Number(input.value);
              if (input.value === "" || !(n >= 1)) {
                input.value = String(length);
                return;
              }
              // Resize from the start point along the wall's current
              // direction (a zero-length wall extends horizontally).
              const dx = w.x2 - w.x1;
              const dy = w.y2 - w.y1;
              const cur = Math.hypot(dx, dy);
              const ux = cur > 0 ? dx / cur : 1;
              const uy = cur > 0 ? dy / cur : 0;
              this._updateWall(w.id, {
                x2: Math.round(w.x1 + ux * n),
                y2: Math.round(w.y1 + uy * n),
              });
            }}
          />
          <span class="hint">Resizes from the start point, keeping the direction.</span>
        </div>
        <p class="hint">
          Or drag the line on the canvas to move it, and the round handles to move an endpoint.
        </p>
      `;
    }

    return html`${nothing}`;
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
      <div class="row wide">
        <label>${label}</label>
        ${this._renderEntityPicker(
          s?.entity ?? "",
          (v) => {
            if (!v) this._updateTrackerSensor(tr.id, axis, null);
            else this._updateTrackerSensor(tr.id, axis, { entity: v });
          },
          ["sensor", "input_number", "number"]
        )}
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
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                const n = Number(input.value);
                // A cleared field must not silently collapse the range to 0.
                if (input.value !== "" && Number.isFinite(n))
                  this._updateTrackerSensor(tr.id, axis, { min: n });
                else input.value = String(s.min);
              }}
            />
            <input
              class="num"
              type="number"
              step="0.01"
              title="Reading at the far edge"
              .value=${String(s.max)}
              @change=${(e: Event) => {
                const input = e.target as HTMLInputElement;
                const n = Number(input.value);
                if (input.value !== "" && Number.isFinite(n))
                  this._updateTrackerSensor(tr.id, axis, { max: n });
                else input.value = String(s.max);
              }}
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
          <div class="row wide">
            <label>${label} presence</label>
            ${this._renderEntityPicker(
              s.presence?.entity ?? "",
              (v) =>
                this._updateTrackerSensor(tr.id, axis, {
                  presence: v ? { entity: v, invert: s.presence?.invert } : undefined,
                }),
              ["binary_sensor", "input_boolean", "device_tracker"]
            )}
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
    /* Full-screen workspace, shown as a popover so the top layer lifts it clear
       of HA's edit dialog (whose surface is transformed — see updated()). The
       resets undo the UA popover defaults: fit-content size, auto margins, a
       solid border and padding. The fixed position only matters to the
       non-popover fallback, where the transformed dialog surface is the
       containing block — there "fullscreen" fills the dialog, not the page. */
    .editor.fullscreen {
      position: fixed;
      inset: 0;
      z-index: 100;
      width: auto;
      height: auto;
      max-width: none;
      max-height: none;
      margin: 0;
      border: none;
      padding: 12px;
      box-sizing: border-box;
      color: inherit;
      background: var(--card-background-color, #fff);
      overflow: hidden;
    }
    /* Toolbar-icon button (Expand/Exit) — match the gear button's icon+label
       alignment so it reads as part of the toolbar. */
    .expand-toggle {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    /* Below the two toolbars: the canvas and the element/project sections.
       Stacked at dialog width; split into canvas + docked side panel when
       expanded so the extra width isn't wasted. */
    .workspace {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .side {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .editor.fullscreen .workspace {
      flex-direction: row;
      align-items: stretch;
      flex: 1 1 auto;
      min-height: 0;
    }
    .editor.fullscreen .canvas-outer {
      flex: 1 1 auto;
      min-width: 0;
      min-height: 0;
      display: flex;
      flex-direction: column;
    }
    .editor.fullscreen .canvas-wrap {
      flex: 1 1 auto;
      min-height: 0;
      height: auto;
      resize: none;
    }
    /* Docked inspector — fixed, scrollable column beside the canvas. */
    .editor.fullscreen .side {
      flex: 0 0 340px;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 2px;
    }
    /* At real dialog width the side panel can drop below instead of squeezing
       the canvas to nothing. */
    @media (max-width: 900px) {
      .editor.fullscreen .workspace {
        flex-direction: column;
        /* Stacked panels can exceed a short viewport (phone landscape) — the
           root clips, so the workspace itself must scroll. */
        overflow-y: auto;
      }
      .editor.fullscreen .side {
        flex: 0 0 auto;
        max-height: 40vh;
      }
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
      color: var(--text-primary-color, #fff);
      border-color: var(--primary-color, #03a9f4);
    }
    button.danger {
      color: var(--error-color, #db4437);
    }
    button[disabled] {
      opacity: 0.4;
      cursor: not-allowed;
    }
    /* The canvas is focusable so keyboard shortcuts only fire while working in
       the editor; only show the ring for keyboard focus, not pointer clicks. */
    .canvas-wrap:focus {
      outline: none;
    }
    .canvas-wrap:focus-visible {
      outline: 2px solid var(--primary-color, #03a9f4);
      outline-offset: -2px;
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
    /* Toolbar icons sit inline with their labels; smaller than content icons. */
    .toolbar ha-icon {
      --mdc-icon-size: 16px;
    }
    .seg button {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    /* === Popovers (floor gear, + Add). The backdrop is a fixed transparent
       layer below the popover that closes it on any outside click. === */
    .pop-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .pop {
      position: absolute;
      top: calc(100% + 6px);
      right: 0;
      z-index: 20;
      min-width: 220px;
      padding: 8px;
      background: var(--card-background-color, #fff);
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.18);
    }
    .pop.left {
      left: 0;
      right: auto;
    }
    .pop-backdrop {
      position: fixed;
      inset: 0;
      z-index: 19;
    }
    .pop-row {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 8px;
    }
    .pop-row label {
      flex: 0 0 60px;
      font-size: 12px;
      color: var(--secondary-text-color);
    }
    .pop-row input,
    .pop-row select {
      flex: 1;
      min-width: 0;
      padding: 4px 6px;
      border-radius: 4px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
    }
    .pop-action {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      justify-content: center;
      font-size: 13px;
    }
    .add-pop {
      min-width: 300px;
    }
    .add-entry {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      border: none;
      background: none;
      padding: 6px 8px;
      border-radius: 6px;
      text-align: left;
      font-size: 13px;
    }
    .add-entry:hover {
      background: var(--secondary-background-color, #f5f5f5);
    }
    .add-furn-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--divider-color, #eee);
    }
    .furn-cell {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      border: none;
      background: none;
      padding: 6px 2px;
      border-radius: 6px;
      font-size: 11px;
      color: var(--secondary-text-color);
      text-transform: none;
    }
    .furn-cell:hover {
      background: var(--secondary-background-color, #f5f5f5);
    }
    .furn-cell svg {
      position: static;
      width: 38px;
      height: 30px;
      display: block;
    }
    /* === Canvas chrome: the zoom overlay and first-run hint live on a
       relative wrapper OUTSIDE the scroll container so they don't scroll
       away with the stage. === */
    .canvas-outer {
      position: relative;
    }
    .zoom-overlay {
      position: absolute;
      right: 26px;
      bottom: 12px;
      z-index: 2;
      display: flex;
      gap: 4px;
    }
    .zoom-overlay button {
      display: inline-flex;
      align-items: center;
      padding: 3px 7px;
      font-size: 12px;
      background: var(--card-background-color, #fff);
    }
    .zoom-overlay ha-icon {
      --mdc-icon-size: 15px;
    }
    .zoom-val-btn {
      min-width: 46px;
      justify-content: center;
    }
    .empty-hint {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 16px;
      font-size: 14px;
      line-height: 1.6;
      color: var(--secondary-text-color);
      /* Never block the first wall being drawn straight through the hint. */
      pointer-events: none;
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
      stroke: var(--card-background-color, #fff);
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
    /* Element header: kind icon + summary + the selection's actions. */
    .edit-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .edit-head ha-icon {
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
    }
    .edit-head .edit-title {
      font-size: 13px;
      font-weight: 600;
    }
    .edit-head .head-spacer {
      flex: 1;
    }
    .edit-head button {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
    }
    .edit-head button ha-icon {
      --mdc-icon-size: 16px;
      color: inherit;
    }
    /* Collapsible Project section header. */
    .section-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      border: none;
      background: none;
      padding: 2px 0;
      margin: 0;
      cursor: pointer;
      color: var(--secondary-text-color);
      text-align: left;
    }
    .section-toggle ha-icon {
      --mdc-icon-size: 16px;
    }
    .section-toggle .section-title-inline {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .section-toggle .section-summary {
      font-size: 12px;
      color: var(--secondary-text-color);
      opacity: 0.8;
      text-transform: none;
    }
    .panel-body {
      margin-top: 10px;
    }
    /* Field rows flow into responsive columns so the below-canvas sections
       stay short at HA-dialog width (~700px fits two columns). Rows that
       need the full width (entity pickers, long hints) opt out via .wide. */
    .rows {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      column-gap: 16px;
      align-items: start;
    }
    .rows .row.wide,
    .rows > .hint,
    .rows > p {
      grid-column: 1 / -1;
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
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-card-editor": FloorplanCardEditor;
  }
}
