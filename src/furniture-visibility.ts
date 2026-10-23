/**
 * Pure condition evaluator and entity collector for Furniture Visibility (Issue #310).
 * Follows Home Assistant's native dashboard card visibility schema and entity conditions:
 * - condition: "state"
 * - condition: "numeric_state"
 * - condition: "time"
 * - condition: "sun"
 * - condition: "zone"
 * - condition: "location"
 * - condition: "view_columns"
 * - condition: "screen"
 * - condition: "user"
 * - condition: "and" | "or" | "not"
 * - condition: "<domain>.<action>" (e.g. "garage_door.is_open", "light.is_on", "motion.is_detected", "temperature.is_value", etc.)
 * - condition: "device" (with type: "is_open", "is_closed", etc.)
 * - target-based conditions with target: { entity_id: ... } or entity_id: ...
 */

import type { Furniture, RenderHass, VisibilityCondition } from "./types";

/**
 * Checks whether a condition explicitly tests for an outage state ("unavailable" or "unknown").
 */
function isExplicitOutageCheck(stateOrStates: unknown): boolean {
  if (stateOrStates === undefined || stateOrStates === null) return false;
  if (Array.isArray(stateOrStates)) {
    return stateOrStates.some((s) => s === "unavailable" || s === "unknown");
  }
  return stateOrStates === "unavailable" || stateOrStates === "unknown";
}

/**
 * Checks whether a value is a valid Home Assistant entity ID (e.g. "sensor.temp", "domain.object_id").
 */
export function isEntityId(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const s = val.trim();
  if (!s || s.includes(" ") || !s.includes(".")) return false;
  if (!Number.isNaN(Number(s))) return false;
  return /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(s);
}

/**
 * Extracts the primary subject entity IDs directly evaluated by a condition:
 * - cond.entity
 * - cond.entity_id (string or array)
 * - cond.target.entity_id (string or array)
 * - cond.target.entity (string or array)
 */
export function extractSubjectEntityIds(c: unknown): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const ids: string[] = [];

  const add = (val: unknown) => {
    if (typeof val === "string" && isEntityId(val)) {
      ids.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && isEntityId(item)) ids.push(item.trim());
      }
    }
  };

  add(cond.entity);
  add(cond.entity_id);

  if (cond.target && typeof cond.target === "object") {
    const target = cond.target as Record<string, unknown>;
    add(target.entity_id);
    add(target.entity);
  }

  return ids;
}

/**
 * Extracts zone entity IDs from condition (cond.zone, cond.options.zone, cond.target.zone, target.entity_id).
 */
export function extractZoneIds(c: unknown): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const zones: string[] = [];

  const add = (val: unknown) => {
    if (typeof val === "string") {
      const s = val.trim();
      if (!s) return;
      const normalized = s.startsWith("zone.") ? s : `zone.${s}`;
      if (isEntityId(normalized) && !zones.includes(normalized)) {
        zones.push(normalized);
      }
    } else if (Array.isArray(val)) {
      for (const item of val) add(item);
    } else if (val && typeof val === "object") {
      const obj = val as Record<string, unknown>;
      add(obj.entity_id);
      add(obj.entity);
      add(obj.zone);
    }
  };

  add(cond.zone);
  if (cond.options && typeof cond.options === "object") {
    add((cond.options as Record<string, unknown>).zone);
  }
  if (cond.target && typeof cond.target === "object") {
    const target = cond.target as Record<string, unknown>;
    add(target.zone);
    if (typeof target.entity_id === "string" && target.entity_id.startsWith("zone.")) {
      add(target.entity_id);
    } else if (Array.isArray(target.entity_id)) {
      for (const item of target.entity_id) {
        if (typeof item === "string" && item.startsWith("zone.")) add(item);
      }
    }
  }

  return zones;
}

/**
 * Extracts all entity IDs referenced in a condition (both subjects and comparison references),
 * for dependency tracking and card reactive re-renders:
 * - subject entities
 * - cond.above / cond.below (when entity references)
 * - cond.state / cond.state_not (when entity references)
 * - cond.threshold (any nested entity references)
 * - time condition (after/before entity references)
 * - sun condition ("sun.sun")
 * - zone condition
 */
