import { LitElement, html, css, svg, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
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
  ItemKind,
  ItemReading,
  Tracker,
  TrackerSensor,
  Area,
  AreaPoint,
  HaAreaInfo,
  StateColorRule,
  OverlayScale,
} from "./types";
import {
  normalizeSymbol,
  symbolCatalog,
  symbolMatches,
  symbolSize,
  type SymbolCatalog,
  type SymbolDef,
} from "./symbols";
import {
  DEFAULT_CUSTOM_PERCENT,
  DEFAULT_GRID,
  DEFAULT_ITEM_SIZE,
  MIN_TOUCH_TARGET,
  DEFAULT_TEXT_SIZE,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_RIPPLE_DIRECTION,
  DEFAULT_RIPPLE_WIDTH,
  DEFAULT_TRACKER_DOT_SIZE,
  configsEqual,
  emptyConfig,
  getFloors,
  gridPercentToSnap,
  makeFloor,
  haFloorsOf,
  haAreasOf,
  areaNamePatch,
  entityIdsInHaArea,
  areaFiltersEntities,
  moveFloor,
  resolveSnap,
  snapToGridPercent,
  trackerPresenceDetected,
  uid,
  DEFAULT_GLOW_RADIUS,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  renderWallMask,
  imageFitRatio,
  editorGlowPaint,
  renderGlow,
  resolveOpeningAmount,
  openingIsActive,
  wallsLightPassesThrough,
  glowClearSpan,
  openingHasTwoLeaves,
  secondLeafOf,
  renderGlowMask,
  openingDefaultOpen,
  openingMotion,
  shutterStyleOf,
  shutterAmount,
  shutterActive,
  shutterMarkIcon,
  shutterMarkPoint,
  shutterMarkNormal,
  openingMarkIcon,
  openingMarkPoint,
  openingMarkNormal,
  hasOpeningMark,
  SHUTTER_MARK_PIXEL_OFFSET,
  SHUTTER_MARK_SIZE,
  SHUTTER_MARK_ICON_SIZE,
  hasShutterMark,
  openingFromDeviceClass,
  renderRipple,
  renderFurniture,
  renderTracker,
  renderArea,
  renderAreaBorder,
  renderDeadSpace,
  renderDeadSpaceHatch,
  trackerSensorReading,
  kindFromEntity,
  resolveItemIcon,
  resolveStateColor,
  entityIsActive,
  lightBadgePaint,
  itemRawValue,
  isRippleEntity,
  badgeContentOf,
  editorItemLabel,
  badgeValue,
  badgeReading,
  badgeValueSize,
  itemHiddenWhenInactive,
  resolveIconAnimation,
  itemIconSize,
  itemLabelSize,
  textLabel,
  labelPositionOf,
  itemReadings,
  itemHasLabel,
  snapToWall,
  collectWatchedEntities,
  hassRenderInputsChanged,
  wallStrokeStyle,
  normalizeOverlayScale,
  overlayLength,
} from "./render";
import { deadSpacesCached } from "./dead-space";
import { cssColor, cssColorOr, cssNumber, contrastText } from "./css-safe";
import { skinStyle, skinTokens, SKIN_ACCENT, SKIN_PAPER, SKIN_TEXT, SKIN_WALL } from "./skins";
import {
  ENDPOINT_SNAP,
  applyDelta,
  areaContainingPoint,
  attachedCorners,
  elementsAtPoint,
  cyclePick,
  isLocked,
  movableSelection,
  elementsInRect,
  layoutPointsInPolygon,
  nearestAreaSnapPoint,
  nearestCorner,
  snapWallEnd,
  type AttachedCorner,
  type OrigPos,
  type Rect,
  type Sel,
  type SelKind,
} from "./editor-geometry";
import { FrameCoalescer, rafScheduler } from "./frame-coalescer";
import { applyCardConfig } from "./editor-save";
import type { AreaEntityScope } from "./editor-forms";
import {
  furnitureChoices,
  furnitureLabel,
  areaForm,
  areaNameForm,
  diffFormValue,
  floorImageForm,
  furnitureForm,
  isLiveField,
  formSlice,
  itemEntityForm,
  itemIdentityForm,
  itemShowStateForm,
  itemLabelForm,
  itemBadgeForm,
  itemEffectsForm,
  itemBehaviourForm,
  itemHasRipple,
  normalizeFormPatch,
  openingForm,
  projectForm,
  projectDeadSpaceForm,
  projectDisplayForm,
  projectPressForm,
  projectReplayForm,
  projectSkinForm,
  projectSunForm,
  projectReliefForm,
  textForm,
  trackerForm,
  wallForm,
  itemGroup7aForm,
  type FormField,
  type FormSpec,
} from "./editor-forms";

const formLabel = (s: FormField): string => s.label;
const formHelper = (s: FormField): string | undefined => s.helper;

type Tool = "select" | "wall" | "door" | "window" | "tracker" | "area";
type OverlaySel = { kind: "item" | "text"; id: string };

/** Toolbar metadata per tool: mdi icon + label (icons make the modes scannable). */
const TOOL_META: Record<Tool, { icon: string; label: string }> = {
  select: { icon: "mdi:cursor-default", label: "Select" },
  wall: { icon: "mdi:wall", label: "Wall" },
  door: { icon: "mdi:door", label: "Door" },
  window: { icon: "mdi:window-closed-variant", label: "Window" },
  tracker: { icon: "mdi:crosshairs-gps", label: "Tracker" },
  area: { icon: "mdi:vector-polygon", label: "Area" },
};

/** Icon shown in the Element header per selected element kind. */
const SEL_KIND_ICON: Record<SelKind, string> = {
  wall: "mdi:wall",
  opening: "mdi:door",
  item: "mdi:lightbulb-outline",
  text: "mdi:format-text",
  furniture: "mdi:sofa-outline",
  tracker: "mdi:crosshairs-gps",
  area: "mdi:floor-plan",
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
  /** Set when dragging a single Area vertex handle (index into its `points`). */
  areaVertex?: number;
  /**
   * Endpoints of *other* walls that coincide with the dragged wall's
   * corner(s) and stretch along with it (issue #30). Hold Alt to detach and
   * move just the grabbed wall.
   */
  attached?: AttachedCorner[];
  /** Set once the drag actually moved something (history snapshots lazily). */
  moved?: boolean;
  /** The exact history entry this drag pushed, so cancel can remove it by identity. */
  snapshot?: FloorplanCardConfig;
  /** The redo stack as it stood before the drag's history push cleared it. */
  priorFuture?: FloorplanCardConfig[];
  /**
   * Set if anything emitted while this drag was live. A drag normally emits
   * nothing until it is released, which is what lets cancel restore the
   * pre-drag config locally; if something did emit, the host has moved on and
   * has to be told to go back.
   */
  emitted?: boolean;
}

/**
 * One drag move, already resolved to canvas coordinates.
 *
 * Resolved where the event arrives rather than where it is applied: a pointer
 * event carries screen coordinates, and turning those into canvas coordinates
 * needs the SVG's CTM, which is live — scrolling the canvas (a plain wheel
 * does exactly that) or zooming changes it. Transforming a frame later would
 * read the *new* CTM against the *old* pointer position and place the element
 * off by the scroll delta.
 */
interface DragMove {
  x: number;
  y: number;
  altKey: boolean;
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
  areas: Area[];
}

/** Snap distance (virtual units) for openings onto walls. */
const WALL_SNAP = 35;
/**
 * How far the pointer may move between clicks and still count as "the same
 * spot" for click-cycling (issue #52), in **screen pixels**.
 *
 * This used to be measured in canvas units, which made the tolerance depend
 * on zoom: on a plan shown at a quarter scale, one canvas unit is a quarter
 * of a pixel, so a couple of pixels of ordinary hand tremor blew past it and
 * silently restarted the cycle — the last candidate in the stack (an Area)
 * was then unreachable in practice (issue #95). Screen space is where the
 * hand actually moves, so the tolerance belongs there.
 */
const PICK_EPS_PX = 8;
const HISTORY_MAX = 60;
/** How long Apply stays on "Saved" before returning to its idle label. */
const APPLY_SAVED_MS = 2000;
/** Angle (degrees) within which a drawn wall is snapped flat to horizontal/vertical. */
const WALL_AXIS_SNAP_DEG = 10;

/**
 * True when the event's composed path sits in a form field / picker — keys
 * typed there belong to the field, not the canvas. ha-form covers all its
 * inner controls — ha-select dropdowns have no native input in the event
 * path, so arrows/Escape/Delete would otherwise reach the canvas.
 */
