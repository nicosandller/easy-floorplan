import type { HomeAssistant, FloorplanCardConfig } from "../types";
import { HistoryService, type HistoryEventInput, type HistoryServiceLike } from "./history-service";
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
  uiLastUpdateFrameMs: number;
  loopId?: number;
  lastReplayFrame?: number;
  panelId: string;
}

export interface ReplayCardLike {
  getConfig: () => FloorplanCardConfig | undefined;
  getHass: () => HomeAssistant | undefined;
  getActiveFloorId: () => string | undefined;
  requestUpdate: () => void;
}

export type ReplayController = {
  state: ReplayState;
  getDefaultWindow: () => { start: number; end: number };
  normalizeWindow: (start: number, end: number) => { start: number; end: number };
  watchedEntities: () => string[];
  scopeKey: () => string;
  speedForRange: (start: number, end: number) => number;
  currentTime: () => number;
  isHistoryVisible: () => boolean;
  isReplayShowing: () => boolean;
  syncToConfig: () => void;
  isReplayReady: () => boolean;
  isReplayEnabled: () => boolean;
  getRenderState: () => { enabled: boolean; currentTime: number; historyVisible: boolean };
  clearConfigColorCache: () => void;
  pausePlayback: () => void;
  formatReplayTime: (timestamp: number) => string;
  handleRangeChange: (kind: "start" | "end", ev: Event) => void;
  updateWindow: (start: number, end: number) => void;
  resetForFloorChange: () => void;
  zoomWindow: (direction: -1 | 1) => void;
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
  playReplay: () => void;
  pauseReplay: () => void;
  startReplayLoop: () => void;
  stopReplayLoop: () => void;
  requestUpdate: () => void;
};

let nextReplayPanelId = 0;

