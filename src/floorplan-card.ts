import { LitElement, html, css, svg, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import type {
  HomeAssistant,
  FloorplanCardConfig,
  FloorItem,
  FloorText,
  Floor,
  Area,
  OverlayScale,
  RenderHass,
} from "./types";
import { HistoryService } from "./replay-history/history-service";
import { buildRenderHass } from "./replay-history/render-state-service";
import "./replay-history/history-timeline";
import "./replay-history/replay-panel";
import { cssColor, cssColorOr, cssNumber, cssIdent, cssEntityId, contrastText } from "./css-safe";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_AREA_LABEL_SIZE,
  MIN_TOUCH_TARGET,
  DEFAULT_SUN_MIN,
  DEFAULT_SUN_MAX,
  PRESS_SCALE,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  getFloors,
  trackerPresenceDetected,
  newPlanConfig,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  renderWallMask,
  imageFitRatio,
  sunBrightness,
  resolveOpeningAmount,
  openingIsActive,
  openingActionForGesture,
  openingIsPressable,
  areaActionForGesture,
  areaHasActions,
  openingHasTwoLeaves,
  secondLeafOf,
  shutterAmount,
  shutterStyleOf,
  shutterActive,
  shutterMarkPoint,
  shutterMarkIcon,
  shutterMarkNormal,
  openingMarkPoint,
  openingMarkIcon,
  openingMarkNormal,
  hasOpeningMark,
  SHUTTER_MARK_PIXEL_OFFSET,
  SHUTTER_MARK_SIZE,
  SHUTTER_MARK_ICON_SIZE,
  hasShutterMark,
  entityStateText,
  renderRipple,
  renderFurniture,
  furnitureColor,
  furnitureFloorTarget,
  renderTracker,
  renderArea,
  renderAreaBorder,
  renderDeadSpace,
  renderDeadSpaceHatch,
  areaColor,
  glowPaint,
  lightBadgePaint,
  renderGlow,
  renderGlowMask,
  renderSunDimMask,
  wallsLightPassesThrough,
  openingClearFraction,
  polygonCentroid,
  trackerSensorReading,
  entityIsActive,
  itemBadgeLabel,
  resolveStateColor,
  itemRawValue,
  badgeContentOf,
  badgeValue,
  badgeValueSize,
  pressEffectOf,
  labelPositionOf,
  offlineStyleOf,
  itemIsOffline,
  itemHiddenWhenInactive,
  itemLabelSize,
  areaLabelFontSize,
  wallStrokeStyle,
  normalizeOverlayScale,
  overlayLength,
  renderSunlight,
  sunLightDirection,
  sunlightStrengthOf,
  sunReachScale,
  sunIsPinned,
  SUN_REACH,
  SUN_LIGHT_COLOR,
  SUN_SHADE_COLOR,
  hassRenderInputsChanged,
  collectWatchedEntities,
  resolveItemIcon,
  resolveIconAnimation,
  itemIconSize,
  normalizePlanRotation,
  rotatedCanvasSize,
  rotatePlanPoint,
  planRotationTransform,
  areaZoomTransform,
  IDENTITY_ZOOM,
  type PlanRotation,
} from "./render";
import { symbolCatalog } from "./symbols";
import { deadSpacesCached } from "./dead-space";
import type { Opening } from "./types";
import {
  skinAttribute,
  skinPalettes,
  skinTokens,
  SKIN_ACCENT,
  SKIN_PAPER,
  SKIN_TEXT,
  SKIN_WALL,
} from "./skins";
import { actionForGesture, executeAction, hasAction, itemIsInteractive } from "./actions";
import { actionHandler } from "./action-handler";
import { ReplayControllerImpl } from "./replay-history/replay-controller";
import { createReplayPanelProps, renderReplayPanel } from "./replay-history/replay-panel";
import { getReplayWatchedEntities } from "./replay-history/replay-utils";

/**
 * Which floor each plan was last viewed on, keyed by its floor-id set (issue
 * #81). Home Assistant's card editor **recreates** the preview element on
 * every config change, so per-instance view state alone is lost on each
 * keystroke and the preview snaps back to the default floor — making an
 * upstairs plan almost uneditable. Module-level so it survives that
 * re-creation, keyed by content so unrelated cards never share a floor.
 *
 * Deliberately not persisted: it is view state, never written to the config.
 */
const lastViewedFloor = new Map<string, string>();

/** Content key for {@link lastViewedFloor} — the plan's floor ids, in order. */
function floorMemoryKey(floors: readonly Floor[]): string {
  return floors.map((f) => f.id).join("|");
}

@customElement("easy-floorplan-card")
export class FloorplanCard extends LitElement {
  private static _nextWallMaskId = 0;
  private static _nextGlowId = 0;

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: FloorplanCardConfig;
  /** View-state: which floor is shown. Never persisted to config. */
  @state() private _activeFloorId?: string;
  /** View-state: which area (if any) the plan is zoomed in to. Never persisted. */
  @state() private _zoomedAreaId?: string;
  private readonly _wallMaskId = `fp-wall-mask-${FloorplanCard._nextWallMaskId++}`;
  /** Prefix for this card's glow gradient ids, unique per instance (issue #6). */
  private readonly _glowIdBase = `fp-glow-${FloorplanCard._nextGlowId++}`;
  /** Entity ids this plan actually displays; used to skip irrelevant hass updates. */
  private _watchedEntities: Set<string> = new Set();
  private readonly _historyService = new HistoryService();

  private _syncHistoryServiceContext(): void {
    this._historyService.configure({
      hass: this.hass,
      watched: this._config ? getReplayWatchedEntities(this._config, this._activeFloorId) : undefined,
    });
  }

  private readonly _replayController = new ReplayControllerImpl({
    getConfig: () => this._config,
    getHass: () => this.hass,
    getActiveFloorId: () => this._activeFloorId,
    getHistoryService: () => this._historyService,
    requestUpdate: () => this.requestUpdate(),
  });


  public setConfig(config: FloorplanCardConfig): void {
    // Cheap shape assertions so malformed YAML surfaces as HA's error card
    // instead of a render crash deep inside the SVG.
    if (!config || typeof config !== "object") throw new Error("Invalid configuration");
    const raw = config as Record<string, unknown>;
    // A key with an empty YAML value ("trackers:") parses to null — treat it
    // as unset like the ?? defaults always have, not as malformed.
    for (const key of ["walls", "openings", "items", "texts", "furniture", "trackers", "areas", "floors"]) {
      if (raw[key] != null && !Array.isArray(raw[key]))
        throw new Error(`Invalid configuration: "${key}" must be a list`);
    }
    for (const key of ["width", "height", "grid", "rotation"]) {
      if (raw[key] != null && typeof raw[key] !== "number")
        throw new Error(`Invalid configuration: "${key}" must be a number`);
    }
    this._config = {
      ...config,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
      walls: config.walls ?? [],
      openings: config.openings ?? [],
      items: config.items ?? [],
      texts: config.texts ?? [],
      furniture: config.furniture ?? [],
    };
    this._watchedEntities = collectWatchedEntities(this._config);
    this._syncHistoryServiceContext();
    this._replayController.state.configuredColorCache.clear();
    this._historyService.clearCache();
    if (!this._replayController.state.configured) {
      this._replayController.state.playbackController.pause();
      this._replayController.stopReplayLoop();
    } else if (this.hass) {
      this._replayController.ensureStarted();
    }
    // Restore the floor this plan was last viewed on (issue #81). Only when
    // this instance has no floor of its own yet — a live floor switch always
    // wins — and only if that floor still exists.
    if (!this._activeFloorId) {
      const floors = getFloors(this._config);
      const remembered = lastViewedFloor.get(floorMemoryKey(floors));
      if (remembered && floors.some((f) => f.id === remembered)) {
        this._activeFloorId = remembered;
      }
    }
  }

  /**
   * HA pushes a fresh `hass` on every state change anywhere in the instance —
   * for most updates nothing on this plan moved. Skip those renders entirely.
   */
  protected shouldUpdate(changed: PropertyValues): boolean {
    // Anything but a pure hass tick (config change, floor switch, first render).
    if (!(changed.size === 1 && changed.has("hass"))) return true;
    const prev = changed.get("hass") as HomeAssistant | undefined;
    if (!prev || !this.hass) return true;
    return hassRenderInputsChanged(prev, this.hass, this._watchedEntities);
  }

  /**
   * Carry the skin as an attribute on the host, where `skinPalettes` picks it
   * up (issue #155). It has to be the host and not the template, because the
   * point is to sit *above* the `<ha-card>` a card-mod rule targets — see
   * skins.ts. Only ever a `findSkin` match, so an unrecognised `skin:` puts no
   * attribute on the element at all.
   */
  protected willUpdate(changed: PropertyValues): void {
    if (!changed.has("_config")) return;
    const skin = skinAttribute(this._config?.skin);
    if (skin) this.setAttribute("data-skin", skin);
    else this.removeAttribute("data-skin");
  }

  protected updated(changed: PropertyValues): void {
    super.updated(changed);
    if (changed.has("hass") || changed.has("_activeFloorId")) {
      this._syncHistoryServiceContext();
    }
    if (
      (changed.has("hass") || changed.has("_activeFloorId"))
      && this.hass
      && this._config?.historyReplay?.enabled
      && !this._replayController.state.loadRequested
      && !this._replayController.state.enabled
      && !this._replayController.state.manuallyDisabled
    ) {
      this._replayController.ensureStarted();
    }
  }

  public getCardSize(): number {
    return 6;
  }

  public static async getConfigElement() {
    await import("./editor");
    return document.createElement("easy-floorplan-card-editor");
  }

  public static getStubConfig(): Partial<FloorplanCardConfig> {
    // Minimal on purpose: the editor migrates to the floors model on first
    // edit, and defaults (width/height/grid) backfill in setConfig.
    //
    // …except what a *new* plan is deliberately made with, which is
    // {@link newPlanConfig}'s to state: written into the config rather than
    // inferred from a missing key, so it reaches new plans and only new plans
    // (issue #192).
    return newPlanConfig();
  }

