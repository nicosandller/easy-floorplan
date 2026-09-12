import { LitElement, css, html, nothing, unsafeCSS } from "lit";
import { guard } from "lit/directives/guard.js";
import { customElement, property, state } from "lit/decorators.js";
import { resolveReplayEventColor, type HistoryEventInput } from "./history-service";
import { thinForDisplay } from "./downsample";
import { SKIN_ACCENT } from "../skins";

@customElement("easy-floorplan-history-timeline")
export class HistoryTimeline extends LitElement {
  @property({ attribute: false }) public events: HistoryEventInput[] = [];
  @property({ type: Number }) public startTime = 0;
  @property({ type: Number }) public endTime = 0;
  @property({ type: Number }) public currentTime = 0;
  @property({ type: Boolean }) public expanded = false;
  private _dragging = false;
  /**
   * Lanes the reader has switched off. A view preference rather than config:
   * it answers "not while I am looking at this", not "never show me this".
   *
   * Replaced rather than mutated on every toggle, because the marker list is
   * memoized on identity and an in-place Set edit would not redraw it.
   */
  @state() private _hidden: ReadonlySet<string> = new Set();

  private _toggleLane(entityId: string): void {
    const next = new Set(this._hidden);
    if (!next.delete(entityId)) next.add(entityId);
    this._hidden = next;
  }

  private _showAllLanes(): void {
    this._hidden = new Set();
  }

  private _seek(timestamp: number): void {
    this.dispatchEvent(new CustomEvent("seek", { detail: { timestamp }, bubbles: true, composed: true }));
  }

  private _formatTimestamp(timestamp: number): string {
    if (!Number.isFinite(timestamp)) return "—";
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(new Date(timestamp * 1000));
  }

  private _getMarkerLeft(timestamp: number): string {
    return `${((timestamp - this.startTime) / Math.max(1, this.endTime - this.startTime)) * 100}%`;
  }

  /**
   * Keep markers visually centered while preventing edge overflow that can
   * trigger horizontal scrollbars in tight containers.
   */
  private _getMarkerLeftClamped(timestamp: number, edgePx: number): string {
    const raw = this._getMarkerLeft(timestamp);
    return `clamp(${edgePx}px, ${raw}, calc(100% - ${edgePx}px))`;
  }

  /** This timestamp as a 0-100 position in the window, unitless for calc(). */
  private _pct(timestamp: number): number {
    return ((timestamp - this.startTime) / Math.max(1, this.endTime - this.startTime)) * 100;
  }

  private _markerStyle(event: HistoryEventInput, stackOffset = "0px"): string {
    const color = resolveReplayEventColor(event);
    const base = `left:${this._getMarkerLeftClamped(event.timestamp, 7)};--stack-offset:${stackOffset};--marker-pct:${this._pct(event.timestamp)};`;
    return color ? `${base}background:${color};box-shadow:0 0 0 2px ${color}22;` : base;
  }

  private _formatEventTitle(event: HistoryEventInput): string {
    return `${this._formatTimestamp(event.timestamp)} · ${event.entityId}: ${event.oldState} → ${event.newState}`;
  }

  private _formatClusterTitle(events: HistoryEventInput[]): string {
    return events.map((event) => this._formatEventTitle(event)).join("\n");
  }

  /**
   * How many markers one lane can carry before they stop being individually
   * visible. A lane is around 1800px on a wide card and a marker is 8px.
   */
  private static readonly MAX_MARKERS_PER_LANE = 150;

  private _visibleEvents(): HistoryEventInput[] {
    if (!this.events.length) return [];
    const start = this.startTime;
    const end = this.endTime;
    return this.events.filter((event) => event.timestamp >= start && event.timestamp <= end);
  }

  /**
   * The events this timeline draws — every discrete state change, and the
   * largest moves of each numeric sensor up to what a lane can show. Replay
   * itself still reads the full series; this only decides what gets a marker.
   */
  /** Each entity's lane, display-thinned. Hidden lanes are still in here, so
   *  the expanded view can keep their label on screen to switch back on. */
  private _laneSeries(): Map<string, HistoryEventInput[]> {
    const byEntity = new Map<string, HistoryEventInput[]>();
    for (const event of this._visibleEvents()) {
      const bucket = byEntity.get(event.entityId);
      if (bucket) bucket.push(event);
      else byEntity.set(event.entityId, [event]);
    }
    for (const [entityId, series] of byEntity) {
      byEntity.set(entityId, thinForDisplay(series, HistoryTimeline.MAX_MARKERS_PER_LANE));
    }
    return byEntity;
  }

