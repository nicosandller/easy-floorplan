import type { HomeAssistant, FloorplanCardConfig } from "../types";
import type { HistoryEventInput, HistoryServiceLike } from "./history-service";
import { PlaybackController } from "./playback-controller";
import {
  formatReplayTime,
  getDefaultReplayWindow,
  getReplayEventColor,
  getReplayScopeKey,
  getReplaySpeedForRange,
  getReplayWatchedEntities,
  normalizeReplayWindow,
  parseReplayInputValue,
} from "./replay-utils";

export interface ReplayState {
  playbackController: PlaybackController;
  configured: boolean;
  enabled: boolean;
  ready: boolean;
  error?: string;
  historyEvents: HistoryEventInput[];
  configuredColorCache: Map<string, string | undefined>;
  loadRequested: boolean;
  startTime: number;
  endTime: number;
  logExpanded: boolean;
  timelineExpanded: boolean;
  speedExpanded: boolean;
  historyVisible: boolean;
  rangeWarning?: string;
  loadToken: number;
  manuallyDisabled: boolean;
  uiLastUpdateFrameMs: number;
  loopId?: number;
  lastReplayFrame?: number;
  panelId: string;
}

export interface ReplayCardLike {
  getConfig: () => FloorplanCardConfig | undefined;
  getHass: () => HomeAssistant | undefined;
  getActiveFloorId: () => string | undefined;
  getHistoryService: () => HistoryServiceLike;
  requestUpdate: () => void;
}

export type ReplayController = {
  state: ReplayState;
  getDefaultWindow: () => { start: number; end: number };
  normalizeWindow: (start: number, end: number) => { start: number; end: number };
  watchedEntities: () => string[];
  scopeKey: () => string;
  speedForRange: (start: number, end: number) => number;
  formatReplayTime: (timestamp: number) => string;
  handleRangeChange: (kind: "start" | "end", ev: Event) => void;
  updateWindow: (start: number, end: number) => void;
  resetForFloorChange: () => void;
  zoomWindow: (direction: -1 | 1) => void;
  ensureStarted: () => void;
  toggleReplay: () => Promise<void>;
  toggleHistoryVisible: (visible: boolean) => void;
  toggleSpeedPanel: () => void;
  toggleTimeline: () => void;
  toggleLog: () => void;
  startReplay: (options?: { preserveCurrentTime?: boolean; keepPlaying?: boolean }) => Promise<void>;
  loadReplayRange: (start: number, end: number, loadToken: number) => Promise<void>;
  seekReplay: (timestamp: number) => void;
  jumpReplay: (seconds: number) => void;
  stepReplay: (direction: 1 | -1) => void;
  setReplaySpeed: (speed: number) => void;
  replaySpeedToSliderValue: (speed: number) => number;
  sliderValueToReplaySpeed: (value: number) => number;
  formatReplaySpeed: (speed: number) => string;
  playReplay: () => void;
  pauseReplay: () => void;
  startReplayLoop: () => void;
  stopReplayLoop: () => void;
  requestUpdate: () => void;
};

let nextReplayPanelId = 0;

export class ReplayControllerImpl implements ReplayController {
  public readonly state: ReplayState;

  constructor(private readonly _card: ReplayCardLike) {
    this.state = {
      playbackController: new PlaybackController(),
      configured: false,
      enabled: false,
      ready: false,
      error: undefined,
      historyEvents: [],
      configuredColorCache: new Map(),
      loadRequested: false,
      startTime: 0,
      endTime: 0,
      logExpanded: false,
      timelineExpanded: false,
      speedExpanded: false,
      historyVisible: false,
      rangeWarning: undefined,
      loadToken: 0,
      manuallyDisabled: false,
      uiLastUpdateFrameMs: 0,
      loopId: undefined,
      lastReplayFrame: undefined,
      panelId: `fp-replay-panel-${nextReplayPanelId++}`,
    };
  }

  private logReplay(message: string, data?: Record<string, unknown>): void {
    console.log(message, data ?? {});
  }

  public getDefaultWindow(): { start: number; end: number } {
    return getDefaultReplayWindow(this._card.getConfig());
  }

  public normalizeWindow(start: number, end: number): { start: number; end: number } {
    return normalizeReplayWindow(start, end);
  }

  public watchedEntities(): string[] {
    return getReplayWatchedEntities(this._card.getConfig(), this._card.getActiveFloorId());
  }

  public scopeKey(): string {
    return getReplayScopeKey(this._card.getConfig(), this._card.getActiveFloorId());
  }

  public speedForRange(start: number, end: number): number {
    return getReplaySpeedForRange(this._card.getConfig(), start, end);
  }

