import type { HassEntity, HomeAssistant } from "../types";
import { cssColor } from "../css-safe";
import { SKIN_ACCENT, SKIN_ACTIVE, SKIN_INACTIVE } from "../skins";

export interface HistoryEventInput {
  timestamp: number;
  entityId: string;
  oldState: string;
  newState: string;
  attributes?: Record<string, unknown>;
  color?: string;
}

export function resolveReplayEventColor(event: Pick<HistoryEventInput, "entityId" | "newState" | "attributes" | "color">): string | undefined {
  const supplied = typeof event.color === "string" ? cssColor(event.color) : undefined;
  if (supplied) return supplied;

  const rawColor = event.attributes?.color;
  const attributeColor = typeof rawColor === "string" ? cssColor(rawColor) : undefined;
  if (attributeColor) return attributeColor;

  const state = String(event.newState ?? "").trim().toLowerCase();

  if (event.entityId.startsWith("light.")) return state === "off" ? SKIN_INACTIVE : SKIN_ACTIVE;
  if (event.entityId.startsWith("cover.")) return state === "closed" ? SKIN_INACTIVE : SKIN_ACCENT;
  if (event.entityId.startsWith("sensor.")) return state === "off" ? SKIN_INACTIVE : SKIN_ACCENT;
  if (event.entityId.startsWith("binary_sensor.")) return state === "off" ? SKIN_INACTIVE : SKIN_ACCENT;
  if (event.entityId.startsWith("fan.")) return state === "off" ? SKIN_INACTIVE : SKIN_ACTIVE;
  if (event.entityId.startsWith("media_player.")) return state === "idle" ? SKIN_INACTIVE : SKIN_ACTIVE;
  if (state === "on" || state === "open" || state === "playing" || state === "home" || state === "locked" || state === "unlocked") {
    return SKIN_ACCENT;
  }
  return SKIN_INACTIVE;
}

export interface HistoryServiceLike {
  loadHistory: (start: number, end: number, options?: HistoryLoadOptions) => Promise<void>;
  loadFromHass: (hass: HomeAssistant, start: number, end: number, watched: string[]) => Promise<HistoryEventInput[]>;
  clearCache: () => void;
  getEvents: () => HistoryEventInput[];
  getEventAfter: (timestamp: number) => HistoryEventInput | undefined;
  getEventBefore: (timestamp: number) => HistoryEventInput | undefined;
  getStateAt: (timestamp: number) => Map<string, HassEntity>;
}

export interface HistoryServiceOptions {
  loader?: (start: number, end: number, context?: HistoryLoadOptions) => Promise<HistoryEventInput[]>;
}

export interface HistoryLoadOptions {
  /**
   * Additional cache scope (for example, watched entity ids).
   * Keeps replay windows with different filters from sharing stale results.
   */
  scopeKey?: string;
  /**
   * When present, the service can fetch and normalize HA history directly rather
   * than delegating to a host card loader.
   */
  hass?: HomeAssistant;
  /**
   * Floor-scoped entity ids the history request is allowed to touch.
   */
  watched?: string[];
}

export class HistoryService implements HistoryServiceLike {
  private readonly _loader: (start: number, end: number, context?: HistoryLoadOptions) => Promise<HistoryEventInput[]>;
  private _context?: Pick<HistoryLoadOptions, "hass" | "watched">;
  private readonly _cache = new Map<string, HistoryEventInput[]>();
  private _events: HistoryEventInput[] = [];
  private _eventsByEntity = new Map<string, HistoryEventInput[]>();
  private readonly _maxCacheEntries = 8;
  private _loadCommitId = 0;

  constructor(options: HistoryServiceOptions = {}) {
    this._loader = options.loader ?? (async () => []);
  }

  public configure(context: Pick<HistoryLoadOptions, "hass" | "watched"> = {}): void {
    this._context = context;
  }

