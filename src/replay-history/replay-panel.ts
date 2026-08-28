import { LitElement, css, html, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { formatReplayInputValue, sliderValueToReplaySpeed } from "./replay-utils";
import { resolveReplayEventColor, type HistoryEventInput } from "./history-service";

export interface ReplayPanelRenderProps {
  events: HistoryEventInput[];
  startTime: number;
  endTime: number;
  currentTime: number;
  visible: boolean;
  enabled: boolean;
  ready: boolean;
  playing: boolean;
  timelineExpanded: boolean;
  logExpanded: boolean;
  speedExpanded: boolean;
  error?: string;
  rangeWarning?: string;
  panelId: string;
  replaySpeed: number;
  currentTimeLabel: string;
  startInputValue: string;
  endInputValue: string;
  onToggleVisible: (visible: boolean) => void;
  onRangeChange: (kind: "start" | "end", value: string) => void;
  onZoom: (direction: -1 | 1) => void;
  onToggleReplay: () => void;
  onJump: (delta: number) => void;
  onStep: (direction: -1 | 1) => void;
  onPlayToggle: () => void;
  onToggleSpeedPanel: () => void;
  onSpeedSliderInput: (value: number) => void;
  onSpeedChange: (value: number) => void;
  onToggleTimeline: () => void;
  onToggleLog: () => void;
  onSeek: (timestamp: number) => void;
}

export interface ReplayPanelHost {
  state: {
    historyEvents: HistoryEventInput[];
    historyVisible: boolean;
    enabled: boolean;
    ready: boolean;
    timelineExpanded: boolean;
    logExpanded: boolean;
    speedExpanded: boolean;
    error?: string;
    rangeWarning?: string;
    panelId: string;
    startTime: number;
    endTime: number;
    playbackController: { startTime: number; endTime: number; currentTime: number; speed: number; playing: boolean };
  };
  formatReplayTime: (timestamp: number) => string;
  handleRangeChange: (kind: "start" | "end", ev: Event) => void;
  zoomWindow: (direction: -1 | 1) => void;
  toggleReplay: () => Promise<void>;
  jumpReplay: (delta: number) => void;
  stepReplay: (direction: -1 | 1) => void;
  pauseReplay: () => void;
  playReplay: () => void;
  setReplaySpeed: (speed: number) => void;
  seekReplay: (timestamp: number) => void;
  toggleHistoryVisible: (visible: boolean) => void;
  toggleSpeedPanel: () => void;
  toggleTimeline: () => void;
  toggleLog: () => void;
  requestUpdate: () => void;
}

export function createReplayPanelProps(host: ReplayPanelHost): ReplayPanelRenderProps {
  const playback = host.state.playbackController;
  const state = host.state;
  const currentTimeLabel = host.formatReplayTime(playback.currentTime);

  return {
    events: state.historyEvents,
    startTime: playback.startTime,
    endTime: playback.endTime,
    currentTime: playback.currentTime,
    visible: state.historyVisible,
    enabled: state.enabled,
    ready: state.ready,
    playing: playback.playing,
    timelineExpanded: state.timelineExpanded,
    logExpanded: state.logExpanded,
    speedExpanded: state.speedExpanded,
    error: state.error,
    rangeWarning: state.rangeWarning,
    panelId: state.panelId,
    replaySpeed: playback.speed,
    currentTimeLabel,
    startInputValue: formatReplayInputValue(state.startTime),
    endInputValue: formatReplayInputValue(state.endTime),
    onToggleVisible: (visible: boolean) => host.toggleHistoryVisible(visible),
    onRangeChange: (kind: "start" | "end", value: string) => {
      host.handleRangeChange(kind, { target: { value } } as unknown as Event);
    },
    onZoom: (direction: -1 | 1) => host.zoomWindow(direction),
    onToggleReplay: () => { void host.toggleReplay(); },
    onJump: (delta: number) => host.jumpReplay(delta),
    onStep: (direction: -1 | 1) => host.stepReplay(direction),
    onPlayToggle: () => (playback.playing ? host.pauseReplay() : host.playReplay()),
    onToggleSpeedPanel: () => host.toggleSpeedPanel(),
    onSpeedSliderInput: (value: number) => host.setReplaySpeed(sliderValueToReplaySpeed(value)),
    onSpeedChange: (value: number) => host.setReplaySpeed(value),
    onToggleTimeline: () => host.toggleTimeline(),
    onToggleLog: () => host.toggleLog(),
    onSeek: (timestamp: number) => host.seekReplay(timestamp),
  };
}

export function renderReplayPanel(props: ReplayPanelRenderProps): TemplateResult {
  return html`
    <easy-floorplan-replay-panel
      .events=${props.events}
      .startTime=${props.startTime}
      .endTime=${props.endTime}
      .currentTime=${props.currentTime}
      .visible=${props.visible}
      .enabled=${props.enabled}
      .ready=${props.ready}
      .playing=${props.playing}
      .timelineExpanded=${props.timelineExpanded}
      .logExpanded=${props.logExpanded}
      .speedExpanded=${props.speedExpanded}
      .error=${props.error}
      .rangeWarning=${props.rangeWarning}
      .panelId=${props.panelId}
      .replaySpeed=${props.replaySpeed}
      .currentTimeLabel=${props.currentTimeLabel}
      .startInputValue=${props.startInputValue}
      .endInputValue=${props.endInputValue}
      @toggle-visible=${(ev: CustomEvent<{ visible: boolean }>) => props.onToggleVisible(Boolean(ev.detail?.visible ?? true))}
      @range-change=${(ev: CustomEvent<{ kind: "start" | "end"; value: string }>) => {
        const kind = ev.detail?.kind ?? "start";
        if (!ev.detail?.value) return;
        props.onRangeChange(kind, ev.detail.value);
      }}
      @zoom=${(ev: CustomEvent<{ direction: -1 | 1 }>) => props.onZoom(ev.detail?.direction ?? 1)}
      @toggle-replay=${() => props.onToggleReplay()}
      @jump=${(ev: CustomEvent<{ delta: number }>) => props.onJump(ev.detail?.delta ?? 0)}
      @step=${(ev: CustomEvent<{ direction: -1 | 1 }>) => props.onStep(ev.detail?.direction ?? 1)}
      @play-toggle=${() => props.onPlayToggle()}
      @toggle-speed-panel=${() => props.onToggleSpeedPanel()}
      @speed-slider-input=${(ev: CustomEvent<{ value: number }>) => {
        const value = Number(ev.detail?.value ?? 0);
        if (!Number.isFinite(value)) return;
        props.onSpeedSliderInput(value);
      }}
      @speed-change=${(ev: CustomEvent<{ value: number }>) => {
        const value = Number(ev.detail?.value ?? 1);
        if (!Number.isFinite(value)) return;
        props.onSpeedChange(value);
      }}
      @toggle-timeline=${() => props.onToggleTimeline()}
      @toggle-log=${() => props.onToggleLog()}
      @seek=${(ev: CustomEvent<{ timestamp: number }>) => props.onSeek(ev.detail?.timestamp ?? props.currentTime)}
    ></easy-floorplan-replay-panel>
  `;
}

@customElement("easy-floorplan-replay-panel")
export class ReplayPanel extends LitElement {
  static styles = css`
    .replay-panel {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 12px 10px;
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 12px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.03));
      overflow-x: hidden;
    }
    .replay-panel-toggle {
      display: flex;
      justify-content: flex-end;
      margin: 0 0 4px;
    }
    .replay-hide-toggle,
    .replay-show-toggle {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 999px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      padding: 4px 10px;
      font-size: 12px;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
    }
    .replay-hide-toggle {
      position: absolute;
      top: 6px;
      right: 6px;
      z-index: 1;
      padding: 2px 8px;
      font-size: 11px;
      text-transform: lowercase;
    }
    .replay-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      padding-right: 52px;
    }
    .replay-meta {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .replay-chip {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 999px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .replay-time {
      font-size: 12px;
      color: var(--secondary-text-color, #666);
    }
    .replay-status {
      font-size: 12px;
      color: var(--secondary-text-color, #666);
    }
    .replay-toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: end;
      justify-content: space-between;
    }
    .replay-toolbar-toggles {
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      justify-content: flex-end;
    }
    .replay-lanes {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }
    .replay-transport {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      align-items: center;
    }
    .replay-speed-toggle {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 999px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      padding: 4px 10px;
      font-size: 12px;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .replay-icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 30px;
      height: 28px;
      padding: 2px 6px;
    }
    .replay-icon-button ha-icon,
    .replay-speed-toggle ha-icon,
    .replay-run-button ha-icon {
      --mdc-icon-size: 16px;
    }
    .replay-speed-panel {
      border: 1px solid var(--divider-color, #ddd);
      border-radius: 8px;
      background: var(--card-background-color, #fff);
      padding: 8px 10px;
      min-width: 0;
    }
    .replay-range {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: end;
    }
    .replay-range-tools {
      display: flex;
      gap: 4px;
    }
    .replay-view-tools {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .replay-timeline-wrap {
      max-height: 220px;
      overflow-y: auto;
      overflow-x: hidden;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 8px;
      background: var(--card-background-color, #fff);
      min-width: 0;
    }
    .replay-range-field,
    .replay-speed-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 12px;
      color: var(--secondary-text-color, #666);
    }
    .replay-range-field {
      flex: 1 1 210px;
      min-width: 180px;
    }
    .replay-speed-group {
      flex: 1 1 auto;
      min-width: 0;
      max-width: 100%;
      margin-left: 0;
    }
    .replay-range input,
    .replay-speed-slider,
    .replay-speed-field input {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      padding: 4px 8px;
      font-size: 12px;
      min-width: 150px;
    }
    .replay-toolbar button,
    .replay-range-tools button,
    .replay-toolbar select,
    .replay-speed-field input {
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 6px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1;
    }
    .replay-speed-slider {
      padding: 0;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }
    .replay-speed {
      width: 92px;
      min-width: 0;
      align-self: flex-start;
    }
    .replay-run-button {
      min-width: 82px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .replay-toolbar button,
    .replay-range-tools button {
      cursor: pointer;
    }
    @media (max-width: 720px) {
      .replay-toolbar {
        align-items: stretch;
      }
      .replay-speed-group {
        margin-left: 0;
        max-width: 100%;
      }
    }
    .replay-event-log {
      border: 1px solid var(--divider-color, #e0e0e0);
      border-radius: 8px;
      background: var(--card-background-color, #fff);
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .replay-event-log.collapsed {
      padding-bottom: 8px;
    }
    .replay-timeline-toggle,
    .replay-log-toggle {
      align-self: flex-start;
      border: 1px solid var(--divider-color, #ccc);
      border-radius: 999px;
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.03));
      color: var(--primary-text-color);
      padding: 4px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .replay-event-log ul {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 180px;
      overflow: auto;
      overscroll-behavior: contain;
    }
    .replay-event-item {
      display: grid;
      grid-template-columns: auto auto auto minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      font-size: 12px;
      color: var(--secondary-text-color, #666);
      user-select: text;
      cursor: text;
      padding: 2px 0;
    }
    .replay-event-passed {
      color: var(--primary-text-color);
    }
    .replay-event-current {
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.03));
      border-radius: 6px;
      padding: 4px 6px;
      margin: -4px -6px;
    }
    .replay-event-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--divider-color, #ccc);
      flex-shrink: 0;
    }
    .replay-event-time {
      color: var(--secondary-text-color, #666);
      white-space: nowrap;
    }
    .replay-event-entity {
      color: var(--primary-text-color);
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .replay-event-icon {
      display: inline-flex;
      align-items: center;
      color: var(--secondary-text-color, #666);
    }
    .replay-event-icon ha-icon {
      --mdc-icon-size: 16px;
    }
    .replay-event-change {
      color: var(--secondary-text-color, #666);
      white-space: nowrap;
      text-align: right;
    }
    .replay-panel-hidden {
      border: 1px dashed var(--divider-color, #ccc);
      border-radius: 8px;
      background: var(--card-background-color, #fff);
      padding: 8px 10px;
    }
    .replay-toolbar-hidden {
      justify-content: flex-end;
      margin: 0;
    }
    .replay-empty {
      font-size: 12px;
      color: var(--secondary-text-color, #666);
    }
  `;

  @property({ attribute: false }) public events: HistoryEventInput[] = [];
  @property({ type: Number }) public startTime = 0;
  @property({ type: Number }) public endTime = 0;
  @property({ type: Number }) public currentTime = 0;
  @property({ type: Boolean }) public visible = false;
  @property({ type: Boolean }) public enabled = false;
  @property({ type: Boolean }) public ready = false;
  @property({ type: Boolean }) public playing = false;
  @property({ type: Boolean }) public timelineExpanded = false;
  @property({ type: Boolean }) public logExpanded = false;
  @property({ type: Boolean }) public speedExpanded = false;
  @property({ type: String }) public error?: string;
  @property({ type: String }) public rangeWarning?: string;
  @property({ type: String }) public panelId = "replay-panel";
  @property({ type: Number }) public replaySpeed = 1;
  @property({ type: String }) public currentTimeLabel = "—";
  @property({ type: String }) public startInputValue = "";
  @property({ type: String }) public endInputValue = "";

  private _logRef?: HTMLUListElement;

  protected updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if ((changed.has("events") || changed.has("currentTime") || changed.has("logExpanded")) && this._logRef) {
      this._syncLogToCurrentEvent();
    }
  }

  private _dispatch(name: string, detail?: Record<string, unknown>): void {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _getCurrentEvent(): HistoryEventInput | undefined {
    if (!this.events.length) return undefined;
    const target = this.currentTime;
    let lo = 0;
    let hi = this.events.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.events[mid].timestamp <= target) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best >= 0 ? this.events[best] : undefined;
  }

  private _renderEventItem(event: HistoryEventInput, isCurrent: boolean): TemplateResult {
    const passed = event.timestamp <= this.currentTime;
    const color =
      (typeof event.color === "string" ? event.color : undefined)
      ?? (typeof event.attributes?.color === "string" ? event.attributes.color : undefined)
      ?? resolveReplayEventColor(event);
    return html`
      <li class="replay-event-item ${passed ? "replay-event-passed" : ""} ${isCurrent ? "replay-event-current" : ""}" data-timestamp=${event.timestamp}>
        <span class="replay-event-dot" style=${`background:${color}; box-shadow:0 0 0 2px ${color}22;`}></span>
        <span class="replay-event-time">${new Date(event.timestamp * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
        <span class="replay-event-icon"><ha-icon icon="mdi:swap-horizontal"></ha-icon></span>
        <span class="replay-event-entity">${event.entityId}</span>
        <span class="replay-event-change">${event.oldState} → ${event.newState}</span>
      </li>
    `;
  }

  private _syncLogToCurrentEvent(): void {
    if (!this._logRef) return;
    const current = this._logRef.querySelector<HTMLElement>(".replay-event-item.replay-event-current");
    if (!current) return;
    current.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  protected render(): TemplateResult {
    if (!this.visible) {
      return html`
        <div class="replay-panel-toggle">
          <button
            class="replay-show-toggle"
            aria-expanded="false"
            aria-controls=${this.panelId}
            @click=${() => this._dispatch("toggle-visible", { visible: true })}
          >
            Show replay history
          </button>
        </div>
      `;
    }

    const currentEvent = this._getCurrentEvent();
    return html`
      <div class="replay-panel" id=${this.panelId}>
        <button
          class="replay-hide-toggle"
          aria-label="Hide replay panel"
          aria-controls=${this.panelId}
          @click=${() => this._dispatch("toggle-visible", { visible: false })}
        >
          hide
        </button>
        <div class="replay-header">
          <div class="replay-meta">
            <span class="replay-chip">${this.ready ? "Replay ready" : this.enabled ? "Loading replay…" : "Replay paused"}</span>
            <span class="replay-time">${this.currentTimeLabel}</span>
          </div>
          <div class="replay-status">
            ${this.error ? html`<span class="replay-error">${this.error}</span>` : nothing}
            ${this.rangeWarning ? html`<span class="replay-loading">${this.rangeWarning}</span>` : nothing}
            ${!this.ready && this.enabled && !this.error ? html`<span class="replay-loading">Loading history…</span>` : nothing}
          </div>
        </div>
        <div class="replay-range">
          <label class="replay-range-field">
            <span>Start</span>
            <input
              type="datetime-local"
              .value=${this.startInputValue}
              @change=${(ev: Event) => this._dispatch("range-change", { kind: "start", value: (ev.target as HTMLInputElement).value })}
            />
          </label>
          <label class="replay-range-field">
            <span>End</span>
            <input
              type="datetime-local"
              .value=${this.endInputValue}
              @change=${(ev: Event) => this._dispatch("range-change", { kind: "end", value: (ev.target as HTMLInputElement).value })}
            />
          </label>
          <div class="replay-range-tools">
            <button class="replay-icon-button" aria-label="Zoom out range" title="Zoom out range" @click=${() => this._dispatch("zoom", { direction: -1 })}>
              <ha-icon icon="mdi:magnify-minus-outline"></ha-icon>
            </button>
            <button class="replay-icon-button" aria-label="Zoom in range" title="Zoom in range" @click=${() => this._dispatch("zoom", { direction: 1 })}>
              <ha-icon icon="mdi:magnify-plus-outline"></ha-icon>
            </button>
          </div>
        </div>
        <div class="replay-toolbar">
          <div class="replay-transport" role="group" aria-label="Replay transport controls">
            <button title="Toggle replay mode" @click=${() => this._dispatch("toggle-replay")}>${this.enabled ? "Disable" : "Enable"}</button>
            <button class="replay-icon-button" aria-label="Jump back 30 seconds" title="Jump back 30 seconds" @click=${() => this._dispatch("jump", { delta: -30 })}>
              <ha-icon icon="mdi:rewind-30"></ha-icon>
            </button>
            <button class="replay-icon-button" aria-label="Step back one event" title="Step back" @click=${() => this._dispatch("step", { direction: -1 })}>
              <ha-icon icon="mdi:skip-previous"></ha-icon>
            </button>
            <button class="replay-run-button" title=${this.playing ? "Pause replay" : "Run replay"} @click=${() => this._dispatch("play-toggle") }>
              <ha-icon icon=${this.playing ? "mdi:pause" : "mdi:play"}></ha-icon>
              <span>${this.playing ? "Pause" : "Run"}</span>
            </button>
            <button class="replay-icon-button" aria-label="Step forward one event" title="Step forward" @click=${() => this._dispatch("step", { direction: 1 })}>
              <ha-icon icon="mdi:skip-next"></ha-icon>
            </button>
            <button class="replay-icon-button" aria-label="Jump forward 30 seconds" title="Jump forward 30 seconds" @click=${() => this._dispatch("jump", { delta: 30 })}>
              <ha-icon icon="mdi:fast-forward-30"></ha-icon>
            </button>
          </div>
          <div class="replay-toolbar-toggles">
            <button
              class="replay-speed-toggle"
              aria-expanded=${this.speedExpanded}
              @click=${() => this._dispatch("toggle-speed-panel")}
            >
              Speed ${this.replaySpeed.toFixed(2)}x
              <ha-icon icon=${this.speedExpanded ? "mdi:chevron-up" : "mdi:chevron-down"}></ha-icon>
            </button>
          </div>
        </div>
        ${this.speedExpanded
          ? html`<div class="replay-speed-panel">
              <label class="replay-speed-field replay-speed-group">
                <span>Playback speed</span>
                <input
                  class="replay-speed-slider"
                  type="range"
                  min="-2"
                  max="3"
                  step="0.01"
                  .value=${String(Math.log10(this.replaySpeed || 1))}
                  @input=${(ev: Event) => this._dispatch("speed-slider-input", { value: Number((ev.target as HTMLInputElement).value) })}
                />
                <input
                  class="replay-speed"
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  .value=${this.replaySpeed.toString()}
                  @change=${(ev: Event) => this._dispatch("speed-change", { value: Number((ev.target as HTMLInputElement).value || 1) })}
                />
              </label>
            </div>`
          : nothing}
        <div class="replay-lanes">
          <div class="replay-view-tools">
            <button class="replay-timeline-toggle" @click=${() => this._dispatch("toggle-timeline") }>
              ${this.timelineExpanded ? "Collapse lanes" : "Expand lanes"}
            </button>
          </div>
          <div class="replay-timeline-wrap">
            <easy-floorplan-history-timeline
              .events=${this.events}
              .startTime=${this.startTime}
              .endTime=${this.endTime}
              .currentTime=${this.currentTime}
              .expanded=${this.timelineExpanded}
              @seek=${(ev: CustomEvent<{ timestamp: number }>) => this._dispatch("seek", { timestamp: ev.detail.timestamp })}
            ></easy-floorplan-history-timeline>
          </div>
        </div>
        <div class=${`replay-event-log ${this.logExpanded ? "expanded" : "collapsed"}`} role="log" aria-label="Replay event log">
          <button class="replay-log-toggle" @click=${() => this._dispatch("toggle-log") }>
            ${this.logExpanded ? "Hide log" : "Show log"}
          </button>
          ${this.logExpanded
            ? html`<ul
                class="replay-event-list"
                ${((ref: Element | undefined) => {
                  this._logRef = ref instanceof HTMLUListElement ? ref : undefined;
                  if (this._logRef && this.events.length) this._syncLogToCurrentEvent();
                }) as any}
              >${repeat(this.events, (event, index) => `${event.timestamp}-${event.entityId}-${event.newState}-${index}`, (event) => this._renderEventItem(event, currentEvent?.timestamp === event.timestamp))}</ul>`
            : nothing}
          ${!this.logExpanded && !this.events.length ? html`<div class="replay-empty">No history events yet.</div>` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-replay-panel": ReplayPanel;
  }
}
