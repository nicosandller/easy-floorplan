import type { HassEntity } from "./types";

export interface HistoryEventInput {
  timestamp: number;
  entityId: string;
  oldState: string;
  newState: string;
  attributes?: Record<string, unknown>;
  color?: string;
}

export function resolveReplayEventColor(event: Pick<HistoryEventInput, "entityId" | "newState" | "attributes" | "color">): string | undefined {
  if (typeof event.color === "string" && event.color.trim()) return event.color;
  const rawColor = event.attributes?.color;
  if (typeof rawColor === "string" && rawColor.trim()) return rawColor;

  const state = String(event.newState ?? "").trim().toLowerCase();
  if (event.entityId.startsWith("light.")) return state === "off" ? "#ffffff" : "#f4b400";
  if (event.entityId.startsWith("cover.")) return state === "closed" ? "#ffffff" : "#7b1fa2";
  if (event.entityId.startsWith("sensor.")) return state === "off" ? "#ffffff" : "#1976d2";
  if (event.entityId.startsWith("binary_sensor.")) return state === "off" ? "#ffffff" : "#e53935";
  if (event.entityId.startsWith("fan.")) return state === "off" ? "#ffffff" : "#00897b";
  if (event.entityId.startsWith("media_player.")) return state === "idle" ? "#ffffff" : "#6d4c41";
  if (state === "on" || state === "open" || state === "playing" || state === "home" || state === "locked" || state === "unlocked") {
    return "#03a9f4";
  }
  return "#ffffff";
}

export interface HistoryServiceOptions {
  loader?: (start: number, end: number) => Promise<HistoryEventInput[]>;
}

export class HistoryService {
  private readonly _loader: (start: number, end: number) => Promise<HistoryEventInput[]>;
  private readonly _cache = new Map<string, HistoryEventInput[]>();
  private _events: HistoryEventInput[] = [];

  constructor(options: HistoryServiceOptions = {}) {
    this._loader = options.loader ?? (async () => []);
  }

  public async loadHistory(start: number, end: number): Promise<void> {
    const key = `${start}:${end}`;
    if (this._cache.has(key)) {
      this._events = this._cache.get(key)!;
      return;
    }

    const events = await this._loader(start, end);
    const normalized = events
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((event) => ({
        ...event,
        attributes: event.attributes ?? {},
      }));

    this._cache.set(key, normalized);
    this._events = normalized;
  }

  public getStateAt(timestamp: number): Map<string, HassEntity> {
    const initialStates = new Map<string, string>();
    const states = new Map<string, HassEntity>();

    for (const event of this._events) {
      if (!initialStates.has(event.entityId)) {
        initialStates.set(event.entityId, event.oldState);
      }
      if (event.timestamp > timestamp) break;
      states.set(event.entityId, this._toHassEntity(event.entityId, event.newState, event.attributes, event.timestamp));
    }

    for (const [entityId, stateValue] of initialStates.entries()) {
      if (!states.has(entityId)) {
        states.set(entityId, this._toHassEntity(entityId, stateValue, {}, 0));
      }
    }

    return states;
  }

  private _toHassEntity(
    entityId: string,
    state: string,
    attributes: Record<string, unknown> | undefined,
    timestamp: number,
  ): HassEntity {
    return {
      entity_id: entityId,
      state,
      attributes: attributes ?? {},
      last_changed: new Date(timestamp || Date.now()).toISOString(),
      last_updated: new Date(timestamp || Date.now()).toISOString(),
      context: { id: "history", parent_id: null, user_id: null },
    } as HassEntity;
  }

  public getEvents(): HistoryEventInput[] {
    return this._events.slice();
  }

  public getEventBefore(timestamp: number): HistoryEventInput | undefined {
    let best: HistoryEventInput | undefined;
    for (const event of this._events) {
      if (event.timestamp > timestamp) break;
      best = event;
    }
    return best;
  }

  public getEventAfter(timestamp: number): HistoryEventInput | undefined {
    return this._events.find((event) => event.timestamp >= timestamp);
  }
}