function isTypingPath(path: EventTarget[]): boolean {
  return path.some((el) => {
    const node = el as HTMLElement;
    const tag = node.tagName?.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      tag === "select" ||
      tag === "ha-form" ||
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
  /**
   * While the Area tool is active, the polygon being built up click by click.
   * Closed by clicking back on `points[0]` once at least 3 points are placed.
   */
  @state() private _draftArea: { points: AreaPoint[] } | null = null;
  /** Live cursor position while drawing an Area, for the rubber-band preview segment. */
  @state() private _areaHover: AreaPoint | null = null;
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
  /**
   * Search query for the furniture picker (issue #90). Lives beside
   * `_addMenuOpen` and is cleared wherever that is, so reopening the popover
   * always shows the whole library rather than the last thing you looked for.
   */
  @state() private _addQuery = "";
  /** Paste-a-symbol box in the Project panel, and its last validation error. */
  @state() private _symbolDraft = "";
  @state() private _symbolError = "";
  /** Project section expanded? Collapsed by default — page settings are touched rarely. */
  @state() private _projectOpen = false;
  /**
   * Which config groups are expanded, by title (issue #205).
   *
   * Every group starts collapsed, so selecting a device shows its eight
   * headings rather than two dozen controls, and the thing you came for is one
   * click away instead of a scroll away.
   *
   * Keyed by title alone, deliberately: the titles are the panels' shared
   * vocabulary — "Color" means the same thing on a room, a device and a
   * shutter — so opening one and clicking through several elements keeps the
   * section you are working in open, instead of re-collapsing on every
   * selection. Not persisted: it is a view state, not config.
   *
   * Replaced rather than mutated on toggle — Lit compares by identity, and a
   * mutated Set is the same object.
   */
  @state() private _openGroups: ReadonlySet<string> = new Set();
  /**
   * Expanded (fullscreen) editing. HA renders the card config editor in a
   * narrow dialog (~480–560px), which is cramped for a visual canvas editor.
   * When true the `.editor` root is promoted to the top layer so the canvas
   * gets real room and the element/project sections dock beside it.
   */
  @state() private _fullscreen = false;
  /**
   * Apply (issue #198): "saving" while the dashboard write is in flight,
   * "saved" for a moment after, so the click has a visible answer — the card
   * that changed is on another tab, or behind the fullscreen workspace.
   */
  @state() private _applyState: "idle" | "saving" | "saved" = "idle";
  /** Why the last Apply didn't go through, shown beside the button. */
  @state() private _applyError = "";
  private _applyResetTimer: ReturnType<typeof setTimeout> | null = null;

  @query(".editor") private _editorEl?: HTMLElement;
  @query("svg") private _svg?: SVGSVGElement;
  @query(".canvas-wrap") private _canvasWrap?: HTMLElement;

  private _drag: Drag | null = null;
  /**
   * Drag moves are applied once per animation frame. A pointer reports faster
   * than the browser renders, and applying every raw move only queues work the
   * frame cannot finish, so the element falls further behind the longer the
   * drag lasts.
   */
  private _dragMoves = new FrameCoalescer<DragMove>(rafScheduler, (move) => {
    if (this._drag) this._applyDrag(move);
  });
  /** A drag changed the config and the host has not been told yet. */
  private _dragDirty = false;
  /**
   * Where the last plain selection click landed, for click-cycling through
   * overlapping elements (issue #52). Cleared whenever the pointer lands
   * somewhere else, so cycling only happens on repeat clicks in one spot.
   */
  private _pickAnchor: { clientX: number; clientY: number } | null = null;
  /**
   * Hide the canvas name labels while editing (issue #52). Editor view state
   * only — never written to the config, so it can't change what the live card
   * shows. A dense plan is much easier to aim at without them.
   */
  @state() private _hideLabels = false;
  /** Live touch points on the canvas wrap, for pinch-zoom (issue #38). */
  private _pinchPts = new Map<number, { x: number; y: number }>();
  /** Pinch baseline: finger distance, zoom, and centroid (content coords) at pinch start. */
  private _pinch: { d0: number; z0: number; cx: number; cy: number } | null = null;
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
    this._canvasWrap?.focus({ preventScroll: true });
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
    if (this._applyResetTimer !== null) clearTimeout(this._applyResetTimer);
    // HA's dialog reparents the editor, so this can land mid-drag. Removal
    // takes the pointer capture with it, so the gesture is over either way:
    // hand the host what the drag accumulated (_config is otherwise its only
    // copy of the edit, and a save sees only what config-changed delivered),
    // then end the gesture. Dropping the queued move rather than settling it
    // commits the position the canvas last actually drew — settling would be
    // safe too, now that a queued move carries no DOM dependency, but it would
    // commit a position that was never rendered. Clearing _gesturePointer is
    // not optional: it gates every new gesture, and the pointer it belongs to
    // can no longer report.
    this._dragMoves.cancel();
    this._flushDrag();
    this._drag = null;
    this._gesturePointer = null;
    this._resetPinch();
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

  /**
   * The shipped symbol library with this config's own `symbols:` merged over
   * it (issue #90). Memoized on the config's identity inside `symbolCatalog`,
   * so calling it per cell in the picker costs one lookup.
   */
  private _symbols(): SymbolCatalog {
    return symbolCatalog(this._config.symbols);
  }

  /** Discrete change to the active floor's elements (snapshots for undo). */
  private _commitFloor(partial: Partial<Floor>): void {
    this._commit({ ...this._config, floors: this._patchFloors(partial) });
  }

  /** Live change to the active floor's elements (no history snapshot — for dragging). */
  private _emitFloor(partial: Partial<Floor>): void {
    const config = { ...this._config, floors: this._patchFloors(partial) };
    // A drag owns the config until pointerup. Emitting per move asks HA to
    // re-render whatever card is being edited — for a stack, every child of it
    // — and to echo the config back through setConfig, which stalls the gesture
    // far longer than a frame. The canvas still follows the pointer: _config is
    // @state, so assigning it repaints the editor without involving the host.
    if (this._drag) {
      this._config = config;
      this._watchedEntities = collectWatchedEntities(config);
      this._dragDirty = true;
      return;
    }
    this._emit(config);
  }

  /** Hand the host what a drag accumulated — once, on release. */
  private _flushDrag(): void {
    if (!this._dragDirty) return;
    this._dragDirty = false;
    this._emit(this._config);
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
    void this._ensureHaComponents();
    // Upgrade the plain-input fallbacks in place whenever a component gets
    // defined later (by us or by another editor the user opened).
    for (const tag of [
      "ha-form",
      "ha-entity-picker",
      "ha-entity-attribute-picker",
      "ha-icon-picker",
      "ha-combo-box",
    ]) {
      if (!customElements.get(tag)) {
        void customElements.whenDefined(tag).then(() => this.requestUpdate());
      }
    }
    // Pinch-zoom (issue #38): capture phase, because element handlers on the
    // canvas (item badges, endpoint handles) stopPropagation and would hide a
    // finger that lands on them from the pinch tracker.
    const wrap = this._canvasWrap;
    if (wrap) {
      wrap.addEventListener("pointerdown", this._onWrapPointerDown, { capture: true });
      wrap.addEventListener("pointermove", this._onWrapPointerMove, { capture: true });
      wrap.addEventListener("pointerup", this._onWrapPointerEnd, { capture: true });
      wrap.addEventListener("pointercancel", this._onWrapPointerEnd, { capture: true });
      // Safari routes trackpad/touch pinch through proprietary gesture events
      // and zooms the whole page (the entire visual editor) unless they're
      // canceled — touch-action does not cover this path.
      for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
        wrap.addEventListener(type, this._preventGesture);
      }
    }
  }

  /**
   * Defensive pinch-state reset (review feedback on #57). The listeners
   * themselves stay attached on purpose: they live on an element inside our
   * own shadow root (no leak — they die with the instance), and HA's dialog
   * reparents the editor, which fires disconnected/connected without a second
   * firstUpdated — removing them here would permanently kill pinch after a
   * reparent. Clearing the *points* is what matters: a pointerup lost to the
   * reparent would leave a stale entry behind, and the next single tap would
   * read as a phantom second finger.
   */
  private _resetPinch(): void {
    this._pinchPts.clear();
    this._pinch = null;
  }

  private _preventGesture = (e: Event): void => e.preventDefault();

  // ---- pinch-zoom on the canvas (issue #38) -------------------------------

  private _onWrapPointerDown = (ev: PointerEvent): void => {
    if (ev.pointerType !== "touch") return;
    this._pinchPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this._pinchPts.size !== 2) return;
    // A second finger turns the gesture into a pinch: abort any draw/drag so
    // the canvas doesn't draw a wall while the user is only trying to zoom.
    this._cancelGesture();
    const wrap = this._canvasWrap;
    const rect = wrap?.getBoundingClientRect();
    const [a, b] = [...this._pinchPts.values()];
    this._pinch = {
      d0: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1),
      z0: this._zoom,
      cx: (a.x + b.x) / 2 - (rect?.left ?? 0) + (wrap?.scrollLeft ?? 0),
      cy: (a.y + b.y) / 2 - (rect?.top ?? 0) + (wrap?.scrollTop ?? 0),
    };
    ev.stopPropagation();
  };

  private _onWrapPointerMove = (ev: PointerEvent): void => {
    if (!this._pinch || !this._pinchPts.has(ev.pointerId)) return;
    this._pinchPts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this._pinchPts.size < 2) return;
    ev.preventDefault();
    ev.stopPropagation();
    const [a, b] = [...this._pinchPts.values()];
    const pinch = this._pinch;
    this._setZoom(pinch.z0 * (Math.hypot(b.x - a.x, b.y - a.y) / pinch.d0));
    // Keep the content point under the fingers stationary: the stage scales
    // with _zoom on the next render, so re-derive the scroll offset after it.
    void this.updateComplete.then(() => {
      const wrap = this._canvasWrap;
      if (!wrap || this._pinch !== pinch) return;
      const rect = wrap.getBoundingClientRect();
      const scale = this._zoom / pinch.z0;
      wrap.scrollLeft = pinch.cx * scale - ((a.x + b.x) / 2 - rect.left);
      wrap.scrollTop = pinch.cy * scale - ((a.y + b.y) / 2 - rect.top);
    });
  };

  private _onWrapPointerEnd = (ev: PointerEvent): void => {
    if (ev.pointerType !== "touch") return;
    this._pinchPts.delete(ev.pointerId);
    if (this._pinchPts.size < 2) this._pinch = null;
  };

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
   * `ha-form` and the pickers are only defined once HA loads an editor that
   * imports them. The button-card editor statically imports ha-form (and the
   * ui_action selector chain); the entities editor defines ha-entity-picker
   * for the custom tracker rows. Every selector rendered by ha-form
   * lazy-loads its own picker after that.
   */
  private async _ensureHaComponents(): Promise<void> {
    if (customElements.get("ha-form") && customElements.get("ha-entity-picker")) return;
    const helpers = await (window as unknown as { loadCardHelpers?: () => Promise<any> })
      .loadCardHelpers?.();
    if (!helpers) return;
    for (const config of [{ type: "button" }, { type: "entities", entities: [] }]) {
      try {
        const card = await helpers.createCardElement(config);
        await card?.constructor?.getConfigElement?.();
      } catch {
        // Fall back to plain inputs; the whenDefined hooks upgrade late arrivals.
      }
    }
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

  /** Grid update plus a custom-snap rescale so its percentage of the grid is preserved. */
  private _gridPatch(newGrid: number): Partial<FloorplanCardConfig> {
    const patch: Partial<FloorplanCardConfig> = { grid: newGrid };
    if (this._snapMode === "custom") {
      const pct = snapToGridPercent(this._config.snap as number, this.grid);
      patch.snap = gridPercentToSnap(pct, newGrid);
    }
    return patch;
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

  /**
   * Snap a raw point for Area drawing/editing: nearby wall corner or another
   * Area's vertex wins (so adjacent rooms can share an exact boundary point),
   * else the grid/snap step. `exclude` drops one vertex from the candidate
   * set — the one currently being dragged, so it can't snap to itself.
   */
  private _snapAreaPoint(
    rawX: number,
    rawY: number,
    exclude?: { areaId: string; vertexIndex: number }
  ): AreaPoint {
    return (
      nearestAreaSnapPoint(this._floor(), rawX, rawY, ENDPOINT_SNAP, exclude) ?? {
        x: this._snap(rawX),
        y: this._snap(rawY),
      }
    );
  }

  /**
   * Like {@link _snapWallPoint}, but ignores endpoints in `moving` (keys
   * `${wallId}:${end}`) — the corner cluster being dragged must not attract
   * itself.
   */
  private _snapWallPointExcluding(
    rawX: number,
    rawY: number,
    moving: ReadonlySet<string>
  ): { x: number; y: number } {
    let best: { x: number; y: number } | null = null;
    let bestDist = ENDPOINT_SNAP;
    for (const w of this._floor().walls) {
      for (const end of [1, 2] as const) {
        if (moving.has(`${w.id}:${end}`)) continue;
        const x = end === 1 ? w.x1 : w.x2;
        const y = end === 1 ? w.y1 : w.y2;
        const d = Math.hypot(rawX - x, rawY - y);
        if (d < bestDist) {
          bestDist = d;
          best = { x, y };
        }
      }
    }
    return best ?? { x: this._snap(rawX), y: this._snap(rawY) };
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
    if (this._drag) this._drag.emitted = true;
    this._config = config;
    // Recompute here, not just in setConfig: real HA deep-equal-skips the
    // setConfig echo of our own emission, so entities bound during the
    // session would otherwise never enter the watched set.
    this._watchedEntities = collectWatchedEntities(config);
    // Emit without the legacy flat arrays: `floors` is the source of truth,
    // and empty stubs would otherwise be persisted into the user's YAML.
    const out = { ...config };
    for (const key of ["walls", "openings", "items", "texts", "furniture", "trackers", "areas"] as const) {
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
    const gestureActive = !!(
      this._drag ||
      this._draft ||
      this._draftTracker ||
      this._draftArea ||
      this._marquee
    );
    // Backspace pops the last placed vertex instead of deleting a selected
    // element while an Area draft is in progress (checked ahead of the
    // gestureActive bail so it isn't swallowed by that guard).
    if (ev.key === "Backspace" && this._draftArea?.points.length) {
      ev.preventDefault();
      const pts = this._draftArea.points.slice(0, -1);
      this._draftArea = pts.length ? { points: pts } : null;
      return;
    }
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
        this._addQuery = "";
        return;
      }
      if (this._draft || this._draftTracker || this._draftArea || this._marquee || this._drag) {
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
    // Every selected element is pinned, so there is nothing to move. Return
    // before committing: `_commitFloor` pushes a history entry unconditionally
    // and `.map()` below hands it freshly allocated arrays, so an arrow key on
    // a locked selection would otherwise spend an undo step on nothing — and
    // wipe the redo stack while doing it (issue #191).
    if (!movableSelection(f, this._selection).length) return;
    // Pinned elements sit out the nudge as they sit out a drag (issue #191).
    // Filtered per kind rather than from the selection, because _idsOfKind
    // also feeds copy and delete, which a lock deliberately does not block.
    const movable = (kind: SelKind) => {
      const ids = this._idsOfKind(kind);
      for (const id of ids) if (isLocked(f, { kind, id })) ids.delete(id);
      return ids;
    };
    const wIds = movable("wall");
    const oIds = movable("opening");
    const iIds = movable("item");
    const tIds = movable("text");
    const fIds = movable("furniture");
    const trIds = movable("tracker");
    const aIds = movable("area");
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
      areas: (f.areas ?? []).map((a) =>
        aIds.has(a.id) ? { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : a
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
    this._canvasWrap?.focus({ preventScroll: true });
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
    if (this._tool === "area") {
      // Discrete clicks, like door/window — no drag capture/gesture pointer.
      const pt = this._snapAreaPoint(raw.x, raw.y);
      if (!this._draftArea) {
        this._draftArea = { points: [pt] };
        return;
      }
      const pts = this._draftArea.points;
      const first = pts[0]!;
      if (pts.length >= 3 && Math.hypot(pt.x - first.x, pt.y - first.y) <= ENDPOINT_SNAP) {
        this._finishArea();
        return;
      }
      const last = pts[pts.length - 1]!;
      if (pt.x !== last.x || pt.y !== last.y) {
        this._draftArea = { points: [...pts, pt] };
      }
      return;
    }
    // Select tool, empty canvas: start a marquee (rubber-band) selection.
    // Clicking empty space also ends any cycling run (issue #52).
    this._pickAnchor = null;
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
    // Whatever the drag accumulated is about to be replaced by its snapshot.
    this._dragMoves.cancel();
    this._dragDirty = false;
    this._gesturePointer = null;
    this._draft = null;
    this._draftTracker = null;
    this._draftArea = null;
    this._areaHover = null;
    this._marquee = null;
    const drag = this._drag;
    this._drag = null;
    if (drag?.moved && drag.snapshot) {
      this._history = this._history.filter((c) => c !== drag.snapshot);
      if (drag.emitted) {
        this._emit(drag.snapshot);
      } else {
        // Nothing emitted while the drag was live, so the host still holds
        // exactly this config: restore locally and spare it a full re-render.
        // _lastEmitted stays as it is — it still describes the last thing
        // actually emitted.
        this._config = drag.snapshot;
        this._watchedEntities = collectWatchedEntities(drag.snapshot);
      }
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
    if (this._tool === "area" && this._draftArea) {
      const raw = this._toVirtual(ev, false);
      this._areaHover = this._snapAreaPoint(raw.x, raw.y);
      return;
    }
    if (this._marquee) {
      const raw = this._toVirtual(ev, false);
      this._marquee = { ...this._marquee, x1: raw.x, y1: raw.y };
      return;
    }
    if (this._drag) this._dragMoves.push({ ...this._toVirtual(ev, false), altKey: ev.altKey });
  }

  private _onCanvasUp(ev: PointerEvent): void {
    if (this._foreignPointer(ev)) return;
    // Land on the last position the pointer reported, not on whatever the
    // previous frame caught — settle while _drag is still set.
    this._dragMoves.settle();
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
      this._flushDrag();
    }
  }

  /** All active-floor elements whose center lies inside the marquee rect. */
  private _elementsInRect(m: Marquee): Sel[] {
    return elementsInRect(this._floor(), m);
  }

  // ---- dragging existing elements ----------------------------------------

  /**
   * Which element a plain click should actually select (issue #52). The
   * element whose hit area received the event is only a starting point: a big
   * tracker zone or an Area polygon can sit over a device, so we hit-test the
   * point geometrically and take the most *specific* candidate. Clicking again
   * without moving steps to the next candidate underneath and wraps, which is
   * what makes buried elements reachable at all.
   *
   * Modifier-clicks (multi-select) and explicit handles keep their old
   * behavior — they address one element on purpose.
   */
  private _resolvePick(ev: PointerEvent, sel: Sel): Sel {
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) return sel;
    const p = this._toVirtual(ev, false);
    const candidates = elementsAtPoint(this._floor(), p.x, p.y, {
      itemSize: DEFAULT_ITEM_SIZE,
      textSize: DEFAULT_TEXT_SIZE,
      wallThickness: WALL_THICKNESS,
      hass: this.hass,
    });
    const sameSpot =
      !!this._pickAnchor &&
      Math.hypot(ev.clientX - this._pickAnchor.clientX, ev.clientY - this._pickAnchor.clientY) <=
        PICK_EPS_PX;
    this._pickAnchor = { clientX: ev.clientX, clientY: ev.clientY };
    return cyclePick(candidates, this._selection, sameSpot) ?? sel;
  }

  private _startDrag(ev: PointerEvent, sel: Sel, endpoint?: 1 | 2, areaVertex?: number): void {
    if (this._tool !== "select") return;
    ev.stopPropagation();
    if (this._gesturePointer !== null) return;
    this._canvasWrap?.focus({ preventScroll: true });
    // Endpoint/vertex handles always operate on that single element; every
    // other click goes through the overlap-aware picker (issue #52).
    const explicitHandle = endpoint != null || areaVertex != null;
    const pick = explicitHandle ? sel : this._resolvePick(ev, sel);
    if (explicitHandle) this._selectOne(pick);
    else this._selectForPointer(ev, pick);
    // A locked element selects but never drags (issue #191). Refused here
    // rather than inside _applyDrag so it covers the handle branches too —
    // a wall endpoint and an area vertex are written straight to the floor
    // and never consult the drag snapshot that pins everything else.
    // The selection above stands; nothing else happens. No `_drag`, no
    // captured pointer and no `_gesturePointer`, so pointermove has nothing
    // to apply — and `ev.stopPropagation()` at the top already kept the
    // canvas marquee out of it.
    if (isLocked(this._floor(), pick)) return;
    this._drag = {
      primary: pick,
      start: this._toVirtual(ev, false),
      orig: this._snapshotSelection(),
      endpoint,
      areaVertex,
    };
    if (pick.kind === "wall") this._drag.attached = this._attachedCorners(pick.id, endpoint);
    this._gesturePointer = ev.pointerId;
    this._capturePointer(ev);
  }

  /** See {@link attachedCorners}: shared room corners that stretch with this wall. */
  private _attachedCorners(wallId: string, endpoint?: 1 | 2): Drag["attached"] {
    return attachedCorners(this._floor().walls, wallId, endpoint);
  }

  /** Capture the start positions of every selected element on the active floor. */
  private _snapshotSelection(): Map<string, OrigPos> {
    const f = this._floor();
    const m = new Map<string, OrigPos>();
    for (const s of this._selection) {
      // What is not snapshotted does not move. That is the whole mechanism
      // for a pinned member of a group drag (issue #191): the delta is still
      // taken from the primary, and _applyDelta only writes the elements this
      // map names — so dragging a group by an unlocked handle leaves the
      // locked ones exactly where they were.
      if (isLocked(f, s)) continue;
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
      } else if (s.kind === "area") {
        const a = (f.areas ?? []).find((x) => x.id === s.id);
        if (a) m.set(`area:${a.id}`, { kind: "polygon", points: a.points.map((p) => ({ ...p })) });
      } else {
        // tracker — stored by top-left corner.
        const tr = (f.trackers ?? []).find((x) => x.id === s.id);
        if (tr) m.set(`tracker:${tr.id}`, { kind: "pt", x: tr.x, y: tr.y });
      }
    }
    return m;
  }

  private _applyDrag(p: DragMove): void {
    const drag = this._drag!;
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

    // Single wall endpoint handle: snaps to nearby wall corners. Coincident
    // corners of other walls travel along (Alt detaches), so dragging a room
    // corner stretches the room (issue #30).
    if (drag.endpoint) {
      const attach = p.altKey ? [] : (drag.attached ?? []);
      // The moving cluster must not be a snap candidate for itself — the
      // dragged corner would stick to its own last emitted position.
      const moving = new Set<string>([
        `${drag.primary.id}:${drag.endpoint}`,
        ...attach.map((a) => `${a.id}:${a.end}`),
      ]);
      const target = this._snapWallPointExcluding(p.x, p.y, moving);
      const walls = f.walls.map((w) => {
        let out = w;
        if (w.id === drag.primary.id)
          out = drag.endpoint === 1
            ? { ...out, x1: target.x, y1: target.y }
            : { ...out, x2: target.x, y2: target.y };
        for (const a of attach) {
          if (a.id !== w.id) continue;
          out = a.end === 1
            ? { ...out, x1: target.x, y1: target.y }
            : { ...out, x2: target.x, y2: target.y };
        }
        return out;
      });
      this._emitFloor({ walls });
      return;
    }

    // Single Area vertex handle: reshape just that point, snapping to nearby
    // wall corners / other areas' vertices (decision #1/#4 in areas.md). Like
    // the wall-endpoint branch above, this positions absolutely against the
    // live floor data rather than a delta off the pre-drag snapshot, and has
    // no "stretch neighboring corners" step — a vertex only ever moves alone.
    if (drag.primary.kind === "area" && drag.areaVertex != null) {
      const idx = drag.areaVertex;
      const target = this._snapAreaPoint(p.x, p.y, { areaId: drag.primary.id, vertexIndex: idx });
      const areas = (f.areas ?? []).map((a) =>
        a.id === drag.primary.id
          ? { ...a, points: a.points.map((pt, i) => (i === idx ? target : pt)) }
          : a
      );
      this._emitFloor({ areas });
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
    // Any fixed vertex works as the delta-tracking reference for a whole-
    // polygon (Area) drag — every point moves by the same delta regardless.
    const refX = ref.kind === "wall" ? ref.x1 : ref.kind === "polygon" ? ref.points[0]!.x : ref.x;
    const refY = ref.kind === "wall" ? ref.y1 : ref.kind === "polygon" ? ref.points[0]!.y : ref.y;
    const dx = this._snap(refX + (p.x - drag.start.x)) - refX;
    const dy = this._snap(refY + (p.y - drag.start.y)) - refY;
    let patch = this._applyDelta(dx, dy, drag.orig);
    // Whole-wall drag: shared corners of neighboring walls follow (issue #30),
    // unless Alt detaches or the neighbor is itself part of the selection
    // (then it already translated with the group).
    if (drag.attached?.length && !p.altKey) {
      const walls = (patch.walls ?? f.walls).map((w) => {
        let out = w;
        for (const a of drag.attached!) {
          if (a.id !== w.id || drag.orig.has(`wall:${a.id}`)) continue;
          out = a.end === 1
            ? { ...out, x1: a.x0 + dx, y1: a.y0 + dy }
            : { ...out, x2: a.x0 + dx, y2: a.y0 + dy };
        }
        return out;
      });
      patch = { ...patch, walls };
    }
    this._emitFloor(patch);
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
    this._canvasWrap?.focus({ preventScroll: true });
    const pick = this._resolvePick(ev, sel);
    this._selectForPointer(ev, pick);
    this._drag = {
      primary: pick,
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
    if (this._drag) this._dragMoves.push({ ...this._toVirtual(ev, false), altKey: ev.altKey });
  }

  private _onOverlayUp(ev: PointerEvent): void {
    if (this._foreignPointer(ev)) return;
    this._dragMoves.settle();
    this._gesturePointer = null;
    if (this._drag) {
      this._drag = null;
      this._releasePointer(ev, ev.currentTarget as Element);
      this._flushDrag();
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

  private _addFurniture(type: string): void {
    const size = symbolSize(type, this._symbols());
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

  /** Close the in-progress Area draft into a committed polygon and select it. */
  private _finishArea(): void {
    if (!this._draftArea || this._draftArea.points.length < 3) return;
    const area: Area = { id: uid("area"), points: this._draftArea.points, showName: true };
    this._commitFloor({ areas: [...(this._floor().areas ?? []), area] });
    this._selection = [{ kind: "area", id: area.id }];
    this._draftArea = null;
    this._areaHover = null;
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
    const aIds = this._idsOfKind("area");
    this._commitFloor({
      walls: f.walls.filter((w) => !wIds.has(w.id)),
      openings: f.openings.filter((o) => !oIds.has(o.id)),
      items: f.items.filter((i) => !iIds.has(i.id)),
      texts: f.texts.filter((t) => !tIds.has(t.id)),
      furniture: f.furniture.filter((fu) => !fIds.has(fu.id)),
      trackers: (f.trackers ?? []).filter((tr) => !trIds.has(tr.id)),
      areas: (f.areas ?? []).filter((a) => !aIds.has(a.id)),
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
    const aIds = this._idsOfKind("area");
    this._clipboard = structuredClone({
      walls: f.walls.filter((w) => wIds.has(w.id)),
      openings: f.openings.filter((o) => oIds.has(o.id)),
      items: f.items.filter((it) => iIds.has(it.id)),
      texts: f.texts.filter((t) => tIds.has(t.id)),
      furniture: f.furniture.filter((fu) => fIds.has(fu.id)),
      trackers: (f.trackers ?? []).filter((tr) => trIds.has(tr.id)),
      areas: (f.areas ?? []).filter((a) => aIds.has(a.id)),
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
    // A pasted copy is never pinned (issue #191). It lands offset from the
    // original and the first thing anyone does with it is put it somewhere —
    // inheriting the lock would hand back a copy that cannot be moved into
    // place, which reads as the paste being broken rather than as a lock.
    const loose = { locked: undefined };
    const newWalls: Wall[] = cb.walls.map((w) => ({
      ...w,
      ...loose,
      id: uid("wall"),
      x1: w.x1 + off,
      y1: w.y1 + off,
      x2: w.x2 + off,
      y2: w.y2 + off,
    }));
    const newOpenings: Opening[] = cb.openings.map((o) => ({
      ...o,
      ...loose,
      id: uid(o.type),
      x: o.x + off,
      y: o.y + off,
    }));
    const newItems: FloorItem[] = cb.items.map((it) => ({
      ...it,
      ...loose,
      id: uid("item"),
      x: it.x + off,
      y: it.y + off,
    }));
    const newTexts: FloorText[] = cb.texts.map((t) => ({
      ...t,
      ...loose,
      id: uid("text"),
      x: t.x + off,
      y: t.y + off,
    }));
    const newFurn: Furniture[] = cb.furniture.map((fu) => ({
      ...fu,
      ...loose,
      id: uid("furn"),
      x: fu.x + off,
      y: fu.y + off,
    }));
    const newTrackers: Tracker[] = (cb.trackers ?? []).map((tr) => ({
      ...tr,
      ...loose,
      id: uid("tracker"),
      x: tr.x + off,
      y: tr.y + off,
    }));
    const newAreas: Area[] = (cb.areas ?? []).map((a) => ({
      ...a,
      ...loose,
      id: uid("area"),
      points: a.points.map((p) => ({ x: p.x + off, y: p.y + off })),
    }));
    this._commitFloor({
      walls: [...f.walls, ...newWalls],
      openings: [...f.openings, ...newOpenings],
      items: [...f.items, ...newItems],
      texts: [...f.texts, ...newTexts],
      furniture: [...f.furniture, ...newFurn],
      trackers: [...(f.trackers ?? []), ...newTrackers],
      areas: [...(f.areas ?? []), ...newAreas],
    });
    this._selection = [
      ...newWalls.map((w) => ({ kind: "wall" as const, id: w.id })),
      ...newOpenings.map((o) => ({ kind: "opening" as const, id: o.id })),
      ...newItems.map((it) => ({ kind: "item" as const, id: it.id })),
      ...newTexts.map((t) => ({ kind: "text" as const, id: t.id })),
      ...newFurn.map((fu) => ({ kind: "furniture" as const, id: fu.id })),
      ...newTrackers.map((tr) => ({ kind: "tracker" as const, id: tr.id })),
      ...newAreas.map((a) => ({ kind: "area" as const, id: a.id })),
    ];
    this._tool = "select";
  }

  private _duplicate(): void {
    this._copy();
    this._paste();
  }

  /**
   * Pin (or release) every selected element (issue #191). One history entry
   * for the whole selection, since it is one press.
   *
   * `undefined` rather than `false` when releasing: unlocked is the default,
   * so a released element goes back to saying nothing about it rather than
   * leaving `locked: false` behind in the YAML.
   */
  private _setLocked(locked: boolean): void {
    if (!this._selection.length) return;
    const f = this._floor();
    // `undefined` rather than `false` when releasing: unlocked is the default,
    // so a released element goes back to saying nothing about it rather than
    // leaving `locked: false` behind in the YAML.
    const flag = locked || undefined;
    const set = <T extends { id: string; locked?: boolean }>(xs: readonly T[], kind: SelKind) => {
      const ids = this._idsOfKind(kind);
      return xs.map((x) => (ids.has(x.id) ? { ...x, locked: flag } : x));
    };
    // One _commitFloor for the whole selection — one press, one undo step.
    this._commitFloor({
      walls: set(f.walls, "wall"),
      openings: set(f.openings, "opening"),
      items: set(f.items, "item"),
      texts: set(f.texts, "text"),
      furniture: set(f.furniture, "furniture"),
      trackers: set(f.trackers ?? [], "tracker"),
      areas: set(f.areas ?? [], "area"),
    });
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

  /**
   * Move the active floor one step up/down the list (issue #66) — the safe
   * alternative to reordering floor blocks by hand in YAML. Commits through
   * history, so a mis-move is one Ctrl+Z away.
   */
  private _moveFloor(delta: -1 | 1): void {
    const next = moveFloor(this._config.floors ?? [], this._activeFloorId, delta);
    if (next) this._commit({ ...this._config, floors: next });
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

  private _updateArea(id: string, partial: Partial<Area>): void {
    this._commitFloor({
      areas: (this._floor().areas ?? []).map((a) => (a.id === id ? { ...a, ...partial } : a)),
    });
  }

  /** Drop the HA-area link but keep the name the user sees on the plan. */
  private _unlinkHaArea(id: string): void {
    this._updateArea(id, { haArea: undefined });
  }

  /**
   * Status line under the Area's name field. The name doubles as the HA-area
   * link (see {@link areaNamePatch}), so the resulting association would
   * otherwise be invisible: this shows a "Linked" chip whenever `haArea` is
   * set, with an unlink button for the one intent the merged field can't
   * express — keeping the name while dropping the link.
   */
  private _renderAreaLinkRow(a: Area, haAreas: HaAreaInfo[]): TemplateResult {
    const linked = a.haArea ? haAreas.find((ha) => ha.area_id === a.haArea) : undefined;
    return html`
      <div class="row wide area-name-status">
        <label></label>
        ${a.haArea
          ? html`<span
              class="ha-link-chip"
              title=${`Linked to the Home Assistant area "${linked?.name ?? a.haArea}"`}
            >
              <ha-icon icon="mdi:link-variant"></ha-icon>Linked
              <button
                class="unlink"
                title="Keep this name but unlink the Home Assistant area"
                @click=${() => this._unlinkHaArea(a.id)}
              >
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
            </span>`
          : html`<span class="hint"
              >${haAreas.length
                ? "Name this room after a Home Assistant area to link it."
                : "No Home Assistant areas available."}</span
            >`}
      </div>
    `;
  }

  /**
   * The editor's colour control: a swatch that edits live as you drag, plus a
   * text box for theme variables and named colours, committed on change.
   * Emptying the text box clears the override.
   *
   * Every colour in this editor is one of these. It lived as eight copies of
   * the same markup before the colour rules below needed a ninth.
   */
  private _renderColorRow(opts: {
    label: string;
    value: string | undefined;
    /** Swatch colour shown when nothing is set — the effective default. */
    swatch: string;
    /** Text-box placeholder naming that default, e.g. "(primary)". */
    placeholder: string;
    onLive: (color: string) => void;
    onCommit: (color: string | undefined) => void;
    title?: string;
  }): TemplateResult {
    return html`
      <div class="row">
        <label title=${opts.title ?? nothing}>${opts.label}</label>
        <input
          type="color"
          title=${opts.title ?? nothing}
          .value=${opts.value ?? opts.swatch}
          @input=${(e: Event) => opts.onLive((e.target as HTMLInputElement).value)}
        />
        <input
          type="text"
          placeholder=${opts.placeholder}
          .value=${opts.value ?? ""}
          @change=${(e: Event) => opts.onCommit((e.target as HTMLInputElement).value || undefined)}
        />
      </div>
    `;
  }

  /**
   * An entity's `supported_features` bitmask, or 0 when it isn't in `hass`.
   * Handed to {@link openingForm} so its Tap field can name the default the
   * live card would take — which for a `cover` depends on whether it can
   * actually open and close.
   */
  private _supportedFeatures(id: string): number {
    return (this.hass?.states[id]?.attributes?.supported_features as number) ?? 0;
  }

  /**
   * The glyph a device shows when no state rule names one — what a rule's
   * empty icon box falls back to. Resolved exactly as the card resolves it,
   * with the rules removed so a currently-matching rule cannot report itself
   * as the default.
   */
  private _itemDefaultIcon(it: FloorItem): string {
    const st = it.entity ? this.hass?.states[it.entity] : undefined;
    return resolveItemIcon(
      { ...it, stateColor: undefined },
      st,
      it.entity ? this.hass?.entities?.[it.entity]?.icon : undefined
    );
  }

  /**
   * The device's icon, rendered here rather than up in the form (issue #127):
   * it is the same setting the state rules below override, so it belongs
   * beside them — like "Active color" beside the colours those rules replace.
   *
   * Unlike the colour it stays on screen once rules exist, because rules do
   * *not* replace it: a rule with no icon of its own falls through to this
   * one, which is what lets someone colour by state without naming the same
   * glyph in every row. Hiding it would strand a setting that is still
   * drawing.
   */
  private _renderItemIconRow(it: FloorItem): TemplateResult {
    const title = "Icon for this device; a state rule below can swap it";
    return html`
      <div class="row wide">
        <label title=${title}>Icon</label>
        ${this._renderIconPicker(it.icon ?? "", (icon) => this._updateItem(it.id, { icon: icon || undefined }), {
          // The entity's own glyph, so leaving the box empty is visibly a
          // choice rather than a blank.
          placeholder: this._itemDefaultIcon(it),
          title,
        })}
      </div>
      ${it.stateColor?.length
        ? html`<p class="hint rule-note">Shown while no rule below names an icon of its own.</p>`
        : nothing}
    `;
  }

  /**
   * Which fields each element panel's groups hold, in order.
   *
   * Declared as data rather than inline at the render site so the whole shape
   * of a panel can be read (and tested) in one place — every field a form
   * produces has to appear in exactly one group, or it silently stops being
   * editable.
   *
   * The criteria are the device panel's, applied to what each element actually
   * has: what it *is* first, then what it *reads*, then how it *looks*, then
   * what it *does*. Elements with only a couple of controls — a wall, a text —
   * are left ungrouped: a heading over a single field is chrome, not structure.
   */
  private static readonly OPENING_GROUPS = [
    // What it is, and how it is drawn.
    ["Shape", ["type", "motion", "length", "sash", "sashSpan", "hinge", "opens", "slide", "style", "angle"]],
    // Which contacts drive it — the opening's own, before the shutter's.
    ["What it reads", ["entity", "secondaryEntity", "invert"]],
    // How it behaves toward the sun (issue #177), which is neither shape nor
    // state but gets asked about as its own thing.
    ["Sunlight", ["glazed", "sunlight"]],
    // The shutter is a layer over the opening with its own entity, style,
    // side, second contact, badge and colour — so it gets its own group
    // rather than being scattered through the others.
    ["Shutter", [
      "shutterEntity",
      "shutterStyle",
      "shutterSide",
      "shutterSecondaryEntity",
      "shutterInvert",
      "showShutterIcon",
      "shutterIcon",
    ]],
    ["Badge", ["showIcon", "icon"]],
    // No fields of its own — the opening's accent is a colour row, not an
    // ha-form field. It is listed here so it lands in the same place in the
    // order as every other panel's Color group, rather than after Behavior.
    ["Color", []],
    ["Behavior", ["tapTarget", "tap_action", "hold_action", "double_tap_action"]],
  ] as const;

  private static readonly FURNITURE_GROUPS = [
    ["Shape", ["type", "hand", "w", "h", "angle"]],
    ["What it reads", ["entity"]],
    // What clicking it does — a staircase that changes floor (issue #121).
    ["Behavior", ["goToFloor"]],
  ] as const;

  private static readonly TRACKER_GROUPS = [
    ["Zone", ["w", "h", "x", "y", "angle"]],
    ["Marker", ["dotSize", "label"]],
  ] as const;

  /**
   * One titled group of the element panel, with a rule above it.
   *
   * The device panel had grown to two dozen controls in one flat run, in the
   * order they had been added rather than any order you would look for them
   * in. Grouping them costs a heading and a hairline each; what it buys is
   * that "where do I set the label position" has an answer you can guess.
   *
   * The heading is a disclosure button and the group starts collapsed (issue
   * #205): headings you can skim beat controls you have to scroll past, and
   * the panel now opens as a table of contents for the element. See
   * `_openGroups` for why the open set is keyed by title.
   *
   * Collapsed means *not rendered*, not hidden — so a closed group's `ha-form`
   * costs nothing, and reopening it rebuilds from `data` the same way a
   * selection change does.
   *
   * Takes the content rather than a field list because a group is rarely all
   * `ha-form` — the readings list, the icon row and the colour pickers are
   * hand-rolled, and they belong *inside* the group whose subject they share.
   */
  private _renderGroup(title: string, ...content: unknown[]): TemplateResult {
    const open = this._openGroups.has(title);
    return html`
      <div class="cfg-group ${open ? "open" : ""}">
        <button
          class="cfg-group-title"
          type="button"
          aria-expanded=${open}
          @click=${() => this._toggleGroup(title)}
        >
          <ha-icon icon=${open ? "mdi:chevron-down" : "mdi:chevron-right"}></ha-icon>
          <span>${title}</span>
        </button>
        ${open ? content : nothing}
      </div>
    `;
  }

  /** Open a collapsed config group, or collapse an open one. */
  private _toggleGroup(title: string): void {
    const next = new Set(this._openGroups);
    if (!next.delete(title)) next.add(title);
    this._openGroups = next;
  }

  /**
   * A device's other entities (issue #180): every reading beyond its own
   * state, added one at a time with "+ Add entity" rather than by putting four
   * entity dropdowns on every device that will never use them.
   *
   * Plain rows rather than `ha-form` fields for the same reason the state
   * rules are: the list is repeatable and `ha-form` has no selector for that.
   *
   * The attribute box is offered on every row, not only once an entity is
   * picked, because a row with an attribute and *no* entity is a real and
   * useful configuration — it reads that attribute off the device's own
   * entity, which is how one climate shows four of its own numbers. It is HA's
   * own attribute picker, so it lists what that entity actually has.
   */
  private _renderItemReadings(it: FloorItem): TemplateResult {
    // The pool as the card sees it, legacy pair included — so a device
    // configured before #180 shows its second entity here as the first row
    // rather than as an invisible extra the editor cannot reach.
    const list = itemReadings(it);
    // Writing the list writes the *whole* pool into `readings` and clears the
    // legacy keys, which is the migration: touch a device once and its config
    // stops using the old spelling. Done here rather than as a config-wide
    // upgrade so nothing rewrites a plan the user has not edited.
    const commit = (next: ItemReading[]): void =>
      this._updateItem(it.id, {
        readings: next.length ? next : undefined,
        secondaryEntity: undefined,
        secondaryAttribute: undefined,
        // `badgeEntity: "secondary"` meant index 0, which is where the legacy
        // pair still is — restate it as the index so the old spelling does not
        // outlive the keys it referred to.
        ...(it.badgeEntity === "secondary" ? { badgeEntity: 0 } : {}),
      });
    const patch = (i: number, part: Partial<ItemReading>): void =>
      commit(list.map((r, j) => (j === i ? { ...r, ...part } : r)));
    return html`
      <div class="row wide">
        <label title="Further entities and attributes whose readings join this device's label line"
          >Other entities</label
        >
      </div>
      ${list.map(
        (reading, i) => html`
          <div class="row wide item-reading">
            ${this._renderEntityPicker(
              reading.entity ?? "",
              (entity) => patch(i, { entity: entity || undefined }),
              undefined,
              // Scoped to the room the device sits in, exactly as its own
              // entity picker is — an extra reading is as likely to come from
              // the same room as the first one.
              this._areaEntitiesAt(it.x, it.y)?.entities
            )}
            ${this._renderAttributePicker(
              reading.entity || it.entity,
              reading.attribute ?? "",
              (attribute) => patch(i, { attribute: attribute || undefined }),
              "Read this attribute instead of the state — with no entity beside it, from this device's own entity"
            )}
            <button
              class="rule-remove"
              aria-label="Remove entity"
              title="Remove this entity"
              @click=${() => commit(list.filter((_, j) => j !== i))}
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
          <!-- Under its own entity, because it is about that entity and not
               about the device: an entity can be bound for the badge to read
               and kept out of the label text. -->
          <div class="row wide reading-show">
            <!-- The input is *inside* its label rather than paired to it by
                 id: the only id available here is the element's own, which
                 comes from config and can be anything, so a generated "for"
                 would be invalid or duplicated exactly when someone
                 hand-writes their YAML. Wrapping needs no id, and clicking
                 the words toggles the box either way. -->
            <label>
              <input
                type="checkbox"
                title="Off keeps this entity bound — the badge can still read it — without printing it in the label"
                .checked=${reading.showState !== false}
                @change=${(e: Event) =>
                  patch(i, {
                    // `true` is the default, so it stays out of the YAML.
                    showState: (e.target as HTMLInputElement).checked ? undefined : false,
                  })}
              />
              Show on label
            </label>
            <span class="hint"
              >${reading.showState === false
                ? "Bound but not printed — the badge can still read it."
                : "Its value joins the label line."}</span
            >
          </div>
        `
      )}
      <div class="row wide state-color-add">
        <button @click=${() => commit([...list, {}])}>
          <ha-icon icon="mdi:plus"></ha-icon>Add entity
        </button>
      </div>
      ${list.length
        ? html`<p class="hint rule-note">
            These show whether or not the device's own "Show state" above is on
            — that toggle is about the device's entity, not about these. Use
            each row's own "Show on label" to keep one bound without printing it.
          </p>`
        : nothing}
    `;
  }

  /**
   * The "Color by state" block (issues #68, #79, #82): a list of rules, each
   * one a condition and a colour, plus an "Add rule" button.
   *
   * A rule's condition is either a numeric threshold or an exact state, chosen
   * per row — the two ways an entity's value comes back. A rule with neither is
   * the fallback, and reads as "otherwise" in the UI.
   *
   * These are plain rows rather than `ha-form` fields: the list is repeatable
   * and ha-form has no selector for that (its `object` selector is a raw YAML
   * box). Colours are the one part of this editor that was always hand-rolled,
   * so the block still matches its neighbours.
   */
  private _renderStateColorRules(
    rules: StateColorRule[] | undefined,
    onChange: (next: StateColorRule[] | undefined) => void,
    opts?: { icons?: boolean; iconPlaceholder?: string }
  ): TemplateResult {
    const list = rules ?? [];
    const patch = (i: number, part: Partial<StateColorRule>): void => {
      const next = list.map((r, j) => (j === i ? { ...r, ...part } : r));
      onChange(next);
    };
    return html`
      <div class="row wide state-colors">
        <label
          title=${opts?.icons
            ? "Color the badge — and optionally swap its icon — by what the entity reads"
            : "Color the element by what its entity reads"}
          >${opts?.icons ? "Color & icon by state" : "Color by state"}</label
        >
      </div>
      ${list.map((rule, i) => {
        const mode = typeof rule.state === "string" ? "state" : typeof rule.above === "number" ? "above" : "else";
        return html`
          <div class="row wide state-color-rule">
            <select
              .value=${mode}
              title="When this rule applies"
              @change=${(e: Event) => {
                const m = (e.target as HTMLSelectElement).value;
                // Switching condition drops the other kind, so a rule can
                // never carry both an `above` and a `state`.
                patch(i, {
                  above: m === "above" ? (rule.above ?? 0) : undefined,
                  state: m === "state" ? (rule.state ?? "") : undefined,
                });
              }}
            >
              <option value="above">above</option>
              <option value="state">state is</option>
              <option value="else">otherwise</option>
            </select>
            ${mode === "above"
              ? html`<input
                  type="number"
                  class="cond"
                  .value=${String(rule.above ?? 0)}
                  @change=${(e: Event) =>
                    patch(i, { above: Number((e.target as HTMLInputElement).value) || 0 })}
                />`
              : mode === "state"
                ? html`<input
                    type="text"
                    class="cond"
                    placeholder="on"
                    .value=${rule.state ?? ""}
                    @change=${(e: Event) => patch(i, { state: (e.target as HTMLInputElement).value })}
                  />`
                : html`<span class="cond hint">any other value</span>`}
            <input
              type="color"
              .value=${rule.color || "#ff0000"}
              @input=${(e: Event) => patch(i, { color: (e.target as HTMLInputElement).value })}
            />
            <input
              type="text"
              class="rule-color-text"
              placeholder="red"
              .value=${rule.color ?? ""}
              @change=${(e: Event) => patch(i, { color: (e.target as HTMLInputElement).value })}
            />
            ${opts?.icons
              ? // Empty means "keep the device's icon", so the device's icon is
                // the placeholder — the rule shows what leaving it blank gives
                // you, and colour-only rules need no icon at all (issue #127).
                this._renderIconPicker(rule.icon ?? "", (icon) => patch(i, { icon: icon || undefined }), {
                  placeholder: opts.iconPlaceholder,
                  title: "Icon while this rule matches — empty keeps the device's own",
                })
              : nothing}
            <button
              class="rule-remove"
              aria-label="Remove rule"
              title="Remove this rule"
              @click=${() => {
                const next = list.filter((_, j) => j !== i);
                onChange(next.length ? next : undefined);
              }}
            >
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
          </div>
        `;
      })}
      <div class="row wide state-color-add">
        <button
          @click=${() =>
            onChange([
              ...list,
              // A fresh rule defaults to a threshold: the numeric case is what
              // both #68 and #82 ask for, and it's the one that needs no typing.
              { above: 0, color: "#ff0000" },
            ])}
        >
          <ha-icon icon="mdi:plus"></ha-icon>Add rule
        </button>
      </div>
    `;
  }

  /**
   * Entity ids to scope a picker to for something sitting at (x, y), or
   * undefined for "offer everything".
   *
   * An element inside an Area linked to a Home Assistant area gets its pickers
   * scoped to that area, unless the area's own "Filter entities" toggle turns
   * that off. Recomputed on every render from the live coordinates, so it
   * tracks the element as it's dragged in/out of the polygon, even before the
   * form reopens.
   */
  /**
   * The Area actively scoping the selected element's entity picker, if any —
   * i.e. the element is a device/furniture, it sits inside an Area, and that
   * Area is linked to an HA area with filtering on. The canvas animates this
   * one so it is obvious *which room you are working in* and why the picker
   * is short; nothing else in the editor communicated that.
   */
  private _scopingAreaId(): string | undefined {
    if (this._selection.length !== 1) return undefined;
    const sel = this._selection[0]!;
    const f = this._floor();
    const el =
      sel.kind === "item"
        ? f.items.find((x) => x.id === sel.id)
        : sel.kind === "furniture"
          ? f.furniture.find((x) => x.id === sel.id)
          : undefined;
    if (!el) return undefined;
    const area = areaContainingPoint(f, el.x, el.y);
    // Only when it actually narrows the picker: an unlinked area, or one with
    // nothing assigned in HA, filters nothing and must not claim otherwise.
    if (!areaFiltersEntities(area)) return undefined;
    return entityIdsInHaArea(this.hass, area!.haArea!).length ? area!.id : undefined;
  }

  private _areaEntitiesAt(x: number, y: number): AreaEntityScope | undefined {
    const area = areaContainingPoint(this._floor(), x, y);
    if (!areaFiltersEntities(area)) return undefined;
    const entities = entityIdsInHaArea(this.hass, area!.haArea!);
    // An area with nothing assigned to it in HA must not produce an empty
    // picker — the form treats an empty list as "no scoping" (see
    // areaScopedEntity), and the name lets it say so when it does scope.
    return { entities, name: area!.name };
  }

  /** Every entity in `area`'s linked HA area not already placed as an item on this floor. */
  private _pendingAreaEntities(area: Area): string[] {
    if (!area.haArea) return [];
    const existing = new Set(this._floor().items.map((it) => it.entity));
    return entityIdsInHaArea(this.hass, area.haArea).filter((id) => !existing.has(id));
  }

  /**
   * Add a device for every entity registered to `area`'s linked HA area that
   * isn't already placed as an item on this floor, laid out across the
   * polygon's interior (`layoutPointsInPolygon`) so the new icons spread out
   * instead of stacking on top of each other.
   */
  private _addAreaEntities(area: Area): void {
    const toAdd = this._pendingAreaEntities(area);
    if (!toAdd.length) return;
    const positions = layoutPointsInPolygon(area.points, toAdd.length);
    const newItems: FloorItem[] = toAdd.map((entity, i) => {
      const kind = kindFromEntity(entity);
      return {
        id: uid("item"),
        entity,
        x: Math.round(positions[i]!.x),
        y: Math.round(positions[i]!.y),
        kind,
        showState: kind === "sensor",
        showIcon: true,
        size: DEFAULT_ITEM_SIZE,
      };
    });
    this._commitFloor({ items: [...this._floor().items, ...newItems] });
    this._selection = newItems.map((it) => ({ kind: "item" as const, id: it.id }));
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

  private _updateAreaLive(id: string, partial: Partial<Area>): void {
    this._beginLive("area", id, partial);
    this._emitFloor({
      areas: (this._floor().areas ?? []).map((a) => (a.id === id ? { ...a, ...partial } : a)),
    });
  }

  private _patchConfigLive(partial: Partial<FloorplanCardConfig>): void {
    this._beginLive("config", "", partial);
    this._emit({ ...this._config, ...partial });
  }

  private _updateWallLive(id: string, partial: Partial<Wall>): void {
    this._beginLive("wall", id, partial);
    this._emitFloor({
      walls: this._floor().walls.map((w) => (w.id === id ? { ...w, ...partial } : w)),
    });
  }

  private _patchFloorLive(partial: Partial<Floor>): void {
    this._beginLive("floor", this._activeFloorId, partial);
    this._emitFloor(partial);
  }

  /** Route a form patch to the right per-kind update helper (commit or burst). */
  private _applyElementPatch(
    kind: "opening" | "item" | "text" | "furniture" | "tracker" | "wall" | "area",
    id: string,
    patch: Record<string, unknown>,
    live: boolean
  ): void {
    switch (kind) {
      case "opening":
        if (live) this._updateOpeningLive(id, patch);
        else this._updateOpening(id, patch);
        break;
      case "item":
        if (live) this._updateItemLive(id, patch);
        else this._updateItem(id, patch);
        break;
      case "text":
        if (live) this._updateTextLive(id, patch);
        else this._updateText(id, patch);
        break;
      case "furniture":
        if (live) this._updateFurnitureLive(id, patch);
        else this._updateFurniture(id, patch);
        break;
      case "tracker":
        if (live) this._updateTrackerLive(id, patch);
        else this._updateTracker(id, patch);
        break;
      case "wall":
        if (live) this._updateWallLive(id, patch);
        else this._updateWall(id, patch);
        break;
      case "area":
        if (live) this._updateAreaLive(id, patch);
        else this._updateArea(id, patch);
        break;
    }
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
        const label = furnitureLabel(fu.type, this._symbols());
        return `${label.charAt(0).toUpperCase()}${label.slice(1)} · ${Math.round(fu.w)}×${Math.round(fu.h)}`;
      }
      case "area": {
        const a = (f.areas ?? []).find((x) => x.id === sel.id);
        if (!a) return "Area";
        return `Area · ${a.name || `${a.points.length}-point`}`;
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
    } else if (t === "area") {
      label = "Area";
      const n = this._draftArea?.points.length ?? 0;
      body = html`
        <span class="ctx-hint">
          ${n === 0
            ? "Click to start a room outline; points snap to nearby corners."
            : n < 3
              ? `${n} point${n === 1 ? "" : "s"} placed — click to add more (3+ to close).`
              : `${n} points placed — click the first point to close the room, or keep adding.`}
        </span>
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
    // How the card will size this plan's badges and labels. The canvas honours
    // it so the editor previews the drawing rather than a version of it with
    // fixed-size furniture on top (issue #192): set a badge to 34 on a plan
    // 1200 wide and the number you see here is the one the card renders.
    const overlay = normalizeOverlayScale(c.overlayScale);
    // Which room, if any, is currently narrowing the selected element's
    // entity picker — animated on the canvas so the scoping is never a
    // mystery (see _scopingAreaId).
    const scopingAreaId = this._scopingAreaId();
    // Dead spaces (issue #88) — derived from the walls and openings, so they
    // follow every edit without anything being stored.
    const deadSpaceRings = c.showDeadSpaces
      ? deadSpacesCached(floor.walls, floor.openings)
      : [];
    // Walls as light meets them (issue #143), same as the card — so dropping a
    // door into a wall spills the pool through it while you are still drawing.
    // Skipped entirely on a floor with no cast light, which is most of them:
    // this sits on the path of every keystroke and drag in the editor.
    const lightWalls = floor.items.some((it) => it.glow)
      ? wallsLightPassesThrough(floor.walls, floor.openings, (o) => {
          const amt = (id?: string) =>
            resolveOpeningAmount(o, id ? this.hass?.states[id] : undefined);
          // Same reading as the card, second leaf included (issue #145),
          // glass admitted whole regardless of sash, and a shutter overriding
          // that — all same as the card.
          return glowClearSpan(
            o,
            amt(o.entity),
            o.secondaryEntity && openingHasTwoLeaves(o)
              ? resolveOpeningAmount(
                  secondLeafOf(o),
                  this.hass?.states[o.secondaryEntity]
                )
              : undefined,
            o.shutterEntity ? shutterAmount(this.hass?.states[o.shutterEntity], o.shutterInvert) : undefined
          );
        })
      : floor.walls;
    const floorEmpty =
      !floor.walls.length &&
      !floor.openings.length &&
      !floor.items.length &&
      !floor.texts.length &&
      !floor.furniture.length &&
      !(floor.trackers ?? []).length &&
      !(floor.areas ?? []).length;
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
                this._addQuery = "";
              }}
            ></div>`
          : nothing}
        <div class="toolbar">
          <!-- Tools — modes; exactly one is active at a time -->
          <div class="seg" role="group" aria-label="Tool">
            ${(["select", "wall", "door", "window", "tracker", "area"] as Tool[]).map(
              (t) => html`
                <button
                  class=${this._tool === t ? "active" : ""}
                  aria-pressed=${this._tool === t}
                  title=${TOOL_META[t].label}
                  @click=${() => {
                    this._tool = t;
                    this._draft = null;
                    this._draftTracker = null;
                    this._draftArea = null;
                    this._areaHover = null;
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

          <!-- Apply: save the plan to the dashboard and keep editing (issue
               #198). HA's own Save closes the dialog, and the preview beside
               the editor is too small to judge where an icon really lands, so
               checking one nudge cost a save, a close, a look, then reopening
               and re-expanding the editor. Next to Expand because that is
               where the need bites hardest: the fullscreen workspace covers
               HA's footer, Save included. -->
          <button
            class="apply-btn"
            ?disabled=${this._applyState === "saving"}
            title="Save to the dashboard without closing the editor — the card behind updates"
            @click=${this._apply}
          >
            <ha-icon
              icon=${this._applyState === "saved" ? "mdi:check" : "mdi:content-save-outline"}
            ></ha-icon>
            ${this._applyState === "saved"
              ? "Saved"
              : this._applyState === "saving"
                ? "Saving…"
                : "Apply"}
          </button>
          ${this._applyError ? html`<span class="apply-error">${this._applyError}</span>` : nothing}

          <!-- Labels: declutter a dense plan while editing (issue #52). -->
          <button
            class="icon-btn"
            aria-pressed=${this._hideLabels}
            title=${this._hideLabels
              ? "Show element labels on the canvas"
              : "Hide element labels — easier to aim on a dense plan"}
            @click=${() => {
              this._hideLabels = !this._hideLabels;
            }}
          >
            <ha-icon
              icon=${this._hideLabels ? "mdi:label-off-outline" : "mdi:label-outline"}
            ></ha-icon>
            Labels
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
            <select
              @change=${(e: Event) => {
                this._switchFloor((e.target as HTMLSelectElement).value);
                // Hand focus back to the canvas: while the <select> keeps it,
                // isTypingPath swallows every shortcut — most visibly Ctrl+V
                // after a cross-floor copy (issue #37).
                this._canvasWrap?.focus({ preventScroll: true });
              }}
            >
              ${floors.map(
                (f) =>
                  html`<option value=${f.id} .selected=${f.id === this._activeFloorId}>${f.name}</option>`
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
                this._addQuery = "";
              }}
            >
              <ha-icon icon="mdi:cog-outline"></ha-icon>
            </button>
            ${this._floorMenuOpen
              ? html`<div class="pop">
                  ${this._renderHaFloorRow(floor)}
                  <!-- Reorder (issue #66): the safe alternative to cut-and-
                       pasting floor blocks in YAML, which drops/duplicates
                       ids. Position in this list is the switcher order. -->
                  <div class="pop-row">
                    <label>Order</label>
                    <button
                      aria-label="Move floor up"
                      title="Move this floor up the list"
                      ?disabled=${floors.length < 2 || floors[0]?.id === this._activeFloorId}
                      @click=${() => this._moveFloor(-1)}
                    >
                      <ha-icon icon="mdi:arrow-up"></ha-icon>
                    </button>
                    <button
                      aria-label="Move floor down"
                      title="Move this floor down the list"
                      ?disabled=${floors.length < 2 ||
                      floors[floors.length - 1]?.id === this._activeFloorId}
                      @click=${() => this._moveFloor(1)}
                    >
                      <ha-icon icon="mdi:arrow-down"></ha-icon>
                    </button>
                  </div>
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
                  <!-- Issue #67: switcher-button label, per-floor accent, and
                       which floor the live card opens on. -->
                  <div class="pop-row">
                    <label>Short</label>
                    <input
                      type="text"
                      maxlength="8"
                      placeholder="e.g. GF"
                      title="Short label for the card's floor-switcher button"
                      .value=${floor?.short ?? ""}
                      @change=${(e: Event) =>
                        this._commitFloor({
                          short: (e.target as HTMLInputElement).value.trim() || undefined,
                        })}
                    />
                  </div>
                  <div class="pop-row">
                    <label>Color</label>
                    <input
                      type="color"
                      title="Accent for this floor's switcher button while active"
                      .value=${floor?.color ?? "#03a9f4"}
                      @input=${(e: Event) =>
                        this._commitFloor({ color: (e.target as HTMLInputElement).value })}
                    />
                    <button
                      aria-label="Clear floor color"
                      title="Back to the theme color"
                      ?disabled=${!floor?.color}
                      @click=${() => this._commitFloor({ color: undefined })}
                    >
                      <ha-icon icon="mdi:water-off-outline"></ha-icon>
                    </button>
                  </div>
                  <div class="pop-row">
                    <label>Default</label>
                    <input
                      type="checkbox"
                      title="Open the live card on this floor"
                      .checked=${this._config.defaultFloor === this._activeFloorId}
                      @change=${(e: Event) =>
                        this._commit({
                          ...this._config,
                          defaultFloor: (e.target as HTMLInputElement).checked
                            ? this._activeFloorId
                            : undefined,
                        })}
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
        <!-- The viewport keeps the canvas's aspect ratio so its height does not
             grow with the zoom level. Otherwise zooming in made this box taller,
             which pushed the zoom buttons (anchored to its bottom-right) down the
             page — you had to chase the + button between clicks. Fullscreen sizes
             the viewport from the available space instead, which is why it never
             had the problem. -->
        <div
          class="canvas-wrap"
          tabindex="0"
          style=${this._fullscreen
            ? nothing
            : `aspect-ratio:${cssNumber(c.width, DEFAULT_WIDTH)} / ${cssNumber(c.height, DEFAULT_HEIGHT)};`}
          @wheel=${this._onCanvasWheel}
        >
          <!-- The stage doubles as the card's .plan box for overlay sizing: same
               container query, same --fp-u, so a badge measured in canvas units
               previews here at the size a card of this width would draw it
               (issue #192). The editor never rotates the plan, so the canvas
               width is what 100cqw measures against. -->
          <div class="stage ${overlay === "plan" ? "scale-plan" : ""}"
               style="aspect-ratio: ${cssNumber(c.width, DEFAULT_WIDTH)} / ${cssNumber(
            c.height, DEFAULT_HEIGHT)}; width:${this._zoom * 100}%;
                   --fp-plan-w: ${cssNumber(c.width, DEFAULT_WIDTH)};${skinStyle(c.skin)}">
            <!-- Keyed on the skin, for the repaint reason documented on the
                 card's SVG (issue #122): a var() inside a presentation
                 attribute does not repaint when the custom property changes,
                 so without this the canvas kept the previous skin's doors and
                 room fills. -->
            ${keyed(
              c.skin ?? "",
              svg`<svg
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
                fill=${c.background ?? SKIN_PAPER}
              />
              ${floor.image
                ? svg`<image href=${floor.image} x="0" y="0" width=${c.width} height=${c.height}
                            preserveAspectRatio=${imageFitRatio(floor.imageFit)}
                            opacity=${floor.imageOpacity ?? 1} />`
                : nothing}
              ${this._renderGrid()}
              ${repeat(
                floor.areas ?? [],
                (a, i) => a.id || i,
                (a) => this._renderAreaSel(a, scopingAreaId)
              )}
              <!-- Dead spaces (issue #88), same layer position as the card so
                   what you draw is what you get. Live while you draw: closing
                   the last wall of a shaft hatches it, and dropping a door into
                   it clears the hatching again — which is the fastest way to
                   see that the card agrees with you about what is sealed. -->
              ${deadSpaceRings.length
                ? svg`${renderDeadSpaceHatch(`${this._wallMaskId}-dead`)}
                      ${deadSpaceRings.map((ring) =>
                        renderDeadSpace(ring, `${this._wallMaskId}-dead`)
                      )}`
                : nothing}
              <!-- Light pools (issue #6), same layer position as the card so
                   what you place is what you get. Previewed at full strength
                   with no hass in the editor, so the radius is adjustable
                   without having to turn the real light on. -->
              ${renderGlowMask(
                floor.furniture, c.width, c.height,
                `${this._wallMaskId}-glowmask`, this._symbols()
              )}
              <g class="fp-glows"
                 mask=${floor.furniture.length ? `url(#${this._wallMaskId}-glowmask)` : nothing}>
                ${floor.items.map((it, i) => {
                  if (!it.glow) return nothing;
                  // An off light draws nothing, as on the card; only a glow
                  // with no readable state previews lit (issue #108).
                  const paint = editorGlowPaint(it, this.hass?.states[it.entity]);
                  return paint
                    ? renderGlow(it, paint, `${this._wallMaskId}-glow-${i}`, lightWalls)
                    : nothing;
                })}
              </g>
              ${
                // Radius guide for the selected glow (issue #108). Sizing an
                // unlit light would otherwise be blind, now that an off light
                // correctly draws nothing. Editor-only chrome, like the
                // tracker zone outline.
                //
                // Deliberately the *configured* radius, not the brightness-
                // scaled one (issue #123): this is the handle for the value you
                // are setting, which is the pool's size at full brightness. A
                // guide that shrank as the bulb dimmed would move while you
                // dragged it, and would never show the size you actually typed.
                floor.items.map((it) =>
                  it.glow && this._isSel("item", it.id)
                    ? svg`<circle class="glow-guide" cx=${it.x} cy=${it.y}
                                  r=${cssNumber(it.glowRadius, DEFAULT_GLOW_RADIUS)} />`
                    : nothing
                )
              }
              ${floor.furniture.map((f) => this._renderFurnitureSel(f))}
              ${renderWallMask(floor.openings, c.width, c.height, this._wallMaskId)}
              ${floor.walls.map((w) => this._renderWall(w))}
              <!-- Room outlines, same layer position as the card so what you
                   place is what you get. Only a static borderColor draws here,
                   there being no hass to resolve a live color from — but the
                   clip ids are passed anyway, so wiring a live preview in later
                   cannot silently land on the unclipped path. -->
              <g mask=${`url(#${this._wallMaskId})`}>
                ${(floor.areas ?? []).map((a, i) =>
                  renderAreaBorder(a, undefined, `${this._wallMaskId}-area-${i}`)
                )}
              </g>
              ${repeat(
                // Keyed by id: switching floors must create fresh DOM. Reused
                // nodes would CSS-transition from the previous floor's opening
                // state — a window briefly plays a door swing (issue #50).
                floor.openings,
                (o, i) => o.id || i,
                (o) => this._renderOpeningSel(o)
              )}
              ${repeat(
                floor.trackers ?? [],
                (tr, i) => tr.id || i,
                (tr) => this._renderTrackerSel(tr)
              )}
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
                  ? svg`<g class="fp-wall-neon"><line x1=${this._draft.x1} y1=${this._draft.y1}
                              x2=${this._draft.x2} y2=${this._draft.y2}
                              class="wall draft" mask=${`url(#${this._wallMaskId})`}
                              stroke-width=${WALL_THICKNESS} /></g>`
                  : nothing
              }
              ${this._renderAreaDraft()}
              ${
                this._marquee
                  ? svg`<rect x=${Math.min(this._marquee.x0, this._marquee.x1)}
                              y=${Math.min(this._marquee.y0, this._marquee.y1)}
                              width=${Math.abs(this._marquee.x1 - this._marquee.x0)}
                              height=${Math.abs(this._marquee.y1 - this._marquee.y0)}
                              class="marquee" />`
                  : nothing
              }
            </svg>`
            )}
            <div class="items">
              ${floor.texts.map((t) => this._renderTextOverlay(t, c, overlay))}
              ${floor.openings
                .filter((o) => hasShutterMark(o))
                .map((o) => this._renderShutterMarkOverlay(o, c, overlay))}
              ${floor.openings
                .filter((o) => hasOpeningMark(o))
                .map((o) => this._renderOpeningMarkOverlay(o, c, overlay))}
              ${floor.items.map((it) => this._renderItemOverlay(it, c, overlay))}
            </div>
          </div>
        </div>
        ${floorEmpty && !this._draft && !this._draftTracker && !this._draftArea
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
  /**
   * Render a FormSpec: real `<ha-form>` (native HA selectors) when the
   * element is defined, otherwise the same schema through plain inputs.
   * Patches route through `apply(patch, live)` — `live` marks continuous
   * fields (typing, sliders) for the burst-history path.
   */
  private _renderForm(
    spec: FormSpec,
    apply: (patch: Record<string, unknown>, live: boolean) => void
  ): TemplateResult {
    if (customElements.get("ha-form")) {
      return html`<ha-form
        .hass=${this.hass}
        .data=${spec.data}
        .schema=${spec.fields}
        .computeLabel=${formLabel}
        .computeHelper=${formHelper}
        @value-changed=${(ev: CustomEvent) => {
          // ha-form re-fires a consolidated event (detail.value = full data
          // object); keep it from bubbling out into HA's dialog.
          ev.stopPropagation();
          const raw = diffFormValue(spec.data, ev.detail.value as Record<string, unknown>, spec.fields);
          const patch = normalizeFormPatch(raw, spec.fields);
          const names = Object.keys(patch);
          if (!names.length) return;
          const live =
            names.length === 1 && isLiveField(spec.fields.find((f) => f.name === names[0])!);
          apply(spec.toPatch(patch), live);
        }}
      ></ha-form>`;
    }
    return html`${spec.fields.map((f) => this._renderFallbackField(spec, f, apply))}`;
  }

  private _applyFallback(
    spec: FormSpec,
    field: FormField,
    value: unknown,
    live: boolean,
    apply: (patch: Record<string, unknown>, live: boolean) => void
  ): void {
    const patch = normalizeFormPatch({ [field.name]: value }, spec.fields);
    if (field.name in patch) apply(spec.toPatch(patch), live && isLiveField(field));
  }

  /** One plain-input row per schema field — the outside-HA / load-failure path. */
  private _renderFallbackField(
    spec: FormSpec,
    f: FormField,
    apply: (patch: Record<string, unknown>, live: boolean) => void
  ): TemplateResult {
    const value = spec.data[f.name];
    const sel = f.selector;
    if ("select" in sel) {
      const select = sel.select as {
        options: { value: string; label: string }[];
        custom_value?: boolean;
      };
      const options = select.options;
      // `custom_value` means "pick one of these, or type your own" — a <select>
      // can't express that, so mirror HA's combo box with a datalist-backed
      // input (the Area name field, which doubles as its HA-area link).
      if (select.custom_value) {
        const listId = `sel-${f.name}-${options.length}`;
        return html`<div class="row wide">
          <label>${f.label}</label>
          <input
            type="text"
            list=${listId}
            .value=${String(value ?? "")}
            @change=${(e: Event) =>
              this._applyFallback(spec, f, (e.target as HTMLInputElement).value, false, apply)}
          />
          <datalist id=${listId}>
            ${options.map((o) => html`<option value=${o.value}></option>`)}
          </datalist>
        </div>`;
      }
      return html`<div class="row">
        <label>${f.label}</label>
        <select
          .value=${String(value ?? "")}
          @change=${(e: Event) =>
            this._applyFallback(spec, f, (e.target as HTMLSelectElement).value, false, apply)}
        >
          ${options.map(
            (o) => html`<option value=${o.value} ?selected=${o.value === value}>${o.label}</option>`
          )}
        </select>
      </div>`;
    }
    if ("boolean" in sel) {
      return html`<div class="row">
        <label>${f.label}</label>
        <input
          type="checkbox"
          .checked=${!!value}
          @change=${(e: Event) =>
            this._applyFallback(spec, f, (e.target as HTMLInputElement).checked, false, apply)}
        />
      </div>`;
    }
    if ("number" in sel) {
      const n = sel.number as { min?: number; max?: number; step?: number; mode?: string };
      const slider = n.mode === "slider";
      return html`<div class="row">
        <label>${f.label}</label>
        ${slider
          ? html`<input
              type="range"
              min=${n.min ?? 0}
              max=${n.max ?? 100}
              step=${n.step ?? 1}
              .value=${String(value ?? n.min ?? 0)}
              @input=${(e: Event) =>
                this._applyFallback(spec, f, Number((e.target as HTMLInputElement).value), true, apply)}
            />`
          : nothing}
        <input
          class="num"
          type="number"
          min=${n.min ?? nothing}
          max=${n.max ?? nothing}
          step=${n.step ?? nothing}
          .value=${String(value ?? "")}
          @change=${(e: Event) => {
            const input = e.target as HTMLInputElement;
            this._applyFallback(
              spec,
              f,
              input.value === "" ? undefined : Number(input.value),
              false,
              apply
            );
            // An invalid required value is dropped by normalizeFormPatch —
            // re-sync the box so it never shows a value that wasn't stored.
            input.value = String(spec.data[f.name] ?? "");
          }}
        />
      </div>`;
    }
    if ("entity" in sel) {
      const entitySel = sel.entity as {
        filter?: { domain?: string[] }[];
        include_entities?: string[];
      };
      return html`<div class="row wide">
        <label>${f.label}</label>
        ${this._renderEntityPicker(
          String(value ?? ""),
          (v) => this._applyFallback(spec, f, v, false, apply),
          entitySel.filter?.[0]?.domain,
          entitySel.include_entities
        )}
      </div>`;
    }
    if ("icon" in sel) {
      return html`<div class="row wide">
        <label>${f.label}</label>
        <input
          type="text"
          placeholder=${(sel.icon as { placeholder?: string }).placeholder ?? "mdi:…"}
          .value=${String(value ?? "")}
          @change=${(e: Event) =>
            this._applyFallback(spec, f, (e.target as HTMLInputElement).value, false, apply)}
        />
      </div>`;
    }
    // Actions need HA's action editor — configurable via YAML outside HA.
    if ("ui_action" in sel) return html`${nothing}`;
    return html`<div class="row">
      <label>${f.label}</label>
      <input
        type="text"
        .value=${String(value ?? "")}
        @input=${(e: Event) =>
          this._applyFallback(spec, f, (e.target as HTMLInputElement).value, true, apply)}
      />
    </div>`;
  }

  private _renderEntityPicker(
    value: string,
    onChange: (entity: string) => void,
    includeDomains?: string[],
    includeEntities?: string[]
  ): TemplateResult {
    if (customElements.get("ha-entity-picker")) {
      return html`<ha-entity-picker
        .hass=${this.hass}
        .value=${value}
        .includeDomains=${includeDomains}
        .includeEntities=${includeEntities}
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

  /**
   * Attribute field for the hand-rolled rows, mirroring
   * {@link _renderEntityPicker}: HA's own attribute dropdown when the frontend
   * has registered it, a plain text input otherwise.
   *
   * The dropdown is the whole point — it lists the attributes the entity
   * *actually has*, which is what `ha-form`'s `attribute` selector gives the
   * device's own Attribute field. A repeatable row cannot go through `ha-form`,
   * but that is no reason for it to be a worse control: typing `curent_temp`
   * into a free-text box fails silently at render time, which is exactly the
   * bug a picker cannot have.
   *
   * `entityId` is what the attributes are listed from — the row's own entity
   * when it names one, else the device's, which is the same fallback the
   * reading itself resolves through.
   */
  private _renderAttributePicker(
    entityId: string | undefined,
    value: string,
    onChange: (attribute: string) => void,
    title?: string
  ): TemplateResult {
    if (customElements.get("ha-entity-attribute-picker") && entityId) {
      return html`<ha-entity-attribute-picker
        class="reading-attr"
        .hass=${this.hass}
        .entityId=${entityId}
        .value=${value}
        allow-custom-value
        title=${title ?? nothing}
        @value-changed=${(e: CustomEvent) => onChange((e.detail.value as string) ?? "")}
      ></ha-entity-attribute-picker>`;
    }
    return html`<input
      type="text"
      class="reading-attr"
      placeholder="attribute"
      title=${title ?? nothing}
      .value=${value}
      @change=${(e: Event) => onChange((e.target as HTMLInputElement).value)}
    />`;
  }

  /**
   * Icon field for the hand-rolled rows (issue #106), mirroring
   * {@link _renderEntityPicker}: HA's searchable picker when the frontend has
   * registered it, a plain text input otherwise. Used by the state-rule list,
   * which cannot go through `ha-form` because it is repeatable, and by the
   * device's own icon row that sits beside it (issue #127).
   */
  private _renderIconPicker(
    value: string,
    onChange: (icon: string) => void,
    opts?: { placeholder?: string; title?: string }
  ): TemplateResult {
    if (customElements.get("ha-icon-picker")) {
      return html`<ha-icon-picker
        class="rule-icon"
        .hass=${this.hass}
        .value=${value}
        placeholder=${opts?.placeholder ?? "Icon"}
        title=${opts?.title ?? nothing}
        @value-changed=${(e: CustomEvent) => onChange((e.detail.value as string) ?? "")}
      ></ha-icon-picker>`;
    }
    return html`<input
      type="text"
      class="rule-icon"
      placeholder=${opts?.placeholder ?? "mdi:blinds"}
      title=${opts?.title ?? nothing}
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
    this._addQuery = "";
  }

  /**
   * Save the card to the dashboard and stay in the editor (issue #198).
   *
   * The heavy lifting is in `editor-save.ts`; what belongs here is the wait
   * before it. Our edits reach HA through `config-changed`, which the element
   * editor between us and the dialog re-fires only after its own render — and
   * a field committed by the blur *this very click* caused is still in flight
   * at this point. Letting the microtasks drain first is the difference
   * between applying the plan and applying it one edit ago.
   */
  private _apply = async (): Promise<void> => {
    if (this._applyState === "saving") return;
    if (this._applyResetTimer !== null) clearTimeout(this._applyResetTimer);
    this._applyState = "saving";
    this._applyError = "";
    await this.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = await applyCardConfig(this);
    if (!result.ok) {
      this._applyState = "idle";
      this._applyError = result.error;
      return;
    }
    this._applyState = "saved";
    this._applyResetTimer = setTimeout(() => {
      this._applyResetTimer = null;
      this._applyState = "idle";
    }, APPLY_SAVED_MS);
  };

  /**
   * The "+ Add" popover: device, text, then every symbol as its real glyph.
   *
   * The grid is searchable and grouped (issue #90). It was 26 fixed cells over
   * six rows, which was already the tallest thing in the editor; with a
   * community library behind it the list only grows, so the query filters on id,
   * name, category and the symbol's own keywords — "couch" finds the sofa.
   */
  private _renderAddMenu(): TemplateResult {
    const close = () => {
      this._addMenuOpen = false;
      this._addQuery = "";
    };
    const catalog = this._symbols();
    const matches = furnitureChoices(catalog).filter((s) => symbolMatches(s, this._addQuery));
    const grouped = !this._addQuery.trim();
    let lastCategory = "";

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
        <div class="furn-search">
          <ha-icon icon="mdi:magnify"></ha-icon>
          <input
            type="search"
            placeholder="Search furniture"
            .value=${this._addQuery}
            @input=${(e: Event) => {
              this._addQuery = (e.target as HTMLInputElement).value;
            }}
            @keydown=${(e: KeyboardEvent) => {
              // Escape clears the query first; the popover's own Escape
              // handler closes it, so without this one key would do both.
              if (e.key === "Escape" && this._addQuery) {
                e.stopPropagation();
                this._addQuery = "";
              }
            }}
          />
        </div>
        <div class="add-furn-scroll">
          ${matches.length
            ? matches.map((s) => {
                const header = grouped && s.category !== lastCategory ? s.category : "";
                lastCategory = s.category;
                return html`${header ? html`<div class="furn-group">${header}</div>` : nothing}
                  ${this._renderFurnCell(s, close)}`;
              })
            : html`<div class="furn-empty">No symbol matches “${this._addQuery}”</div>`}
        </div>
      </div>
    `;
  }

  /** One picker cell: the symbol drawn at its own default size, plus its name. */
  private _renderFurnCell(s: SymbolDef, close: () => void): TemplateResult {
    // Glyphs are drawn centered at the origin; pad the viewBox a bit
    // (tv draws its stand below the box, plants overflow slightly).
    const { w, h } = s.size;
    const pad = Math.max(w, h) * 0.25 + 6;
    const vb = `${-w / 2 - pad} ${-h / 2 - pad} ${w + pad * 2} ${h + pad * 2}`;
    return html`
      <button
        class="furn-cell"
        title=${s.name}
        @click=${() => {
          this._addFurniture(s.id);
          close();
        }}
      >
        <svg viewBox=${vb}>
          ${renderFurniture(
            { id: "preview", type: s.id, x: 0, y: 0, w, h },
            undefined,
            this._symbols()
          )}
        </svg>
        <span>${s.name}</span>
      </button>
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
          <span class="edit-title" title=${summary}>${summary}</span>
          <span class="head-spacer"></span>
          ${(() => {
            // Lock in place (issue #191). Beside duplicate and delete because
            // it is the same kind of thing — an action on the selection, not a
            // property of it — and because this header is the one place that
            // says what a selected element can have done to it.
            //
            // With several selected the button reports the whole group: it
            // reads "locked" only when every one of them is, so the first
            // press pins whatever is still loose rather than unpinning the
            // ones already done.
            const f = this._floor();
            const all = this._selection.every((x) => isLocked(f, x));
            return html`<button
              class=${all ? "on" : ""}
              aria-label=${all ? "Unlock" : "Lock in place"}
              aria-pressed=${all ? "true" : "false"}
              title=${all
                ? "Unlock — let it be dragged again"
                : "Lock in place — it can still be selected and edited, just not moved"}
              @click=${() => this._setLocked(!all)}
            >
              <ha-icon icon=${all ? "mdi:lock" : "mdi:lock-open-variant-outline"}></ha-icon>
            </button>`;
          })()}
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
          : html`${this._renderAreaScopeHint()}
              <div class="rows">${this._renderSelectionEditor()}</div>`}
      </section>
    `;
  }

  private _renderWall(w: Wall): TemplateResult {
    const selected = this._isSel("wall", w.id);
    // A pinned wall still *looks* selected — it is — but shows no endpoint
    // handles (issue #191): they would be drawn as grab targets that refuse
    // to grab, and their absence is the clearest signal on the canvas that
    // the wall is pinned.
    const handles = selected && !w.locked;
    return svg`
      <g>
        <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
              class="wall-hit"
              @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "wall", id: w.id })} />
        <g class="fp-wall-neon"><line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
              class="wall ${selected ? "selected" : ""}"
              mask=${`url(#${this._wallMaskId})`}
              style=${wallStrokeStyle(w.thickness)} stroke-linecap="round" /></g>
        ${
          handles
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
          color: selected ? "var(--primary-color, #03a9f4)" : SKIN_WALL,
          open: openingDefaultOpen(o),
          // Draw sliding / rolling openings partly open in the editor so the
          // motion is visible — closed, both look like a plain band, which
          // would make the Motion / Slide / Style controls appear inert.
          amount: openingMotion(o) !== "swing" ? 0.55 : undefined,
          // Shutter previewed half-rolled so the layer is visible while
          // configuring, whatever the live state.
          shutter: o.shutterEntity
            ? { amount: 0.55, style: shutterStyleOf(o), flip: o.shutterFlipV }
            : undefined,
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
        ${renderFurniture(f, undefined, this._symbols())}
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

  /**
   * A committed Area: the translucent fill (shared with the live card),
   * a transparent hit-polygon for click-to-select and whole-shape drag, and
   * — while selected — a heavier outline plus one draggable handle per
   * vertex (decision #1 in areas.md: vertices reshape independently, with
   * no cross-element corner-stretch).
   */
  /**
   * States in words what the canvas animation shows: this element sits in a
   * linked room, so its entity picker only lists that room's entities. Colour
   * alone can't carry that, and the off-switch lives on the Area element.
   */
  private _renderAreaScopeHint(): TemplateResult | typeof nothing {
    const id = this._scopingAreaId();
    if (!id) return nothing;
    const area = (this._floor().areas ?? []).find((a) => a.id === id);
    const name = area?.name ? area.name : "this area";
    // The switch lives on the Area element, which is a deselect-navigate-
    // reselect round trip from here — issue #94 was exactly someone reading
    // the old wording and finding no such control. Offer it inline instead.
    return html`<p class="hint area-scope-hint">
      <ha-icon icon="mdi:vector-polygon"></ha-icon>
      <span>Only entities in <strong>${name}</strong> are listed.</span>
      <button
        class="link-btn"
        title="Turn off Filter entities for this area — every entity becomes selectable"
        @click=${() => this._updateArea(id, { filterEntities: false })}
      >
        Show all
      </button>
    </p>`;
  }

  private _renderAreaSel(a: Area, scopingId?: string): TemplateResult {
    const selected = this._isSel("area", a.id);
    const scoping = a.id === scopingId;
    const pts = a.points.map((p) => `${p.x},${p.y}`).join(" ");
    return svg`
      <g class="area-hit ${selected ? "selected" : ""} ${scoping ? "scoping" : ""}">
        ${scoping ? svg`<polygon points=${pts} class="area-scoping" />` : nothing}
        ${renderArea(a)}
        <polygon points=${pts} class="area-hit-shape"
                 @pointerdown=${(e: PointerEvent) => this._startDrag(e, { kind: "area", id: a.id })} />
        ${selected ? svg`<polygon points=${pts} class="area-outline" />` : nothing}
        ${
          // Outline yes, vertex handles no, for a pinned room — same reasoning
          // as the wall's endpoints (issue #191): still visibly selected, with
          // nothing on it that pretends to be draggable.
          selected && !a.locked
            ? a.points.map(
                (p, i) => svg`
                  <circle cx=${p.x} cy=${p.y} r="7" class="handle"
                          @pointerdown=${(e: PointerEvent) =>
                            this._startDrag(e, { kind: "area", id: a.id }, undefined, i)} />`
              )
            : nothing
        }
      </g>`;
  }

  /**
   * The in-progress Area draft: committed vertices as dots, straight segments
   * between them, and — while a live pointer position is known — a dashed
   * "rubber band" segment from the last vertex to the cursor. Once 3+ points
   * are down the starting vertex is drawn larger/hollow so it's visually
   * obvious that clicking it closes the polygon (see `_onCanvasDown`).
   */
  private _renderAreaDraft(): TemplateResult | typeof nothing {
    const draft = this._draftArea;
    if (!draft) return nothing;
    const pts = draft.points;
    const line = pts.map((p) => `${p.x},${p.y}`).join(" ");
    const last = pts[pts.length - 1]!;
    const canClose = pts.length >= 3;
    const hover = this._areaHover;
    return svg`
      <g class="area-draft">
        ${pts.length > 1 ? svg`<polyline points=${line} class="area-draft-line" />` : nothing}
        ${
          hover
            ? svg`<line x1=${last.x} y1=${last.y} x2=${hover.x} y2=${hover.y}
                        class="area-draft-hover" />`
            : nothing
        }
        ${pts.map((p, i) =>
          i === 0 && canClose
            ? svg`<circle cx=${p.x} cy=${p.y} r="9" class="area-draft-start" />`
            : svg`<circle cx=${p.x} cy=${p.y} r="5" class="area-draft-point" />`
        )}
      </g>`;
  }

  /**
   * The card's shutter badge, previewed (issue #74 follow-up) — an opening
   * with both entities bound shows the shutter's own icon beside it, and the
   * editor is where you find out whether it lands somewhere sensible.
   *
   * Inert here: the canvas selects and drags openings by clicking them, and a
   * badge that swallowed those clicks would make the opening under it awkward
   * to grab. On the card it is a control; here it is a picture of one.
   */
  private _renderShutterMarkOverlay(
    o: Opening,
    c: FloorplanCardConfig,
    scale: OverlayScale
  ): TemplateResult {
    const id = o.shutterEntity!;
    const st = this.hass?.states[id];
    const open = shutterAmount(st, o.shutterInvert) > 0;
    const icon = shutterMarkIcon(o, st, open, this.hass?.entities?.[id]?.icon);
    const accent = cssColor(o.shutterActiveColor ?? o.activeColor) ?? SKIN_ACCENT;
    const at = shutterMarkPoint(o);
    // Same two-part offset as the card (canvas units + screen pixels), so the
    // preview shows where the badge will actually sit. The editor never
    // rotates the plan, hence no rotation argument.
    // In the plan's own units when that is how the card measures them, so the
    // badge previews at the size it will actually be drawn (issue #192).
    const n = shutterMarkNormal(o);
    const box = overlayLength(SHUTTER_MARK_SIZE, scale);
    const step = overlayLength(SHUTTER_MARK_PIXEL_OFFSET, scale);
    return html`<div
      class="shutter-mark ${shutterActive(st, o.shutterInvert) ? "on" : "off"}"
      style="left:${(at.x / c.width) * 100}%; top:${(at.y / c.height) * 100}%;
             width:${box};height:${box};
             transform:translate(-50%,-50%)
                       translate(calc(${n.x} * ${step}), calc(${n.y} * ${step}));
             --fp-active:${accent};"
      title=${`${(st?.attributes?.friendly_name as string | undefined) ?? id} — shown on the card, tap it there to open the shutter`}
    >
      <ha-icon icon=${icon} style="--mdc-icon-size:${overlayLength(
        SHUTTER_MARK_ICON_SIZE,
        scale
      )};"></ha-icon>
    </div>`;
  }

  /**
   * The card's opening badge, previewed (issue #154 follow-up). Same reason as
   * the shutter's preview above: turning **Show icon** on and finding out where
   * the badge lands is the whole point of having a canvas. Inert here too.
   */
  private _renderOpeningMarkOverlay(
    o: Opening,
    c: FloorplanCardConfig,
    scale: OverlayScale
  ): TemplateResult {
    const id = o.entity!;
    const st = this.hass?.states[id];
    const open = resolveOpeningAmount(o, st) > 0;
    const icon = openingMarkIcon(o, st, open, this.hass?.entities?.[id]?.icon);
    const accent = cssColor(o.activeColor) ?? SKIN_ACCENT;
    const at = openingMarkPoint(o);
    const n = openingMarkNormal(o);
    const box = overlayLength(SHUTTER_MARK_SIZE, scale);
    const step = overlayLength(SHUTTER_MARK_PIXEL_OFFSET, scale);
    return html`<div
      class="shutter-mark ${openingIsActive(o, st) ? "on" : "off"}"
      style="left:${(at.x / c.width) * 100}%; top:${(at.y / c.height) * 100}%;
             width:${box};height:${box};
             transform:translate(-50%,-50%)
                       translate(calc(${n.x} * ${step}), calc(${n.y} * ${step}));
             --fp-active:${accent};"
      title=${`${(st?.attributes?.friendly_name as string | undefined) ?? id} — shown on the card, tap it there to open its dialog`}
    >
      <ha-icon icon=${icon} style="--mdc-icon-size:${overlayLength(
        SHUTTER_MARK_ICON_SIZE,
        scale
      )};"></ha-icon>
    </div>`;
  }

  private _renderItemOverlay(
    it: FloorItem,
    c: FloorplanCardConfig,
    scale: OverlayScale
  ): TemplateResult {
    const selected = this._isSel("item", it.id);
    const st = it.entity ? this.hass?.states[it.entity] : undefined;
    // Pass the registry icon here too, so the editor preview matches the card.
    const icon = resolveItemIcon(it, st, it.entity ? this.hass?.entities?.[it.entity]?.icon : undefined);
    // The card's own label line when it has one, else a dim editor-only
    // stand-in so devices stay tellable apart (issue #135). The rule lives in
    // render.ts, where it can be unit-tested.
    const { text: label, live: cardLabel } = editorItemLabel(this.hass, it);
    const size = cssNumber(it.size, DEFAULT_ITEM_SIZE);
    const showIcon = badgeContentOf(it) !== "none";
    const display = it.display ?? "badge";
    // Same resolution as the card, so the canvas shows the colour the plan
    // will actually render (state rules first, then the active colour).
    const rawValue = itemRawValue(it, st);
    const stateColor = cssColor(resolveStateColor(it.stateColor, rawValue));
    // …and the same badge contents, so "Badge shows: Value" previews here too.
    const value = badgeContentOf(it) === "value" ? badgeValue(this.hass, it) : undefined;
    // The active colour — the one the user set, else the bulb's own colour
    // (issue #106). The canvas never previewed either, so setting "Active
    // color" changed nothing here and a coloured lamp would have looked plain;
    // both are the same one line, so both land together.
    const active = entityIsActive(it.entity, st?.state);
    const activeColor = active ? (cssColor(it.activeColor) ?? lightBadgePaint(st)) : undefined;
    // Ink that reads on whatever the badge ends up painted, same rule as the card.
    const badgeInk = contrastText(stateColor ?? activeColor);
    const rippleColor =
      it.rippleColor ?? stateColor ?? activeColor ?? SKIN_ACCENT;
    const rippleSize = it.rippleSize ?? DEFAULT_RIPPLE_SIZE;
    const rippleDirection = it.rippleDirection ?? DEFAULT_RIPPLE_DIRECTION;
    const rippleWidth = it.rippleWidth ?? DEFAULT_RIPPLE_WIDTH;

    // Live preview: the icon animates exactly when the card would animate it
    // (entity currently active), so the "Badge shows" dropdown shows its
    // effect without leaving the editor.
    const anim = resolveIconAnimation(it, st?.state, st?.attributes);
    // Every measure the card expresses in canvas units, expressed the same way
    // here (issue #192) — the badge box, the value inside it, the glyph, the
    // ripple and the label below.
    const box = overlayLength(size, scale);
    const badge = html`<div
      class="badge ${showIcon ? "" : "ghost"} ${stateColor
        ? "state-colored"
        : active
          ? "active-colored"
          : ""}"
      style="width:${box};height:${box};transform:rotate(${cssNumber(it.angle, 0)}deg);${
        stateColor ? `--fp-state:${stateColor};` : ""
      }${activeColor ? `--fp-active:${activeColor};` : ""}${
        badgeInk ? `--fp-ink:${badgeInk};` : ""
      }"
    >
      ${value
        ? html`<span
            class="badge-value"
            style="font-size:${overlayLength(badgeValueSize(size, value), scale)};"
            >${value}</span
          >`
        : html`<ha-icon
            class=${anim ? `anim-${anim}` : ""}
            icon=${icon}
            style="--mdc-icon-size:${overlayLength(itemIconSize(size), scale)};"
          ></ha-icon>`}
    </div>`;

    // Editor always previews the ripple animated so its effect is visible.
    let visual: TemplateResult;
    if (display === "ripple") {
      visual = renderRipple(true, rippleColor, rippleSize, rippleDirection, rippleWidth, 3, scale);
    } else if (display === "iconRipple") {
      visual = html`<div class="stack">
        ${renderRipple(true, rippleColor, rippleSize, rippleDirection, rippleWidth, 3, scale)}
        <div class="stack-icon">${badge}</div>
      </div>`;
    } else {
      visual = badge;
    }

    // "Only when active" devices are invisible on the card while idle (issue
    // #55). The editor must still show them — dimmed — or they could never be
    // found and edited again.
    const hiddenOnCard = itemHiddenWhenInactive(it, st?.state);
    return html`
      <div
        class="edit-item ${selected ? "selected" : ""} ${hiddenOnCard ? "card-hidden" : ""}"
        style="left:${(it.x / c.width) * 100}%; top:${(it.y / c.height) * 100}%;"
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "item", id: it.id })}
        @pointermove=${this._onOverlayMove}
        @pointerup=${this._onOverlayUp}
        @pointercancel=${this._onPointerCancel}
      >
        ${visual}
        <!-- The card's own label line when there is one (issue #135), so
             turning Show state on is visible here rather than only after
             leaving the editor; otherwise the dim identification fallback.
             The Labels toolbar toggle hides either on dense plans (issue
             #52), and the size previews the card's labelSize (issue #59). -->
        ${this._hideLabels
          ? nothing
          : html`<span
              class="ilabel ${cardLabel ? "live" : ""} ilabel-${labelPositionOf(it)}"
              style="font-size:${overlayLength(
                cardLabel || it.labelSize != null ? itemLabelSize(it.labelSize) : 11,
                scale
              )};${cardLabel && stateColor ? `color:${stateColor};` : ""}"
              >${label}</span
            >`}
      </div>
    `;
  }

  private _renderTextOverlay(
    t: FloorText,
    c: FloorplanCardConfig,
    scale: OverlayScale
  ): TemplateResult {
    const selected = this._isSel("text", t.id);
    return html`
      <div
        class="edit-text ${selected ? "selected" : ""}"
        style="left:${(t.x / c.width) * 100}%; top:${(t.y / c.height) * 100}%;
               font-size:${overlayLength(cssNumber(t.size, DEFAULT_TEXT_SIZE), scale)};
               color:${cssColorOr(t.color, SKIN_TEXT)};
               transform:translate(-50%,-50%) rotate(${cssNumber(t.angle, 0)}deg);"
        @pointerdown=${(e: PointerEvent) => this._onOverlayDown(e, { kind: "text", id: t.id })}
        @pointermove=${this._onOverlayMove}
        @pointerup=${this._onOverlayUp}
        @pointercancel=${this._onPointerCancel}
      >
        ${textLabel(this.hass, t) || "…"}
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

  /**
   * The Project panel, grouped on the same criteria as the element panels:
   * what the plan *is*, then how it *looks*, then what it *does*.
   *
   * It had the same problem the device panel had — nineteen controls in one
   * run, with the sun's five aiming fields separated from the two brightness
   * sliders by a press-effect dropdown, and "Offline devices" filed under
   * display next to the card's rotation.
   *
   * `offlineStyle` moves out of the display slice and joins the press effect:
   * both are statements about how *devices* look and answer, not about how the
   * card is framed. It stays in `projectDisplayForm` as a field — one form, one
   * `toPatch` — and is sliced into the group it belongs to (see `formSlice`).
   */
  private _renderPanelBody(): TemplateResult {
    const c = this._config;
    const patch = (p: Record<string, unknown>) =>
      this._patchConfig(p as Partial<FloorplanCardConfig>);
    const display = projectDisplayForm(c);
    return html`
      <div class="rows panel-body">
        ${this._renderGroup(
          "Project",
          this._renderForm(projectForm(c), (p, live) => {
            if ("grid" in p && typeof p.grid === "number") {
              // The grid change rescales a custom snap step. ha-form's number
              // box fires per keystroke — respect the burst path so typing
              // "24" isn't two history commits (grid=2, then grid=24).
              p = { ...p, ...this._gridPatch(p.grid) };
            }
            if (live) this._patchConfigLive(p as Partial<FloorplanCardConfig>);
            else this._patchConfig(p as Partial<FloorplanCardConfig>);
          })
        )}
        ${this._renderGroup(
          // The plan's own look: its palette, its paper, and the one drawing
          // convention that is a plan-wide choice rather than an element's.
          "Look",
          this._renderForm(projectSkinForm(c), patch),
          this._renderColorRow({
            label: "Background",
            value: c.background,
            swatch: "#ffffff",
            placeholder: "#ffffff or empty",
            onLive: (background) => this._patchConfigLive({ background }),
            onCommit: (background) => this._patchConfig({ background }),
          }),
          this._renderForm(projectDeadSpaceForm(c), patch)
        )}
        ${this._renderGroup(
          // Per floor, not per project — but it is the floor's paper, so it
          // belongs beside the plan's own.
          "Floor image",
          this._renderForm(floorImageForm(this._floor()), (p, live) => {
            if (live) this._patchFloorLive(p as Partial<Floor>);
            else this._commitFloor(p as Partial<Floor>);
          })
        )}
        ${this._renderGroup(
          // How the card is framed on the dashboard, as opposed to what is
          // drawn inside it. Set once for a surface and rarely touched again.
          "Display",
          this._renderForm(
            formSlice(display, [
              "rotation",
              "rotationPortrait",
              "rotationLandscape",
              "overlayScale",
              "compactHeader",
              "zoomedOverlayScale",
            ]),
            patch
          )
        )}
        ${this._renderGroup(
          // Light through the openings (issue #177) — where it comes from and
          // what it looks like where it lands.
          "Sunlight",
          this._renderForm(projectReliefForm(c), patch),
          c.sunlight
            ? html`${this._renderColorRow({
                label: "Sun color",
                title: "Color of the light the openings let in",
                value: c.sunlightColor,
                swatch: "#ffd9a0",
                placeholder: "(warm white)",
                onLive: (sunlightColor) => this._patchConfigLive({ sunlightColor }),
                onCommit: (sunlightColor) => this._patchConfig({ sunlightColor }),
              })}
              ${c.sunShade === false
                ? nothing
                : this._renderColorRow({
                    label: "Shade color",
                    title: "Color of everywhere the light does not reach",
                    value: c.sunShadeColor,
                    swatch: "#000000",
                    placeholder: "(black)",
                    onLive: (sunShadeColor) => this._patchConfigLive({ sunShadeColor }),
                    onCommit: (sunShadeColor) => this._patchConfig({ sunShadeColor }),
                  })}`
            : nothing
        )}
        ${this._renderGroup(
          // The other half of following the sun, and a separate switch: this
          // one dims the whole plan after dark rather than casting anything.
          "Night dimming",
          this._renderForm(projectSunForm(c), patch)
        )}
        ${this._renderGroup(
          // How devices look and answer, plan-wide. "Offline devices" lived
          // under display, beside the card's rotation, which is not what it is
          // about.
          "Devices",
          this._renderForm(projectReplayForm(c), patch),
          this._renderForm(formSlice(display, ["offlineStyle"]), patch),
          this._renderForm(projectPressForm(c), patch)
        )}
        ${this._renderGroup("Symbols", this._renderSymbolsPanel())}
      </div>
    `;
  }

  /**
   * Paste a furniture symbol into this plan (issue #90).
   *
   * The point is that you don't need a pull request to draw something the
   * library hasn't got: paste the geometry here, it lands in the config's
   * `symbols:` block, and it appears in the picker beside the built-ins. If it
   * turns out to be generally useful, the same JSON is what you contribute to
   * `furniture/`.
   *
   * It is validated through `normalizeSymbol` — the same function the shipped
   * library goes through — so a malformed paste is reported here rather than
   * becoming a broken glyph on the plan. Nothing pasted is ever parsed as
   * markup; see `symbols.ts`.
   */
  private _renderSymbolsPanel(): TemplateResult {
    const own = Object.keys(this._config.symbols ?? {});
    return html`
      <div class="row col symbols-panel">
        ${own.length
          ? html`<div class="symbol-list">
              ${own.map(
                (id) => html`
                  <span class="symbol-chip">
                    ${id}
                    <button
                      class="chip-x"
                      title=${`Remove ${id}`}
                      @click=${() => this._removeSymbol(id)}
                    >
                      ✕
                    </button>
                  </span>
                `
              )}
            </div>`
          : nothing}
        <textarea
          class="symbol-input"
          rows="4"
          spellcheck="false"
          placeholder=${'{ "id": "my-desk", "size": { "w": 120, "h": 60 }, "parts": [ … ] }'}
          .value=${this._symbolDraft}
          @input=${(e: Event) => {
            this._symbolDraft = (e.target as HTMLTextAreaElement).value;
            this._symbolError = "";
          }}
        ></textarea>
        ${this._symbolError ? html`<div class="symbol-error">${this._symbolError}</div>` : nothing}
        <div class="symbol-actions">
          <button ?disabled=${!this._symbolDraft.trim()} @click=${this._addSymbol}>
            Add symbol
          </button>
          <a
            href="https://github.com/nicosandller/easy-floorplan/blob/main/furniture/README.md"
            target="_blank"
            rel="noreferrer"
            >How to draw one</a
          >
        </div>
      </div>
    `;
  }

  private _addSymbol = (): void => {
    let raw: unknown;
    try {
      raw = JSON.parse(this._symbolDraft);
    } catch (err) {
      this._symbolError = `Not valid JSON — ${(err as Error).message}`;
      return;
    }
    const problems: string[] = [];
    const def = normalizeSymbol(raw, undefined, problems);
    if (!def) {
      this._symbolError = problems[0] ?? "Not a usable symbol.";
      return;
    }
    this._patchConfig({ symbols: { ...(this._config.symbols ?? {}), [def.id]: raw } });
    this._symbolDraft = "";
    this._symbolError = "";
  };

  private _removeSymbol(id: string): void {
    const rest = { ...(this._config.symbols ?? {}) };
    delete rest[id];
    // Drop the key entirely when the last one goes, so removing every symbol
    // leaves the config as it was rather than carrying an empty block forever.
    this._patchConfig({ symbols: Object.keys(rest).length ? rest : undefined });
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
      const spec = openingForm(o, (id) => this._supportedFeatures(id));
      const apply = (patch: Record<string, unknown>, live: boolean): void => {
        if ("entity" in patch) {
          // Infer type/motion from the entity's HA device_class (e.g. a
          // `cover` with device_class `window` → a window; a `garage`
          // roller → a sliding door). Only when the class is known, so we
          // never clobber a hand-set type with a guess.
          const entity = patch.entity as string | undefined;
          const dc = entity
            ? (this.hass?.states[entity]?.attributes?.device_class as string | undefined)
            : undefined;
          patch = { ...patch, ...(dc ? openingFromDeviceClass(dc) : {}) };
        }
        this._applyElementPatch("opening", o.id, patch, live);
      };
      /** A group, skipped when this opening has none of its fields. */
      const group = (title: string, names: readonly string[], ...extra: unknown[]) => {
        const slice = formSlice(spec, names);
        if (!slice.fields.length && !extra.some((x) => x && x !== nothing)) return nothing;
        return this._renderGroup(title, this._renderForm(slice, apply), ...extra);
      };
      return html`
        ${FloorplanCardEditor.OPENING_GROUPS.map(([title, names]) =>
          title === "Color"
            ? group(
                title,
                names,
                o.entity
                  ? this._renderColorRow({
                      label: "Active color",
                      value: o.activeColor,
                      swatch: "#03a9f4",
                      placeholder: "(primary)",
                      onLive: (activeColor) => this._updateOpeningLive(o.id, { activeColor }),
                      onCommit: (activeColor) => this._updateOpening(o.id, { activeColor }),
                    })
                  : nothing
              )
            : title === "Shutter"
            ? group(
                title,
                names,
                // The shutter's own accent, so an open shutter over a shut
                // window can read as a separate thing from the sash it
                // covers. Falls back to the opening's, hence the placeholder.
                o.shutterEntity
                  ? this._renderColorRow({
                      label: "Shutter color",
                      title: "Shutter color while it is open",
                      value: o.shutterActiveColor,
                      swatch: o.activeColor ?? "#03a9f4",
                      placeholder: o.activeColor ? "(active color)" : "(primary)",
                      onLive: (shutterActiveColor) =>
                        this._updateOpeningLive(o.id, { shutterActiveColor }),
                      onCommit: (shutterActiveColor) =>
                        this._updateOpening(o.id, { shutterActiveColor }),
                    })
                  : nothing
              )
            : group(title, names)
        )}
      `;
    }

    if (sel.kind === "item") {
      const it = this._floor().items.find((x) => x.id === sel.id);
      if (!it) return html`${nothing}`;
      const areaEntities = this._areaEntitiesAt(it.x, it.y);
      // The entity's device class decides whether this device detects
      // anything, and so whether the ripple is on offer at all (issues #127,
      // #202).
      const deviceClass = it.entity
        ? (this.hass?.states[it.entity]?.attributes?.device_class as string | undefined)
        : undefined;
      // What the badge is reading right now, so the "Badge reads" row can open
      // on it rather than on a guess (issue #136). Same "resolve off hass at
      // the call site" arrangement as deviceClass above.
      const friendly = (id?: string) =>
        (id ? (this.hass?.states[id]?.attributes?.friendly_name as string | undefined) : undefined) ??
        id;
      const badgeSource = {
        source: badgeReading(this.hass, it)?.source ?? "primary",
        primaryLabel: friendly(it.entity),
        // One label per reading, positionally — the dropdown names each rather
        // than numbering them, and a reading with no entity of its own is read
        // off this device, so that is the name to show for it (issue #180).
        readingLabels: itemReadings(it).map((r) => friendly(r.entity || it.entity)),
      } as const;
      // One handler for every group: they all patch the same item, and only
      // the entity field needs anything extra.
      const apply = (patch: Record<string, unknown>, live: boolean): void => {
        if ("entity" in patch && typeof patch.entity === "string") {
          // Any entity change re-derives the item kind (icon defaults etc.) —
          // including clearing it, which resets kind to "generic".
          patch = { ...patch, kind: kindFromEntity(patch.entity) };
        }
        this._applyElementPatch("item", it.id, patch, live);
      };
      const effects = itemEffectsForm(it, deviceClass);
      return html`
        ${this._renderGroup("Identity", this._renderForm(itemIdentityForm(it), apply))}
        ${this._renderGroup(
          "What it reads",
          // Entity, its attribute, whether its own state shows, then every
          // other entity — the order the label prints them in (issue #180).
          this._renderForm(itemEntityForm(it, areaEntities), apply),
          this._renderForm(itemShowStateForm(it), apply),
          this._renderItemReadings(it)
        )}
        ${itemHasLabel(it)
          ? // Nothing to place or size while the device draws no label at all.
            this._renderGroup("Label", this._renderForm(itemLabelForm(it), apply))
          : nothing}
        ${this._renderGroup(
          "Badge",
          this._renderForm(itemBadgeForm(it, badgeSource), apply),
          this._renderItemIconRow(it)
        )}
        ${this._renderGroup(
          "Color",
          it.stateColor?.length
            ? // Colour by state supersedes the fixed active colour, so showing
              // both invites setting one and seeing the other. Say which one is
              // in charge instead of leaving a dead control on screen.
              html`<p class="hint rule-note">
                Colored by the state rules below — they replace the active color.
              </p>`
            : this._renderColorRow({
                label: "Active color",
                title: "Badge color while this device is on (issue #79)",
                value: it.activeColor,
                swatch: "#fdd835",
                placeholder: "(theme)",
                onLive: (activeColor) => this._updateItemLive(it.id, { activeColor }),
                onCommit: (activeColor) => this._updateItem(it.id, { activeColor }),
              }),
          this._renderStateColorRules(
            it.stateColor,
            (stateColor) => this._updateItem(it.id, { stateColor }),
            // Only a device draws a glyph, so only a device's rules offer an
            // icon — furniture and areas share this rule shape but paint
            // polygons (issue #106).
            { icons: true, iconPlaceholder: this._itemDefaultIcon(it) }
          )
        )}
        ${effects
          ? this._renderGroup(
              "Effects",
              this._renderForm(effects, apply),
              // The ring's colour belongs with the ring, not with the badge's.
              isRippleEntity(it.entity, deviceClass) && itemHasRipple(it)
                ? this._renderColorRow({
                    label: "Ripple color",
                    value: it.rippleColor,
                    swatch: it.activeColor ?? "#03a9f4",
                    placeholder: it.activeColor ? "(active color)" : "(primary)",
                    onLive: (rippleColor) => this._updateItemLive(it.id, { rippleColor }),
                    onCommit: (rippleColor) => this._updateItem(it.id, { rippleColor }),
                  })
                : nothing
            )
          : nothing}
        ${this._renderGroup("Behaviour", this._renderForm(itemBehaviourForm(it), apply))}
        ${this._renderGroup("Visibility", this._renderForm(itemGroup7aForm(it), apply))}
      `;
    }

    if (sel.kind === "text") {
      const t = this._floor().texts.find((x) => x.id === sel.id);
      if (!t) return html`${nothing}`;
      return html`
        ${this._renderForm(textForm(t, this._areaEntitiesAt(t.x, t.y)), (patch, live) =>
          this._applyElementPatch("text", t.id, patch, live)
        )}
        ${this._renderColorRow({
          label: "Color",
          value: t.color,
          swatch: "#000000",
          placeholder: "(theme default)",
          onLive: (color) => this._updateTextLive(t.id, { color }),
          onCommit: (color) => this._updateText(t.id, { color }),
        })}
      `;
    }

    if (sel.kind === "furniture") {
      const f = this._floor().furniture.find((x) => x.id === sel.id);
      if (!f) return html`${nothing}`;
      const fSpec = furnitureForm(f, this._areaEntitiesAt(f.x, f.y), this._symbols());
      const fApply = (patch: Record<string, unknown>, live: boolean) =>
        this._applyElementPatch("furniture", f.id, patch, live);
      return html`
        ${FloorplanCardEditor.FURNITURE_GROUPS.map(([title, names]) =>
          this._renderGroup(title, this._renderForm(formSlice(fSpec, names), fApply))
        )}
        ${this._renderGroup(
          "Color",
          this._renderColorRow({
          label: "Color",
          value: f.color,
          swatch: "#9e9e9e",
          placeholder: "(gray)",
            onLive: (color) => this._updateFurnitureLive(f.id, { color }),
            onCommit: (color) => this._updateFurniture(f.id, { color }),
          }),
          // Without an entity there is nothing to condition a colour on.
          f.entity
            ? html`
                ${this._renderColorRow({
                  label: "Active color",
                  title: "Color while the entity is on",
                  value: f.activeColor,
                  swatch: "#03a9f4",
                  placeholder: "(no change)",
                  onLive: (activeColor) => this._updateFurnitureLive(f.id, { activeColor }),
                  onCommit: (activeColor) => this._updateFurniture(f.id, { activeColor }),
                })}
                ${this._renderStateColorRules(f.stateColor, (stateColor) =>
                  this._updateFurniture(f.id, { stateColor })
                )}
              `
            : nothing
        )}
      `;
    }

    if (sel.kind === "area") {
      const a = (this._floor().areas ?? []).find((x) => x.id === sel.id);
      if (!a) return html`${nothing}`;
      const haAreas = haAreasOf(this.hass);
      const pendingEntities = a.haArea ? this._pendingAreaEntities(a) : [];
      const aSpec = areaForm(a);
      const aApply = (patch: Record<string, unknown>, live: boolean) =>
        this._applyElementPatch("area", a.id, patch, live);
      return html`
        ${this._renderGroup(
          // The name doubles as the HA-area link, so the link status line and
          // the name-related toggles belong with it.
          "Identity",
          this._renderForm(
            areaNameForm(a, haAreas.map((ha) => ha.name)),
            (patch, live) =>
              // A name change also decides `haArea` (see areaNamePatch).
              this._applyElementPatch("area", a.id, areaNamePatch(patch, haAreas), live)
          ),
          this._renderAreaLinkRow(a, haAreas),
          this._renderForm(formSlice(aSpec, ["showName", "labelSize"]), aApply)
        )}
        ${this._renderGroup(
          "What it reads",
          this._renderForm(formSlice(aSpec, ["entity"]), aApply)
        )}
        ${this._renderGroup(
          "Color",
          this._renderForm(formSlice(aSpec, ["highlight", "opacity", "activeOpacity"]), aApply),
          this._renderColorRow({
            label: "Color",
            value: a.color,
            swatch: "#03a9f4",
            placeholder: "(primary)",
            onLive: (color) => this._updateAreaLive(a.id, { color }),
            onCommit: (color) => this._updateArea(a.id, { color }),
          }),
          // The colours the bound entity drives. Same shape furniture and
          // devices already use, and gated the same way — without an entity
          // there is nothing to condition on. Until this existed the Entity
          // picker above was inert on its own: areaColor() resolves nothing
          // without an activeColor or a matching rule, so binding an entity
          // in the editor changed nothing and the feature looked unbuilt.
          a.entity
            ? html`
                ${this._renderColorRow({
                  label: "Active color",
                  title: "Color while the entity is on",
                  value: a.activeColor,
                  swatch: "#03a9f4",
                  placeholder: "(no change)",
                  onLive: (activeColor) => this._updateAreaLive(a.id, { activeColor }),
                  onCommit: (activeColor) => this._updateArea(a.id, { activeColor }),
                })}
                ${this._renderStateColorRules(a.stateColor, (stateColor) =>
                  this._updateArea(a.id, { stateColor })
                )}
              `
            : nothing
        )}
        ${this._renderGroup(
          // What tapping the room does (issue #181). Last, as it is on every
          // other element: the thing it *does*, after everything it *is*.
          "Behavior",
          this._renderForm(
            formSlice(aSpec, [
              "fitZoom",
              "zoom",
              "tap_action",
              "hold_action",
              "double_tap_action",
            ]),
            aApply
          )
        )}
        ${a.haArea
          ? this._renderGroup(
              // Everything that only exists because this room is linked to a
              // Home Assistant area.
              "Home Assistant area",
              html`<div class="row wide">
                <label>Filter entities</label>
                <input
                  type="checkbox"
                  .checked=${a.filterEntities ?? true}
                  @change=${(e: Event) =>
                    this._updateArea(a.id, {
                      filterEntities: (e.target as HTMLInputElement).checked,
                    })}
                />
                <span class="hint"
                  >Scope the entity picker, for devices placed inside this room, to this HA
                  area's entities.</span
                >
              </div>`,
              html`<div class="row wide">
                <button
                  ?disabled=${!pendingEntities.length}
                  title=${pendingEntities.length
                    ? `Add ${pendingEntities.length} device${pendingEntities.length === 1 ? "" : "s"} from this HA area, spread out across the room`
                    : "Every entity in this HA area is already placed on this floor"}
                  @click=${() => this._addAreaEntities(a)}
                >
                  <ha-icon icon="mdi:shape-square-plus"></ha-icon>
                  Add all devices in this HA area${pendingEntities.length
                    ? ` (${pendingEntities.length})`
                    : ""}
                </button>
              </div>`
            )
          : nothing}
        <p class="hint">
          Drag inside the fill to move the whole room; drag a vertex handle to reshape it.
        </p>
      `;
    }

    if (sel.kind === "tracker") {
      const tr = (this._floor().trackers ?? []).find((x) => x.id === sel.id);
      if (!tr) return html`${nothing}`;
      const trSpec = trackerForm(tr);
      const trApply = (patch: Record<string, unknown>, live: boolean) =>
        this._applyElementPatch("tracker", tr.id, patch, live);
      return html`
        ${this._renderGroup(
          "Zone",
          this._renderForm(formSlice(trSpec, FloorplanCardEditor.TRACKER_GROUPS[0][1]), trApply)
        )}
        ${this._renderGroup(
          // The two distance sensors that place the marker inside the zone —
          // the thing a tracker actually is, so it gets its own group rather
          // than two unlabelled blocks above the box.
          "Sensors",
          this._renderTrackerSensorRows(tr, "xSensor", "X sensor"),
          this._renderTrackerSensorRows(tr, "ySensor", "Y sensor")
        )}
        ${this._renderGroup(
          "Marker",
          this._renderForm(formSlice(trSpec, FloorplanCardEditor.TRACKER_GROUPS[1][1]), trApply),
          this._renderColorRow({
            label: "Color",
            value: tr.color,
            swatch: "#03a9f4",
            placeholder: "(primary)",
            onLive: (color) => this._updateTrackerLive(tr.id, { color }),
            onCommit: (color) => this._updateTracker(tr.id, { color }),
          })
        )}
      `;
    }

    if (sel.kind === "wall") {
      const w = this._floor().walls.find((x) => x.id === sel.id);
      if (!w) return html`${nothing}`;
      const length = Math.round(Math.hypot(w.x2 - w.x1, w.y2 - w.y1));
      return html`
        ${this._renderForm(wallForm(w), (patch, live) =>
          this._applyElementPatch("wall", w.id, patch, live)
        )}
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

  // The canvas mirrors the card, so it takes the same --fp-skin-* defaults
  // (issue #122). A skin overrides them on .stage only — the toolbar, panels
  // and forms stay in the Home Assistant theme, which is what makes the canvas
  // read as the plan rather than as more editor chrome.
  static styles = [
    skinTokens,
    css`
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
    /* Toolbar-icon buttons (Expand/Exit, Apply) — match the gear button's
       icon+label alignment so they read as part of the toolbar. */
    .expand-toggle,
    .apply-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
    }
    /* Apply writes to the dashboard, unlike everything else in the toolbar —
       accented so it reads as the one committing action. */
    .apply-btn {
      color: var(--primary-color, #03a9f4);
      border-color: var(--primary-color, #03a9f4);
    }
    /* Why the last Apply didn't go through; sits in the toolbar so it is
       visible in the fullscreen workspace too, where nothing else is. */
    .apply-error {
      font-size: 12px;
      color: var(--error-color, #c62828);
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
    svg.tracker,
    svg.area {
      cursor: crosshair;
    }
    .grid {
      /* Theme text colour at low opacity so the grid stays visible over a
         background image (and on both light and dark themes); non-scaling-stroke
         keeps the lines a crisp ~1px at any canvas size / zoom. Editor-only —
         the live card never draws a grid. */
      stroke: var(--fp-skin-text, var(--primary-text-color, #212121));
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
      stroke: var(--fp-skin-wall, var(--primary-text-color));
      /* Same skin hooks as the card's .wall, so the canvas draws the weight
         and glow the plan will actually have. The glow itself is on
         .fp-wall-neon, outside the doorway mask — see the note there. */
      stroke-width: var(--fp-skin-wall-width, 8);
      /* The wide transparent .wall-hit line beneath handles selection/drag.
         Without this, the visible line (painted on top) swallows clicks on the
         wall body, so you could only grab it just *outside* the body. */
      pointer-events: none;
    }
    /* Neon, matching the card. Must stay on a group *outside* the doorway
       mask: CSS applies filter before mask, so a filter on the wall itself is
       computed from the uncut wall and its halo then survives the cut,
       leaving a fringe that runs through every opening (#203). */
    .fp-wall-neon {
      filter: var(--fp-skin-wall-filter, none);
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
    /* Roll-up curtain: scaleY must shrink onto the band's own centerline
       (the track), not the SVG origin. */
    .fp-roll-curtain {
      transform-box: fill-box;
      transform-origin: center;
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
    /* Search row above the grid (issue #90): the library grows with every
       contributed symbol, so the list has to be findable, not just scrollable. */
    .furn-search {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      padding: 4px 6px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 6px;
    }
    .furn-search ha-icon {
      --mdc-icon-size: 16px;
      color: var(--secondary-text-color);
      flex: none;
    }
    .furn-search input {
      flex: 1;
      min-width: 0;
      border: none;
      outline: none;
      background: none;
      font: inherit;
      font-size: 12px;
      color: var(--primary-text-color);
    }
    .add-furn-scroll {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 4px;
      margin-top: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--divider-color, #eee);
      /* 26 built-ins already filled six rows; a community library is unbounded. */
      max-height: 46vh;
      overflow-y: auto;
    }
    .furn-group {
      grid-column: 1 / -1;
      font-size: 10px;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--secondary-text-color);
      opacity: 0.8;
      padding: 4px 2px 0;
    }
    .furn-empty {
      grid-column: 1 / -1;
      padding: 10px 2px;
      font-size: 12px;
      color: var(--secondary-text-color);
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
    /*
     * overlayScale: plan, previewed (issue #192). The same two lines the card
     * uses, on the box that plays the same part: the stage carries the canvas
     * ratio, so 100cqw is the plan's own width on screen and --fp-u is one
     * canvas unit. Declared on .items rather than .stage for the reason the
     * card documents — an unregistered custom property substitutes as a token
     * stream, so the cqw resolves where it is used, which stays correct if
     * --fp-u is ever registered with @property.
     *
     * Zoom falls out of it rather than needing a term of its own: the stage's
     * width is a percentage of the zoom, so zooming in widens the container and
     * every canvas-unit measure grows with the drawing — which is the mode.
     */
    .stage.scale-plan {
      container-type: inline-size;
    }
    /*
     * The unit itself, declared twice on purpose.
     *
     * The fallback in var(--fp-u, 1px) is not the safety net it looks like: it
     * fires when the property is *unset*, never when its value fails to
     * resolve. A browser with no container queries parses the calc quite
     * happily -- a custom property takes almost any token stream -- and then
     * every property using it is invalid at computed-value time, so each falls
     * back to its own initial value. Width becomes auto, and a badge collapses
     * to its borders: about 3px, with its label landing on top of it because
     * the item's box collapsed with it.
     *
     * So the plain value is declared first, and the container-query one only
     * where it can actually be computed. One pixel per canvas unit is exactly
     * what overlayScale fixed draws, which is the right thing to degrade to: a
     * plan that looks like it did before canvas units existed, rather than one
     * with 3px badges.
     *
     * The guard tests the unit as well as the property, because they are two
     * features and only one of them is what the declaration is made of. A
     * browser with container-type but no cqw would pass a check for the
     * property and then fail on the value, which is the exact collapse this is
     * here to stop. Test what is actually used; it costs one more clause.
     */
    .stage.scale-plan .items {
      --fp-u: 1px;
    }
    @supports (container-type: inline-size) and (width: 1cqw) {
      .stage.scale-plan .items {
        --fp-u: calc(100cqw / var(--fp-plan-w));
      }
    }
    /* Label padding and offsets go to em so they track the text with the plan,
       exactly as the card's own scale-plan rules do. Hairlines stay px on
       purpose there and here: below a pixel they disappear on the small cards
       this mode is for. */
    .stage.scale-plan .ilabel {
      padding: 0.08em 0.33em;
      border-radius: 0.33em;
      top: calc(100% + 0.17em);
      max-width: none;
    }
    .stage.scale-plan .ilabel-left,
    .stage.scale-plan .ilabel-right {
      top: 50%;
    }
    .stage.scale-plan .ilabel-left {
      right: calc(100% + 0.33em);
    }
    .stage.scale-plan .ilabel-right {
      left: calc(100% + 0.33em);
    }
    /* Preview of the card's shutter badge. Inherits .items' pointer-events:
       none — the opening underneath stays clickable for selection and drag. */
    .shutter-mark {
      position: absolute;
      /* transform and size are set inline, matching the card. */
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: var(--fp-skin-paper, var(--card-background-color, #fff));
      border: 1px solid var(--fp-skin-wall, var(--primary-text-color, #212121));
      color: var(--fp-skin-wall, var(--primary-text-color, #212121));
      opacity: 0.75;
    }
    .shutter-mark.on {
      color: var(--fp-active, var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      border-color: var(--fp-active, var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      opacity: 1;
    }
    .shutter-mark ha-icon {
      --mdc-icon-size: 15px;
      display: flex;
    }
    /* Grab area = the visible device, matching the card's hit area. A presence
       ripple is mostly empty air, and while the anchor took pointer events for
       all of it, a 110px square sat over the plan: the wall or door underneath
       could not be clicked at all, and neither could a device standing inside
       the ring. The badge and label answer instead — enough to grab and drag,
       and it puts back what was buried. */
    .edit-item {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: none;
      cursor: move;
      display: flex;
      flex-direction: column;
      align-items: center;
      touch-action: none;
    }
    .edit-item .badge,
    .edit-item .ilabel {
      pointer-events: auto;
    }
    .stack-icon,
    .ripple {
      pointer-events: none;
    }
    /* A ripple-only device has no badge to grab, so its centre answers. */
    .edit-item .ripple .dot {
      pointer-events: auto;
      position: relative;
    }
    .edit-item .ripple .dot::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: ${MIN_TOUCH_TARGET}px;
      height: ${MIN_TOUCH_TARGET}px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
    }
    .badge {
      width: 34px;
      height: 34px;
      border-radius: var(--fp-skin-badge-radius, 50%);
      background: var(--fp-skin-badge-bg, var(--card-background-color, #fff));
      border: var(--fp-skin-badge-border-width, 1.5px) solid
        var(--fp-skin-badge-border, var(--divider-color, #ccc));
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--fp-skin-text, var(--primary-text-color));
      box-shadow: var(--fp-skin-badge-shadow, 0 1px 3px rgba(0, 0, 0, 0.25));
    }
    /* Mirrors the card's .badge-value (issue #106) — the canvas must show the
       reading exactly as the plan will draw it. */
    .badge-value {
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    /* Hidden on the live card right now (issue #55): faded and dashed here so
       it reads as deliberately absent from the card, while staying selectable. */
    .edit-item.card-hidden {
      opacity: 0.4;
    }
    .edit-item.card-hidden .badge {
      border-style: dashed;
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

      /* Keep only the angular slice the ring should travel along */
      -webkit-mask: conic-gradient(
        from calc(var(--fp-ripple-direction) * 1deg - var(--fp-ripple-width) * 1deg / 2),
        #000 0deg,
        #000 calc(var(--fp-ripple-width) * 1deg),
        transparent calc(var(--fp-ripple-width) * 1deg)
      );
      mask: conic-gradient(
        from calc(var(--fp-ripple-direction) * 1deg - var(--fp-ripple-width) * 1deg / 2),
        #000 0deg,
        #000 calc(var(--fp-ripple-width) * 1deg),
        transparent calc(var(--fp-ripple-width) * 1deg)
      );
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
    .area-hit {
      cursor: move;
    }
    /* Dead-space hatching (issue #88): a whole region of the canvas, so it must
       never take a pointer event — it sits over the very walls and doors you
       would click next, and over empty floor you need to be able to drag on. */
    .fp-dead-space {
      pointer-events: none;
    }
    .area-hit-shape {
      /* Transparent fill turns the whole polygon into a pointer target for
         the whole-shape drag, without covering the translucent room fill
         drawn underneath by renderArea. */
      fill: transparent;
      stroke: none;
      pointer-events: all;
    }
    .area-scope-hint {
      display: flex;
      align-items: center;
      gap: 6px;
      margin: 0 0 6px;
      color: var(--primary-color, #03a9f4);
    }
    .area-scope-hint .link-btn {
      border: none;
      background: none;
      padding: 0 2px;
      font: inherit;
      color: var(--primary-color, #03a9f4);
      text-decoration: underline;
      cursor: pointer;
      flex: 0 0 auto;
    }
    .area-scope-hint ha-icon {
      --mdc-icon-size: 16px;
      flex: 0 0 auto;
    }
    .area-outline {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2;
      pointer-events: none;
    }
    /* The room currently scoping the selected element's entity picker: a
       breathing tint plus marching-ants border, so "you are working inside
       the Kitchen — that's why the picker is short" reads at a glance. */
    .area-scoping {
      fill: var(--primary-color, #03a9f4);
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2.5;
      stroke-dasharray: 10 6;
      pointer-events: none;
      animation: fp-area-breathe 2.2s ease-in-out infinite,
        fp-area-ants 1.4s linear infinite;
    }
    @keyframes fp-area-breathe {
      0%,
      100% {
        fill-opacity: 0.1;
      }
      50% {
        fill-opacity: 0.28;
      }
    }
    @keyframes fp-area-ants {
      to {
        stroke-dashoffset: -16;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .area-scoping {
        animation: none;
        fill-opacity: 0.2;
      }
    }
    .area-draft-line {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2;
      stroke-dasharray: 6 4;
      pointer-events: none;
    }
    .area-draft-hover {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.5;
      stroke-dasharray: 3 4;
      opacity: 0.7;
      pointer-events: none;
    }
    .area-draft-point {
      fill: var(--primary-color, #03a9f4);
      stroke: var(--card-background-color, #fff);
      stroke-width: 1.5;
      pointer-events: none;
    }
    .area-draft-start {
      fill: var(--card-background-color, #fff);
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 2;
      pointer-events: none;
    }
    /* Light pools are decoration: they must never intercept a pointer. These
       are filled circles drawn above the areas, so without this they swallow
       pointerdown and areas under a lit lamp cannot be selected (issue #108).
       The blend rules mirror the card's, so the editor previews the same
       picture it will render — overlapping lamps add rather than stack. */
    .fp-glows {
      isolation: isolate;
      pointer-events: none;
    }
    .fp-glow {
      mix-blend-mode: screen;
    }
    /* Radius guide for the selected cast-light device (issue #108). Outline
       only — it shows how far the light reaches without pretending it is on. */
    .glow-guide {
      fill: none;
      stroke: var(--primary-color, #03a9f4);
      stroke-width: 1.5;
      stroke-dasharray: 6 5;
      opacity: 0.7;
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
    /* Icon motion while the entity is active (issue #48) — matches the card. */
    ha-icon.anim-spin {
      animation: fp-icon-spin 2s linear infinite;
    }
    ha-icon.anim-pulse {
      animation: fp-icon-pulse 1.6s ease-in-out infinite;
    }
    @keyframes fp-icon-spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(360deg);
      }
    }
    @keyframes fp-icon-pulse {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.4;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      ha-icon.anim-spin,
      ha-icon.anim-pulse {
        animation: none;
      }
    }
    .ilabel {
      /* Out of flow, hanging below the badge: the label must not change the
         element's box, so badges anchor on (x, y) whether or not a label
         renders — icons stay aligned (issue #34) and match the card. */
      position: absolute;
      top: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      font-size: 11px;
      line-height: 1;
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--fp-skin-badge-bg, var(--card-background-color, #fff));
      color: var(--secondary-text-color);
      white-space: nowrap;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    /* Label beside the badge (issue #180), mirroring the card's own rule so
       moving it here shows what the card will do rather than only what the
       config now says. */
    .ilabel-left,
    .ilabel-right {
      top: 50%;
      transform: translateY(-50%);
    }
    .ilabel-left {
      left: auto;
      right: calc(100% + 4px);
    }
    .ilabel-right {
      left: calc(100% + 4px);
    }
    /* The card's own label line, drawn as the card draws it (issue #135):
       full-strength ink, and no width clamp — the card has none, and clipping
       is exactly what would make a long label look right here and wrong live.
       The unclamped variant is the one you are checking; the dim fallback
       above stays clamped, being editor chrome rather than a preview. */
    .ilabel.live {
      color: var(--fp-skin-text, var(--primary-text-color));
      max-width: none;
      overflow: visible;
    }
    /* An extra-reading row (issue #180): the entity picker takes the space and
       the attribute box stays narrow beside it, the same proportions the
       state-rule rows use for their condition and colour. */
    .item-reading ha-entity-picker,
    .item-reading input[type="text"]:not(.reading-attr) {
      flex: 1 1 auto;
      min-width: 0;
    }
    .item-reading .reading-attr {
      flex: 0 0 130px;
      min-width: 0;
    }
    /* The visibility toggle belongs to the entity row above it, so it sits
       tight under it and the gap goes after the pair instead. */
    .reading-show {
      margin-top: -4px;
      margin-bottom: 12px;
      padding-left: 4px;
    }
    .reading-show label {
      flex: 0 0 auto;
      font-size: 12px;
      /* Holds the checkbox it wraps, so the pair reads as one control and the
         whole thing is a click target. */
      display: inline-flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
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
    /* Element header: kind icon + summary + the selection's actions.
       The actions are the fixed part and the summary is the elastic one: a
       device named after a long entity id used to push Duplicate and Delete
       off the panel entirely (issue #163), which is unreachable rather than
       merely ugly. So everything but the title refuses to shrink, and the
       title truncates instead — its full text stays available on hover. */
    .edit-head {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 10px;
    }
    .edit-head ha-icon {
      --mdc-icon-size: 18px;
      color: var(--secondary-text-color);
      flex: none;
    }
    .edit-head .edit-title {
      font-size: 13px;
      font-weight: 600;
      /* min-width:0 is what lets a flex item shrink below its content. */
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .edit-head .head-spacer {
      /* Grows to push the actions right, but never shrinks the title away
         while there is still slack of its own to give back. */
      flex: 1 1 0;
      min-width: 0;
    }
    .edit-head button {
      display: inline-flex;
      align-items: center;
      padding: 4px 8px;
      flex: none;
    }
    .edit-head button ha-icon {
      --mdc-icon-size: 16px;
      color: inherit;
    }
    /* Lock in place (issue #191). The pressed state has to read at a glance:
       it is the only one of these buttons that describes a state rather than
       performing an action, and "why won't this drag" is the question it
       exists to answer. */
    .edit-head button.on {
      color: var(--primary-color);
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
    /* ---- Element panel groups --------------------------------------------
       The device panel is two dozen controls; ungrouped, finding one meant
       reading all of them. Each group is a heading and a hairline above it,
       with real space between groups so the eye can skip a whole section it
       does not want.

       The rule is on the group rather than between them, and the first group
       drops it: a line above the very first heading would read as a border
       around the panel rather than as a separator inside it. */
    .cfg-group {
      border-top: 1px solid var(--divider-color, #e0e0e0);
      padding-top: 14px;
      margin-top: 18px;
    }
    /* A collapsed group is one line, and a column of one-line headings wants
       to read as a list rather than as eight things with a gap each. */
    .cfg-group:not(.open) {
      padding-top: 8px;
      margin-top: 8px;
    }
    /* Ties with the rule above on specificity, so it has to stay below it:
       the first group leads the panel and takes no space above it whether it
       is open or shut. */
    .cfg-group:first-of-type {
      border-top: none;
      padding-top: 0;
      margin-top: 0;
    }
    /* The heading names the group without competing with the field labels
       beneath it: same size, but the primary ink and a little letter-spacing,
       so it reads as a heading rather than as one more row label.

       It is also the group's disclosure control, so it undoes the panel's
       generic button look (border, chip padding, capitalize — which would
       print "What it reads" as "What It Reads") and keeps the heading's own
       type. Full width so the whole line is the hit target, not just the
       glyph. */
    .cfg-group-title {
      display: flex;
      align-items: center;
      gap: 4px;
      width: 100%;
      margin: 0 0 10px;
      padding: 2px 0;
      border: none;
      border-radius: 0;
      background: none;
      cursor: pointer;
      text-align: left;
      text-transform: none;
      font: inherit;
      font-size: 13px;
      font-weight: 500;
      letter-spacing: 0.02em;
      color: var(--primary-text-color);
    }
    /* The chevron is the affordance, so it stays quieter than the title it
       points at. */
    .cfg-group-title ha-icon {
      --mdc-icon-size: 18px;
      flex: none;
      color: var(--secondary-text-color);
    }
    /* ha-form packs its own fields tightly; the last one in a group should not
       sit flush against the next group's rule. */
    .cfg-group > *:last-child {
      margin-bottom: 0;
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
    ha-icon-picker,
    ha-combo-box {
      flex: 1;
      min-width: 0;
    }
    .row input.num {
      flex: 0 0 64px;
    }
    /* Paste-a-symbol block (issue #90): a stacked row, since a JSON blob does
       not fit the label-then-control shape the rest of the panel uses. */
    .row.col {
      flex-direction: column;
      align-items: stretch;
    }
    .row.col > label {
      flex: none;
      margin-bottom: 2px;
    }
    .symbol-input {
      width: 100%;
      box-sizing: border-box;
      padding: 6px;
      border-radius: 4px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font-family: var(--code-font-family, ui-monospace, monospace);
      font-size: 11px;
      resize: vertical;
    }
    .symbol-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-bottom: 6px;
    }
    .symbol-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 11px;
      background: var(--secondary-background-color, #f2f2f2);
      color: var(--primary-text-color);
    }
    .symbol-chip button.chip-x {
      border: none;
      background: none;
      padding: 0;
      font-size: 11px;
      line-height: 1;
      color: var(--secondary-text-color);
    }
    .symbol-actions button[disabled] {
      opacity: 0.5;
      cursor: default;
    }
    .symbol-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 6px;
      font-size: 12px;
    }
    .symbol-actions a {
      color: var(--secondary-text-color);
    }
    .symbol-error {
      margin-top: 4px;
      font-size: 11px;
      color: var(--error-color, #c62828);
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
    /* The Area name's status line (Linked chip / hint). It sits on its own row
       under the field rather than beside it: the docked inspector is only
       340px wide in full screen, and a chip + hint sharing that row squeezed
       the name box down to a sliver. The empty label keeps it aligned with the
       field above, and -4px claws back the row's own bottom margin so the pair
       still reads as one control. */
    .area-name-status {
      margin-top: -4px;
    }
    /* "Color by state" rules (issues #68, #79, #82). The rules are a list, so
       they read as one group indented under the heading row rather than as
       more loose fields; the rail is what says "these belong together" in a
       340px panel where indentation alone is too expensive. */
    .state-colors {
      margin-bottom: 4px;
    }
    .state-colors label {
      flex: 1 1 auto;
      font-weight: 500;
    }
    .state-color-rule,
    .state-color-add {
      padding-left: 8px;
      border-left: 2px solid var(--divider-color, #ccc);
      margin-bottom: 6px;
    }
    /* The docked inspector is only 340px wide, so a rule's condition and its
       colour cannot share a line without crushing both. Wrap onto two lines
       instead of squeezing — the fullscreen visibility complaint. */
    .row.state-color-rule {
      flex-wrap: wrap;
      row-gap: 4px;
    }
    .rule-note {
      margin: 0 0 6px;
      font-style: italic;
    }
    /* The canvas preview mirrors the card: a resolved state colour paints the
       badge whether or not the entity reads "on". */
    .edit-item .badge.state-colored {
      background: var(--fp-state);
      border-color: var(--fp-state);
      color: var(--fp-ink, var(--text-primary-color, #212121));
    }
    /* An active device, painted exactly as the card paints it (issue #106):
       the device's active colour, else a colour-capable bulb's own, else the
       theme's active yellow — the same fallback chain as .item.on .badge.
       The canvas previewed none of this before, so setting "Active color"
       changed nothing here and a coloured lamp looked plain. Below
       .state-colored, which is the more specific statement. */
    .edit-item .badge.active-colored {
      background: var(--fp-active, var(--fp-skin-active, var(--state-light-active-color, var(--state-active-color, #fdd835))));
      border-color: var(--fp-active, var(--fp-skin-active, var(--state-light-active-color, var(--state-active-color, #fdd835))));
      color: var(--fp-ink, var(--fp-skin-active-ink, var(--text-primary-color, #212121)));
    }
    .state-color-rule select {
      flex: 0 0 96px;
    }
    /* Higher specificity than the generic .row input rule above, which would
       otherwise stretch a two-digit threshold across half the panel. */
    .row.state-color-rule input.cond {
      flex: 0 0 90px;
    }
    .row.state-color-rule span.cond {
      flex: 0 0 auto;
      font-size: 12px;
      white-space: nowrap;
    }
    /* The color text box gives up width first — the condition and the swatch
       are what you read, and the swatch already shows the colour. */
    .row.state-color-rule input.rule-color-text {
      flex: 1 1 60px;
      min-width: 60px;
    }
    /* The optional icon (issue #106) takes the rule's second line rather than
       competing for the first: the condition and the colour are what you scan,
       and an icon picker needs room for its name to be readable. */
    .row.state-color-rule .rule-icon {
      flex: 1 1 100%;
      min-width: 0;
    }
    .state-color-rule .rule-remove,
    .state-color-add button {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      color: var(--secondary-text-color);
      cursor: pointer;
      padding: 3px 6px;
    }
    .state-color-rule .rule-remove {
      flex: 0 0 auto;
    }
    .state-color-rule .rule-remove ha-icon,
    .state-color-add button ha-icon {
      --mdc-icon-size: 16px;
    }
    .area-name-status label {
      /* Alignment spacer only — nothing to announce. */
      flex: 0 0 90px;
    }
    /* "Linked" badge on the Area name row: the HA-area association is implied
       by the name matching, so it needs to be visible somewhere. */
    .ha-link-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 4px 2px 8px;
      border-radius: 999px;
      background: var(--primary-color, #03a9f4);
      color: var(--text-primary-color, #fff);
      font-size: 12px;
      font-weight: 500;
      white-space: nowrap;
    }
    .ha-link-chip ha-icon {
      --mdc-icon-size: 14px;
    }
    .ha-link-chip .unlink {
      display: inline-flex;
      align-items: center;
      padding: 0;
      border: none;
      background: none;
      color: inherit;
      cursor: pointer;
      opacity: 0.85;
    }
    .ha-link-chip .unlink:hover {
      opacity: 1;
    }
  `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-card-editor": FloorplanCardEditor;
  }
}
