import type { HomeAssistant, HassEntity } from "./types";
import { HistoryService } from "./history-service";

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
  constructor(
    private readonly _historyService: HistoryService,
    private readonly _fallback: StateProvider,
    private readonly _timestamp: number,
  ) {}

  public getEntityState(entityId: string): HassEntity | undefined {
    const historical = this._historyService.getStateAt(this._timestamp).get(entityId);
    return historical ?? this._fallback.getEntityState(entityId);
  }
}