export function extractConditionEntityIds(c: unknown): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const ids: string[] = extractSubjectEntityIds(cond);

  const checkRef = (val: unknown) => {
    if (!val) return;
    if (typeof val === "string" && isEntityId(val)) {
      ids.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && isEntityId(item)) ids.push(item.trim());
      }
    } else if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.entity === "string" && isEntityId(obj.entity)) {
        ids.push(obj.entity.trim());
      }
      if (typeof obj.entity_id === "string" && isEntityId(obj.entity_id)) {
        ids.push(obj.entity_id.trim());
      }
    }
  };

  checkRef(cond.above);
  checkRef(cond.below);

  const checkThresholdObj = (th: unknown) => {
    if (!th || typeof th !== "object") return;
    const t = th as Record<string, unknown>;
    checkRef(t.value);
    checkRef(t.value_min);
    checkRef(t.value_max);
    checkRef(t.value_lower);
    checkRef(t.value_upper);
    checkRef(t.min);
    checkRef(t.max);
    checkRef(t.lower);
    checkRef(t.upper);
    checkRef(t.above);
    checkRef(t.below);
    checkRef(t.entity);
    checkRef(t.entity_id);
  };

  if (cond.options && typeof cond.options === "object") {
    checkThresholdObj((cond.options as Record<string, unknown>).threshold);
  }
  checkThresholdObj(cond.threshold);

  const condType = String(cond.condition ?? "");

  // Time condition entities (e.g. input_datetime.xyz, sensor.time)
  if (condType === "time") {
    checkRef(cond.after);
    checkRef(cond.before);
  }

  // Sun condition entities
  if (condType === "sun" || condType.startsWith("sun.")) {
    ids.push("sun.sun");
  }

  // Zone condition entities
  if (
    condType === "zone" ||
    condType.startsWith("zone.") ||
    (condType === "device" && (cond.type === "is_in_zone" || cond.type === "is_not_in_zone"))
  ) {
    for (const z of extractZoneIds(cond)) {
      ids.push(z);
    }
  }

  // State condition entity references in state or state_not
  if (condType === "state" || !condType) {
    checkRef(cond.state);
    checkRef(cond.state_not);
  }

  return ids;
}

interface ResolvedThreshold {
  value: number;
  unit?: string;
}

/**
 * Resolves a threshold entry (number, string, entity id, or active_choice object)
 * into a concrete numeric value and optional unit.
 */
function resolveThresholdValue(
  val: unknown,
  hass: RenderHass
): ResolvedThreshold | undefined {
  if (val === undefined || val === null || val === "") return undefined;

  // Direct number
  if (typeof val === "number") {
    return Number.isFinite(val) ? { value: val } : undefined;
  }

  // String: might be a numeric string or an entity ID (e.g. sensor.xyz, input_number.xyz)
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (!trimmed) return undefined;

    if (isEntityId(trimmed) && hass.states[trimmed]) {
      const stateObj = hass.states[trimmed];
      if (stateObj?.state !== undefined) {
        const num = parseFloat(stateObj.state);
        if (!Number.isNaN(num)) {
          return {
            value: num,
            unit: stateObj.attributes?.unit_of_measurement as string | undefined,
          };
        }
      }
    }

    const asNum = parseFloat(trimmed);
    return !Number.isNaN(asNum) ? { value: asNum } : undefined;
  }

  // Object: e.g. { active_choice: "number", number: 20, unit_of_measurement: "°C" }
  // or { active_choice: "entity", entity: "sensor.outdoor_temp" }
  if (typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const activeChoice = String(obj.active_choice ?? "");
    const unit = typeof obj.unit_of_measurement === "string" ? obj.unit_of_measurement.trim() : undefined;

    if (activeChoice === "entity" || (!("number" in obj) && (obj.entity || obj.entity_id))) {
      const entId = String(obj.entity ?? obj.entity_id ?? "").trim();
      if (entId) {
        const stateObj = hass.states[entId];
        if (stateObj?.state !== undefined) {
          const num = parseFloat(stateObj.state);
          if (!Number.isNaN(num)) {
            return {
              value: num,
              unit: (stateObj.attributes?.unit_of_measurement as string | undefined) ?? unit,
            };
          }
        }
      }
    }

    const numCandidate = obj.number !== undefined ? obj.number : obj.value;
    if (numCandidate !== undefined && numCandidate !== null && numCandidate !== "") {
      if (typeof numCandidate === "number") {
        return Number.isFinite(numCandidate) ? { value: numCandidate, unit } : undefined;
      }
      const num = parseFloat(String(numCandidate));
      if (!Number.isNaN(num)) {
        return { value: num, unit };
      }
    }
  }

  return undefined;
}

/**
 * Normalizes temperature values across units (°C, °F, K) when comparing an entity reading against a threshold.
 */
function normalizeUnitValue(val: number, fromUnit?: string, toUnit?: string): number {
  if (!fromUnit || !toUnit) return val;
  const f = fromUnit.trim();
  const t = toUnit.trim();
  if (f === t) return val;

  const isC = (u: string) => u === "°C" || u === "C" || u === "degC";
  const isF = (u: string) => u === "°F" || u === "F" || u === "degF";
  const isK = (u: string) => u === "K" || u === "°K";

  // Temperature unit conversions
  if ((isC(f) || isF(f) || isK(f)) && (isC(t) || isF(t) || isK(t))) {
    let inC: number;
    if (isC(f)) inC = val;
    else if (isF(f)) inC = (val - 32) * (5 / 9);
    else inC = val - 273.15;

    if (isC(t)) return inC;
    if (isF(t)) return inC * (9 / 5) + 32;
    if (isK(t)) return inC + 273.15;
  }

  return val;
}

