import type { HomeAssistant, HassEntity } from "../types";
import { type HistoryServiceLike } from "./history-service";

export interface StateProvider {
  getEntityState(entityId: string): HassEntity | undefined;
}

export class LiveStateProvider implements StateProvider {
  constructor(private readonly _hass: HomeAssistant) {}

  public getEntityState(entityId: string): HassEntity | undefined {
    return this._hass.states[entityId];
  }
}

export class HistoryStateProvider implements StateProvider {
  private readonly _historicalStates: Map<string, HassEntity>;

  constructor(
    private readonly _historyService: HistoryServiceLike,
    private readonly _fallback: StateProvider,
    private readonly _timestamp: number,
  ) {
    this._historicalStates = this._historyService.getStateAt(this._timestamp);
  }

  public getEntityState(entityId: string): HassEntity | undefined {
    const historical = this._historicalStates.get(entityId);
    if (historical) return historical;

    const fallback = this._fallback.getEntityState(entityId);
    return fallback ? { ...fallback, attributes: { ...(fallback.attributes ?? {}) } } : undefined;
  }
}
