/**
 * Floor Summary Calculation Logic (issue #234).
 * Pure, framework-agnostic helper functions for:
 * - Detecting candidate sensors on a floor (temperature, humidity, presence, lights, windows)
 * - Calculating numeric averages with unit conversion (e.g. °F ↔ °C) and exclusion filtering
 * - Computing structured floor summary metrics and badge text
 */

import type {
  Floor,
  FloorSummaryCardConfig,
  RenderHass,
} from "./types";
import {
  DEFAULT_FLOOR_SUMMARY_DECIMALS,
  DEFAULT_FLOOR_SUMMARY_METRICS,
  entityIdsInHaArea,
  haAreasOf,
} from "./types";

/**
 * Categorized candidate sensors discovered on a floor.
 */
export interface DetectedFloorSensors {
  temperature: string[];
  humidity: string[];
  presence: string[];
  lights: string[];
  windows: string[];
  all: string[];
}

/**
 * Options for computing numeric average across entities.
 */
export interface FloorAverageOptions {
  decimals?: number;
  attribute?: string;
  preferredUnit?: string;
}

/**
 * Computed average result with metadata.
 */
export interface FloorAverageResult {
  value: number | null;
  formatted: string;
  unit: string;
  count: number;
  entityIds: string[];
}

/**
 * A single metric entry within a floor summary.
 */
export interface FloorSummaryMetric<T = number | boolean> {
  value: T | null;
  formatted: string;
  unit: string;
  count: number;
  entityIds: string[];
}

/**
 * Structured summary data for a floor.
 */
export interface FloorSummaryData {
  enabled: boolean;
  temperature: FloorSummaryMetric<number>;
  humidity: FloorSummaryMetric<number>;
  presence: FloorSummaryMetric<boolean> & { active: boolean };
  lights: {
    onCount: number;
    totalCount: number;
    formatted: string;
    entityIds: string[];
  };
  windows: {
    openCount: number;
    totalCount: number;
    formatted: string;
    entityIds: string[];
  };
  badgeText: string;
  tooltip: string;
}

/**
 * Normalizes a temperature unit string for comparison.
 */
export function normalizeTempUnit(unit: string | undefined): "C" | "F" | "K" | undefined {
  if (!unit) return undefined;
  const clean = unit.trim().toUpperCase().replace("°", "");
  if (clean === "C" || clean === "CELSIUS") return "C";
  if (clean === "F" || clean === "FAHRENHEIT") return "F";
  if (clean === "K" || clean === "KELVIN") return "K";
  return undefined;
}

/**
 * Converts a temperature numeric value between units (C, F, K).
 */
export function convertTemperature(val: number, fromUnit?: string, toUnit?: string): number {
  const from = normalizeTempUnit(fromUnit);
  const to = normalizeTempUnit(toUnit);
  if (!from || !to || from === to) return val;

  // Convert to Celsius first
  let inC = val;
  if (from === "F") {
    inC = ((val - 32) * 5) / 9;
  } else if (from === "K") {
    inC = val - 273.15;
  }

  // Convert Celsius to target unit
  if (to === "C") return inC;
  if (to === "F") return (inC * 9) / 5 + 32;
  if (to === "K") return inC + 273.15;
  return val;
}

/**
 * Format a numeric metric with units.
 */
export function formatMetricValue(
  value: number | null,
  unit?: string,
  decimals: number = DEFAULT_FLOOR_SUMMARY_DECIMALS
): string {
  if (value === null || !Number.isFinite(value)) return "";
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(value * factor) / factor;
  const numStr = decimals > 0 ? rounded.toFixed(decimals) : String(rounded);
  if (!unit) return numStr;
  if (unit.startsWith("°") || unit === "%") {
    return `${numStr}${unit}`;
  }
  return `${numStr} ${unit}`;
}

/**
 * Discovers candidate sensor entities placed on a floor.
 */
/**
 * Domains a floor summary can classify. Anything else in a linked HA area is
 * left out, so the card does not re-render for entities it never reads.
 */
const SUMMARY_DOMAINS = new Set([
  "sensor",
  "binary_sensor",
  "climate",
  "light",
  "cover",
  "person",
  "device_tracker",
]);

/**
 * Entity ids a floor's linked Home Assistant areas (`area.haArea`) and floor
 * (`floor.haFloor`) contribute to its summary. Reads the HA entity, device and
 * area registries, so pass the full `hass` object, not a `RenderHass`.
 */