  /**
   * Sections-view sizing (grid rows ≈ 56px): room for the 5:3 default canvas.
   * An instance method — HA calls it on the card element (getConfigElement /
   * getStubConfig are the static ones, called before any instance exists).
   */
  public getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  private _isOn(item: FloorItem, renderHass?: RenderHass): boolean {
    // Domain-aware: locks say "unlocked", vacuums "cleaning" — never "on".
    return entityIsActive(item.entity, renderHass?.states[item.entity]?.state);
  }

  /** How far open an opening should be drawn (0..1), from its entity (or default). */
  private _openingAmount(o: Opening, renderHass?: RenderHass): number {
    const state = o.entity ? renderHass?.states[o.entity] : undefined;
    return resolveOpeningAmount(o, state);
  }

  /** Whether an opening wears its accent: drawn open, or a cover still in transit. */
  private _openingActive(o: Opening, renderHass?: RenderHass): boolean {
    const state = o.entity ? renderHass?.states[o.entity] : undefined;
    return openingIsActive(o, state);
  }

  /**
   * The second leaf's own state for an opening with a sensor on each — a
   * two-panel slider (issue #145) or a hinged double (issue #159).
   * `undefined` — no second sensor, or a shape with only one leaf — leaves both
   * on the first entity, so nothing about a single-sensor opening changes.
   */
  private _openingSecond(o: Opening, renderHass?: RenderHass): { amount: number; active: boolean } | undefined {
    if (!o.secondaryEntity || !openingHasTwoLeaves(o)) return undefined;
    const leaf = secondLeafOf(o);
    const state = renderHass?.states[o.secondaryEntity];
    return { amount: resolveOpeningAmount(leaf, state), active: openingIsActive(leaf, state) };
  }

  /**
   * The same for a hinged shutter's other panel (issue #159). Read from its
   * own key and its own resolvers — the shutter answers to `shutterInvert` and
   * is drawn from `shutterAmount` / `shutterActive`, not the sash's — and only
   * for a `swing` shutter, since a roll curtain has no second panel to drive.
   */
  private _shutterSecond(o: Opening, renderHass?: RenderHass): { amount: number; active: boolean } | undefined {
    if (!o.shutterSecondaryEntity || shutterStyleOf(o) !== "swing") return undefined;
    const state = renderHass?.states[o.shutterSecondaryEntity];
    return {
      amount: shutterAmount(state, o.shutterInvert),
      active: shutterActive(state, o.shutterInvert),
    };
  }

  private _itemIcon(item: FloorItem, renderHass?: RenderHass): string {
    return resolveItemIcon(
      item,
      renderHass?.states[item.entity],
      this.hass?.entities?.[item.entity]?.icon,
    );
  }

  private _label(item: FloorItem, renderHass?: RenderHass): string {
    return item.name ?? renderHass?.states[item.entity]?.attributes?.friendly_name ?? item.entity ?? "";
  }

  public disconnectedCallback(): void {
    this._replayController.stopReplayLoop();
    super.disconnectedCallback();
  }

  private _handleItemAction(
    ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>,
    item: FloorItem
  ): void {
    if (!this.hass) return;
    executeAction(this, this.hass, item, actionForGesture(item, ev.detail.action));
  }

  /**
   * An entity's `supported_features` bitmask, or 0 when it isn't in `hass`.
   * An arrow property so it can be handed to the pure resolvers in `render.ts`
   * without a `.bind(this)` at every call site.
   */
  private _featuresOf = (id: string): number =>
    (this.hass?.states[id]?.attributes?.supported_features as number) ?? 0;

  /** What a gesture on this opening would do, if anything. */
  private _openingPress(o: Opening, gesture: "tap" | "hold" | "double_tap") {
    return openingActionForGesture(o, gesture, this._featuresOf);
  }

  /**
   * Pressing an opening (issue #74 follow-up). Which entity answers — the
   * window/door or its shutter — is {@link openingActionForGesture}'s call;
   * from here it is the same Lovelace dispatch every device uses.
   */
  private _onOpeningAction(
    ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>,
    o: Opening
  ): void {
    if (!this.hass) return;
    const press = this._openingPress(o, ev.detail.action);
    if (!press) return;
    executeAction(this, this.hass, { entity: press.entity }, press.config);
  }