export class ReplayControllerImpl implements ReplayController {
  public readonly state: ReplayState;
  private readonly _historyService = new HistoryService();

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
      uiLastUpdateFrameMs: 0,
      loopId: undefined,
      lastReplayFrame: undefined,
      panelId: `fp-replay-panel-${nextReplayPanelId++}`,
    };
  }

  private logReplay(message: string, data?: Record<string, unknown>): void {
    // Opt-in: this is called on seek, so a playhead drag emits one line per
    // frame. Warnings and errors elsewhere in this module stay ungated — those
    // are real failures and should not need a config change to surface.
    if (!this._card.getConfig()?.historyReplay?.debug) return;
    console.log(message, data ?? {});
  }

  public getDefaultWindow(): { start: number; end: number } {
    return getDefaultReplayWindow(this._card.getConfig());
  }

  public normalizeWindow(start: number, end: number): { start: number; end: number } {
    return normalizeReplayWindow(start, end);
  }

  public historyService(): HistoryServiceLike {
    return this._historyService;
  }

  public clearHistoryCache(): void {
    this._historyService.clearCache();
  }

  public syncHistoryServiceContext(): void {
    this._historyService.configure({
      hass: this._card.getHass(),
      watched: this.watchedEntities(),
    });
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

  public currentTime(): number {
    return this.state.playbackController.currentTime;
  }

  public isHistoryVisible(): boolean {
    return this.state.historyVisible;
  }

  public isReplayReady(): boolean {
    return this.state.ready;
  }

  public isReplayEnabled(): boolean {
    return this.state.enabled;
  }

  /**
   * Whether the replay panel is on screen: the config offers it, and it is
   * open. Both halves, because a panel that is not rendered can neither be
   * read nor closed -- so nothing behind it may draw on the plan or keep a
   * clock running.
   */
  public isReplayShowing(): boolean {
    return this._replayOffered() && this.state.historyVisible;
  }

  /** Whether the config puts a replay control on the card at all. */
  private _replayOffered(): boolean {
    return !!this._card.getConfig()?.historyReplay?.enabled;
  }

  /**
   * Bring replay back in line with a config that no longer offers it.
   *
   * Switching `historyReplay.enabled` off takes the panel off screen but not,
   * on its own, the state behind it: the plan went on rendering history with
   * no control left anywhere to leave it. Called from setConfig, so it also
   * covers the ordinary case of a shut panel, where it just makes sure no
   * clock is ticking against a plan nobody is replaying.
   */
  public syncToConfig(): void {
    if (this.isReplayShowing()) return;
    this.state.historyVisible = false;
    this.state.playbackController.pause();
    this.stopReplayLoop();
  }

  /**
   * What the plan should draw from: history at `currentTime`, or the live
   * states Home Assistant is pushing.
   *
   * The panel being open is the whole answer. Closed, replay is not a mode the
   * plan is quietly in -- it is off, whatever the controller has loaded and
   * wherever the head happens to sit, so a plan nobody has asked to rewind is
   * indistinguishable from one with the feature switched off entirely.
   *
   * "Open" means on screen, which takes the config as well as the panel --
   * see {@link isReplayShowing}.
   *
   * Deliberately blunt, because the subtle version kept failing. Replay leaked
   * into a live plan through any path that started it without anyone opening
   * the panel -- switching floors was enough, and that path parked the head at
   * the *start* of the window rather than the end -- and the symptom was
   * silent: every watched entity with a recorded state drew from an hour ago,
   * so lights that were on drew off and a presence sensor that was tripping
   * drew still, while a light toggled from the plan really did switch, because
   * the service call is live either way. Nothing on a closed panel said why
   * (issue #256).
   */
  public getRenderState(): { enabled: boolean; currentTime: number; historyVisible: boolean } {
    return {
      enabled: this.isReplayShowing() && this.state.enabled,
      currentTime: this.state.playbackController.currentTime,
      historyVisible: this.state.historyVisible,
    };
  }

  public clearConfigColorCache(): void {
    this.state.configuredColorCache.clear();
  }

  public pausePlayback(): void {
    this.state.playbackController.pause();
  }

  public formatReplayTime(timestamp: number): string {
    // Seconds, not minutes: at anything near real-time speed a minute-
    // resolution clock sits on the same string for a long stretch of playback
    // and reads as though replay is not running at all.
    return formatReplayTime(timestamp, new Intl.DateTimeFormat(undefined, {
      dateStyle: "short",
      timeStyle: "medium",
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
    this.clearHistoryCache();
    this.state.playbackController.pause();
    this.stopReplayLoop();
    this._card.requestUpdate();
    // Only while the panel is open: `historyReplay.enabled` says the control is
    // offered, not that the plan is in replay, and reloading on a closed panel
    // is a history query nobody asked for and nobody can see.
    if (!this._card.getHass() || !this.state.historyVisible) return;
    void this.startReplay({ preserveCurrentTime: true, keepPlaying: wasPlaying });
  }

  public resetForFloorChange(): void {
    this.state.historyEvents = [];
    this.state.enabled = false;
    this.state.ready = false;
    this.state.error = undefined;
    this.state.loadRequested = false;
    this.state.loadToken += 1;
    this.clearHistoryCache();
    this.stopReplayLoop();
    this._card.requestUpdate();
    // Same rule as updateWindow: a floor switch reloads replay only if replay
    // is what you are looking at. This path is how replay used to turn itself
    // on behind a closed panel -- see getRenderState.
    if (this._card.getHass() && this.state.historyVisible) {
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

  /**
   * Opening and closing the panel is the whole of turning replay on and off.
   *
   * There is no separate enable switch and no button back to now, because
   * those used to be separate questions whose answers could disagree: the plan
   * could be showing an hour ago with nothing on screen saying so. Opening
   * loads the window and parks the head at its start, so replay begins where
   * the calendar says it does; closing stops the clock and hands the plan back
   * to Home Assistant.
   *
   * Closing is not a teardown. The window and its events stay loaded, so
   * reopening on the same range costs no second history fetch -- it just
   * cannot reach the plan while the panel is shut (see {@link getRenderState}).
   */
  public toggleHistoryVisible(visible: boolean): void {
    // Asked to open, and there is something to open: the flag means "the panel
    // is on screen", so a config that draws no panel cannot set it. Committing
    // it first and bailing afterwards left it true with replay switched off --
    // a state where isHistoryVisible and isReplayShowing disagree, and where
    // switching the feature back on would find the panel already open with
    // nothing ever loaded behind it.
    const open = visible && this._replayOffered();
    this.state.historyVisible = open;
    if (!open) {
      this.state.playbackController.pause();
      this.stopReplayLoop();
      this.logReplay("[easy-floorplan] Replay closed, plan is live");
      this._card.requestUpdate();
      return;
    }
    this._card.requestUpdate();
    if (!this._card.getHass()) return;
    void this.startReplay();
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
    this.state.enabled = true;
    this.state.loadRequested = true;
    this.state.error = undefined;
    this.state.ready = false;
    // A fresh start begins at the top of the window the calendar shows, so
    // opening the panel and pressing Run play the range through rather than
    // sitting on its last instant with nowhere left to go.
    const initialTime = options.preserveCurrentTime
      ? Math.min(replayEnd, Math.max(replayStart, this.state.playbackController.currentTime))
      : replayStart;
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
      await this._historyService.loadHistory(start, end, { scopeKey, hass: this._card.getHass(), watched: this.watchedEntities(), numericSteps: this._card.getConfig()?.historyReplay?.numericSteps });
      if (loadToken !== this.state.loadToken) return;
      const watched = new Set(this.watchedEntities());
      const loadedEvents = this._historyService.getEvents();
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
      ? this._historyService.getEventAfter(currentTime + epsilon)
      : this._historyService.getEventBefore(currentTime - epsilon);
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