/**
 * Evaluates a single entity against a state, numeric_state, or shorthand/device condition.
 */
function evaluateEntityCondition(
  entityId: string,
  cond: Record<string, unknown>,
  hass: RenderHass
): boolean {
  const stateObj = hass.states[entityId];
  if (!stateObj) return true; // Fail-open on missing entity

  const raw = cond.attribute ? stateObj.attributes?.[cond.attribute as string] : stateObj.state;
  const strVal = String(raw ?? "");

  // Fail-open outage protection: if the entity is unavailable/unknown and the condition
  // did not explicitly ask for unavailable/unknown, do not hide the furniture.
  if (strVal === "unavailable" || strVal === "unknown") {
    const testsForOutage =
      isExplicitOutageCheck(cond.state) || isExplicitOutageCheck(cond.state_not);
    if (!testsForOutage) return true;
  }

  const condType = String(cond.condition ?? "");
  const actionType = String(cond.type ?? "");

  // 1. Shorthand entity / device conditions (e.g. garage_door.is_open, cover.is_closed, type: "is_open")
  const check = condType.includes(".")
    ? condType.split(".").pop()!
    : condType === "device"
    ? actionType
    : condType;

  if (
    check === "in_zone" ||
    check === "is_in_zone" ||
    check === "not_in_zone" ||
    check === "is_not_in_zone"
  ) {
    return evaluateZoneCondition(cond, hass, entityId);
  }

  if (check === "is_open") {
    return strVal === "open" || strVal === "opening" || strVal === "on" || strVal === "unlocked";
  }
  if (check === "is_closed") {
    return strVal === "closed" || strVal === "closing" || strVal === "off" || strVal === "locked";
  }
  if (check === "is_on") {
    return strVal === "on";
  }
  if (check === "is_off") {
    return strVal === "off";
  }
  if (check === "is_locked") {
    return strVal === "locked" || strVal === "locking";
  }
  if (check === "is_unlocked") {
    return strVal === "unlocked" || strVal === "unlocking";
  }
  if (check === "is_home") {
    return strVal === "home" || strVal === "on";
  }
  if (check === "is_not_home") {
    return strVal !== "home" && strVal !== "on";
  }
  if (check === "is_detected" || check === "is_motion") {
    return (
      strVal === "on" ||
      strVal === "detected" ||
      strVal === "unsafe" ||
      strVal === "problem" ||
      strVal === "wet" ||
      strVal === "gas" ||
      strVal === "smoke" ||
      strVal === "motion"
    );
  }
  if (check === "is_clear" || check === "is_no_motion") {
    return (
      strVal === "off" ||
      strVal === "clear" ||
      strVal === "safe" ||
      strVal === "ok" ||
      strVal === "normal" ||
      strVal === "dry" ||
      strVal === "no_motion"
    );
  }
  if (check === "is_occupied") {
    return strVal === "on" || strVal === "occupied" || strVal === "home";
  }
  if (check === "is_not_occupied") {
    return strVal === "off" || strVal === "not_occupied" || strVal === "clear" || strVal === "not_home";
  }
  if (check === "is_plugged_in") {
    return strVal === "on" || strVal === "plugged" || strVal === "connected" || strVal === "charging";
  }
  if (check === "is_unplugged") {
    return strVal === "off" || strVal === "unplugged" || strVal === "disconnected";
  }
  if (check === "is_charging") {
    return strVal === "charging" || strVal === "on";
  }
  if (check === "is_discharging") {
    return strVal === "discharging";
  }
  if (check === "is_low") {
    return strVal === "on" || strVal === "low";
  }
  if (check === "is_normal") {
    return strVal === "off" || strVal === "normal";
  }
  if (check === "is_playing") {
    return strVal === "playing";
  }
  if (check === "is_paused") {
    return strVal === "paused";
  }
  if (check === "is_idle") {
    return strVal === "idle";
  }
  if (check === "is_stopped") {
    return strVal === "stopped" || strVal === "off" || strVal === "idle";
  }
  if (check === "is_cleaning") {
    return strVal === "cleaning" || strVal === "mowing" || strVal === "on";
  }
  if (check === "is_docked") {
    return strVal === "docked" || strVal === "home" || strVal === "charging";
  }
  if (check === "is_returning") {
    return strVal === "returning";
  }
  if (check === "is_error") {
    return strVal === "error";
  }
  if (check === "is_running") {
    return strVal === "on" || strVal === "running" || strVal === "active";
  }
  if (check === "is_not_running") {
    return strVal === "off" || strVal === "not_running" || strVal === "idle" || strVal === "standby";
  }
  if (check === "is_connected") {
    return strVal === "on" || strVal === "connected";
  }
  if (check === "is_disconnected") {
    return strVal === "off" || strVal === "disconnected";
  }
  if (check === "is_disarmed") {
    return strVal === "disarmed";
  }
  if (check === "is_armed_home") {
    return strVal === "armed_home";
  }
  if (check === "is_armed_away") {
    return strVal === "armed_away";
  }
  if (check === "is_armed_night") {
    return strVal === "armed_night";
  }
  if (check === "is_armed_vacation") {
    return strVal === "armed_vacation";
  }
  if (check === "is_armed_custom_bypass") {
    return strVal === "armed_custom_bypass";
  }
  if (check === "is_pending") {
    return strVal === "pending";
  }
  if (check === "is_triggered") {
    return strVal === "triggered";
  }
  if (check === "is_armed") {
    return strVal.startsWith("armed");
  }
  if (check === "is_above_horizon") {
    return strVal === "above_horizon";
  }
  if (check === "is_below_horizon") {
    return strVal === "below_horizon";
  }

  // 2. Numeric state and domain threshold conditions (e.g. temperature.is_value, power.is_value, options.threshold)
  const thresholdObj = (
    cond.options && typeof cond.options === "object"
      ? (cond.options as Record<string, unknown>).threshold
      : undefined
  ) ?? (cond.threshold && typeof cond.threshold === "object" ? cond.threshold : undefined);

  const isNumericOrThreshold =
    condType === "numeric_state" ||
    condType.endsWith(".is_value") ||
    condType.endsWith(".crossed_threshold") ||
    cond.above !== undefined ||
    cond.below !== undefined ||
    thresholdObj !== undefined;

  if (isNumericOrThreshold) {
    const num = parseFloat(strVal);
    if (Number.isNaN(num)) return true; // Fail-open on non-numeric

    const entityUnit = stateObj.attributes?.unit_of_measurement as string | undefined;

    if (thresholdObj && typeof thresholdObj === "object") {
      const t = thresholdObj as Record<string, unknown>;
      const threshType = String(t.type ?? "").toLowerCase();

      if (threshType === "below") {
        const res = resolveThresholdValue(t.value ?? t.below, hass);
        if (res !== undefined) {
          const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
          if (num >= limit) return false;
        }
      } else if (threshType === "above") {
        const res = resolveThresholdValue(t.value ?? t.above, hass);
        if (res !== undefined) {
          const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
          if (num <= limit) return false;
        }
      } else if (threshType === "in_range") {
        const minRes = resolveThresholdValue(t.value_min ?? t.min ?? t.value_lower ?? t.lower ?? t.above, hass);
        const maxRes = resolveThresholdValue(t.value_max ?? t.max ?? t.value_upper ?? t.upper ?? t.below, hass);
        if (minRes !== undefined) {
          const minLimit = normalizeUnitValue(minRes.value, minRes.unit, entityUnit);
          if (num <= minLimit) return false;
        }
        if (maxRes !== undefined) {
          const maxLimit = normalizeUnitValue(maxRes.value, maxRes.unit, entityUnit);
          if (num >= maxLimit) return false;
        }
      } else if (threshType === "outside_range") {
        const minRes = resolveThresholdValue(t.value_min ?? t.min ?? t.value_lower ?? t.lower ?? t.above, hass);
        const maxRes = resolveThresholdValue(t.value_max ?? t.max ?? t.value_upper ?? t.upper ?? t.below, hass);
        if (minRes !== undefined && maxRes !== undefined) {
          const minLimit = normalizeUnitValue(minRes.value, minRes.unit, entityUnit);
          const maxLimit = normalizeUnitValue(maxRes.value, maxRes.unit, entityUnit);
          if (num >= minLimit && num <= maxLimit) return false;
        }
      } else {
        if (t.above !== undefined) {
          const res = resolveThresholdValue(t.above, hass);
          if (res !== undefined) {
            const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
            if (num <= limit) return false;
          }
        }
        if (t.below !== undefined) {
          const res = resolveThresholdValue(t.below, hass);
          if (res !== undefined) {
            const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
            if (num >= limit) return false;
          }
        }
      }
    }

    if (cond.above !== undefined) {
      const res = resolveThresholdValue(cond.above, hass);
      if (res !== undefined) {
        const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
        if (num <= limit) return false;
      }
    }

    if (cond.below !== undefined) {
      const res = resolveThresholdValue(cond.below, hass);
      if (res !== undefined) {
        const limit = normalizeUnitValue(res.value, res.unit, entityUnit);
        if (num >= limit) return false;
      }
    }

    return true;
  }

  // 3. State condition (state or state_not) with entity reference resolution
  const matchesTargetState = (target: unknown): boolean => {
    if (Array.isArray(target)) {
      return target.some((t) => matchesTargetState(t));
    }
    const s = String(target ?? "");
    if (s === strVal) return true;
    if (hass.states[s] && hass.states[s].state === strVal) return true;
    return false;
  };

  if (cond.state !== undefined) {
    if (!matchesTargetState(cond.state)) return false;
  }

  if (cond.state_not !== undefined) {
    if (matchesTargetState(cond.state_not)) return false;
  }

  return true;
}

