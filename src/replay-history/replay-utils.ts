import type { FloorplanCardConfig, HomeAssistant } from "../types";
import { getFloors } from "../types";
import { cssColor } from "../css-safe";
import { entityIsActive, kindFromEntity, resolveItemIcon } from "../render";
import { resolveReplayEventColor, type HistoryEventInput } from "./history-service";
import { ReplayScopeService } from "./replay-scope";

export function getDefaultReplayWindow(config: FloorplanCardConfig | undefined): { start: number; end: number } {
  const now = Date.now() / 1000;
  const configuredLookback = config?.historyReplay?.lookbackSeconds;
  const lookback =
    typeof configuredLookback === "number" && Number.isFinite(configuredLookback) && configuredLookback > 0
      ? configuredLookback
      : 3600;
  return { start: Math.max(0, now - lookback), end: now };
}

export function normalizeReplayWindow(start: number, end: number): { start: number; end: number } {
  const normalizedStart = Math.min(start, end);
  const normalizedEnd = Math.max(start, end);
  return {
    start: Math.max(0, normalizedStart),
    end: Math.max(normalizedStart, normalizedEnd),
  };
}

export function getReplayWatchedEntities(config: FloorplanCardConfig | undefined, activeFloorId?: string): string[] {
  return ReplayScopeService.currentFloorEntityIds(config, activeFloorId);
}

export function getReplayScopeKey(config: FloorplanCardConfig | undefined, activeFloorId?: string): string {
  return ReplayScopeService.scopeKey(config, activeFloorId);
}

export function getReplaySpeedForRange(config: FloorplanCardConfig | undefined, start: number, end: number): number {
  const duration = Math.max(1, end - start);
  const baselineSpeed = duration / 30;
  const configuredSpeed = config?.historyReplay?.defaultSpeed;
  const derivedSpeed = configuredSpeed != null ? configuredSpeed : baselineSpeed;
  return Math.max(0.25, derivedSpeed);
}

export function parseReplayInputValue(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() / 1000 : parsed / 1000;
}

export function formatReplayInputValue(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp * 1000);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function replaySpeedToSliderValue(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  const value = Math.log10(speed);
  return Math.min(3, Math.max(-2, value));
}

export function sliderValueToReplaySpeed(value: number): number {
  const clamped = Math.min(3, Math.max(-2, value));
  return Number((10 ** clamped).toPrecision(4));
}

export function formatReplaySpeed(speed: number): string {
  if (speed >= 100) return `${Math.round(speed)}x`;
  if (speed >= 10) return `${speed.toFixed(1)}x`;
  if (speed >= 1) return `${speed.toFixed(2)}x`;
  return `${speed.toFixed(3)}x`;
}

export function getReplayEventIcon(event: HistoryEventInput, hass?: HomeAssistant, _config?: FloorplanCardConfig): string {
  const kind = kindFromEntity(event.entityId);
  const liveState = hass?.states[event.entityId];
  const replayState = {
    state: event.newState,
    attributes: {
      ...(liveState?.attributes ?? {}),
      ...(event.attributes ?? {}),
    },
  };
  return resolveItemIcon(
    {
      entity: event.entityId,
      kind,
    },
    replayState,
    hass?.entities?.[event.entityId]?.icon,
  );
}

export function findConfiguredReplayColor(
  config: FloorplanCardConfig | undefined,
  entityId: string,
  cache: Map<string, string | undefined>,
): string | undefined {
  if (!config) return undefined;
  if (cache.has(entityId)) {
    return cache.get(entityId);
  }

  const floors = getFloors(config);
  let color: string | undefined;
  for (const floor of floors) {
    for (const item of floor.items ?? []) {
      if (item.entity === entityId) {
        color = item.activeColor ?? item.rippleColor;
        cache.set(entityId, color);
        return color;
      }
    }
    for (const opening of floor.openings ?? []) {
      if (opening.entity === entityId) {
        color = opening.activeColor;
        cache.set(entityId, color);
        return color;
      }
    }
    for (const furniture of floor.furniture ?? []) {
      if (furniture.entity === entityId) {
        color = furniture.activeColor;
        cache.set(entityId, color);
        return color;
      }
    }
  }
  cache.set(entityId, undefined);
  return undefined;
}

export function getReplayEventColor(
  event: HistoryEventInput,
  config: FloorplanCardConfig | undefined,
  _hass: HomeAssistant | undefined,
  replayConfiguredColorCache: Map<string, string | undefined>,
  replayConfigured: boolean,
): string | undefined {
  if (!config) return resolveReplayEventColor(event);

  const configuredColor = cssColor(findConfiguredReplayColor(config, event.entityId, replayConfiguredColorCache));
  const active = entityIsActive(event.entityId, event.newState);
  if (replayConfigured && configuredColor) return active ? configuredColor : "#ffffff";

  const resolved = resolveReplayEventColor(event);
  return active ? resolved : "#ffffff";
}

export function formatReplayTime(timestamp: number, formatter: Intl.DateTimeFormat): string {
  if (!Number.isFinite(timestamp)) return "—";
  try {
    return formatter.format(new Date(timestamp * 1000));
  } catch {
    return new Date(timestamp * 1000).toISOString();
  }
}