  /**
   * What the summary bar draws: every lane that is switched on. Hiding a lane
   * takes its events out of here too, which is the point — a summary that
   * still counted a lane you had switched off would not be a summary of what
   * you are looking at.
   */
  private _drawnEvents(): HistoryEventInput[] {
    const out: HistoryEventInput[] = [];
    for (const [entityId, series] of this._laneSeries()) {
      if (this._hidden.has(entityId)) continue;
      out.push(...series);
    }
    return out.sort((a, b) => a.timestamp - b.timestamp);
  }

  private _groupEventsByTimestamp(): Array<{ timestamp: number; events: HistoryEventInput[]; left: string }> {
    const visibleEvents = this._drawnEvents();
    const grouped = new Map<number, HistoryEventInput[]>();
    for (const event of visibleEvents) {
      const bucket = grouped.get(event.timestamp);
      if (bucket) {
        bucket.push(event);
      } else {
        grouped.set(event.timestamp, [event]);
      }
    }

    return Array.from(grouped.entries()).map(([timestamp, events]) => ({
      timestamp,
      events,
      left: this._getMarkerLeft(timestamp),
    }));
  }

  private _getEntityLabel(event: HistoryEventInput): string {
    const attributes = event.attributes ?? {};
    const friendlyName = typeof attributes.friendly_name === "string" ? attributes.friendly_name : undefined;
    const label = friendlyName?.trim() || event.entityId;
    return label.replace(/^./, (c) => c.toUpperCase());
  }

  private _seekFromClientX(clientX: number): void {
    const selector = this.expanded ? ".timeline-track-overlay" : ".timeline";
    const rect = this.shadowRoot?.querySelector(selector)?.getBoundingClientRect();
    if (!rect) return;
    const span = Math.max(1, this.endTime - this.startTime);
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const timestamp = Math.round(this.startTime + ratio * span);
    this._seek(timestamp);
  }

  private _handleTimelineClick(ev: MouseEvent): void {
    this._seekFromClientX(ev.clientX);
  }

  private _handleKeyDown(ev: KeyboardEvent): void {
    const span = Math.max(1, this.endTime - this.startTime);
    const step = Math.max(1, Math.round(span / 100));
    switch (ev.key) {
      case "ArrowLeft":
      case "ArrowDown":
        this._seek(Math.max(this.startTime, this.currentTime - step));
        ev.preventDefault();
        break;
      case "ArrowRight":
      case "ArrowUp":
        this._seek(Math.min(this.endTime, this.currentTime + step));
        ev.preventDefault();
        break;
      case "Home":
        this._seek(this.startTime);
        ev.preventDefault();
        break;
      case "End":
        this._seek(this.endTime);
        ev.preventDefault();
        break;
      default:
        break;
    }
  }

  /**
   * The way back. Switching a lane off in the expanded view and then
   * collapsing would otherwise strand it: the summary bar has no labels to
   * click, so nothing on screen would say anything was missing.
   */
  private _renderHiddenNotice() {
    if (!this._hidden.size) return nothing;
    const n = this._hidden.size;
    return html`
      <div class="lanes-hidden">
        <span>${n} lane${n === 1 ? "" : "s"} hidden</span>
        <button class="lanes-hidden-show" @click=${() => this._showAllLanes()}>Show all</button>
      </div>
    `;
  }

