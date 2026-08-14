import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { resolveReplayEventColor, type HistoryEventInput } from "./history-service";

@customElement("easy-floorplan-history-timeline")
export class HistoryTimeline extends LitElement {
  @property({ attribute: false }) public events: HistoryEventInput[] = [];
  @property({ type: Number }) public startTime = 0;
  @property({ type: Number }) public endTime = 0;
  @property({ type: Number }) public currentTime = 0;
  @property({ type: Boolean }) public expanded = false;
  private _dragging = false;

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

  private _markerStyle(event: HistoryEventInput, stackOffset = "0px"): string {
    const color = resolveReplayEventColor(event);
    const base = `left:${this._getMarkerLeft(event.timestamp)};--stack-offset:${stackOffset};`;
    return color ? `${base}background:${color};box-shadow:0 0 0 2px ${color}22;` : base;
  }

  private _formatEventTitle(event: HistoryEventInput): string {
    return `${this._formatTimestamp(event.timestamp)} · ${event.entityId}: ${event.oldState} → ${event.newState}`;
  }

  private _formatClusterTitle(events: HistoryEventInput[]): string {
    return events.map((event) => this._formatEventTitle(event)).join("\n");
  }

  private _groupEventsByTimestamp(): Array<{ timestamp: number; events: HistoryEventInput[]; left: string; passed: boolean }> {
    const grouped = new Map<number, HistoryEventInput[]>();
    for (const event of this.events) {
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
      passed: timestamp <= this.currentTime,
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

  private _renderExpandedTimeline(span: number) {
    const entities = Array.from(new Set(this.events.map((event) => event.entityId)));
    const playheadLeft = ((this.currentTime - this.startTime) / span) * 100;
    return html`
      <div
        class="timeline-expanded timeline-interactive"
        @click=${(ev: MouseEvent) => this._handleTimelineClick(ev)}
        @pointerdown=${(ev: PointerEvent) => this._handlePointerDown(ev)}
        @pointermove=${(ev: PointerEvent) => this._handlePointerMove(ev)}
        @pointerup=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @pointerleave=${(ev: PointerEvent) => this._handlePointerUp(ev)}
      >
        <div class="timeline-track-overlay" style="grid-row:1 / span ${entities.length};" aria-hidden="true">
          <div class="playhead playhead-expanded" style="left:${playheadLeft}%"></div>
        </div>
        ${entities.map((entityId, index) => {
          const laneEvents = this.events.filter((event) => event.entityId === entityId);
          const row = index + 1;
          return html`
            <div class="lane-label" style="grid-row:${row};">${this._getEntityLabel(this.events.find((event) => event.entityId === entityId)!)}</div>
            <div class="lane lane-track" style="grid-row:${row};">
              ${laneEvents.map((event) => {
                const color = resolveReplayEventColor(event);
                const left = this._getMarkerLeft(event.timestamp);
                const passed = event.timestamp <= this.currentTime;
                return html`
                  <button
                    class="marker ${passed ? "passed" : ""}"
                    style=${`left:${left};${color ? `background:${color};box-shadow:0 0 0 2px ${color}22;` : ""}`}
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
        })}
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
    if (!this.events.length) return html`<div class="timeline-empty">No history available.</div>`;
    const span = Math.max(1, this.endTime - this.startTime);
    const markerGroups = this._groupEventsByTimestamp();
    if (this.expanded) {
      return this._renderExpandedTimeline(span);
    }
    return html`
      <div
        class="timeline timeline-interactive"
        @click=${(ev: MouseEvent) => this._handleTimelineClick(ev)}
        @pointerdown=${(ev: PointerEvent) => this._handlePointerDown(ev)}
        @pointermove=${(ev: PointerEvent) => this._handlePointerMove(ev)}
        @pointerup=${(ev: PointerEvent) => this._handlePointerUp(ev)}
        @pointerleave=${(ev: PointerEvent) => this._handlePointerUp(ev)}
      >
        <div class="track"></div>
        <div class="playhead" style="left:${((this.currentTime - this.startTime) / span) * 100}%"></div>
        ${markerGroups.map((group) => html`
          <div
            class="marker-cluster ${group.passed ? "passed" : ""}"
            style="left:${group.left};"
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
                  class="marker ${group.passed ? "passed" : ""}"
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
        `)}
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
    .lane-label {
      grid-column: 1;
      font-size: 11px;
      color: var(--secondary-text-color, #666);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
    }
    .lane-track {
      position: relative;
      height: 14px;
      border-radius: 999px;
      background: var(--divider-color, #ddd);
    }
    .track { position: absolute; inset: 0; border-radius: 999px; background: var(--divider-color, #ddd); }
    .playhead { position: absolute; top: -2px; width: 2px; height: calc(100% + 4px); background: var(--primary-color, #03a9f4); }
    .playhead-expanded { top: 0; bottom: 0; height: auto; transform: translateX(-50%); }
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
    .marker.passed {
      transform: translate(-50%, -50%) scale(1.2);
    }
    .timeline-empty { font-size: 12px; color: var(--secondary-text-color, #666); }
  `;
}