export function floorHaEntityIds(floor: Floor, registry: unknown): string[] {
  const ids = new Set<string>();
  const haAreaIds = new Set<string>();
  for (const area of floor.areas ?? []) {
    if (area.haArea) haAreaIds.add(area.haArea);
  }
  if (floor.haFloor) {
    for (const a of haAreasOf(registry)) {
      if (a.floor_id === floor.haFloor) haAreaIds.add(a.area_id);
    }
  }
  for (const areaId of haAreaIds) {
    for (const id of entityIdsInHaArea(registry, areaId)) {
      if (SUMMARY_DOMAINS.has(id.split(".")[0])) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Whether a floor shows a summary: on unless the floor turns it off, when the
 * card enables summaries, the floor enables its own, or the floor names a
 * helper entity or custom text.
 */
export function floorSummaryShown(floor: Floor, config?: FloorSummaryCardConfig): boolean {
  if (floor.summary?.enabled === false) return false;
  return !!(
    config?.enabled ||
    floor.summary?.enabled === true ||
    floor.summary?.temperatureEntity ||
    floor.summary?.humidityEntity ||
    floor.summary?.presenceEntity ||
    floor.summary?.customText
  );
}

/**
 * Discovers candidate sensor entities placed on a floor.
 *
 * `haEntityIds` are the entities found through the floor's linked HA areas
 * and floor (see {@link floorHaEntityIds}). When omitted they are looked up
 * in `hass`, which only works when it carries the HA registries.
 */
export function detectFloorSensors(
  floor: Floor,
  hass: RenderHass | undefined,
  haEntityIds?: readonly string[]
): DetectedFloorSensors {
  const result: DetectedFloorSensors = {
    temperature: [],
    humidity: [],
    presence: [],
    lights: [],
    windows: [],
    all: [],
  };

  if (!floor) return result;

  const rawEntityIds = new Set<string>();

  // 1. Gather all entity IDs referenced on the floor
  for (const item of floor.items ?? []) {
    if (item.entity) rawEntityIds.add(item.entity);
    if (item.secondaryEntity) rawEntityIds.add(item.secondaryEntity);
    for (const reading of item.readings ?? []) {
      if (reading.entity) rawEntityIds.add(reading.entity);
    }
  }

  for (const opening of floor.openings ?? []) {
    if (opening.entity) rawEntityIds.add(opening.entity);
    if (opening.secondaryEntity) rawEntityIds.add(opening.secondaryEntity);
  }

  for (const tracker of floor.trackers ?? []) {
    if (tracker.xSensor?.entity) rawEntityIds.add(tracker.xSensor.entity);
    if (tracker.ySensor?.entity) rawEntityIds.add(tracker.ySensor.entity);
    if (tracker.xSensor?.presence?.entity) rawEntityIds.add(tracker.xSensor.presence.entity);
    if (tracker.ySensor?.presence?.entity) rawEntityIds.add(tracker.ySensor.presence.entity);
  }

  // 2. Areas, and the entities of their linked Home Assistant areas and floor
  for (const area of floor.areas ?? []) {
    if (area.entity) rawEntityIds.add(area.entity);
  }
  for (const id of haEntityIds ?? floorHaEntityIds(floor, hass)) {
    rawEntityIds.add(id);
  }

  // 3. Configured summary helpers
  if (floor.summary?.temperatureEntity) rawEntityIds.add(floor.summary.temperatureEntity);
  if (floor.summary?.humidityEntity) rawEntityIds.add(floor.summary.humidityEntity);
  if (floor.summary?.presenceEntity) rawEntityIds.add(floor.summary.presenceEntity);

  result.all = Array.from(rawEntityIds);

  const states = hass?.states ?? {};

  for (const entityId of rawEntityIds) {
    const stateObj = states[entityId];
    const attrs = stateObj?.attributes ?? {};
    const devClass = attrs.device_class as string | undefined;
    const unit = attrs.unit_of_measurement as string | undefined;
    const domain = entityId.split(".")[0];

    // Temperature detection: trust the device class and a standard temperature unit (°C / °F).
    // Kelvin (K) is only accepted together with device_class: temperature, so colour-temperature
    // sensors (e.g. 4000 K) in linked rooms are not averaged into room temperature.
    const tempUnit = normalizeTempUnit(unit);
    const isTemp =
      domain === "climate" ||
      (domain === "sensor" &&
        (devClass === "temperature" || tempUnit === "C" || tempUnit === "F"));

    if (isTemp) {
      result.temperature.push(entityId);
    }

    // Humidity detection: device class only, for the same reason (a "%" with
    // "humid" in the name can be a battery or a dehumidifier setting).
    const isHumid =
      (domain === "sensor" && devClass === "humidity") ||
      (domain === "climate" && attrs.current_humidity !== undefined);

    if (isHumid) {
      result.humidity.push(entityId);
    }

    // Presence / occupancy detection: device class or a presence domain.
    const isPresence =
      (domain === "binary_sensor" &&
        (devClass === "occupancy" || devClass === "motion" || devClass === "presence")) ||
      domain === "person" ||
      domain === "device_tracker";

    if (isPresence) {
      result.presence.push(entityId);
    }

    // Light detection: controllable lights only (light domain).
    // A binary_sensor with device_class: light detects ambient daylight, not a fixture.
    const isLight = domain === "light";
    if (isLight) {
      result.lights.push(entityId);
    }

    // Window / Door detection
    const isOpeningElement = floor.openings?.some(
      (o) => o.entity === entityId || o.secondaryEntity === entityId
    );
    const isWindowOrDoor =
      isOpeningElement ||
      devClass === "window" ||
      devClass === "door" ||
      devClass === "garage_door" ||
      devClass === "opening";

    if (isWindowOrDoor) {
      result.windows.push(entityId);
    }
  }

  return result;
}

/**
 * Computes average value across a list of numeric entities with filtering and optional unit conversion.
 */
export function calculateFloorAverage(
  entityIds: string[],
  exclude: string[] | undefined,
  hass: RenderHass | undefined,
  options?: FloorAverageOptions
): FloorAverageResult {
  const decimals = options?.decimals ?? DEFAULT_FLOOR_SUMMARY_DECIMALS;
  const excludeSet = new Set(exclude ?? []);
  const validIds: string[] = [];

  if (!hass || !entityIds.length) {
    return {
      value: null,
      formatted: "",
      unit: options?.preferredUnit ?? "",
      count: 0,
      entityIds: [],
    };
  }

  const states = hass.states ?? {};
  const candidates = entityIds.filter((id) => !excludeSet.has(id));

  // Determine target unit
  let targetUnit: string | undefined = options?.preferredUnit;
  if (!targetUnit) {
    for (const id of candidates) {
      const st = states[id];
      if (st && st.state !== "unavailable" && st.state !== "unknown") {
        const u = st.attributes?.unit_of_measurement as string | undefined;
        if (u) {
          targetUnit = u;
          break;
        }
      }
    }
    if (!targetUnit && candidates.some((id) => id.startsWith("climate."))) {
      targetUnit = "°";
    }
  }

  let sum = 0;
  let count = 0;

  for (const id of candidates) {
    const st = states[id];
    if (!st || st.state === "unavailable" || st.state === "unknown") {
      continue;
    }

    let rawVal: unknown;
    if (options?.attribute) {
      rawVal = st.attributes?.[options.attribute];
    } else if (id.startsWith("climate.")) {
      if (targetUnit === "%" || options?.preferredUnit === "%") {
        rawVal = st.attributes?.current_humidity;
      } else {
        rawVal = st.attributes?.current_temperature ?? st.state;
      }
    } else {
      rawVal = st.state;
    }

    if (rawVal === undefined || rawVal === null || rawVal === "") {
      continue;
    }

    const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
    if (Number.isNaN(num) || !Number.isFinite(num)) {
      continue;
    }

    const sensorUnit = st.attributes?.unit_of_measurement as string | undefined;
    const converted = convertTemperature(num, sensorUnit, targetUnit);

    sum += converted;
    count++;
    validIds.push(id);
  }

  if (count === 0) {
    return {
      value: null,
      formatted: "",
      unit: targetUnit ?? "",
      count: 0,
      entityIds: [],
    };
  }

  const avg = sum / count;
  const factor = Math.pow(10, decimals);
  const rounded = Math.round(avg * factor) / factor;
  const formatted = formatMetricValue(rounded, targetUnit, decimals);

  return {
    value: rounded,
    formatted,
    unit: targetUnit ?? "",
    count,
    entityIds: validIds,
  };
}

/**
 * Computes full summary telemetry for a floor.
 */
export function computeFloorSummary(
  floor: Floor,
  hass: RenderHass | undefined,
  config?: FloorSummaryCardConfig,
  haEntityIds?: readonly string[]
): FloorSummaryData {
  const enabled = floorSummaryShown(floor, config);

  const decimals = config?.decimals ?? DEFAULT_FLOOR_SUMMARY_DECIMALS;
  const exclude = floor.summary?.excludeEntities;
  const excludeSet = new Set(exclude ?? []);
  const detected = detectFloorSensors(floor, hass, haEntityIds);
  const states = hass?.states ?? {};

  // 1. Temperature
  let tempResult: FloorAverageResult;
  if (floor.summary?.temperatureEntity) {
    const entId = floor.summary.temperatureEntity;
    const st = states[entId];
    if (st && st.state !== "unavailable" && st.state !== "unknown") {
      const rawVal = entId.startsWith("climate.")
        ? st.attributes?.current_temperature ?? st.state
        : st.state;
      const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
      if (!Number.isNaN(num) && Number.isFinite(num)) {
        const unit = (st.attributes?.unit_of_measurement as string | undefined) ?? "°";
        const factor = Math.pow(10, decimals);
        const rounded = Math.round(num * factor) / factor;
        tempResult = {
          value: rounded,
          formatted: formatMetricValue(rounded, unit, decimals),
          unit,
          count: 1,
          entityIds: [entId],
        };
      } else {
        tempResult = { value: null, formatted: "", unit: "", count: 0, entityIds: [] };
      }
    } else {
      tempResult = { value: null, formatted: "", unit: "", count: 0, entityIds: [] };
    }
  } else {
    tempResult = calculateFloorAverage(detected.temperature, exclude, hass, { decimals });
  }

  // 2. Humidity
  let humidResult: FloorAverageResult;
  if (floor.summary?.humidityEntity) {
    const entId = floor.summary.humidityEntity;
    const st = states[entId];
    if (st && st.state !== "unavailable" && st.state !== "unknown") {
      const rawVal = entId.startsWith("climate.")
        ? st.attributes?.current_humidity ?? st.state
        : st.state;
      const num = typeof rawVal === "number" ? rawVal : parseFloat(String(rawVal));
      if (!Number.isNaN(num) && Number.isFinite(num)) {
        const unit = (st.attributes?.unit_of_measurement as string | undefined) ?? "%";
        const factor = Math.pow(10, 0);
        const rounded = Math.round(num * factor) / factor;
        humidResult = {
          value: rounded,
          formatted: formatMetricValue(rounded, unit, 0),
          unit,
          count: 1,
          entityIds: [entId],
        };
      } else {
        humidResult = { value: null, formatted: "", unit: "", count: 0, entityIds: [] };
      }
    } else {
      humidResult = { value: null, formatted: "", unit: "", count: 0, entityIds: [] };
    }
  } else {
    humidResult = calculateFloorAverage(detected.humidity, exclude, hass, {
      decimals: 0,
      preferredUnit: "%",
    });
  }

  // 3. Presence / Occupancy
  let presenceActive = false;
  let presenceCount = 0;
  const presenceEntities: string[] = [];

  if (floor.summary?.presenceEntity) {
    const entId = floor.summary.presenceEntity;
    const st = states[entId];
    if (st && st.state !== "unavailable" && st.state !== "unknown") {
      const s = String(st.state).toLowerCase();
      const num = parseFloat(s);
      if (s === "on" || s === "home" || s === "occupied" || (!isNaN(num) && num > 0)) {
        presenceActive = true;
        presenceCount = !isNaN(num) && num > 0 ? num : 1;
      }
      presenceEntities.push(entId);
    }
  } else {
    const candidates = detected.presence.filter((id) => !excludeSet.has(id));
    for (const id of candidates) {
      const st = states[id];
      if (st && st.state !== "unavailable" && st.state !== "unknown") {
        const s = String(st.state).toLowerCase();
        const num = parseFloat(s);
        if (s === "on" || s === "home" || s === "occupied" || (!isNaN(num) && num > 0)) {
          presenceActive = true;
          if (id.startsWith("person.")) {
            presenceCount++;
          }
          presenceEntities.push(id);
        }
      }
    }
    if (presenceActive && presenceCount === 0) {
      presenceCount = 1;
    }
  }

  const presenceFormatted = presenceActive
    ? presenceCount > 1
      ? `${presenceCount} present`
      : "Occupied"
    : "Clear";

  // 4. Lights
  const lightCandidates = detected.lights.filter((id) => !excludeSet.has(id));
  let lightsOn = 0;
  const onLightIds: string[] = [];
  for (const id of lightCandidates) {
    const st = states[id];
    if (st?.state === "on") {
      lightsOn++;
      onLightIds.push(id);
    }
  }
  const lightsFormatted = lightsOn > 0 ? `${lightsOn} on` : "Off";

  // 5. Windows & Doors
  const windowCandidates = detected.windows.filter((id) => !excludeSet.has(id));
  let windowsOpen = 0;
  const openWindowIds: string[] = [];
  for (const id of windowCandidates) {
    const st = states[id];
    if (st) {
      const s = String(st.state).toLowerCase();
      const pos = st.attributes?.current_position;
      if (s === "on" || s === "open" || (typeof pos === "number" && pos > 0)) {
        windowsOpen++;
        openWindowIds.push(id);
      }
    }
  }
  const windowsFormatted = windowsOpen > 0 ? `${windowsOpen} open` : "Closed";

  // 6. Badge Text
  let badgeText = "";
  if (floor.summary?.customText) {
    badgeText = floor.summary.customText
      .replace(/\{temp\}/gi, tempResult.formatted)
      .replace(/\{humidity\}/gi, humidResult.formatted)
      .replace(/\{presence\}/gi, presenceFormatted)
      .replace(/\{lights\}/gi, lightsFormatted)
      .replace(/\{windows\}/gi, windowsFormatted)
      .trim();
  } else {
    const defaultMetrics = [...DEFAULT_FLOOR_SUMMARY_METRICS];
    const metricsToShow = config?.metrics ?? defaultMetrics;
    const parts: string[] = [];

    if (metricsToShow.includes("temperature") && tempResult.formatted) {
      parts.push(tempResult.formatted);
    }
    if (metricsToShow.includes("humidity") && humidResult.formatted) {
      parts.push(humidResult.formatted);
    }
    if (metricsToShow.includes("presence") && presenceActive) {
      parts.push(presenceCount > 1 ? `👤 ${presenceCount}` : "👤");
    }
    if (metricsToShow.includes("lights") && lightsOn > 0) {
      parts.push(`💡 ${lightsOn}`);
    }
    if (metricsToShow.includes("windows") && windowsOpen > 0) {
      parts.push(`🪟 ${windowsOpen}`);
    }

    badgeText = parts.join(" · ");
  }

  // 7. Tooltip (Human-readable title & aria-label)
  const tipParts: string[] = [floor.name];
  const statParts: string[] = [];
  if (tempResult.formatted) {
    statParts.push(`Average Temp ${tempResult.formatted}`);
  }
  if (humidResult.formatted) {
    statParts.push(`Humidity ${humidResult.formatted}`);
  }
  if (presenceActive) {
    statParts.push(presenceCount > 1 ? `${presenceCount} present` : "Occupied");
  }
  if (lightsOn > 0) {
    statParts.push(`${lightsOn} ${lightsOn === 1 ? "light" : "lights"} on`);
  }
  if (windowsOpen > 0) {
    statParts.push(`${windowsOpen} ${windowsOpen === 1 ? "opening" : "openings"} open`);
  }

  const tooltip =
    statParts.length > 0 ? `${tipParts[0]}: ${statParts.join(", ")}` : floor.name;

  return {
    enabled,
    temperature: {
      value: tempResult.value,
      formatted: tempResult.formatted,
      unit: tempResult.unit,
      count: tempResult.count,
      entityIds: tempResult.entityIds,
    },
    humidity: {
      value: humidResult.value,
      formatted: humidResult.formatted,
      unit: humidResult.unit,
      count: humidResult.count,
      entityIds: humidResult.entityIds,
    },
    presence: {
      value: presenceActive,
      active: presenceActive,
      formatted: presenceFormatted,
      unit: "",
      count: presenceCount,
      entityIds: presenceEntities,
    },
    lights: {
      onCount: lightsOn,
      totalCount: lightCandidates.length,
      formatted: lightsFormatted,
      entityIds: onLightIds,
    },
    windows: {
      openCount: windowsOpen,
      totalCount: windowCandidates.length,
      formatted: windowsFormatted,
      entityIds: openWindowIds,
    },
    badgeText,
    tooltip,
  };
}