  public formatReplayTime(timestamp: number): string {
    return formatReplayTime(timestamp, new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    }));
  }

  public handleRangeChange(kind: "start" | "end", ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const timestamp = parseReplayInputValue(input.value);
    if (kind === "start") this.state.startTime = timestamp;
    else this.state.endTime = timestamp;
    this.updateWindow(this.state.startTime, this.state.endTime);
  }

  public updateWindow(start: number, end: number): void {
    const { start: replayStart, end: replayEnd } = normalizeReplayWindow(start, end);
    const span = replayEnd - replayStart;
    this.state.rangeWarning = span < 60 ? "Very small replay window may hide expected transitions." : undefined;
    const wasPlaying = this.state.playbackController.playing;
    this.state.startTime = replayStart;
    this.state.endTime = replayEnd;
    this._card.getHistoryService().clearCache();
    this.state.playbackController.pause();
    this.stopReplayLoop();
    this._card.requestUpdate();
    if (!this._card.getHass() || !this._card.getConfig()?.historyReplay?.enabled) return;
    void this.startReplay({ preserveCurrentTime: true, keepPlaying: wasPlaying });
  }

  public resetForFloorChange(): void {
    this.state.historyEvents = [];
    this.state.enabled = false;
    this.state.ready = false;
    this.state.error = undefined;
    this.state.loadRequested = false;
    this.state.loadToken += 1;
    this._card.getHistoryService().clearCache();
    this.stopReplayLoop();
    this._card.requestUpdate();
    if (this._card.getHass() && this._card.getConfig()?.historyReplay?.enabled) {
      void this.startReplay({ preserveCurrentTime: true, keepPlaying: this.state.playbackController.playing });
    }
  }

  public zoomWindow(direction: -1 | 1): void {
    const span = Math.max(60, this.state.endTime - this.state.startTime);
    const anchor = this.state.playbackController.currentTime;
    const nextSpan = direction > 0 ? Math.max(60, span * 0.8) : span * 1.25;
    const halfSpan = nextSpan / 2;
    const nextStart = Math.max(0, anchor - halfSpan);
    const nextEnd = nextStart + nextSpan;
    this.updateWindow(nextStart, nextEnd);
  }

  public ensureStarted(): void {
    if (!this._card.getHass() || !this._card.getConfig()?.historyReplay?.enabled || this.state.loadRequested || this.state.enabled || this.state.manuallyDisabled) {
      return;
    }
    void this.startReplay();
  }

  public async toggleReplay(): Promise<void> {
    if (!this._card.getHass() || !this._card.getConfig()?.historyReplay) return;
    if (!this.state.enabled) {
      this.state.manuallyDisabled = false;
      await this.startReplay();
      return;
    }
    this.state.enabled = false;
    this.state.manuallyDisabled = true;
    this.state.loadToken += 1;
    this.state.ready = false;
    this.state.loadRequested = false;
    this.state.error = undefined;
    this.state.historyEvents = [];
    this.state.playbackController.pause();
    this.stopReplayLoop();
    this._card.requestUpdate();
  }

  public toggleHistoryVisible(visible: boolean): void {
    this.state.historyVisible = visible;
    this._card.requestUpdate();
  }

  public toggleSpeedPanel(): void {
    this.state.speedExpanded = !this.state.speedExpanded;
    this._card.requestUpdate();
  }

  public toggleTimeline(): void {
    this.state.timelineExpanded = !this.state.timelineExpanded;
    this._card.requestUpdate();
  }

  public toggleLog(): void {
    this.state.logExpanded = !this.state.logExpanded;
    this._card.requestUpdate();
  }

  public async startReplay(options: { preserveCurrentTime?: boolean; keepPlaying?: boolean } = {}): Promise<void> {
    if (!this._card.getHass() || !this._card.getConfig()?.historyReplay) return;
    const start = this.state.startTime || this.getDefaultWindow().start;
    const end = this.state.endTime || this.getDefaultWindow().end;
    const { start: replayStart, end: replayEnd } = this.normalizeWindow(start, end);
    this.state.startTime = replayStart;
    this.state.endTime = replayEnd;
    this.state.manuallyDisabled = false;
    this.state.enabled = true;
    this.state.loadRequested = true;
    this.state.error = undefined;
    this.state.ready = false;
    const initialTime = options.preserveCurrentTime
      ? Math.min(replayEnd, Math.max(replayStart, this.state.playbackController.currentTime))
      : replayEnd;
    this.state.playbackController = new PlaybackController({
      startTime: replayStart,
      endTime: replayEnd,
      initialSpeed: this.speedForRange(replayStart, replayEnd),
    });
    this.state.playbackController.seek(initialTime);
    if (options.keepPlaying) this.state.playbackController.play();
    const loadToken = ++this.state.loadToken;
    this.logReplay("[easy-floorplan] Starting replay", { start: replayStart, end: replayEnd, lookback: replayEnd - replayStart });
    await this.loadReplayRange(replayStart, replayEnd, loadToken);
    if (options.keepPlaying && this.state.enabled && this.state.playbackController.playing) {
      this.startReplayLoop();
    }
    this._card.requestUpdate();
  }

  public async loadReplayRange(start: number, end: number, loadToken: number): Promise<void> {
    try {
      const scopeKey = this.scopeKey();
      await this._card.getHistoryService().loadHistory(start, end, { scopeKey, hass: this._card.getHass(), watched: this.watchedEntities() });
      if (loadToken !== this.state.loadToken) return;
      const watched = new Set(this.watchedEntities());
      const loadedEvents = this._card.getHistoryService().getEvents();
      this.state.historyEvents = loadedEvents.filter((event) => watched.has(event.entityId)).map((event) => ({
        ...event,
        color: getReplayEventColor(event, this._card.getConfig(), this._card.getHass(), this.state.configuredColorCache, this.state.configured),
      }));
      this.state.ready = true;
      this.state.loadRequested = false;
      this.state.error = undefined;
      this.logReplay("[easy-floorplan] Replay history loaded", { eventCount: this.state.historyEvents.length });
      this._card.requestUpdate();
    } catch (error) {
      if (loadToken !== this.state.loadToken) return;
      this.state.ready = false;
      this.state.loadRequested = false;
      this.state.error = error instanceof Error ? error.message : "Unable to load history.";
      console.error("[easy-floorplan] Replay history loading failed", error);
    }
  }

  public seekReplay(timestamp: number): void {
    this.state.playbackController.seek(timestamp);
    this.logReplay("[easy-floorplan] Replay seek", { timestamp });
    this._card.requestUpdate();
  }

  public jumpReplay(seconds: number): void {
    this.state.playbackController.seek(this.state.playbackController.currentTime + seconds);
    this.logReplay("[easy-floorplan] Replay jump", { seconds });
    this._card.requestUpdate();
  }

  public stepReplay(direction: 1 | -1): void {
    if (!this.state.historyEvents.length) return;
    const currentTime = this.state.playbackController.currentTime;
    const epsilon = 0.0001;
    const candidate = direction > 0
      ? this._card.getHistoryService().getEventAfter(currentTime + epsilon)
      : this._card.getHistoryService().getEventBefore(currentTime - epsilon);
    if (candidate) {
      this.state.playbackController.seek(candidate.timestamp);
    } else {
      this.state.playbackController.seek(direction > 0 ? this.state.playbackController.endTime : this.state.playbackController.startTime);
    }
    this._card.requestUpdate();
  }

  public setReplaySpeed(speed: number): void {
    this.state.playbackController.setPlaybackSpeed(speed);
    this.logReplay("[easy-floorplan] Replay speed", { speed });
    this._card.requestUpdate();
  }

  public playReplay(): void {
    if (!this.state.enabled) {
      void this.startReplay({ preserveCurrentTime: true, keepPlaying: true });
      return;
    }
    if (!this.state.ready) {
      const replayStart = this.state.startTime || this.state.playbackController.startTime;
      const replayEnd = this.state.endTime || this.state.playbackController.endTime;
      void this.loadReplayRange(replayStart, replayEnd, ++this.state.loadToken);
    }
    if (this.state.playbackController.currentTime >= this.state.playbackController.endTime) {
      this.state.playbackController.seek(this.state.playbackController.startTime);
    }
    this.state.playbackController.play();
    this.startReplayLoop();
    this.logReplay("[easy-floorplan] Replay play", { currentTime: this.state.playbackController.currentTime });
    this._card.requestUpdate();
  }

  public pauseReplay(): void {
    this.state.playbackController.pause();
    this.stopReplayLoop();
    this.logReplay("[easy-floorplan] Replay pause", { currentTime: this.state.playbackController.currentTime });
    this._card.requestUpdate();
  }

  public startReplayLoop(): void {
    if (this.state.loopId) return;
    this.state.lastReplayFrame = undefined;
    this.state.uiLastUpdateFrameMs = 0;
    const tick = (timestamp: number): void => {
      if (this.state.playbackController.playing) {
        if (this.state.lastReplayFrame === undefined) {
          this.state.lastReplayFrame = timestamp;
        } else {
          this.state.playbackController.tick(timestamp - this.state.lastReplayFrame);
          this.state.lastReplayFrame = timestamp;
          if (this.state.uiLastUpdateFrameMs === 0 || timestamp - this.state.uiLastUpdateFrameMs >= 50) {
            this.state.uiLastUpdateFrameMs = timestamp;
            this._card.requestUpdate();
          }
        }
        if (this.state.playbackController.currentTime >= this.state.playbackController.endTime) {
          this.pauseReplay();
          return;
        }
      }
      this.state.loopId = window.requestAnimationFrame(tick);
    };
    this.state.loopId = window.requestAnimationFrame(tick);
  }

  public stopReplayLoop(): void {
    if (this.state.loopId) {
      window.cancelAnimationFrame(this.state.loopId);
      this.state.loopId = undefined;
    }
    this.state.lastReplayFrame = undefined;
  }

  public requestUpdate(): void {
    this._card.requestUpdate();
  }
}