  private _renderExpandedTimeline(span: number) {
    const entityGroups = this._laneSeries();
    const entities = Array.from(entityGroups.keys());
    const playheadLeft = ((this.currentTime - this.startTime) / span) * 100;
    return html`
      <div
        class="timeline-expanded timeline-interactive"
        style="--playhead-pct:${this._pct(this.currentTime)}"
        role="slider"
        tabindex="0"
        aria-label="Replay timeline"
        aria-valuemin=${this.startTime}
        aria-valuemax=${this.endTime}
        aria-valuenow=${this.currentTime}
        aria-valuetext=${this._formatTimestamp(this.currentTime)}
        @click=${(ev: MouseEvent) => this._handleTimelineClick(ev)}
        @pointerdown=${(ev: PointerEvent) => this._handlePointerDown(ev)}
        @pointermove=${(ev: PointerEvent) => this._handlePointerMove(ev)}
        @pointerup=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @pointerleave=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @keydown=${this._handleKeyDown}
      >
        <div class="timeline-track-overlay" style="grid-row:1 / span ${entities.length};" aria-hidden="true">
          <div class="playhead playhead-expanded" style="left:${playheadLeft}%">
            <span class="playhead-time">${this._formatTimestamp(this.currentTime)}</span>
          </div>
        </div>
        ${guard([this.events, this.startTime, this.endTime, this._hidden], () =>
          entities.map((entityId, index) => {
          const laneEvents = entityGroups.get(entityId) ?? [];
          const row = index + 1;
          const label = this._getEntityLabel(laneEvents[0]);
          const off = this._hidden.has(entityId);
          return html`
            <button
              class="lane-label ${off ? "lane-off" : ""}"
              style="grid-row:${row};"
              aria-pressed=${off ? "false" : "true"}
              title=${off ? `Show ${label} on the timeline` : `Hide ${label} from the timeline`}
              @click=${(ev: Event) => {
                ev.stopPropagation();
                this._toggleLane(entityId);
              }}
            ><span class="lane-dot" aria-hidden="true"></span><span class="lane-name">${label}</span></button>
            <div class="lane lane-track ${off ? "lane-off" : ""}" style="grid-row:${row};">
              ${(off ? [] : laneEvents).map((event) => {
                const color = resolveReplayEventColor(event);
                const left = this._getMarkerLeftClamped(event.timestamp, 4);
                return html`
                  <button
                    class="marker"
                    style=${`left:${left};--marker-pct:${this._pct(event.timestamp)};${color ? `background:${color};box-shadow:0 0 0 2px ${color}22;` : ""}`}
                    title=${this._formatEventTitle(event)}
                    @click=${(ev: Event) => {
                      ev.stopPropagation();
                      this._seek(event.timestamp);
                    }}
                  ></button>
                `;
              })}
            </div>
          `;
        }))}
      </div>
    `;
  }

  private _handlePointerDown(ev: PointerEvent): void {
    this._dragging = true;
    this._updateFromPointer(ev);
  }

  private _handlePointerMove(ev: PointerEvent): void {
    if (!this._dragging) return;
    this._updateFromPointer(ev);
  }

  private _handlePointerUp(ev: PointerEvent): void {
    if (!this._dragging) return;
    this._dragging = false;
    this._updateFromPointer(ev);
  }

  private _updateFromPointer(ev: PointerEvent): void {
    this._seekFromClientX(ev.clientX);
  }

  protected render() {
    if (!this.events.length) {
      return html`<div class="timeline-empty">No history available.</div>`;
    }
    const span = Math.max(1, this.endTime - this.startTime);
    if (this.expanded) {
      return html`${this._renderHiddenNotice()}${this._renderExpandedTimeline(span)}`;
    }

    return html`
      ${this._renderHiddenNotice()}
      <div
        class="timeline timeline-interactive"
        style="--playhead-pct:${this._pct(this.currentTime)}"
        role="slider"
        tabindex="0"
        aria-label="Replay timeline"
        aria-valuemin=${this.startTime}
        aria-valuemax=${this.endTime}
        aria-valuenow=${this.currentTime}
        aria-valuetext=${this._formatTimestamp(this.currentTime)}
        @click=${(ev: MouseEvent) => this._handleTimelineClick(ev)}
        @pointerdown=${(ev: PointerEvent) => this._handlePointerDown(ev)}
        @pointermove=${(ev: PointerEvent) => this._handlePointerMove(ev)}
        @pointerup=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @pointerleave=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @keydown=${this._handleKeyDown}
      >
        <div class="track"></div>
        <div class="playhead" style="left:${this._pct(this.currentTime)}%">
          <span class="playhead-time">${this._formatTimestamp(this.currentTime)}</span>
        </div>
        ${guard([this.events, this.startTime, this.endTime], () =>
          this._groupEventsByTimestamp().map((group) => html`
          <div
            class="marker-cluster"
            style="left:${this._getMarkerLeftClamped(group.timestamp, 7)};--marker-pct:${this._pct(group.timestamp)};"
            title=${this._formatClusterTitle(group.events)}
            @click=${(ev: Event) => {
              ev.stopPropagation();
              this._seek(group.timestamp);
            }}
          >
            ${group.events.map((event, index) => {
              const stackOffset = index === 0 ? "-2px" : index === 1 ? "2px" : index === 2 ? "-4px" : "4px";
              return html`
                <button
                  class="marker"
                  style=${this._markerStyle(event, stackOffset)}
                  title=${this._formatEventTitle(event)}
                  @click=${(ev: Event) => {
                    ev.stopPropagation();
                    this._seek(event.timestamp);
                  }}
                ></button>
              `;
            })}
          </div>
        `))}
      </div>
    `;
  }