/**
 * Parses a time string (HH:MM or HH:MM:SS or entity reference) to seconds from midnight (0..86399).
 */
function parseTimeToSeconds(timeStr: string, hass: RenderHass): number | null {
  if (!timeStr) return null;
  let s = timeStr.trim();
  // Check if it's an entity ID
  if (s.includes(".") && !s.includes(" ") && hass.states[s]) {
    s = String(hass.states[s]?.state ?? "");
  }
  const match = s.match(/(?:^|\s|T)(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const seconds = match[3] ? parseInt(match[3], 10) : 0;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

/**
 * Extracts current time in seconds from midnight and short weekday ("sun", "mon", etc.)
 * honoring the Home Assistant timezone if available.
 */
function getNowInTimezone(now: Date, timeZone?: string) {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  if (!timeZone) {
    return {
      sec: now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(),
      weekday: days[now.getDay()],
    };
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      weekday: "short",
      hourCycle: "h23",
    }).formatToParts(now);
    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    let weekday = days[now.getDay()];
    for (const p of parts) {
      if (p.type === "hour") hours = parseInt(p.value, 10);
      else if (p.type === "minute") minutes = parseInt(p.value, 10);
      else if (p.type === "second") seconds = parseInt(p.value, 10);
      else if (p.type === "weekday") weekday = p.value.toLowerCase().slice(0, 3);
    }
    return {
      sec: hours * 3600 + minutes * 60 + seconds,
      weekday,
    };
  } catch {
    return {
      sec: now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds(),
      weekday: days[now.getDay()],
    };
  }
}

/**
 * Evaluates a Time condition (after, before, weekdays).
 */
export function evaluateTimeCondition(
  cond: Record<string, unknown>,
  hass: RenderHass,
  now = new Date()
): boolean {
  const configObj = (hass as unknown as { config?: { time_zone?: string } }).config;
  const localeObj = (hass as unknown as { locale?: { time_zone?: string } }).locale;
  const timeZone =
    configObj?.time_zone ?? (localeObj?.time_zone === "server" ? configObj?.time_zone : undefined);

  const { sec: nowSec, weekday } = getNowInTimezone(now, timeZone);

  // Check weekdays
  if (Array.isArray(cond.weekdays) && cond.weekdays.length > 0) {
    const validDays = cond.weekdays.map((w) => String(w).toLowerCase().slice(0, 3));
    if (!validDays.includes(weekday)) return false;
  }

  const afterSec = typeof cond.after === "string" ? parseTimeToSeconds(cond.after, hass) : null;
  const beforeSec = typeof cond.before === "string" ? parseTimeToSeconds(cond.before, hass) : null;

  if (afterSec !== null && beforeSec !== null) {
    if (beforeSec < afterSec) {
      // Midnight crossing: e.g. 22:00 to 06:00
      return nowSec >= afterSec || nowSec < beforeSec;
    }
    return nowSec >= afterSec && nowSec < beforeSec;
  }

  if (afterSec !== null) {
    return nowSec >= afterSec;
  }

  if (beforeSec !== null) {
    return nowSec < beforeSec;
  }

  return true;
}

/**
 * Parses time offset string or number into seconds.
 */
function parseOffsetSeconds(offset: unknown): number {
  if (typeof offset === "number") return offset;
  if (typeof offset !== "string") return 0;
  const trimmed = offset.trim();
  const sign = trimmed.startsWith("-") ? -1 : 1;
  const cleaned = trimmed.replace(/^[+-]/, "");
  const parts = cleaned.split(":").map((p) => parseFloat(p));
  if (parts.length === 3) {
    return sign * (parts[0] * 3600 + parts[1] * 60 + parts[2]);
  }
  if (parts.length === 2) {
    return sign * (parts[0] * 3600 + parts[1] * 60);
  }
  const asNum = parseFloat(cleaned);
  return !Number.isNaN(asNum) ? sign * asNum : 0;
}

/**
 * Evaluates a Sun condition (after/before sunrise/sunset with optional offsets,
 * or sun.is_above_horizon / sun.is_below_horizon).
 */
export function evaluateSunCondition(
  cond: Record<string, unknown>,
  hass: RenderHass,
  now = new Date()
): boolean {
  const sun = hass.states["sun.sun"];
  if (!sun) return true; // Fail-open if sun entity not tracked

  const condType = String(cond.condition ?? "");
  if (condType === "sun.is_above_horizon") {
    return sun.state === "above_horizon";
  }
  if (condType === "sun.is_below_horizon") {
    return sun.state === "below_horizon";
  }

  const after = typeof cond.after === "string" ? cond.after.toLowerCase() : undefined;
  const before = typeof cond.before === "string" ? cond.before.toLowerCase() : undefined;

  if (!after && !before) return true;

  const afterOffset = parseOffsetSeconds(cond.after_offset);
  const beforeOffset = parseOffsetSeconds(cond.before_offset);

  // If timestamps are available on sun entity attributes, use exact timestamps with offsets
  const nextRisingStr = sun.attributes?.next_rising as string | undefined;
  const nextSettingStr = sun.attributes?.next_setting as string | undefined;

  if (nextRisingStr && nextSettingStr) {
    const nextRising = new Date(nextRisingStr).getTime();
    const nextSetting = new Date(nextSettingStr).getTime();
    const nowMs = now.getTime();
    const DAY_MS = 24 * 3600 * 1000;

    // Estimate previous rising and setting
    const prevRising = nextRising > nowMs ? nextRising - DAY_MS : nextRising;
    const prevSetting = nextSetting > nowMs ? nextSetting - DAY_MS : nextSetting;

    const risingTime = (sun.state === "above_horizon" ? prevRising : nextRising) + afterOffset * 1000;
    const settingTime = (sun.state === "below_horizon" ? prevSetting : nextSetting) + beforeOffset * 1000;

    let afterMatch = true;
    if (after === "sunrise") afterMatch = nowMs >= risingTime;
    else if (after === "sunset") afterMatch = nowMs >= settingTime;

    let beforeMatch = true;
    if (before === "sunrise") beforeMatch = nowMs < risingTime;
    else if (before === "sunset") beforeMatch = nowMs < settingTime;

    return afterMatch && beforeMatch;
  }

  // Fallback to horizon state
  if (afterOffset === 0 && beforeOffset === 0) {
    if (after === "sunrise" && before === "sunset") {
      return sun.state === "above_horizon";
    }
    if (after === "sunset" && before === "sunrise") {
      return sun.state === "below_horizon";
    }
  }

  if (after === "sunrise" || before === "sunset") {
    return sun.state === "above_horizon";
  }
  return sun.state === "below_horizon";
}

/**
 * Evaluates a Zone condition (entity in zone, or person in zone).
 * Supports standard core zone condition, shorthand zone.in_zone / zone.not_in_zone,
 * and device conditions (is_in_zone / is_not_in_zone).
 */
export function evaluateZoneCondition(
  cond: Record<string, unknown>,
  hass: RenderHass,
  defaultEntityId?: string
): boolean {
  const entityIds = extractSubjectEntityIds(cond);
  if (entityIds.length === 0 && defaultEntityId) {
    entityIds.push(defaultEntityId);
  }
  if (entityIds.length === 0) {
    // If no entity specified, try finding user's person
    const userId = (hass as unknown as { user?: { id?: string } }).user?.id;
    if (userId) {
      const person = Object.values(hass.states).find(
        (s) => s && s.entity_id?.startsWith("person.") && s.attributes?.user_id === userId
      );
      if (person) entityIds.push(person.entity_id);
    }
  }

  if (entityIds.length === 0) return true; // Fail-open

  const targetZones = extractZoneIds(cond);
  if (targetZones.length === 0) return true; // Fail-open if no zones specified

  const condType = String(cond.condition ?? "").toLowerCase();
  const actionType = String(cond.type ?? "").toLowerCase();
  const stateProp = String(cond.state ?? "").toLowerCase();

  const isNegated =
    condType === "zone.not_in_zone" ||
    condType.endsWith(".not_in_zone") ||
    actionType === "is_not_in_zone" ||
    actionType === "not_in_zone" ||
    stateProp === "not_in_zone";

  const expectInZone = !isNegated;

  const options = (cond.options as Record<string, unknown> | undefined) ?? {};
  const behavior = options.behavior === "all" ? "all" : "any";

  const isEntityInSpecificZone = (entId: string, zoneId: string): boolean => {
    const s = hass.states[entId];
    if (!s) return false;

    const rawState = String(s.state ?? "").toLowerCase();
    const inZones = Array.isArray(s.attributes?.in_zones)
      ? (s.attributes.in_zones as string[]).map((z) => String(z).toLowerCase())
      : [];

    const normZone = zoneId.toLowerCase().startsWith("zone.")
      ? zoneId.toLowerCase()
      : `zone.${zoneId.toLowerCase()}`;
    const zoneShort = normZone.replace(/^zone\./, "");
    const zoneEntity = hass.states[normZone] || hass.states[zoneId.toLowerCase()];
    const zoneFriendlyName = zoneEntity?.attributes?.friendly_name
      ? String(zoneEntity.attributes.friendly_name).toLowerCase()
      : undefined;

    // 1. in_zones attribute match (e.g. ["zone.home"])
    if (inZones.includes(normZone) || inZones.includes(zoneShort)) {
      return true;
    }

    // 2. Active zone state match (home, not_home, zone name)
    if (zoneShort === "home") {
      if (rawState === "home") return true;
      if (rawState === "not_home" || rawState === "away") return false;
    }
    if (rawState === zoneShort || rawState === normZone) return true;
    if (zoneFriendlyName && rawState === zoneFriendlyName) return true;

    return false;
  };

  const isEntityMatching = (entId: string): boolean => {
    const s = hass.states[entId];
    if (!s) return true; // Fail-open on missing entity
    const rawState = String(s.state ?? "").toLowerCase();
    if (rawState === "unavailable" || rawState === "unknown") {
      const testsForOutage =
        isExplicitOutageCheck(cond.state) || isExplicitOutageCheck(cond.state_not);
      if (!testsForOutage) return true;
    }

    const inZone = targetZones.some((z) => isEntityInSpecificZone(entId, z));
    return expectInZone ? inZone : !inZone;
  };

  if (behavior === "all") {
    return entityIds.every(isEntityMatching);
  }
  return entityIds.some(isEntityMatching);
}

/**
 * Evaluates a Location condition (person state matching locations, away, or target zones).
 */
export function evaluateLocationCondition(
  cond: Record<string, unknown>,
  hass: RenderHass
): boolean {
  const userId = (hass as unknown as { user?: { id?: string } }).user?.id;
  const person = userId
    ? Object.values(hass.states).find(
        (s) => s && s.entity_id?.startsWith("person.") && s.attributes?.user_id === userId
      )
    : undefined;

  if (!person) return true; // Fail open if no person found for user

  const personState = String(person.state ?? "").toLowerCase();

  if (cond.away === true) {
    return personState === "not_home";
  }

  if (Array.isArray(cond.locations) && cond.locations.length > 0) {
    const locs = cond.locations.map((l) => String(l).toLowerCase());
    return locs.includes(personState);
  }

  const target = cond.target as Record<string, unknown> | undefined;
  if (target) {
    const targetEntities: string[] = [];
    const add = (v: unknown) => {
      if (typeof v === "string") targetEntities.push(v.toLowerCase());
      else if (Array.isArray(v)) {
        for (const i of v) if (typeof i === "string") targetEntities.push(i.toLowerCase());
      }
    };
    add(target.entity_id);
    add(target.entity);

    if (targetEntities.length > 0) {
      const inZones = Array.isArray(person.attributes?.in_zones)
        ? (person.attributes.in_zones as string[]).map((z) => z.toLowerCase())
        : [];

      if (inZones.some((z) => targetEntities.includes(z))) return true;
      if (targetEntities.some((t) => t === "zone.home" && personState === "home")) return true;
      if (targetEntities.some((t) => t.replace(/^zone\./, "") === personState)) return true;
    }
  }

  return true;
}

/**
 * Evaluates whether a single visibility condition is met.
 */
export function evaluateCondition(
  cond: VisibilityCondition,
  hass: RenderHass,
  defaultEntityId?: string
): boolean {
  if (typeof cond === "string") {
    // Bare template string fails open
    return true;
  }

  const c = cond as Record<string, unknown>;
  const conditionType = String(c.condition ?? "");

  // Logical groups
  if (conditionType === "and") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return list.every((nested) => evaluateCondition(nested, hass, defaultEntityId));
  }
  if (conditionType === "or") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return list.some((nested) => evaluateCondition(nested, hass, defaultEntityId));
  }
  if (conditionType === "not") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return !list.some((nested) => evaluateCondition(nested, hass, defaultEntityId));
  }

  // Shorthand key logical groups e.g. { and: [...] }, { or: [...] }, { not: [...] }
  if (Array.isArray(c.and)) {
    return (c.and as VisibilityCondition[]).every((nested) =>
      evaluateCondition(nested, hass, defaultEntityId)
    );
  }
  if (Array.isArray(c.or)) {
    return (c.or as VisibilityCondition[]).some((nested) =>
      evaluateCondition(nested, hass, defaultEntityId)
    );
  }
  if (Array.isArray(c.not)) {
    return !(c.not as VisibilityCondition[]).some((nested) =>
      evaluateCondition(nested, hass, defaultEntityId)
    );
  }

  // Template condition fails open
  if (conditionType === "template") {
    return true;
  }

  // View columns condition fails open in card view
  if (conditionType === "view_columns") {
    return true;
  }

  // Time condition
  if (conditionType === "time") {
    return evaluateTimeCondition(c, hass);
  }

  // Sun condition
  if (conditionType === "sun" || conditionType.startsWith("sun.")) {
    return evaluateSunCondition(c, hass);
  }

  // Zone condition (core zone, shorthand zone.in_zone / zone.not_in_zone, device is_in_zone)
  if (
    conditionType === "zone" ||
    conditionType.startsWith("zone.") ||
    (conditionType === "device" && (c.type === "is_in_zone" || c.type === "is_not_in_zone"))
  ) {
    return evaluateZoneCondition(c, hass, defaultEntityId);
  }

  // Location condition
  if (conditionType === "location") {
    return evaluateLocationCondition(c, hass);
  }

  // Screen condition
  if (conditionType === "screen") {
    if (typeof window === "undefined" || !window.matchMedia) return true;
    try {
      return typeof c.media_query === "string" ? window.matchMedia(c.media_query).matches : true;
    } catch {
      return true;
    }
  }

  // User condition
  if (conditionType === "user") {
    const userId = (hass as unknown as { user?: { id?: string } }).user?.id;
    if (!userId) return true;
    const users = Array.isArray(c.users) ? (c.users as string[]) : [];
    return users.includes(userId);
  }

  // Entity-based conditions (state, numeric_state, garage_door.is_open, target: { entity_id }, etc.)
  const entityIds = extractSubjectEntityIds(c);
  if (entityIds.length === 0 && defaultEntityId) {
    entityIds.push(defaultEntityId);
  }
  if (entityIds.length === 0) {
    return true; // Fail open if no entity can be identified
  }

  const options = (c.options as Record<string, unknown> | undefined) ?? {};
  const behavior = options.behavior === "all" ? "all" : "any";

  if (behavior === "all") {
    return entityIds.every((id) => evaluateEntityCondition(id, c, hass));
  }
  return entityIds.some((id) => evaluateEntityCondition(id, c, hass));
}

