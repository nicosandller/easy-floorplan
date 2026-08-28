export interface PlaybackControllerOptions {
  startTime?: number;
  endTime?: number;
  initialSpeed?: number;
}

export class PlaybackController {
  private static readonly _MIN_SPEED = 0.01;
  private static readonly _MAX_SPEED = 1000;

  public currentTime: number;
  public speed: number;
  public playing = false;
  private readonly _startTime: number;
  private readonly _endTime: number;

  public get startTime(): number {
    return this._startTime;
  }

  public get endTime(): number {
    return this._endTime;
  }

  constructor(options: PlaybackControllerOptions = {}) {
    this._startTime = options.startTime ?? 0;
    this._endTime = options.endTime ?? Number.MAX_SAFE_INTEGER;
    this.currentTime = this._startTime;
    this.speed = this._normalizeSpeed(options.initialSpeed ?? 1);
  }

  private _normalizeSpeed(value: number): number {
    if (!Number.isFinite(value)) {
      return Number.isNaN(value) ? 1 : PlaybackController._MAX_SPEED;
    }
    return Math.min(PlaybackController._MAX_SPEED, Math.max(PlaybackController._MIN_SPEED, value));
  }

  public play(): void {
    this.playing = true;
  }

  public pause(): void {
    this.playing = false;
  }

  public seek(timestamp: number): void {
    this.currentTime = this._clamp(timestamp);
  }

  public rewind(seconds: number): void {
    this.seek(this.currentTime - seconds);
  }

  public fastForward(seconds: number): void {
    this.seek(this.currentTime + seconds);
  }

  public setPlaybackSpeed(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.speed = Math.min(PlaybackController._MAX_SPEED, Math.max(PlaybackController._MIN_SPEED, speed));
  }

  public tick(deltaMs: number): void {
    if (!this.playing) return;
    const deltaSeconds = deltaMs / 1000;
    this.currentTime = this._clamp(this.currentTime + deltaSeconds * this.speed);
  }

  private _clamp(value: number): number {
    return Math.min(this._endTime, Math.max(this._startTime, value));
  }
}