  /**
   * The shutter badge (issue #74 follow-up): the shutter entity's own icon,
   * beside an opening that binds both a window/door and a shutter.
   *
   * HTML rather than SVG, like the device badges: it holds a real `ha-icon`.
   * And like them it follows `overlayScale` (#148) — fixed pixels by default,
   * so it stays legible whatever canvas units the author chose, or canvas
   * units under `plan`, so it shrinks with the drawing instead of towering
   * over a scaled-down one. Both offsets follow the same choice, or the badge
   * would drift off the opening at one scale and sit on it at another.
   *
   * The glyph carries the open/closed reading on its own — HA's shutter icons
   * come in pairs — and the accent says the same thing again in colour.
   *
   * Tapping it opens the shutter, whatever the opening's own tap does. That is
   * the point of drawing it: the entity the opening symbol does not lead with
   * gets a control of its own, instead of living behind a press-and-hold
   * nobody can see.
   */
  private _renderShutterMark(
    o: Opening,
    c: FloorplanCardConfig,
    rot: PlanRotation,
    scale: OverlayScale,
    renderHass?: RenderHass
  ): TemplateResult {
    const id = o.shutterEntity!;
    const st = renderHass?.states[id];
    const open = shutterAmount(st, o.shutterInvert) > 0;
    const active = shutterActive(st, o.shutterInvert);
    const icon = shutterMarkIcon(o, st, open, this.hass?.entities?.[id]?.icon);
    const accent = cssColor(o.shutterActiveColor ?? o.activeColor) ?? SKIN_ACCENT;
    const at = shutterMarkPoint(o);
    const p = rotatePlanPoint(at.x, at.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    // Pushed clear of the opening by the badge's own size as well as by the
    // canvas offset, so the tap target underneath stays reachable. In the
    // badge's own unit: fixed pixels never shrink with the plan, and would
    // otherwise cover the opening on a large canvas in a narrow card.
    const n = shutterMarkNormal(o, rot);
    const step = overlayLength(SHUTTER_MARK_PIXEL_OFFSET, scale);
    const push = `translate(calc(${n.x} * ${step}), calc(${n.y} * ${step}))`;
    const box = overlayLength(SHUTTER_MARK_SIZE, scale);
    const name =
      (renderHass?.states[id]?.attributes?.friendly_name as string | undefined) ?? id;
    return html`
      <div
        class="shutter-mark ${active ? "on" : "off"}"
        data-entity=${cssEntityId(id) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;
               width:${box};height:${box};
               transform:translate(-50%,-50%) ${push};--fp-active:${accent};"
        title="${name} · ${entityStateText(renderHass, id)}"
        role="button"
        tabindex="0"
        @action=${() => {
          if (this.hass) executeAction(this, this.hass, { entity: id }, { action: "more-info" });
        }}
        .actionHandler=${actionHandler({})}
      >
        <ha-icon
          icon=${icon}
          style="--mdc-icon-size:${overlayLength(SHUTTER_MARK_ICON_SIZE, scale)};"
        ></ha-icon>
      </div>
    `;
  }

  /**
   * The opening's own badge (issue #154 follow-up) — the same circle as the
   * shutter's, for the entity the opening symbol itself draws.
   *
   * Opt-in, because most symbols need no help: a leaf that has swung and a
   * panel that has slid are both still on screen, in the accent, saying so. A
   * roll-up is the one that isn't — its curtain leaves the floor plane, and
   * wide open the gap holds a single coloured line. That line is honest and
   * easy to miss, so this puts the entity's own open/closed glyph beside it.
   *
   * It sits on the far side of the wall from the shutter's badge, which is
   * what keeps the two from stacking on an opening that draws both.
   */
  private _renderOpeningMark(
    o: Opening,
    c: FloorplanCardConfig,
    rot: PlanRotation,
    scale: OverlayScale,
    renderHass?: RenderHass
  ): TemplateResult {
    const id = o.entity!;
    const st = renderHass?.states[id];
    const open = this._openingAmount(o, renderHass) > 0;
    const active = this._openingActive(o, renderHass);
    const icon = openingMarkIcon(o, st, open, this.hass?.entities?.[id]?.icon);
    const accent = cssColor(o.activeColor) ?? SKIN_ACCENT;
    const at = openingMarkPoint(o);
    const p = rotatePlanPoint(at.x, at.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    const n = openingMarkNormal(o, rot);
    const step = overlayLength(SHUTTER_MARK_PIXEL_OFFSET, scale);
    const push = `translate(calc(${n.x} * ${step}), calc(${n.y} * ${step}))`;
    const box = overlayLength(SHUTTER_MARK_SIZE, scale);
    const name =
      (renderHass?.states[id]?.attributes?.friendly_name as string | undefined) ?? id;
    return html`
      <div
        class="shutter-mark ${active ? "on" : "off"}"
        data-entity=${cssEntityId(id) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;
               width:${box};height:${box};
               transform:translate(-50%,-50%) ${push};--fp-active:${accent};"
        title="${name} · ${entityStateText(renderHass, id)}"
        role="button"
        tabindex="0"
        @action=${() => {
          if (this.hass) executeAction(this, this.hass, { entity: id }, { action: "more-info" });
        }}
        .actionHandler=${actionHandler({})}
      >
        <ha-icon
          icon=${icon}
          style="--mdc-icon-size:${overlayLength(SHUTTER_MARK_ICON_SIZE, scale)};"
        ></ha-icon>
      </div>
    `;
  }

  /**
   * Switch to a floor, from the switcher or from a staircase (issue #121).
   *
   * Shared so the two cannot drift apart on the things that are easy to
   * forget: remembering the choice for the next preview the editor builds, and
   * dropping a zoom that belonged to the floor being left.
   */
  private _goToFloor(floors: readonly Floor[], id: string): void {
    const wasSameFloor = this._activeFloorId === id;
    this._activeFloorId = id;
    lastViewedFloor.set(floorMemoryKey(floors), id);
    this._zoomedAreaId = undefined;

    if (wasSameFloor || !this.hass || !this._config?.historyReplay?.enabled) return;
    this._replayController.resetForFloorChange();
  }

  /** Tapping a room zooms the plan in to it; tapping the same room again zooms back out. */
  private _onAreaClick(a: Area): void {
    this._zoomedAreaId = this._zoomedAreaId === a.id ? undefined : a.id;
  }

  /**
   * A gesture on a room (issue #181): its configured action, or — for a tap
   * with nothing configured — the zoom the room has always done.
   *
   * The fallback is what keeps this backwards compatible. Every plan drawn
   * before areas had actions has three unset gestures, so every tap still
   * zooms and hold and double-tap still do nothing.
   */
  private _onAreaAction(
    ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>,
    a: Area,
  ): void {
    const press = areaActionForGesture(a, ev.detail.action);
    if (!press) {
      if (ev.detail.action === "tap") this._onAreaClick(a);
      return;
    }
    if (!this.hass) return;
    executeAction(this, this.hass, { entity: press.entity }, press.config);
  }

  private _renderBadge(item: FloorItem, scale: OverlayScale, renderHass?: RenderHass): TemplateResult {
    const size = cssNumber(item.size, DEFAULT_ITEM_SIZE);
    const box = overlayLength(size, scale);
    // Animation goes on the inner ha-icon, not the badge: the badge carries
    // the user's `angle` rotation, and a spin on the same element would
    // overwrite it.
    const anim = resolveIconAnimation(
      item,
      item.entity ? renderHass?.states[item.entity]?.state : undefined,
    );
    // "Show the reading, not a picture" (issue #106). Same badge — size, angle,
    // state colour, ripple stacking all unchanged — with the glyph swapped for
    // the number. A device with nothing numeric to show keeps its icon.
    const value = badgeContentOf(item) === "value" ? badgeValue(renderHass, item) : undefined;
    return html`
      <div
        class="badge"
        style="width:${box};height:${box};transform:rotate(${cssNumber(item.angle, 0)}deg);"
      >
        ${value
          ? html`<span
              class="badge-value"
              style="font-size:${overlayLength(badgeValueSize(size, value), scale)};"
              >${value}</span
            >`
          : html`<ha-icon
              class=${anim ? `anim-${anim}` : ""}
              icon=${this._itemIcon(item, renderHass)}
              style="--mdc-icon-size:${overlayLength(itemIconSize(size), scale)};"
            ></ha-icon>`}
      </div>
    `;
  }

  /**
   * Start the ink ripple at the point that was actually touched (issue #134).
   * Positions are real screen pixels off the event, so they are unaffected by
   * overlayScale — the ink lands where the finger did at any plan scale.
   *
   * The position cannot come from CSS — only the event knows where the finger
   * landed — so it is handed over as two custom properties and the animation
   * itself stays in the stylesheet.
   *
   * Restarting needs the reflow: re-adding a class whose animation is still
   * running is a no-op, so a quick second tap would draw nothing at all.
   * Listeners are passive and only write style, so the gesture detection in
   * `actionHandler` is untouched.
   */
  private _startInk(ev: PointerEvent): void {
    const item = ev.currentTarget as HTMLElement | null;
    const ink = item?.querySelector<HTMLElement>(".press-ink");
    if (!ink) return;
    const box = item!.getBoundingClientRect();
    ink.style.setProperty("--fp-ink-x", `${ev.clientX - box.left}px`);
    ink.style.setProperty("--fp-ink-y", `${ev.clientY - box.top}px`);
    ink.classList.remove("inking");
    void ink.offsetWidth;
    ink.classList.add("inking");
  }

  private _renderItem(
    item: FloorItem,
    c: FloorplanCardConfig,
    rot: PlanRotation,
    scale: OverlayScale,
    renderHass?: RenderHass
  ): TemplateResult {
    const on = this._isOn(item, renderHass);
    // Name/state composition lives in itemBadgeLabel, including #39's
    // no-entity guard (an unbound device gets no state line).
    const labelText = itemBadgeLabel(renderHass, item);
    // Threshold color (issue #68), judged on the displayed value (attribute
    // when set, else the state). cssColor gates the config string (#64).
    const st = item.entity ? renderHass?.states[item.entity] : undefined;
  const rawValue = itemRawValue(item, st);
    // One resolved colour drives the whole element (issue #79 follow-up): the
    // label *and* the badge. A sensor is never "on", so tying the badge to the
    // active state alone left threshold colours invisible on exactly the
    // devices they were written for.
    const stateColor = cssColor(resolveStateColor(item.stateColor, rawValue));
    const labelColor = stateColor;
    // Offline (issue #162): the entity is unavailable, unknown, or gone from
    // Home Assistant altogether. Guarded on `hass` — before the first states
    // arrive every device would answer "offline" and the plan would flash
    // grey on load.
    const offline = !!this.hass && itemIsOffline(item, st?.state);
    // "none" is the old `showIcon: false` — no badge, label only (issue #106).
    const showIcon = badgeContentOf(item) !== "none";
    const display = item.display ?? "badge";
    // Per-device active color (issue #79). Ripples follow it too, so a device
    // given one color does not come out yellow-badged with a blue ring.
    // State rules win over the fixed active colour — they are the more
    // specific statement about what this element should look like right now.
    // A colour-capable bulb badges itself its own colour, dimmed with its
    // brightness (issue #106, @ombre33) — but only below anything the user
    // stated explicitly, and only when the bulb actually reports a colour.
    const lightColor = lightBadgePaint(st);
    const activeColor = cssColor(item.activeColor) ?? lightColor;
    const rippleColor =
      item.rippleColor ?? stateColor ?? item.activeColor ?? lightColor ?? SKIN_ACCENT;
    // Ink that can actually be read on whatever the badge ended up painted
    // (issue #106, @MrMcFlyy): a white state colour used to take the theme's
    // white icon with it. undefined for a colour we cannot resolve — a
    // var()/color-mix()/gradient keeps the theme ink, exactly as before.
    const badgeInk = contrastText(stateColor ?? activeColor);
    const rippleSize = item.rippleSize ?? DEFAULT_RIPPLE_SIZE;

    let visual: TemplateResult | typeof nothing = nothing;
    if (display === "ripple") {
      visual = renderRipple(on, rippleColor, rippleSize, 3, scale);
    } else if (display === "iconRipple") {
      visual = html`<div class="stack">
        ${renderRipple(on, rippleColor, rippleSize, 3, scale)}
        ${showIcon ? html`<div class="stack-icon">${this._renderBadge(item, scale, renderHass)}</div>` : nothing}
      </div>`;
    } else if (showIcon) {
      visual = this._renderBadge(item, scale, renderHass);
    }

    // Rotated frame: the overlay is HTML, so each anchor is remapped instead
    // of transformed — badges and labels stay upright at any rotation.
    const p = rotatePlanPoint(item.x, item.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    // Only a device that answers is a button (issue #134) — the press effect,
    // the pointer cursor, the `button` role, the tab stop and the gesture
    // listeners all hang off this one fact.
    //
    // The semantics matter more than the cursor did. An inert device was
    // announced as "button" to a screen reader, sat in the tab order, and
    // replied to Enter with nothing: the same lie, told louder, to the people
    // least able to check it against what the plan looks like. Its label text
    // stays in the DOM either way, so nothing becomes unreadable — only the
    // false affordance goes.
    const interactive = itemIsInteractive(item);
    return html`
      <div
        class="item fp-item ${on ? "on" : "off"} ${offline ? "offline" : ""} ${stateColor
          ? "state-colored"
          : ""} ${interactive ? "interactive" : ""}"
        data-id=${cssIdent(item.id) ?? nothing}
        data-entity=${cssEntityId(item.entity) ?? nothing}
        data-kind=${cssIdent(item.kind) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;${stateColor
          ? `--fp-state:${stateColor};`
          : ""}${activeColor
          ? `--fp-active:${activeColor};`
          : ""}${badgeInk ? `--fp-ink:${badgeInk};` : ""}"
  title=${this._label(item, renderHass)}
        role=${interactive ? "button" : nothing}
        tabindex=${interactive ? "0" : nothing}
        @action=${(ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>) =>
          this._handleItemAction(ev, item)}
        .actionHandler=${actionHandler({
          hasHold: hasAction(item.hold_action),
          hasDoubleClick: hasAction(item.double_tap_action),
          // Unbinds the gesture listeners outright, so keyboard activation
          // cannot reach an action that would do nothing.
          disabled: !interactive,
        })}
        @pointerdown=${interactive && pressEffectOf(c) === "ripple"
          ? (ev: PointerEvent) => this._startInk(ev)
          : nothing}
      >
        ${visual}
        ${interactive && pressEffectOf(c) === "ripple"
          ? html`<span class="press-ink" aria-hidden="true"></span>`
          : nothing}
        ${labelText
          ? html`<span
              class="label ${visual === nothing ? "inflow" : ""} label-${labelPositionOf(item)}"
              style="font-size:${overlayLength(itemLabelSize(item.labelSize), scale)};${labelColor
                ? `color:${labelColor};`
                : ""}"
              >${labelText}</span
            >`
          : nothing}
      </div>
    `;
  }

  private _renderAreaLabel(
    a: Area,
    c: FloorplanCardConfig,
    rot: PlanRotation,
    scale: OverlayScale
  ): TemplateResult | typeof nothing {
    if (!a.name || (a.showName ?? true) === false) return nothing;
    const centroid = polygonCentroid(a.points);
    const p = rotatePlanPoint(centroid.x, centroid.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    // Empty unless the size has something to say the stylesheet doesn't — see
    // areaLabelFontSize, which keeps card-mod's `.area-label` hook working.
    const fontSize = areaLabelFontSize(a.labelSize, scale);
    return html`
      <div
        class="area-label"
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;${fontSize}"
      >
        ${a.name}
      </div>
    `;
  }

  private _renderText(
    t: FloorText,
    c: FloorplanCardConfig,
    rot: PlanRotation,
    scale: OverlayScale
  ): TemplateResult {
    const p = rotatePlanPoint(t.x, t.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    return html`
      <div
        class="text fp-text"
        data-id=${cssIdent(t.id) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;
               font-size:${overlayLength(cssNumber(t.size, DEFAULT_TEXT_SIZE), scale)};
               color:${cssColorOr(t.color, SKIN_TEXT)};
               transform:translate(-50%,-50%) scale(var(--fp-inv-zoom,1)) rotate(${cssNumber(t.angle, 0)}deg);"
      >
        ${t.text}
      </div>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) return html`${nothing}`;
    const c = this._config;
    const renderHass = buildRenderHass(this.hass, this._watchedEntities, this._historyService, this._replayController.state.enabled, this._replayController.state.playbackController.currentTime);
    const floors = getFloors(c);
    const active =
      floors.find((f) => f.id === this._activeFloorId) ??
      floors.find((f) => f.id === c.defaultFloor) ??
      floors[0];
    // Whole-plan display rotation (issue #33): the SVG rotates via one group
    // transform below; the HTML overlay remaps per point in _renderItem /
    // _renderText. Both must use the same mapping (rotatePlanPoint).
    const rot = normalizePlanRotation(c.rotation);
    const dims = rotatedCanvasSize(cssNumber(c.width, DEFAULT_WIDTH), cssNumber(c.height, DEFAULT_HEIGHT), rot);
    const rotTransform = planRotationTransform(c.width, c.height, rot);
    // Overlay sizing mode. --fp-plan-w is the canvas width *as displayed*, so a
    // rotated plan divides by the dimension 100cqw actually measures.
    const scale = normalizeOverlayScale(c.overlayScale);
    // Follow the real sun (issue #113). Elevation comes from the active render
    // state source, so replay and live rendering stay consistent.
    const sunLevel = c.sunDimming
      ? sunBrightness(
          renderHass?.states["sun.sun"]?.attributes?.elevation,
          cssNumber(c.sunBrightnessMin, DEFAULT_SUN_MIN),
          cssNumber(c.sunBrightnessMax, DEFAULT_SUN_MAX)
        )
      : DEFAULT_SUN_MAX;
    // Dead spaces (issue #88). Derived from the walls and openings, never
    // stored — and memoized on those two arrays, because this runs on every
    // hass update the card takes and the walls have moved on none of them.
    const deadSpaceRings = c.showDeadSpaces
      ? deadSpacesCached(active.walls, active.openings)
      : [];
    // Walls as light meets them (issue #143): open doors and windows are holes,
    // exactly as the plan draws them. Computed once here rather than inside
    // each pool — every lamp sweeps the same walls, and the sun-dimming
    // clearing has to agree with the pool it is cut from.
    //
    // Only when something actually casts light. A plan with no lit pools and
    // no sun dimming never reads these walls, and this is on the path of every
    // state change the card takes.
    const castsLight = c.sunDimming || active.items.some((it) => it.glow);
    const lightWalls = castsLight
      ? wallsLightPassesThrough(active.walls, active.openings, (o) =>
          // Both leaves, and the travel each style actually has (issue #145):
          // asking `entity` alone left a door whose *second* panel was open
          // still blocking light outright.
          openingClearFraction(o, this._openingAmount(o, renderHass), this._openingSecond(o, renderHass)?.amount)
        )
      : active.walls;
    // Lit rooms hold back the night (issue #113): without this the flat dim
    // multiplies the lit-vs-unlit contrast too, and a lamp ends up *less*
    // visible after dark than at noon.
    const sunDimMaskId = `${this._glowIdBase}-sundim`;
    const sunDimMask = c.sunDimming
      ? renderSunDimMask(
          active.items,
          renderHass?.states,
          c.width,
          c.height,
          sunDimMaskId,
          lightWalls
        )
      : nothing;
    // Zoom-to-room (tap an area). Both the SVG and the HTML overlay live
    // inside one transformed wrapper below, so the two layers — positioned
    // completely differently (a group transform vs. per-point left/top%) —
    // reframe identically instead of drifting apart under zoom.
    const zoomedArea = active.areas?.find((a) => a.id === this._zoomedAreaId);
    const zoom = zoomedArea ? areaZoomTransform(zoomedArea.points, c.width, c.height, rot) : IDENTITY_ZOOM;
    // Chrome drawn inside the plan rather than above it (issue #152). The
    // flag is what the floor buttons follow; the chip needs a title as well,
    // and a compact card with no title has nothing to draw there.
    const compact = c.compactHeader === true;
    const compactTitle = compact && !!c.title;
    return html`
      <!-- The skin (issue #122) rides on the card rather than on .plan, so the
           floor switcher and the card's own background follow it too — a Tron
           plan floating on a white card would read as a bug. Every token the
           card draws with is declared on :host, so this only ever overrides. -->
      <!-- No skin style here: the palette comes from data-skin on the host, so
           a card-mod rule on this element still wins (issue #155). -->
      <!-- The card header is a fixed ~76px whether the title is "U8" or a
           sentence, and every part of it lives inside ha-card's shadow root
           where no rule of ours reaches. compactHeader therefore does not
           shrink it — it declines it, and draws the title inside the stage
           instead, where it costs no layout height at all (issue #152). -->
      <ha-card .header=${compact ? nothing : (c.title ?? nothing)}>
        <div class="card-shell ${this._replayController.state.historyVisible ? "replay-visible" : ""}">
          ${this._config.historyReplay?.enabled ? this._renderReplayPanel() : nothing}
          <div
            class="stage press-${pressEffectOf(c)} offline-${offlineStyleOf(c)} ${compactTitle
              ? "compact-title"
              : ""}"
            style="aspect-ratio: ${dims.w} / ${dims.h};"
          >
          <!-- The plan box: exactly the canvas ratio, fitted inside whatever
               height the card was actually given, and centred there (closes
               #115). Sized off the container's height so it shrinks when the
               height is the binding axis — clamping a full-width box with
               max-height instead would break the ratio rather than the box.

               The stage carries the same aspect-ratio so it still has a
               definite height in a content-sized (masonry) card; without it,
               size containment leaves 100cqh with nothing to resolve against
               and the plan collapses to nothing. -->
          <div
            class="plan ${scale === "plan" ? "scale-plan" : ""}"
            style="aspect-ratio: ${dims.w} / ${dims.h};
                   width: min(100%, calc(100cqh * ${dims.w} / ${dims.h}));
                   --fp-plan-w: ${dims.w};
                   background:${cssColorOr(c.background, SKIN_PAPER)};"
          >
          <!-- preserveAspectRatio="none" is correct here, and it took a wrong
               fix to see why. Fitting the plan into a card that is the wrong
               shape for it is .plan's job, not this line's (#115): .plan
               carries the canvas ratio, so the SVG's box always matches its
               viewBox, and "none" and "meet" are equivalent while that holds.

               "none" is still the deliberate choice, because it is the one
               that fails safely. The .items overlay is HTML, positioned with
               raw left/top percentages of .plan, and it does not letterbox. So
               if anything ever overrides .plan's ratio (card-mod, a grid row
               count), "meet" letterboxes the SVG away from the overlay and
               every icon drifts off the wall it was placed on, while "none"
               stretches both layers identically: distorted, but aligned. -->
          <!-- Zoom-to-room (tap an area). One wrapper around both the SVG and
               the HTML overlay so a CSS transform here reframes both layers
               identically — see areaZoomTransform. Wraps the keyed() skin
               block below rather than sitting inside it, so a skin change
               (which rebuilds that subtree) never disturbs this transform. -->
          <div
            class="plan-zoom"
            style="transform: translate(${zoom.txPercent}%, ${zoom.tyPercent}%) scale(${zoom.scale});"
          >
          <!-- Keyed on the skin (issue #122). A skin changes custom properties on
               an ancestor, and Chromium does not repaint an SVG element whose
               colour comes from a var() inside a presentation attribute or an
               inline style unless something else about it changes — Lit writes
               the same attribute string either way, so switching skins left
               every door, window and room fill painted in the previous skin's
               colours while the computed values were already correct. Keying
               rebuilds the subtree instead, which repaints by construction.
               Only on a skin change; ordinary state updates are untouched. -->
          ${keyed(
            c.skin ?? "",
            svg`<svg viewBox="0 0 ${dims.w} ${dims.h}" preserveAspectRatio="none">
            <g transform=${rotTransform || nothing}>
            ${active.image
              ? svg`<image href=${active.image} x="0" y="0" width=${c.width} height=${c.height}
                          preserveAspectRatio=${imageFitRatio(active.imageFit)}
                          opacity=${active.imageOpacity ?? 1} />`
              : nothing}
            ${active.areas?.map((a) => {
              // Rooms answer gestures now (issue #181). The hit target is
              // unconditional, as it always was — every room zooms — so only
              // the role and the tab stop are earned by having an action.
              const acts = areaHasActions(a);
              return svg`<g class="area-tap-target"
                    role=${acts ? "button" : nothing}
                    tabindex=${acts ? "0" : nothing}
                    @action=${(ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>) =>
                      this._onAreaAction(ev, a)}
                    .actionHandler=${actionHandler({
                      // Only wait out the timers when a gesture can resolve:
                      // otherwise every tap on an ordinary room would sit for
                      // 500ms before zooming.
                      hasHold: hasAction(areaActionForGesture(a, "hold")?.config),
                      hasDoubleClick: hasAction(areaActionForGesture(a, "double_tap")?.config),
                    })}>
                  ${renderArea(a, areaColor(a, a.entity ? renderHass?.states[a.entity]?.state : undefined))}
                </g>`;
            })}
            <!-- Dead spaces (issue #88): the regions the walls seal off that no
                 door or window reaches, hatched. Above the room fills, so a
                 region someone has also drawn an area over still reads as
                 unreachable; below everything else, because it describes the
                 floor rather than anything standing on it. -->
            ${deadSpaceRings.length
              ? svg`${renderDeadSpaceHatch(`${this._wallMaskId}-dead`)}
                    ${deadSpaceRings.map((ring) =>
                      renderDeadSpace(ring, `${this._wallMaskId}-dead`)
                    )}`
              : nothing}
            <!-- Light pools (issue #6). Above the room fills but below the
                 furniture and walls, so light reads as cast onto the floor
                 rather than painted over the plan. Isolated as one layer: the
                 pools screen-blend with each other (two lamps brighten where
                 they meet) without screening against the plan beneath, which
                 would wash out on a light theme. -->
            ${renderGlowMask(
              active.furniture, c.width, c.height,
              `${this._glowIdBase}-mask`, symbolCatalog(c.symbols)
            )}
            <g class="fp-glows"
               mask=${active.furniture.length ? `url(#${this._glowIdBase}-mask)` : nothing}>
              ${active.items.map((it, i) => {
                if (!it.glow) return nothing;
                const paint = glowPaint(it, renderHass?.states[it.entity]);
                // Walls block the pool (issue #108) — light stops at the room.
                return paint
                  ? renderGlow(it, paint, `${this._glowIdBase}-${i}`, lightWalls)
                  : nothing;
              })}
            </g>
            ${active.furniture.map((f) => {
              const drawn = renderFurniture(
                f,
                furnitureColor(f, f.entity ? renderHass?.states[f.entity]?.state : undefined),
                symbolCatalog(c.symbols)
              );
              // Stairs that go somewhere (issue #121). Only when there is a
              // floor that way: at the top of the building an "up" staircase
              // is still a staircase, but it takes no clicks rather than
              // offering a control that does nothing.
              const to = furnitureFloorTarget(f, floors, active.id);
              if (!to) return drawn;
              const name = floors.find((x) => x.id === to)?.name;
              return svg`<g class="fp-furniture-link" role="button" tabindex="0"
                    @action=${() => this._goToFloor(floors, to)}
                    .actionHandler=${actionHandler({
                      // A staircase has one gesture. Saying so keeps a tap from
                      // sitting out the hold and double-tap timers before it
                      // does anything.
                      hasHold: false,
                      hasDoubleClick: false,
                    })}>
                  <!-- An SVG tooltip is a <title> child, not a title=
                       attribute: the attribute does nothing here. -->
                  <title>${name ? `Go to ${name}` : "Go to the next floor"}</title>
                  ${drawn}
                </g>`;
            })}
            <!-- Sunlight through the openings. Under the walls on purpose:
                 light lands on the floor, and the walls stay crisp lines over
                 it rather than being tinted by the patches they let in. The
                 sun dimming further down is the whole-sky reading and still
                 has the last word — at night there is nothing to let in. -->
            ${
              c.sunlight
                ? renderSunlight(
                    active.walls,
                    active.openings,
                    c.width,
                    c.height,
                    `${this._wallMaskId}-sun`,
                    {
                      // Both halves of the sun come from the same entity while
                      // the plan follows it: the azimuth says where the light
                      // comes from, the elevation whether there is any at all.
                      // A plan that pins its own angle keeps its light on —
                      // see sunlightStrengthOf.
                      dir: sunLightDirection(
                        c,
                        renderHass?.states["sun.sun"]?.attributes?.azimuth
                      ),
                      strength: sunlightStrengthOf(
                        c,
                        renderHass?.states["sun.sun"]?.attributes?.elevation
                      ),
                      // How far a patch carries, shortened as the sun climbs
                      // (issue #185): a midday sun drops its light almost
                      // straight down and lays a short patch, an evening one
                      // rakes it across the room. A pinned bearing states a
                      // picture rather than reading the sky, so it keeps the
                      // plain reach — same rule as the strength above.
                      // Coerced here so the elevation still scales a sane
                      // base — cssNumber is what the sun brightness above
                      // already uses on its own hand-edited numbers. The
                      // bounds live at the sink, in sunReachFraction.
                      reach:
                        cssNumber(c.sunReach, SUN_REACH) *
                        (sunIsPinned(c)
                          ? 1
                          : sunReachScale(renderHass?.states["sun.sun"]?.attributes?.elevation)),
                      // The gap each style actually clears, both leaves
                      // included — the same reading the lamps get above, and
                      // for the same reason (#145): `entity` alone leaves a
                      // door whose *second* panel is open reading as shut,
                      // and a converging pair reading as twice as clear as it
                      // draws. Glazing and shutters are applied on top of
                      // this, inside openingSunFraction.
                      openAmount: (o) =>
                        openingClearFraction(
                          o,
                          this._openingAmount(o, renderHass),
                          this._openingSecond(o, renderHass)?.amount
                        ),
                      // A shutter that is all the way down stops the light, as
                      // one does. Undefined where none is bound, so an opening
                      // without a shutter is judged on itself alone.
                      shutterOpen: (o) =>
                        o.shutterEntity
                          ? shutterAmount(renderHass?.states[o.shutterEntity], o.shutterInvert)
                          : undefined,
                      light: c.sunlightColor ?? SUN_LIGHT_COLOR,
                      shade: c.sunShade === false ? null : (c.sunShadeColor ?? SUN_SHADE_COLOR),
                    }
                  )
                : nothing
            }
            ${renderWallMask(active.openings, c.width, c.height, this._wallMaskId)}
            <g mask=${`url(#${this._wallMaskId})`}>
              ${active.walls.map(
                (w) => svg`
                <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
                      class="wall fp-wall" data-id=${cssIdent(w.id) ?? nothing}
                      style=${wallStrokeStyle(w.thickness)} stroke-linecap="round" />`
              )}
            </g>
            <!-- Room outlines, above the walls they trace. An area polygon runs
                 down the centerline of the room's walls, so an outline drawn
                 with the fill is buried under the wall and never seen. Drawn
                 here it colors the wall instead. Same mask as the walls above,
                 so a doorway is a gap in the outline exactly as it is a gap in
                 the wall. Each live outline is clipped to its own room, so a
                 shared wall splits down the middle rather than going to
                 whichever area happens to sit later in the config. -->
            <g mask=${`url(#${this._wallMaskId})`}>
              ${active.areas?.map((a, i) =>
                renderAreaBorder(
                  a,
                  areaColor(a, a.entity ? renderHass?.states[a.entity]?.state : undefined),
                  `${this._wallMaskId}-area-${i}`
                )
              )}
            </g>
            ${repeat(
              // Keyed by id: switching floors must create fresh DOM nodes.
              // Unkeyed, Lit morphs floor A's openings into floor B's, and the
              // 0.5s leaf/panel transitions animate the leftover state — a
              // window briefly plays a door swing (issue #50).
              active.openings,
              (o, i) => o.id || i,
              (o) => {
              const amount = this._openingAmount(o, renderHass);
              const shutterState = o.shutterEntity
                ? renderHass?.states[o.shutterEntity]
                : undefined;
              const symbol = renderOpening(o, {
                color: SKIN_WALL,
                open: amount > 0,
                amount,
                active: this._openingActive(o, renderHass),
                accent: o.activeColor ?? SKIN_ACCENT,
                // Per-leaf state for a two-sensor biparting slider (issue #145).
                second: this._openingSecond(o, renderHass),
                // External roller shutter layer (issue #74). No entity bound
                // yet → previewed shut, like a static plan.
                shutter: o.shutterEntity
                  ? {
                      amount: shutterAmount(shutterState, o.shutterInvert),
                      active: shutterActive(shutterState, o.shutterInvert),
                      style: shutterStyleOf(o),
                      // The shutter's own accent, falling back to the
                      // opening's and then to the skin's.
                      accent: o.shutterActiveColor ?? o.activeColor ?? SKIN_ACCENT,
                      flip: o.shutterFlipV,
                      // Per-panel state for a two-contact hinged shutter
                      // (issue #159).
                      second: this._shutterSecond(o, renderHass),
                    }
                  : undefined,
              });
              // Only an opening that answers gets a hit target — the same test
              // devices get (issue #134), so an unbound opening is not a button
              // that does nothing. A shutter-only opening does answer, which is
              // why this is no longer `if (!o.entity)`.
              if (!openingIsPressable(o, this._featuresOf)) return symbol;
              // A transparent rect over the opening's wall gap gives a reliable
              // hit target beyond the thin leaf/panel strokes.
              const half = o.length / 2;
              const cutH = WALL_THICKNESS + 4;
              return svg`<g class="fp-opening" role="button" tabindex="0"
                    @action=${(ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>) =>
                      this._onOpeningAction(ev, o)}
                    .actionHandler=${actionHandler({
                      // Only wait out the hold/double-tap timers when a gesture
                      // actually resolves: otherwise every tap on a plain
                      // contact sensor would sit for 500ms before answering.
                      hasHold: hasAction(this._openingPress(o, "hold")?.config),
                      hasDoubleClick: hasAction(this._openingPress(o, "double_tap")?.config),
                    })}>
                  ${symbol}
                  <rect class="fp-opening-hit" x=${o.x - half} y=${o.y - cutH / 2}
                        width=${o.length} height=${cutH}
                        transform="rotate(${o.angle} ${o.x} ${o.y})" />
                </g>`;
            })}
            ${repeat(
              active.trackers ?? [],
              (tr, i) => tr.id || i,
              (tr) =>
              renderTracker(tr, {
                editing: false,
                xReading: trackerSensorReading(renderHass?.states, tr.xSensor?.entity),
                yReading: trackerSensorReading(renderHass?.states, tr.ySensor?.entity),
                xPresent: trackerPresenceDetected(renderHass?.states, tr.xSensor?.presence),
                yPresent: trackerPresenceDetected(renderHass?.states, tr.ySensor?.presence),
              })
            )}
            <!-- Sun dimming (issue #113). Last inside the rotated group, so it
                 covers the whole plan; the device overlay below is HTML and
                 stays at full brightness, keeping icons and state readable at
                 night. pointer-events:none is not optional — this rect spans
                 the canvas, and without it every tappable opening underneath
                 stops responding (the lesson from #108). -->
            ${
              c.sunDimming
                ? svg`${sunDimMask}<rect class="fp-sun-dim"
                            x=${-WALL_THICKNESS} y=${-WALL_THICKNESS}
                            width=${c.width + WALL_THICKNESS * 2}
                            height=${c.height + WALL_THICKNESS * 2}
                            fill="#000"
                            mask=${sunDimMask === nothing ? nothing : `url(#${sunDimMaskId})`}
                            opacity=${1 - sunLevel} />`
                : nothing
            }
            </g>
          </svg>`
          )}
          <div class="items" style="--fp-inv-zoom:${1 / zoom.scale};">
            ${active.areas?.map((a) => this._renderAreaLabel(a, c, rot, scale))}
            ${active.texts.map((t) => this._renderText(t, c, rot, scale))}
            ${repeat(
              // Keyed like the openings above: a floor switch must build fresh
              // nodes rather than morph one floor's badges into another's.
              active.openings.filter((o) => hasShutterMark(o)),
              (o, i) => `${o.id || i}-shutter`,
              (o) => this._renderShutterMark(o, c, rot, scale, renderHass)
            )}
            ${repeat(
              active.openings.filter((o) => hasOpeningMark(o)),
              (o, i) => `${o.id || i}-opening`,
              (o) => this._renderOpeningMark(o, c, rot, scale, renderHass)
            )}
            ${repeat(
              // No entity filter: devices that exist physically but have no HA
              // entity still deserve their badge (issue #39). Keyed by id so a
              // floor switch builds fresh DOM (see the openings comment).
              // "Only when active" devices drop out here (issue #55) — the
              // editor still draws them, dimmed, so they stay editable.
              active.items.filter(
                (it) =>
                  !itemHiddenWhenInactive(
                    it,
                    it.entity ? renderHass?.states[it.entity]?.state : undefined
                  )
              ),
              (it, i) => it.id || i,
              (it) => this._renderItem(it, c, rot, scale, renderHass)
            )}
          </div>
          </div>
          ${zoom.scale > 1
            ? html`<button
                class="zoom-out"
                title="Zoom out"
                aria-label="Zoom out"
                @click=${() => (this._zoomedAreaId = undefined)}
              >
                <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
              </button>`
            : nothing}
          ${compactTitle ? html`<div class="plan-title">${c.title}</div>` : nothing}
          ${floors.length > 1 ? this._renderFloorSwitcher(floors, active, compact) : nothing}
        </div>
        </div>
      </ha-card>
    `;
  }


  private _renderReplayPanel(): TemplateResult {
    return renderReplayPanel(createReplayPanelProps(this._replayController));
  }

  private _renderFloorSwitcher(floors: Floor[], active: Floor, compact = false): TemplateResult {
    return html`
      <div class="floor-switcher ${compact ? "row" : ""}">
        ${floors.map((f) => {
          // Per-floor accent (issue #67): applied only while active so the
          // resting buttons stay theme-neutral. cssColor gates the config
          // string; no custom color falls back to the theme primary.
          const accent = f.id === active.id ? cssColor(f.color) : undefined;
          return html`
            <button
              class=${f.id === active.id ? "active" : ""}
              title=${f.name}
              style=${accent ? `background:${accent};border-color:${accent};` : nothing}
              @click=${() => this._goToFloor(floors, f.id)}
            >
              ${f.short || f.name}
            </button>
          `;
        })}
      </div>
    `;
  }

  // skinTokens declares every --fp-skin-* default on :host (issue #122), and
  // skinPalettes the chosen skin's values on the same element (issue #155).
  // Both sit above <ha-card>, so a card-mod rule on that element beats them by
  // ordinary inheritance rather than needing !important. Palettes come second:
  // same specificity as the defaults, so tree order is what picks the skin.
  static styles = [
    skinTokens,
    skinPalettes,
    css`
    ha-card {
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
      /* The skin paints the card, not just the plan: .plan is only the canvas
         box, and on a card that isn't the canvas's shape the rest would stay
         the Home Assistant theme's colour. Unskinned this is ha-card's own
         default chain, so nothing changes. */
      background: var(--fp-skin-card-bg, var(--ha-card-background, var(--card-background-color, #fff)));
      /* The title sits on that background, and ha-card colours it from this
         variable rather than inheriting — so a dark skin under a light Home
         Assistant theme would print a dark title on near-black. The default is
         ha-card's own. */
      --ha-card-header-color: var(--fp-skin-text, var(--primary-text-color));
      /* A column, so the stage takes the height left over after the card's
         own header rather than the card's whole height. With a title set, a
         full-height stage measures past the bottom of the card by exactly the
         header, and the plan is cut off by that much. */
      display: flex;
      flex-direction: column;
    }
    .card-shell {
      display: flex;
      flex-direction: column;
      gap: 12px;
      /* In fixed-height dashboards (e.g. Sections rows), replay controls can
         extend past the visible card area. Keep content reachable by letting
         this inner shell scroll inside the card instead of clipping. */
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .card-shell.replay-visible {
      display: grid;
      grid-template-rows: auto minmax(0, 1fr);
    }
    .card-shell.replay-visible .stage {
      min-height: 0;
    }
    .stage {
      position: relative;
      width: 100%;
      /* Takes the space the header leaves, and may shrink below its content:
         without min-height a flex item floors at its content size and the
         plan pushes the stage past the card again. */
      flex: 1 1 auto;
      min-height: 0;
      padding: 0;
      /* Centres the plan box in whatever the card was given, and makes the
         stage's own height queryable so the plan can size against it. */
      display: flex;
      align-items: center;
      justify-content: center;
      container-type: size;
    }
    .plan {
      position: relative;
      height: auto;
    }
    /*
     * overlayScale: plan. The container is .plan, not .stage: since #115 the
     * stage is only the box the plan is *centred in*, and it is wider than the
     * plan on any card that isn't the canvas's ratio. Measuring the stage would
     * oversize every label by exactly the letterboxing.
     *
     * --fp-u -- one canvas unit as a length -- is declared on the overlay
     * *inside* .plan rather than on .plan itself. Both work today: --fp-u is an
     * unregistered custom property, so its value is substituted as a token
     * stream and the cqw resolves wherever it is finally used -- always a
     * descendant of .plan. Declaring it here is what stays correct if --fp-u is
     * ever registered with @property, which would resolve the cqw at the
     * declaring element instead. (.plan's own width reads 100cqh against
     * .stage, since container units look at an element's *ancestor* container;
     * adding inline-size containment to .plan doesn't disturb it.)
     *
     * inline-size containment is enough for cqw and is cheaper than the size
     * containment .stage needs; .plan's height comes from its inline
     * aspect-ratio, so nothing here depends on the overlay's own size.
     */
    .plan.scale-plan {
      container-type: inline-size;
    }
    .plan.scale-plan .items {
      --fp-u: calc(100cqw / var(--fp-plan-w));
    }
    /* The measures that aren't config-driven, so they never reach an inline
       style. Label padding goes to em rather than canvas units because it
       should track the label's own size either way.
       Hairlines are deliberately left alone: a badge border and the label's
       drop shadow are 1px-ish either way, and scaling them with the plan puts
       them below a pixel on exactly the small cards this mode is for. Skins
       own those tokens now in any case. */
    .plan.scale-plan .label {
      padding: 0.08em 0.33em;
      border-radius: 0.33em;
    }
    .plan.scale-plan .item > .label {
      top: calc(100% + 0.17em);
    }
    /* The side positions measure their gap in em too, so it tracks the label
       with the plan exactly as the below position's does. Restating top
       because the rule above sets it for every label. */
    .plan.scale-plan .item > .label.label-left,
    .plan.scale-plan .item > .label.label-right {
      top: 50%;
    }
    .plan.scale-plan .item > .label.label-left {
      right: calc(100% + 0.33em);
    }
    .plan.scale-plan .item > .label.label-right {
      left: calc(100% + 0.33em);
    }
    .floor-switcher {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: auto;
      z-index: 1;
    }
    /* Compact chrome (issue #152): the buttons run across the top strip
       instead of down the side, so they share it with the title chip rather
       than each claiming their own band. Wrapped, because a plan with eight
       floors is exactly the case a row is worst at — better a second short
       row than buttons off the edge of the card. Right-aligned so the row
       grows back toward the title rather than through it. */
    .floor-switcher.row {
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    /* Room for the title chip on the left, so a long floor name and a long
       title don't meet in the middle — the chip's own max-width leaves the
       same margin from the other side. Only when there *is* a chip: a compact
       card with no title has the whole strip, and reserving 44% of it would
       wrap the buttons for nothing. */
    .stage.compact-title .floor-switcher.row {
      left: 44%;
    }
    .floor-switcher button {
      cursor: pointer;
      border: 1px solid var(--fp-skin-badge-border, var(--divider-color, #ccc));
      background: var(--fp-skin-badge-bg, var(--card-background-color, #fff));
      color: var(--fp-skin-text, var(--primary-text-color));
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .floor-switcher button.active {
      background: var(--fp-skin-accent, var(--primary-color, #03a9f4));
      /* Its own ink, not the badge's: this sits on --fp-skin-accent, and the
         skin whose accent wants dark ink is not necessarily the one whose
         active badge does. Left at the theme's text-on-primary, Pastel and
         Tron print near-white on a pale blue and a bright cyan. */
      color: var(--fp-skin-accent-ink, var(--text-primary-color, #fff));
      border-color: var(--fp-skin-accent, var(--primary-color, #03a9f4));
    }
    /* The title, drawn inside the plan (issue #152). Styled as a chip rather
       than as a heading: it is sitting *on* the drawing, and 24px of bare text
       over a wall reads as part of the plan. Same tokens as the floor buttons
       beside it, so a skin carries both. */
    .plan-title {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 1;
      /* Stops short of the floor row's own edge, so a long title ellipsises
         rather than running under the buttons. */
      max-width: 40%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid var(--fp-skin-badge-border, var(--divider-color, #ccc));
      background: var(--fp-skin-badge-bg, var(--card-background-color, #fff));
      color: var(--fp-skin-text, var(--primary-text-color));
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 13px;
      font-weight: 500;
      line-height: 1;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    /* Zoom-to-room (tap an area). One wrapper around both the SVG and the
       HTML overlay so a transform here reframes both layers identically —
       transform-origin:0 0 matches the translate-percent math in
       areaZoomTransform(). Setting a transform (even the identity) makes this
       div establish the containing block for its absolutely-positioned
       svg/.items children, so it needs the same inset:0 they'd otherwise use. */
    .plan-zoom {
      position: absolute;
      inset: 0;
      transform-origin: 0 0;
      transition: transform 0.4s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .plan-zoom {
        transition: none;
      }
    }
    .zoom-out {
      position: absolute;
      top: 8px;
      left: 8px;
      z-index: 1;
      cursor: pointer;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      border-radius: 6px;
      padding: 4px;
      line-height: 0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    /* The compact title has that corner. The zoom-out button is the transient
       one — it exists only while a room is zoomed — so it is the one that
       moves, dropping below the chip rather than landing on top of it. */
    .stage.compact-title .zoom-out {
      top: 38px;
    }
    .area-tap-target {
      cursor: pointer;
    }
    /* A staircase that changes floor (issue #121). The pointer is the whole
       affordance — the symbol already draws an arrow saying which way it
       goes — and it only exists on a piece that has somewhere to lead. */
    .fp-furniture-link {
      cursor: pointer;
    }
    .fp-furniture-link:focus-visible {
      outline: 2px solid var(--fp-skin-accent, var(--primary-color, #03a9f4));
      outline-offset: 2px;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    /* Sunlight through the openings. Paint only — the plan underneath stays
       pressable, which is what pointer-events:none is here for (#108). */
    .fp-sunlight {
      pointer-events: none;
    }
    /* No fill declaration here, deliberately. CSS beats the presentation attribute — the same rule the
       wall below relies on — and a patch of sunlight is filled with a
       *gradient* the renderer builds per opening. A flat colour declared here
       silently discards it: the markup keeps saying url(#…), the computed
       style says rgb(…), and the light comes out as a hard slab no matter
       what shape the falloff is given. That is issue #185, and it survived
       four rewrites of the falloff because every one of them was correct and
       none of them was ever used.

       The skin still applies: --fp-skin-sunlight is read by SUN_LIGHT_COLOR
       and lands on the gradient's own stops. */
    .wall {
      stroke: var(--fp-skin-wall, var(--primary-text-color));
      /* CSS beats the presentation attribute, so the skin sets the wall's
         weight while WALL_THICKNESS keeps owning the geometry the doorway
         mask and the opening symbols are cut from. Capped at 10 for that
         reason — see MAX_SKIN_WALL_WIDTH. */
      stroke-width: var(--fp-skin-wall-width, 8);
      /* Neon, for the skins that want it. Everyone else gets none, which
         costs nothing. */
      filter: var(--fp-skin-wall-filter, none);
    }
    /* Dead-space hatching (issue #88). It spans whole regions of the plan, so
       without this it swallows every tap inside one — and a sealed region is
       exactly where a tappable door might sit on the boundary. Same lesson as
       the light pools below (#108). */
    .fp-dead-space {
      pointer-events: none;
    }
    /* Sun dimming (issue #113): decoration, never a pointer target. The
       transition matters — HA steps the sun elevation every ~30s, and without
       it dusk arrives as a series of visible jumps rather than a fade. */
    .fp-sun-dim {
      pointer-events: none;
      transition: opacity 2s linear;
    }
    @media (prefers-reduced-motion: reduce) {
      .fp-sun-dim { transition: none; }
    }
    /* Light pools (issue #6). "isolation" gives the layer its own compositing
       group, so the pools blend with each other but not with the plan beneath
       — screening against a light theme's white background would wash them
       out entirely. Inside that group "screen" makes overlapping lights add,
       so two lamps brighten where they meet instead of the topmost winning. */
    .fp-glows {
      isolation: isolate;
      /* Light is decoration and must never take a click: these are filled
         circles drawn over the plan, so without this they swallow every tap
         inside the pool — devices stop responding under a lit lamp, and in
         the editor whole rooms become unselectable (issue #108). */
      pointer-events: none;
    }
    .fp-glow {
      mix-blend-mode: screen;
      /* Follow the light rather than snapping: a dimmer ramp reads as a ramp. */
      transition: opacity 0.4s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .fp-glow {
        transition: none;
      }
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
    .fp-opening {
      cursor: pointer;
    }
    .fp-opening-hit {
      fill: transparent;
      pointer-events: all;
    }
    /* Shutter badge (issue #74 follow-up): screen-sized, so it stays legible
       whatever canvas units the plan is drawn in — the same reason device
       badges are sized in pixels. Sits in the .items overlay, which is
       pointer-events:none, so it takes its own back. */
    .shutter-mark {
      position: absolute;
      /* transform is set inline: the pixel push along the wall normal. */
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      /* width/height are inline: they follow overlayScale (#148). */
      border-radius: 50%;
      background: var(--fp-skin-paper, var(--card-background-color, #fff));
      border: 1px solid var(--fp-skin-wall, var(--primary-text-color, #212121));
      color: var(--fp-skin-wall, var(--primary-text-color, #212121));
      opacity: 0.75;
      transition: color 0.3s ease, opacity 0.3s ease, border-color 0.3s ease;
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      user-select: none;
    }
    /* Open: the accent, said twice — the glyph is already the "open" half of
       HA's icon pair, and the colour repeats it for a glance across the room. */
    .shutter-mark.on {
      color: var(--fp-active, var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      border-color: var(--fp-active, var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      opacity: 1;
    }
    .shutter-mark ha-icon {
      /* --mdc-icon-size is inline, for the same reason. */
      display: flex;
    }
    .fp-slide-panel {
      transform-box: fill-box;
      transition: transform 0.5s ease;
    }
    .fp-slide-panel rect {
      transition: fill 0.5s ease;
    }
    /* Roll-up curtain (garage / roller shutter): thins onto the track line. */
    .fp-roll-curtain {
      transform-box: fill-box;
      transform-origin: center;
      transition: transform 0.5s ease;
    }
    .fp-roll-curtain rect {
      transition: fill 0.5s ease;
    }
    .items {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    /* A device's hit area is what you can *see* of it — the badge and its
       label — not the box its decoration happens to fill.

       A presence ripple is 80–110px of mostly empty air, and the anchor grew
       to hold it: a 30px motion icon behaved like a 110px square button, which
       also swallowed taps meant for the plan underneath it. The ring is
       decoration; it says "presence here", it is not a control. So the anchor
       stops taking pointer events and the parts that are the device take them
       back. */
    .item {
      position: absolute;
      /* Counter-scaled against the zoom-to-room transform (--fp-inv-zoom,
         set on .items) so a badge stays a constant, legible screen size
         instead of ballooning with the room it's tapped into. Same duration
         and easing as .plan-zoom's own transition, so the zoom and its
         counter-scale animate in lockstep — without this the custom property
         changes in a single frame while the plan takes 0.4s to catch up, and
         every badge is briefly the wrong size mid-transition. */
      transform: translate(-50%, -50%) scale(var(--fp-inv-zoom, 1));
      transition: transform 0.4s ease;
      pointer-events: none;
      /* Not a hand: a device with nothing bound, or tap_action set to none,
         is not a button (issue #134). Only .interactive gets the pointer. */
      cursor: default;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .item .badge,
    .item .label {
      pointer-events: auto;
    }
    /* .stack-icon spans the whole ripple (inset: 0), so it has to stay out of
       the way too — the badge inside it is the target, not its wrapper. */
    .stack-icon,
    .ripple,
    .press-ink {
      pointer-events: none;
    }
    /* A ripple-only device draws no badge, so its centre has to answer for it,
       or switching the badge off would leave the device unclickable. The dot
       is 8px across; this gives it a real touch target without drawing one.
       Deliberately a fixed size, and not scaled by overlayScale (#148): a
       minimum touch target is about fingers, which do not shrink with the
       plan. */
    .item.interactive .ripple .dot {
      pointer-events: auto;
      position: relative;
    }
    .item.interactive .ripple .dot::after {
      content: "";
      position: absolute;
      left: 50%;
      top: 50%;
      width: ${MIN_TOUCH_TARGET}px;
      height: ${MIN_TOUCH_TARGET}px;
      transform: translate(-50%, -50%);
      border-radius: 50%;
    }
    .item.interactive {
      cursor: pointer;
      /* Stops the long-press magnifier / text selection on touch from firing
         over a device you are only trying to press. */
      -webkit-tap-highlight-color: transparent;
      -webkit-touch-callout: none;
      user-select: none;
    }

    /* ---- Press feedback (issue #134) -------------------------------------
       Chosen plan-wide; the stage carries press-scale / press-ripple /
       press-flash / press-none and each rule below is scoped to its own.
       Only .interactive devices respond, so nothing animates that would not
       then do something. */

    /* Scale: the transform has to repeat the translate, since .item is
       centred on its own anchor and a bare scale() would drop that and jump
       the device down-right by half its size. Also has to repeat the
       zoom-to-room counter-scale (--fp-inv-zoom) and multiply rather than
       replace it — restating scale(${PRESS_SCALE}) alone would drop the
       counter-scale along with the translate, and a badge held down at 4x
       zoom would balloon to roughly 4x its resting size instead of shrinking. */
    .press-scale .item.interactive {
      transition: transform ${PRESS_OUT_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    .press-scale .item.interactive:active {
      transform: translate(-50%, -50%) scale(calc(var(--fp-inv-zoom, 1) * ${PRESS_SCALE}));
      transition-duration: ${PRESS_IN_MS}ms;
    }

    /* Flash: drop-shadow rather than a box-shadow or a background, so the halo
       follows whatever the device actually draws — the badge's circle, a bare
       ripple ring, the label — instead of a rectangle around it. */
    .press-flash .item.interactive {
      transition: filter ${PRESS_OUT_MS}ms ease-out;
    }
    .press-flash .item.interactive:active {
      filter: drop-shadow(0 0 5px var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      transition-duration: ${PRESS_IN_MS}ms;
    }

    /* Ink: a circle spreading from the touch point. Positioned by
       _startInk, which is the only thing that knows where the finger landed. */
    .press-ink {
      position: absolute;
      left: var(--fp-ink-x, 50%);
      top: var(--fp-ink-y, 50%);
      width: 0;
      height: 0;
      border-radius: 50%;
      /* Decoration: it must never swallow the tap it is reporting. */
      pointer-events: none;
      opacity: 0;
      background: currentColor;
    }
    .press-ink.inking {
      animation: fp-press-ink 520ms ease-out;
    }
    @keyframes fp-press-ink {
      from {
        width: 0;
        height: 0;
        margin: 0;
        opacity: 0.32;
      }
      to {
        width: 120px;
        height: 120px;
        margin: -60px 0 0 -60px;
        opacity: 0;
      }
    }

    /* Reduced motion keeps the feedback and drops the movement: the halo, with
       no transition. Removing the effect outright would answer an
       accessibility preference by taking the affordance away. */
    @media (prefers-reduced-motion: reduce) {
      .press-scale .item.interactive,
      .press-flash .item.interactive,
      .press-ripple .item.interactive {
        transition: none;
      }
      .press-scale .item.interactive:active {
        transform: translate(-50%, -50%) scale(var(--fp-inv-zoom, 1));
      }
      .press-scale .item.interactive:active,
      .press-ripple .item.interactive:active,
      .press-flash .item.interactive:active {
        filter: drop-shadow(0 0 5px var(--fp-skin-accent, var(--primary-color, #03a9f4)));
      }
      .press-ink.inking {
        animation: none;
      }
    }
    /*
     * The item's x/y anchors its icon, not its icon-plus-label. Were the label
     * in flow, it would make the column taller and the translate would
     * push the icon up by half the label's height -- so an item showing state
     * would sit higher than a bare one beside it, at the same y. The label hangs
     * below instead, out of flow, and every icon lands on its own y.
     */
    .item > .label {
      position: absolute;
      top: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      white-space: nowrap;
    }
    /* Label beside the badge instead of under it (issue #180). A reading under
       a badge grows in both directions at once and meets whatever is next to
       it; hung off one side it grows one way, which is what a row of devices
       along a wall needs.

       Vertically centred on the badge rather than baseline-aligned with it:
       the label is one line and the badge is a circle, so centres are what the
       eye actually pairs up. .inflow (a label-only device) ignores all of
       this — with no badge there is no side to sit on. */
    .item > .label.label-left,
    .item > .label.label-right {
      top: 50%;
      transform: translateY(-50%);
    }
    .item > .label.label-left {
      left: auto;
      right: calc(100% + 4px);
    }
    .item > .label.label-right {
      left: calc(100% + 4px);
    }
    /* Label-only items (showIcon: false) have no badge to hang under, so the
       absolute label would drop to y + 2px on a zero-height item. Put it back
       in flow so it becomes the item's box and centers on (x, y) as before. */
    .label.inflow {
      position: static;
      transform: none;
    }
    .badge {
      position: relative; /* anchors the offline mark (issue #162) */
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
      box-shadow: var(--fp-skin-badge-shadow, 0 1px 3px rgba(0, 0, 0, 0.2));
    }
    /* The reading standing in for the icon (issue #106). Inherits the badge's
       text color, so every rule that recolours a badge — active, --fp-state —
       carries the number with it and needs no counterpart here. The negative
       tracking buys back the width a 4-glyph reading like 1.2kW needs. */
    .badge-value {
      font-weight: 600;
      line-height: 1;
      letter-spacing: -0.02em;
      white-space: nowrap;
    }
    /*
     * --fp-active is the item's own activeColor (issue #79) when it sets one;
     * otherwise this falls through to the theme's active color, which is
     * exactly what every badge used before the option existed.
     */
    .item.on .badge {
      background: var(--fp-active, var(--fp-skin-active, var(--state-light-active-color, var(--state-active-color, #fdd835))));
      border-color: var(--fp-active, var(--fp-skin-active, var(--state-light-active-color, var(--state-active-color, #fdd835))));
      /* --fp-ink is contrastText's answer for a colour we could read; when the
         active colour came from the skin there is no per-item colour to read,
         so the skin states its own ink. A pastel badge under a dark Home
         Assistant theme would otherwise take that theme's near-white text. */
      color: var(--fp-ink, var(--fp-skin-active-ink, var(--text-primary-color, #212121)));
    }
    /* A resolved state colour paints the badge whatever the on/off state —
       thresholds exist for sensors, which are never "on". Declared *after* the
       .on rule (equal specificity) so state rules win over the active colour. */
    .item.state-colored .badge {
      background: var(--fp-state);
      border-color: var(--fp-state);
      color: var(--fp-ink, var(--text-primary-color, #212121));
    }

    /* ---- Offline devices (issue #162) ------------------------------------
       Until now a device whose entity had dropped out was drawn exactly like
       one that is simply switched off — a dead bulb and a bulb someone turned
       off were the same picture, and the plan gave that answer confidently.
       Chosen plan-wide, so the stage carries offline-dim / offline-strike /
       offline-none, exactly as it carries the press effect.

       Nothing here recolours the badge, and nothing needs to: an offline
       entity is never entityIsActive, so it has already fallen back to the
       resting badge. What is added is the *fading*, which says "we have no
       reading" rather than "the reading is off".

       offline-none declares nothing at all, which is the point of it. */
    .offline-dim .item.offline {
      opacity: 0.45;
    }
    /* Strike sits a little brighter than a plain dim, so that the mark drawn
       across it still reads as red rather than as pink: the whole device is
       one composited group, so the mark fades with everything else. */
    .offline-strike .item.offline {
      opacity: 0.6;
    }
    /* The diagonal, drawn across the badge itself rather than the item, so it
       crosses out the icon and not the label hanging underneath. A little
       wider than the badge at each end, the way the "no" symbol overhangs. A
       device drawn as a bare ripple, or as a label with no badge at all, has
       nothing to cross and keeps the fade alone. */
    .offline-strike .item.offline .badge::after {
      content: "";
      position: absolute;
      left: -12%;
      right: -12%;
      top: 50%;
      height: 2px;
      margin-top: -1px;
      border-radius: 1px;
      /* Down to the right, the way every mdi "-off" glyph and the reporter's
         own mock-up draw it. */
      transform: rotate(45deg);
      background: var(--fp-offline-mark, var(--error-color, #db4437));
    }
    ha-icon {
      --mdc-icon-size: 22px;
    }
    /* Icon motion while the entity is active (issue #48). */
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
    .label {
      /* Positioning (out-of-flow anchor + inflow fallback) lives in the
         .item > .label rules above, from #41. */
      font-size: 12px;
      line-height: 1;
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--fp-skin-badge-bg, var(--card-background-color, #fff));
      color: var(--fp-skin-text, var(--primary-text-color));
      white-space: nowrap;
    }
    .text {
      position: absolute;
      pointer-events: none;
      white-space: nowrap;
      font-weight: 500;
      line-height: 1;
      /* Keeps its own counter-scale (inline, see _renderText) in step with
         .plan-zoom's transition — same reasoning as .item's transform. */
      transition: transform 0.4s ease;
    }
    .area-label {
      position: absolute;
      pointer-events: none;
      white-space: nowrap;
      transform: translate(-50%, -50%) scale(var(--fp-inv-zoom, 1));
      /* Same lockstep-with-.plan-zoom reasoning as .item and .text above. */
      transition: transform 0.4s ease;
      font-weight: 600;
      /* The default size stays a normal rule so card-mod can still override it
         — room names had no config option before overlayScale landed, and this
         selector was the only way to change them. An area's own labelSize, and
         overlayScale: plan, come through as an inline style that wins over
         this. Keep in step with DEFAULT_AREA_LABEL_SIZE. */
      font-size: ${DEFAULT_AREA_LABEL_SIZE}px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      line-height: 1;
      color: var(--fp-skin-text, var(--primary-text-color));
      opacity: 0.7;
      text-shadow:
        0 1px 2px var(--fp-skin-bg, var(--card-background-color, #fff)),
        0 -1px 2px var(--fp-skin-bg, var(--card-background-color, #fff));
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
    /* === Tracker animations (live card). The zone outline is editor-only —
       renderTracker is called with editing:false here, so only the marker /
       line and ripples render. Movement transitions on the group's transform
       so the dot/triangle glides between sensor updates rather than jumping. === */
    .tracker-marker {
      transition: transform 0.4s ease-out;
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
  `,
  ];
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-card": FloorplanCard;
  }
}