/**
 * Evaluates whether an array of visibility conditions are all met (AND conjunction).
 */
export function evaluateConditions(
  conditions: readonly VisibilityCondition[],
  hass: RenderHass,
  defaultEntityId?: string
): boolean {
  return conditions.every((cond) => evaluateCondition(cond, hass, defaultEntityId));
}

/**
 * Checks if conditions contain any non-standard Lovelace condition shapes
 * (such as domain-specific conditions like temperature.is_value or garage_door.is_open,
 * sun, zone, location, time, view_columns, device conditions, target wrappers, or options.threshold)
 * so our robust pure evaluator is preferred.
 */
function hasNonStandardConditions(conditions?: readonly VisibilityCondition[]): boolean {
  if (!conditions) return false;
  return conditions.some((c) => {
    if (!c || typeof c !== "object") return true;
    const cond = c as Record<string, unknown>;
    const type = String(cond.condition ?? "");
    if (type.includes(".")) return true;
    if (
      type === "device" ||
      type === "sun" ||
      type === "zone" ||
      type === "location" ||
      type === "time" ||
      type === "view_columns" ||
      type === "template"
    ) {
      return true;
    }
    if (cond.target !== undefined) return true;
    if (
      cond.options &&
      typeof cond.options === "object" &&
      "threshold" in (cond.options as object)
    ) {
      return true;
    }
    if (cond.threshold !== undefined) return true;
    if (Array.isArray(cond.conditions)) {
      return hasNonStandardConditions(cond.conditions as VisibilityCondition[]);
    }
    return false;
  });
}