  static styles = css`
    :host { display: block; }
    .timeline { position: relative; height: 24px; margin: 8px 0; cursor: pointer; }
    .timeline-expanded {
      position: relative;
      display: grid;
      grid-template-columns: minmax(90px, 140px) 1fr;
      column-gap: 8px;
      row-gap: 6px;
      margin: 8px 0;
      cursor: pointer;
      align-items: center;
    }
    .timeline-track-overlay {
      grid-column: 2;
      grid-row: 1 / -1;
      position: relative;
      align-self: stretch;
      pointer-events: none;
      z-index: 0;
    }
    .timeline-interactive { touch-action: none; }
    .lane {
      position: relative;
      z-index: 1;
      grid-column: 2;
      width: 100%;
      min-width: 0;
    }
    /*
     * The lane label is the switch for its lane, so it has to look like one
     * before it is hovered: a button box, a pointer cursor, and a dot standing
     * in for the lane's markers that fills when the lane is on and hollows out
     * when it is off. Discoverability is the whole point — a bare text label
     * that happens to be clickable is not discoverable.
     */
    .lane-label {
      grid-column: 1;
      display: flex;
      align-items: center;
      gap: 6px;
      font: inherit;
      font-size: 11px;
      text-align: left;
      color: var(--secondary-text-color, #666);
      background: none;
      border: 1px solid transparent;
      border-radius: 4px;
      padding: 1px 4px;
      margin: 0;
      cursor: pointer;
      overflow: hidden;
      white-space: nowrap;
      min-width: 0;
    }
    .lane-name {
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .lane-dot {
      flex: none;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      border: 1px solid currentColor;
      background: currentColor;
    }
    .lane-label:hover,
    .lane-label:focus-visible {
      color: var(--primary-text-color);
      border-color: var(--divider-color, #ccc);
      background: var(--secondary-background-color, rgba(127, 127, 127, 0.12));
    }
    /* Switched off: the row stays, so there is something to click to get it
       back, but it reads as absent rather than empty. */
    .lane-label.lane-off {
      opacity: 0.55;
      text-decoration: line-through;
    }
    .lane-label.lane-off .lane-dot {
      background: transparent;
    }
    .lane-track.lane-off {
      opacity: 0.35;
    }
    .lanes-hidden {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 4px;
      font-size: 11px;
      color: var(--secondary-text-color, #666);
    }
    .lanes-hidden-show {
      font: inherit;
      cursor: pointer;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
    }
    .lane-track {
      position: relative;
      height: 14px;
      border-radius: 999px;
      background: var(--divider-color, #ddd);
    }
    .track { position: absolute; inset: 0; border-radius: 999px; background: var(--divider-color, #ddd); }
    .playhead { position: absolute; top: -2px; width: 2px; height: calc(100% + 4px); background: ${unsafeCSS(SKIN_ACCENT)}; }
    .playhead-expanded { top: 0; bottom: 0; height: auto; transform: translateX(-50%); }
    /*
     * The clock rides the playhead rather than sitting in the header: while a
     * replay runs this is the only part of the card the eye is on, and a time
     * three inches away from it does not read as "where we are now".
     */
    .playhead-time {
      position: absolute;
      bottom: calc(100% + 4px);
      left: 50%;
      transform: translateX(-50%);
      padding: 1px 5px;
      border-radius: 4px;
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      pointer-events: none;
      background: ${unsafeCSS(SKIN_ACCENT)};
      color: var(--fp-skin-accent-ink, var(--text-primary-color, #fff));
    }
    .marker-cluster {
      position: absolute;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 14px;
      height: 20px;
      cursor: pointer;
      pointer-events: auto;
    }
    .marker {
      position: absolute;
      left: 50%;
      top: calc(50% + var(--stack-offset, 0px));
      transform: translate(-50%, -50%);
      width: 8px;
      height: 8px;
      border-radius: 50%;
      border: none;
      background: var(--divider-color, #bbb);
      padding: 0;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    }
    /*
     * "Passed" — a marker the playhead has already crossed — used to be a class
     * written per marker, which meant every one of them re-rendered on every
     * frame of playback: 8,000 nodes rebuilt 20 times a second. Both numbers
     * are now plain custom properties, so the whole effect is one variable
     * written on the container and the markers themselves never change.
     *
     * clamp() is doing the comparison: the difference is scaled far past 1, so
     * it saturates to exactly 1 when the playhead is ahead of the marker and 0
     * when it is behind — a step function built out of arithmetic, because CSS
     * has no way to ask whether one length is greater than another.
     */
    .marker,
    .marker-cluster {
      --passed: clamp(0, (var(--playhead-pct, 0) - var(--marker-pct, 0) + 0.000001) * 1000000, 1);
    }
    .marker {
      transform: translate(-50%, -50%) scale(calc(1 + 0.2 * var(--passed)));
    }
    .timeline-empty { font-size: 12px; color: var(--secondary-text-color, #666); }
  `;
}
