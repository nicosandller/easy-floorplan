import type { HomeAssistant, HassEntity, RenderHass } from "../types";
import { HistoryStateProvider, LiveStateProvider, type StateProvider } from "./state-provider";
import type { HistoryServiceLike } from "./history-service";

export function createStateProvider(
  hass: HomeAssistant | undefined,
  historyService: HistoryServiceLike,
  replayEnabled: boolean,
  playbackTime: number,
): StateProvider {
  if (!hass) {
    return { getEntityState: () => undefined };
  }
  if (replayEnabled) {
    return new HistoryStateProvider(historyService, new LiveStateProvider(hass), playbackTime);
  }
  return new LiveStateProvider(hass);
}

export function buildRenderHass(
  hass: HomeAssistant | undefined,
  watchedEntities: Iterable<string>,
  historyService: HistoryServiceLike,
  replayEnabled: boolean,
  playbackTime: number,
): RenderHass | undefined {
  if (!hass) return undefined;

  const provider = createStateProvider(hass, historyService, replayEnabled, playbackTime);
  const states: Record<string, HassEntity | undefined> = {};
  for (const entityId of watchedEntities) {
    states[entityId] = provider.getEntityState(entityId);
  }

  // Every formatter the plan draws through, forwarded: what is not here is not
  // missing, it is silently replaced by the raw attribute (issue #260).
  return {
    states,
    formatEntityState: (stateObj: HassEntity) => hass.formatEntityState(stateObj),
    formatEntityAttributeValue: hass.formatEntityAttributeValue
      ? (stateObj: HassEntity, attribute: string) => hass.formatEntityAttributeValue!(stateObj, attribute)
      : undefined,
  };
}