/**
 * Determines whether a piece of furniture should be displayed based on its visibility rules.
 *
 * Checks Home Assistant's native `checkConditionsMet` on window if exposed for standard conditions,
 * otherwise runs the synchronous pure micro-evaluator.
 */
export function isFurnitureVisible(f: Furniture, hass?: RenderHass): boolean {
  if (!f.visibility || f.visibility.length === 0) return true;
  if (!hass) return true;

  // 1. Dynamic probe to reuse Home Assistant's native validator if exposed for standard conditions
  if (typeof window !== "undefined" && !hasNonStandardConditions(f.visibility)) {
    const haCheck = (window as unknown as { checkConditionsMet?: unknown }).checkConditionsMet;
    if (typeof haCheck === "function") {
      try {
        return f.entity
          ? Boolean(haCheck(f.visibility, hass, { entity_id: f.entity }))
          : Boolean(haCheck(f.visibility, hass));
      } catch {
        // Fall back to pure evaluator on signature mismatch
      }
    }
  }

  // 2. Synchronous pure fallback mirroring Home Assistant validate-condition.ts
  return evaluateConditions(f.visibility, hass, f.entity);
}

/**
 * Recursively extracts all referenced entity IDs from visibility conditions
 * so they can be registered with the card's reactive `watchedEntities` set.
 */
export function collectConditionEntities(
  conditions?: readonly VisibilityCondition[],
  defaultEntityId?: string
): string[] {
  const entities: string[] = [];
  if (defaultEntityId && isEntityId(defaultEntityId)) {
    entities.push(defaultEntityId);
  }
  if (!conditions || conditions.length === 0) return entities;

  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as Record<string, unknown>;
    for (const id of extractConditionEntityIds(cond)) {
      if (!entities.includes(id)) {
        entities.push(id);
      }
    }
    if (Array.isArray(cond.conditions)) {
      for (const nested of cond.conditions) walk(nested);
    }
    if (Array.isArray(cond.and)) {
      for (const nested of cond.and) walk(nested);
    }
    if (Array.isArray(cond.or)) {
      for (const nested of cond.or) walk(nested);
    }
    if (Array.isArray(cond.not)) {
      for (const nested of cond.not) walk(nested);
    }
  };
  for (const cond of conditions) walk(cond);
  return entities;
}
