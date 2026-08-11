import { LitElement, html, css, svg, nothing, type TemplateResult, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { keyed } from "lit/directives/keyed.js";
import type { HomeAssistant, FloorplanCardConfig, FloorItem, FloorText, Floor, Area } from "./types";
import { cssColor, cssColorOr, cssNumber, cssIdent, cssEntityId, contrastText } from "./css-safe";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  DEFAULT_SUN_MIN,
  DEFAULT_SUN_MAX,
  PRESS_SCALE,
  PRESS_IN_MS,
  PRESS_OUT_MS,
  getFloors,
  trackerPresenceDetected,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  renderWallMask,
  imageFitRatio,
  sunBrightness,
  resolveOpeningAmount,
  openingIsActive,
  openingClickAction,
  shutterAmount,
  shutterStyleOf,
  shutterActive,
  renderRipple,
  renderFurniture,
  furnitureColor,
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
  itemHiddenWhenInactive,
  itemLabelSize,
  hassRenderInputsChanged,
  collectWatchedEntities,
  resolveItemIcon,
  resolveIconAnimation,
  itemIconSize,
  normalizePlanRotation,
  rotatedCanvasSize,
  rotatePlanPoint,
  planRotationTransform,
  type PlanRotation,
} from "./render";
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
  private readonly _wallMaskId = `fp-wall-mask-${FloorplanCard._nextWallMaskId++}`;
  /** Prefix for this card's glow gradient ids, unique per instance (issue #6). */
  private readonly _glowIdBase = `fp-glow-${FloorplanCard._nextGlowId++}`;
  /** Entity ids this plan actually displays; used to skip irrelevant hass updates. */
  private _watchedEntities: Set<string> = new Set();

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
    return {};
  }

  /**
   * Sections-view sizing (grid rows ≈ 56px): room for the 5:3 default canvas.
   * An instance method — HA calls it on the card element (getConfigElement /
   * getStubConfig are the static ones, called before any instance exists).
   */
  public getGridOptions() {
    return { columns: 12, rows: 8, min_columns: 6, min_rows: 4 };
  }

  private _isOn(item: FloorItem): boolean {
    // Domain-aware: locks say "unlocked", vacuums "cleaning" — never "on".
    return entityIsActive(item.entity, this.hass?.states[item.entity]?.state);
  }

  /** How far open an opening should be drawn (0..1), from its entity (or default). */
  private _openingAmount(o: Opening): number {
    const state = o.entity ? this.hass?.states[o.entity] : undefined;
    return resolveOpeningAmount(o, state);
  }

  /** Whether an opening wears its accent: drawn open, or a cover still in transit. */
  private _openingActive(o: Opening): boolean {
    const state = o.entity ? this.hass?.states[o.entity] : undefined;
    return openingIsActive(o, state);
  }

  private _itemIcon(item: FloorItem): string {
    return resolveItemIcon(
      item,
      this.hass?.states[item.entity],
      this.hass?.entities?.[item.entity]?.icon,
    );
  }

  private _label(item: FloorItem): string {
    return (
      item.name ?? this.hass?.states[item.entity]?.attributes?.friendly_name ?? item.entity ?? ""
    );
  }

  private _handleItemAction(
    ev: CustomEvent<{ action: "tap" | "hold" | "double_tap" }>,
    item: FloorItem
  ): void {
    if (!this.hass) return;
    executeAction(this, this.hass, item, actionForGesture(item, ev.detail.action));
  }

  /**
   * Tapping an entity-bound opening: toggle a controllable `cover`, otherwise
   * open the entity's more-info dialog (read-only `binary_sensor`s and
   * position-only covers). See {@link openingClickAction}.
   */
  private _onOpeningClick(o: Opening): void {
    if (!this.hass || !o.entity) return;
    const features = (this.hass.states[o.entity]?.attributes?.supported_features as number) ?? 0;
    if (openingClickAction(o.entity, features) === "cover-toggle") {
      this.hass.callService("cover", "toggle", { entity_id: o.entity });
    } else {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: o.entity },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private _renderBadge(item: FloorItem): TemplateResult {
    const size = cssNumber(item.size, DEFAULT_ITEM_SIZE);
    // Animation goes on the inner ha-icon, not the badge: the badge carries
    // the user's `angle` rotation, and a spin on the same element would
    // overwrite it.
    const anim = resolveIconAnimation(
      item,
      item.entity ? this.hass?.states[item.entity]?.state : undefined,
    );
    // "Show the reading, not a picture" (issue #106). Same badge — size, angle,
    // state colour, ripple stacking all unchanged — with the glyph swapped for
    // the number. A device with nothing numeric to show keeps its icon.
    const value = badgeContentOf(item) === "value" ? badgeValue(this.hass, item) : undefined;
    return html`
      <div
        class="badge"
        style="width:${size}px;height:${size}px;transform:rotate(${cssNumber(item.angle, 0)}deg);"
      >
        ${value
          ? html`<span class="badge-value" style="font-size:${badgeValueSize(size, value)}px;"
              >${value}</span
            >`
          : html`<ha-icon
              class=${anim ? `anim-${anim}` : ""}
              icon=${this._itemIcon(item)}
              style="--mdc-icon-size:${itemIconSize(size)}px;"
            ></ha-icon>`}
      </div>
    `;
  }

  /**
   * Start the ink ripple at the point that was actually touched (issue #134).
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

  private _renderItem(item: FloorItem, c: FloorplanCardConfig, rot: PlanRotation): TemplateResult {
    const on = this._isOn(item);
    // Name/state composition lives in itemBadgeLabel, including #39's
    // no-entity guard (an unbound device gets no state line).
    const labelText = itemBadgeLabel(this.hass, item);
    // Threshold color (issue #68), judged on the displayed value (attribute
    // when set, else the state). cssColor gates the config string (#64).
    const st = item.entity ? this.hass?.states[item.entity] : undefined;
    const rawValue = itemRawValue(item, st);
    // One resolved colour drives the whole element (issue #79 follow-up): the
    // label *and* the badge. A sensor is never "on", so tying the badge to the
    // active state alone left threshold colours invisible on exactly the
    // devices they were written for.
    const stateColor = cssColor(resolveStateColor(item.stateColor, rawValue));
    const labelColor = stateColor;
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
      visual = renderRipple(on, rippleColor, rippleSize);
    } else if (display === "iconRipple") {
      visual = html`<div class="stack">
        ${renderRipple(on, rippleColor, rippleSize)}
        ${showIcon ? html`<div class="stack-icon">${this._renderBadge(item)}</div>` : nothing}
      </div>`;
    } else if (showIcon) {
      visual = this._renderBadge(item);
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
        class="item fp-item ${on ? "on" : "off"} ${stateColor ? "state-colored" : ""} ${interactive
          ? "interactive"
          : ""}"
        data-id=${cssIdent(item.id) ?? nothing}
        data-entity=${cssEntityId(item.entity) ?? nothing}
        data-kind=${cssIdent(item.kind) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;${stateColor
          ? `--fp-state:${stateColor};`
          : ""}${activeColor
          ? `--fp-active:${activeColor};`
          : ""}${badgeInk ? `--fp-ink:${badgeInk};` : ""}"
        title=${this._label(item)}
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
              class="label ${visual === nothing ? "inflow" : ""}"
              style="font-size:${itemLabelSize(item.labelSize)}px;${labelColor
                ? `color:${labelColor};`
                : ""}"
              >${labelText}</span
            >`
          : nothing}
      </div>
    `;
  }

  private _renderAreaLabel(a: Area, c: FloorplanCardConfig, rot: PlanRotation): TemplateResult | typeof nothing {
    if (!a.name || (a.showName ?? true) === false) return nothing;
    const centroid = polygonCentroid(a.points);
    const p = rotatePlanPoint(centroid.x, centroid.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    return html`
      <div
        class="area-label"
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;"
      >
        ${a.name}
      </div>
    `;
  }

  private _renderText(t: FloorText, c: FloorplanCardConfig, rot: PlanRotation): TemplateResult {
    const p = rotatePlanPoint(t.x, t.y, c.width, c.height, rot);
    const d = rotatedCanvasSize(c.width, c.height, rot);
    return html`
      <div
        class="text fp-text"
        data-id=${cssIdent(t.id) ?? nothing}
        style="left:${(p.x / d.w) * 100}%; top:${(p.y / d.h) * 100}%;
               font-size:${cssNumber(t.size, DEFAULT_TEXT_SIZE)}px;
               color:${cssColorOr(t.color, SKIN_TEXT)};
               transform:translate(-50%,-50%) rotate(${cssNumber(t.angle, 0)}deg);"
      >
        ${t.text}
      </div>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) return html`${nothing}`;
    const c = this._config;
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
    // Follow the real sun (issue #113). Elevation comes from the HA instance,
    // so every viewer sees the same picture regardless of their own timezone.
    const sunLevel = c.sunDimming
      ? sunBrightness(
          this.hass?.states["sun.sun"]?.attributes?.elevation,
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
      ? wallsLightPassesThrough(active.walls, active.openings, (o) => this._openingAmount(o))
      : active.walls;
    // Lit rooms hold back the night (issue #113): without this the flat dim
    // multiplies the lit-vs-unlit contrast too, and a lamp ends up *less*
    // visible after dark than at noon.
    const sunDimMaskId = `${this._glowIdBase}-sundim`;
    const sunDimMask = c.sunDimming
      ? renderSunDimMask(
          active.items,
          this.hass?.states,
          c.width,
          c.height,
          sunDimMaskId,
          lightWalls
        )
      : nothing;
    return html`
      <!-- The skin (issue #122) rides on the card rather than on .plan, so the
           floor switcher and the card's own background follow it too — a Tron
           plan floating on a white card would read as a bug. Every token the
           card draws with is declared on :host, so this only ever overrides. -->
      <!-- No skin style here: the palette comes from data-skin on the host, so
           a card-mod rule on this element still wins (issue #155). -->
      <ha-card .header=${c.title ?? nothing}>
        <div
          class="stage press-${pressEffectOf(c)}"
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
            class="plan"
            style="aspect-ratio: ${dims.w} / ${dims.h};
                   width: min(100%, calc(100cqh * ${dims.w} / ${dims.h}));
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
            ${active.areas?.map((a) =>
              renderArea(a, areaColor(a, a.entity ? this.hass?.states[a.entity]?.state : undefined))
            )}
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
            ${renderGlowMask(active.furniture, c.width, c.height, `${this._glowIdBase}-mask`)}
            <g class="fp-glows"
               mask=${active.furniture.length ? `url(#${this._glowIdBase}-mask)` : nothing}>
              ${active.items.map((it, i) => {
                if (!it.glow) return nothing;
                const paint = glowPaint(it, this.hass?.states[it.entity]);
                // Walls block the pool (issue #108) — light stops at the room.
                return paint
                  ? renderGlow(it, paint, `${this._glowIdBase}-${i}`, lightWalls)
                  : nothing;
              })}
            </g>
            ${active.furniture.map((f) =>
              renderFurniture(f, furnitureColor(f, f.entity ? this.hass?.states[f.entity]?.state : undefined))
            )}
            ${renderWallMask(active.openings, c.width, c.height, this._wallMaskId)}
            <g mask=${`url(#${this._wallMaskId})`}>
              ${active.walls.map(
                (w) => svg`
                <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
                      class="wall fp-wall" data-id=${cssIdent(w.id) ?? nothing}
                      stroke-width=${WALL_THICKNESS} stroke-linecap="round" />`
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
                  areaColor(a, a.entity ? this.hass?.states[a.entity]?.state : undefined),
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
              const amount = this._openingAmount(o);
              const shutterState = o.shutterEntity
                ? this.hass?.states[o.shutterEntity]
                : undefined;
              const symbol = renderOpening(o, {
                color: SKIN_WALL,
                open: amount > 0,
                amount,
                active: this._openingActive(o),
                accent: o.activeColor ?? SKIN_ACCENT,
                // External roller shutter layer (issue #74). No entity bound
                // yet → previewed shut, like a static plan.
                shutter: o.shutterEntity
                  ? {
                      amount: shutterAmount(shutterState),
                      active: shutterActive(shutterState),
                      style: shutterStyleOf(o),
                    }
                  : undefined,
              });
              if (!o.entity) return symbol;
              // Entity-bound openings are tappable — a transparent rect over the
              // opening's wall gap gives a reliable hit target beyond the thin
              // leaf/panel strokes.
              const half = o.length / 2;
              const cutH = WALL_THICKNESS + 4;
              return svg`<g class="fp-opening" @click=${() => this._onOpeningClick(o)}>
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
                xReading: trackerSensorReading(this.hass?.states, tr.xSensor?.entity),
                yReading: trackerSensorReading(this.hass?.states, tr.ySensor?.entity),
                xPresent: trackerPresenceDetected(this.hass?.states, tr.xSensor?.presence),
                yPresent: trackerPresenceDetected(this.hass?.states, tr.ySensor?.presence),
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
          <div class="items">
            ${active.areas?.map((a) => this._renderAreaLabel(a, c, rot))}
            ${active.texts.map((t) => this._renderText(t, c, rot))}
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
                    it.entity ? this.hass?.states[it.entity]?.state : undefined
                  )
              ),
              (it, i) => it.id || i,
              (it) => this._renderItem(it, c, rot)
            )}
          </div>
          </div>
          ${floors.length > 1 ? this._renderFloorSwitcher(floors, active) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderFloorSwitcher(floors: Floor[], active: Floor): TemplateResult {
    return html`
      <div class="floor-switcher">
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
              @click=${() => {
                this._activeFloorId = f.id;
                // Remember it for the next element the editor preview builds.
                lastViewedFloor.set(floorMemoryKey(floors), f.id);
              }}
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
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
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
    .item {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      /* Not a hand: a device with nothing bound, or tap_action set to none,
         is not a button (issue #134). Only .interactive gets the pointer. */
      cursor: default;
      display: flex;
      flex-direction: column;
      align-items: center;
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
       the device down-right by half its size. */
    .press-scale .item.interactive {
      transition: transform ${PRESS_OUT_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1);
    }
    .press-scale .item.interactive:active {
      transform: translate(-50%, -50%) scale(${PRESS_SCALE});
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
        transform: translate(-50%, -50%);
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
    /* Label-only items (showIcon: false) have no badge to hang under, so the
       absolute label would drop to y + 2px on a zero-height item. Put it back
       in flow so it becomes the item's box and centers on (x, y) as before. */
    .label.inflow {
      position: static;
      transform: none;
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
    }
    .area-label {
      position: absolute;
      pointer-events: none;
      white-space: nowrap;
      transform: translate(-50%, -50%);
      font-weight: 600;
      font-size: 14px;
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