  public async loadHistory(start: number, end: number, options: HistoryLoadOptions = {}): Promise<void> {
    const loadId = ++this._loadCommitId;
    const scope = options.scopeKey ?? "all";
    const key = `${start}:${end}:${scope}`;
    if (this._cache.has(key)) {
      if (loadId === this._loadCommitId) {
        const cachedEvents = this._cache.get(key)!;
        this._events = cachedEvents;
        this._eventsByEntity = this._groupEventsByEntity(cachedEvents);
      }
      return;
    }

    const hass = options.hass ?? this._context?.hass;
    const watched = options.watched ?? this._context?.watched;
    const events = hass && Array.isArray(watched)
      ? await this._loadFromHass(hass, start, end, watched)
      : await this._loader(start, end, { ...this._context, ...options, hass, watched });
    const normalized = events
      .slice()
      .sort((a, b) => a.timestamp - b.timestamp)
      .map((event) => ({
        ...event,
        attributes: event.attributes ?? {},
      }));

    if (loadId !== this._loadCommitId) return;
    this._cache.set(key, normalized);
    if (this._cache.size > this._maxCacheEntries) {
      const oldestKey = this._cache.keys().next().value as string | undefined;
      if (oldestKey) this._cache.delete(oldestKey);
    }
    this._events = normalized;
    this._eventsByEntity = this._groupEventsByEntity(normalized);
  }

  public async loadFromHass(hass: HomeAssistant, start: number, end: number, watched: string[]): Promise<HistoryEventInput[]> {
    return this._loadFromHass(hass, start, end, watched);
  }

  private async _loadFromHass(hass: HomeAssistant, start: number, end: number, watched: string[]): Promise<HistoryEventInput[]> {
    if (!watched.length) return [];
    const ws = (hass as HomeAssistant & { callWS?: (msg: Record<string, unknown>) => Promise<unknown> }).callWS;
    const api = (hass as HomeAssistant & {
      callApi?: (method: string, path: string, parameters?: Record<string, unknown>) => Promise<unknown>
    }).callApi;
    const startTime = new Date(start * 1000).toISOString();
    const endTime = new Date(end * 1000).toISOString();
    const watchedSet = new Set(watched);
    const request = {
      type: "history/history_during_period",
      start_time: startTime,
      end_time: endTime,
      minimal_response: false,
      no_attributes: false,
      significant_changes_only: false,
      entity_ids: watched,
    };

    let history: unknown;
    if (typeof ws === "function") {
      try {
        history = await ws(request);
      } catch (error) {
        console.warn("[easy-floorplan] Replay WS history query failed", { startTime, endTime, watchedCount: watched.length, error });
      }
    }

    if (!history && typeof api === "function") {
      try {
        history = await api("GET", `history/period/${encodeURIComponent(startTime)}`, {
          end_time: endTime,
          filter_entity_id: watched.join(","),
          minimal_response: false,
          no_attributes: false,
          significant_changes_only: false,
        });
      } catch (error) {
        console.warn("[easy-floorplan] Replay REST history query failed", { startTime, endTime, watchedCount: watched.length, error });
      }
    }

    if (!history) {
      throw new Error(`Unable to load history via websocket or REST API (ws:${typeof ws === "function" ? "yes" : "no"}, api:${typeof api === "function" ? "yes" : "no"}).`);
    }

    return this._normalizeHistoryPayload(history, start, end, watchedSet);
  }

  private _normalizeHistoryPayload(history: unknown, start: number, end: number, watchedSet: Set<string>): HistoryEventInput[] {
    type HistoryStateRow = {
      state?: string;
      attributes?: Record<string, unknown>;
      last_updated?: string | number;
      last_changed?: string | number;
    };

    const buckets = new Map<string, HistoryStateRow[]>();
    const parseHistoryTimestamp = (value: string | number | undefined, fallbackIsoTime: string): number => {
      if (typeof value === "number") {
        if (!Number.isFinite(value)) return Number.NaN;
        return value > 1_000_000_000_000 ? value / 1000 : value;
      }
      if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) return numeric > 1_000_000_000_000 ? numeric / 1000 : numeric;
        const parsed = Date.parse(value) / 1000;
        return Number.isFinite(parsed) ? parsed : Number.NaN;
      }
      return Date.parse(fallbackIsoTime) / 1000;
    };

    const pickValue = (row: Record<string, unknown>, keys: string[]): unknown => {
      for (const key of keys) {
        const value = row[key];
        if (value !== undefined) return value;
      }
      return undefined;
    };

    const pushStateRows = (entityId: string, entityRows: unknown[]) => {
      const rows = entityRows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
      if (!rows.length) return;
      buckets.set(entityId, rows.map((row) => {
        const state = pickValue(row, ["state", "s"]);
        const attributes = pickValue(row, ["attributes", "a"]);
        const lastUpdated = pickValue(row, ["last_updated", "lu"]);
        const lastChanged = pickValue(row, ["last_changed", "lc"]);
        return {
          state: typeof state === "string" || typeof state === "number" || typeof state === "boolean" ? String(state) : undefined,
          attributes: attributes && typeof attributes === "object" ? (attributes as Record<string, unknown>) : undefined,
          last_updated: typeof lastUpdated === "string" || typeof lastUpdated === "number" ? lastUpdated : undefined,
          last_changed: typeof lastChanged === "string" || typeof lastChanged === "number" ? lastChanged : undefined,
        };
      }));
    };

    if (Array.isArray(history)) {
      for (const entry of history) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const entityId = typeof record.entity_id === "string" ? record.entity_id : undefined;
        const states = Array.isArray(record.states) ? record.states : Array.isArray(record.history) ? record.history : [];
        if (entityId && states.length) {
          pushStateRows(entityId, states);
        }
      }
    } else if (history && typeof history === "object") {
      for (const [entityId, entityRows] of Object.entries(history as Record<string, unknown>)) {
        if (Array.isArray(entityRows) && entityRows.length) {
          pushStateRows(entityId, entityRows);
          continue;
        }
        if (entityRows && typeof entityRows === "object") {
          const nested = entityRows as Record<string, unknown>;
          if (Array.isArray(nested.states) && nested.states.length) {
            pushStateRows(entityId, nested.states);
          }
        }
      }
    }

    if (!buckets.size) {
      throw new Error("History payload contained no parseable state rows.");
    }

    const normalized: HistoryEventInput[] = [];
    const fallbackIsoTime = new Date(end * 1000).toISOString();

    for (const [entityId, states] of buckets.entries()) {
      if (!states.length) {
        continue;
      }
      if (!watchedSet.has(entityId)) {
        continue;
      }

      if (states.length === 1) {
        const only = states[0];
        const ts = parseHistoryTimestamp(only.last_updated ?? only.last_changed, fallbackIsoTime);
        if (!Number.isFinite(ts)) {
          continue;
        }
        if (ts < start || ts > end) {
          continue;
        }
        normalized.push({
          timestamp: ts,
          entityId,
          oldState: only.state ?? "unknown",
          newState: only.state ?? "unknown",
          attributes: only.attributes ?? {},
        });
        continue;
      }

      for (let index = 1; index < states.length; index += 1) {
        const prev = states[index - 1];
        const next = states[index];
        const prevTs = parseHistoryTimestamp(prev.last_updated ?? prev.last_changed, fallbackIsoTime);
        const nextTs = parseHistoryTimestamp(next.last_updated ?? next.last_changed, fallbackIsoTime);
        if (!Number.isFinite(prevTs) || !Number.isFinite(nextTs)) {
          continue;
        }
        if (nextTs < start || prevTs > end) {
          continue;
        }
        const stateChanged = prev.state !== next.state;
        const attrsChanged = !this._attributesEqual(prev.attributes ?? {}, next.attributes ?? {});
        if (!stateChanged && !attrsChanged) {
          continue;
        }
        normalized.push({
          timestamp: nextTs,
          entityId,
          oldState: prev.state ?? "unknown",
          newState: next.state ?? "unknown",
          attributes: {
            ...(prev.attributes ?? {}),
            ...(next.attributes ?? {}),
          },
        });
      }
    }

    const finalEvents = normalized.sort((a, b) => a.timestamp - b.timestamp);
    return finalEvents;
  }

  private _attributesEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (!a || !b) return !a && !b;
    if (typeof a !== typeof b) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index += 1) {
        if (!this._attributesEqual(a[index], b[index])) return false;
      }
      return true;
    }
    if (typeof a !== "object") return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!(key in bObj)) return false;
      if (!this._attributesEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  public clearCache(): void {
    this._loadCommitId += 1;
    this._cache.clear();
    this._events = [];
    this._eventsByEntity.clear();
  }

  public getStateAt(timestamp: number): Map<string, HassEntity> {
    const states = new Map<string, HassEntity>();

    for (const [entityId, events] of this._eventsByEntity.entries()) {
      const lastEventBeforeTimestamp = this._findLastEventAtOrBefore(events, timestamp);
      if (lastEventBeforeTimestamp) {
        states.set(entityId, this._toHassEntity(entityId, lastEventBeforeTimestamp.newState, lastEventBeforeTimestamp.attributes, lastEventBeforeTimestamp.timestamp));
        continue;
      }

      const firstEvent = events[0];
      if (firstEvent) {
        states.set(entityId, this._toHassEntity(entityId, firstEvent.oldState, firstEvent.attributes, 0));
      }
    }

    return states;
  }

  private _groupEventsByEntity(events: HistoryEventInput[]): Map<string, HistoryEventInput[]> {
    const grouped = new Map<string, HistoryEventInput[]>();
    for (const event of events) {
      const entityEvents = grouped.get(event.entityId) ?? [];
      entityEvents.push(event);
      grouped.set(event.entityId, entityEvents);
    }

    for (const entityEvents of grouped.values()) {
      entityEvents.sort((a, b) => a.timestamp - b.timestamp);
    }

    return grouped;
  }

  private _findLastEventAtOrBefore(events: HistoryEventInput[], timestamp: number): HistoryEventInput | undefined {
    let lo = 0;
    let hi = events.length - 1;
    let best: HistoryEventInput | undefined;

    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const event = events[mid];
      if (event.timestamp <= timestamp) {
        best = event;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }

    return best;
  }

  private _toHassEntity(
    entityId: string,
    state: string,
    attributes: Record<string, unknown> | undefined,
    timestamp: number,
  ): HassEntity {
    const safeTimestamp = Number.isFinite(timestamp) ? timestamp : Date.now() / 1000;
    return {
      entity_id: entityId,
      state,
      attributes: attributes ?? {},
      last_changed: new Date(safeTimestamp * 1000).toISOString(),
      last_updated: new Date(safeTimestamp * 1000).toISOString(),
      context: { id: "history", parent_id: null, user_id: null },
    } as HassEntity;
  }

  public getEvents(): HistoryEventInput[] {
    return this._events.slice();
  }

  public getEventBefore(timestamp: number): HistoryEventInput | undefined {
    if (!this._events.length) return undefined;
    let lo = 0;
    let hi = this._events.length - 1;
    let best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._events[mid].timestamp <= timestamp) {
        best = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return best >= 0 ? this._events[best] : undefined;
  }

  public getEventAfter(timestamp: number): HistoryEventInput | undefined {
    if (!this._events.length) return undefined;
    let lo = 0;
    let hi = this._events.length - 1;
    let best = this._events.length;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this._events[mid].timestamp >= timestamp) {
        best = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    return best < this._events.length ? this._events[best] : undefined;
  }
}
