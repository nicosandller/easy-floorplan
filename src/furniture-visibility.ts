/**
 * Pure condition evaluator and entity collector for Furniture Visibility (Issue #310).
 * Implements Home Assistant's dashboard card visibility and condition schema:
 * - condition: "state"
 * - condition: "numeric_state"
 * - condition: "sun" (including sun ascending / descending, above/below horizon, sunrise/sunset)
 * - condition: "device" / domain verbs (e.g. "garage_door.is_open", "cover.is_closed", etc.)
 * - condition: "zone" / "location" / "area" (person in area or zone, person not in area or zone)
 * - condition: "time" (server timezone aware)
 * - condition: "screen" (responsive media queries)
 * - condition: "user" (user ID matching)
 * - condition: "and" | "or" | "not"
 *
 * Designed to evaluate against Home Assistant state and provide fail-open
 * outage protection during integration reconnects/restarts.
 */

import {
  entityIdsInHaArea,
  type FloorplanCardConfig,
  type Furniture,
  type HomeAssistant,
  type RenderHass,
  type VisibilityCondition,
} from "./types";

/**
 * Checks whether a value is a valid Home Assistant entity ID (e.g. "sensor.temperature", "domain.object_id").
 */
export function isEntityId(val: unknown): val is string {
  if (typeof val !== "string") return false;
  const s = val.trim();
  if (!s || s.includes(" ") || !s.includes(".")) return false;
  if (!Number.isNaN(Number(s))) return false;
  return /^[a-z0-9_]+\.[a-z0-9_]+$/i.test(s);
}

/**
 * Checks whether a state or list of states explicitly tests for an outage ("unavailable" or "unknown").
 */
function isExplicitOutageCheck(stateOrStates: unknown): boolean {
  if (stateOrStates === undefined || stateOrStates === null) return false;
  if (Array.isArray(stateOrStates)) {
    return stateOrStates.some((s) => s === "unavailable" || s === "unknown");
  }
  return stateOrStates === "unavailable" || stateOrStates === "unknown";
}

/**
 * Extracts primary subject entity IDs from a condition object:
 * cond.entity, cond.entity_id, cond.target.entity_id, cond.target.entity
 */
export function extractSubjectEntityIds(c: unknown): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const ids: string[] = [];

  const add = (val: unknown) => {
    if (typeof val === "string" && isEntityId(val)) {
      const trimmed = val.trim();
      if (!ids.includes(trimmed)) ids.push(trimmed);
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && isEntityId(item)) {
          const trimmed = item.trim();
          if (!ids.includes(trimmed)) ids.push(trimmed);
        }
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
 * Extracts zone entity IDs from a condition object.
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

interface ConditionResult {
  pass: boolean;
  outage: boolean;
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
 * Evaluates Sun conditions:
 * - sun ascending / sun descending (sun.sun attribute rising: true / false)
 * - above / below horizon
 * - sunrise / sunset with offsets
 */
export function evaluateSunCondition(
  cond: Record<string, unknown>,
  hass: HomeAssistant | RenderHass,
  now = new Date()
): ConditionResult {
  const states = (hass as Partial<HomeAssistant>).states ?? {};
  const sun = states["sun.sun"];
  if (!sun) return { pass: true, outage: true };

  const isUnavailable = sun.state === "unavailable" || sun.state === "unknown";
  if (isUnavailable) return { pass: true, outage: true };

  const condType = String(cond.condition ?? "").toLowerCase();
  const actionType = String(cond.type ?? "").toLowerCase();
  const stateVal = String(cond.state ?? "").toLowerCase();

  // 1. Sun ascending (rising) / descending (setting)
  const isAscendingCheck =
    condType === "sun.is_ascending" ||
    condType === "sun.is_rising" ||
    actionType === "is_ascending" ||
    actionType === "is_rising" ||
    cond.ascending === true ||
    cond.rising === true ||
    stateVal === "ascending" ||
    stateVal === "rising";

  if (isAscendingCheck) {
    const isRising = sun.attributes?.rising === true;
    return { pass: isRising, outage: false };
  }

  const isDescendingCheck =
    condType === "sun.is_descending" ||
    condType === "sun.is_setting" ||
    actionType === "is_descending" ||
    actionType === "is_setting" ||
    cond.descending === true ||
    cond.setting === true ||
    stateVal === "descending" ||
    stateVal === "setting";

  if (isDescendingCheck) {
    const isDescending = sun.attributes?.rising === false;
    return { pass: isDescending, outage: false };
  }

  // 2. Horizon checks (above_horizon / below_horizon)
  if (
    condType === "sun.is_above_horizon" ||
    actionType === "is_above_horizon" ||
    stateVal === "above_horizon"
  ) {
    return { pass: sun.state === "above_horizon", outage: false };
  }
  if (
    condType === "sun.is_below_horizon" ||
    actionType === "is_below_horizon" ||
    stateVal === "below_horizon"
  ) {
    return { pass: sun.state === "below_horizon", outage: false };
  }

  // 3. Sunrise / sunset relative times with offsets
  const after = typeof cond.after === "string" ? cond.after.toLowerCase() : undefined;
  const before = typeof cond.before === "string" ? cond.before.toLowerCase() : undefined;

  if (!after && !before) {
    return { pass: true, outage: false };
  }

  const afterOffset = parseOffsetSeconds(cond.after_offset);
  const beforeOffset = parseOffsetSeconds(cond.before_offset);

  const nextRisingStr = sun.attributes?.next_rising as string | undefined;
  const nextSettingStr = sun.attributes?.next_setting as string | undefined;

  if (nextRisingStr && nextSettingStr) {
    const nextRising = new Date(nextRisingStr).getTime();
    const nextSetting = new Date(nextSettingStr).getTime();
    const nowMs = now.getTime();
    const DAY_MS = 24 * 3600 * 1000;

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

    return { pass: afterMatch && beforeMatch, outage: false };
  }

  // Fallback to state check
  if (after === "sunrise" || before === "sunset") {
    return { pass: sun.state === "above_horizon", outage: false };
  }
  return { pass: sun.state === "below_horizon", outage: false };
}

/**
 * Evaluates Zone, Area, or Location conditions (e.g. Person in area or zone, Person not in area or zone).
 */
export function evaluateZoneOrAreaCondition(
  cond: Record<string, unknown>,
  hass: HomeAssistant | RenderHass,
  defaultEntityId?: string
): ConditionResult {
  const states = (hass as Partial<HomeAssistant>).states ?? {};
  const condType = String(cond.condition ?? "").toLowerCase();
  const actionType = String(cond.type ?? "").toLowerCase();
  const stateProp = String(cond.state ?? "").toLowerCase();

  const isNegated =
    condType === "zone.not_in_zone" ||
    condType.endsWith(".not_in_zone") ||
    condType === "area.not_in_area" ||
    condType.endsWith(".not_in_area") ||
    actionType === "is_not_in_zone" ||
    actionType === "not_in_zone" ||
    actionType === "is_not_in_area" ||
    actionType === "not_in_area" ||
    stateProp === "not_in_zone" ||
    stateProp === "not_in_area";

  // Check target area
  const targetArea = (
    typeof cond.area_id === "string"
      ? cond.area_id
      : typeof cond.area === "string"
        ? cond.area
        : cond.target && typeof cond.target === "object"
          ? ((cond.target as Record<string, unknown>).area_id as string | undefined) ??
            ((cond.target as Record<string, unknown>).area as string | undefined)
          : undefined
  )?.trim();

  // Check target zones
  const targetZones = extractZoneIds(cond);

  // Subject entities
  let entityIds = extractSubjectEntityIds(cond);
  if (entityIds.length === 0 && defaultEntityId) {
    entityIds.push(defaultEntityId);
  }
  if (entityIds.length === 0) {
    // If no entity specified, check user's person
    const userId = (hass as Partial<HomeAssistant>).user?.id;
    if (userId) {
      const person = Object.values(states).find(
        (s) => s && s.entity_id?.startsWith("person.") && s.attributes?.user_id === userId
      );
      if (person?.entity_id) entityIds.push(person.entity_id);
    }
    // Or collect all person entities
    if (entityIds.length === 0) {
      for (const id of Object.keys(states)) {
        if (id.startsWith("person.")) entityIds.push(id);
      }
    }
  }

  // Location condition: locations or away
  if (condType === "location") {
    if (entityIds.length === 0) return { pass: true, outage: false };
    const person = states[entityIds[0]];
    if (!person) return { pass: true, outage: true };
    const pState = String(person.state ?? "").toLowerCase();
    if (cond.away === true) {
      return { pass: pState === "not_home", outage: false };
    }
    if (Array.isArray(cond.locations) && cond.locations.length > 0) {
      const locs = cond.locations.map((l) => String(l).toLowerCase());
      return { pass: locs.includes(pState), outage: false };
    }
  }

  // Area-level presence evaluation
  if (targetArea) {
    const normArea = targetArea.toLowerCase();

    // Check if any specified person/entity is in the area
    if (entityIds.length > 0) {
      let anyMatch = false;
      let hasOutage = false;

      for (const entId of entityIds) {
        const s = states[entId];
        if (!s) {
          hasOutage = true;
          continue;
        }
        const stateVal = String(s.state ?? "").toLowerCase();
        const attrArea = String(s.attributes?.area ?? s.attributes?.area_id ?? s.attributes?.room ?? "").toLowerCase();

        if (stateVal === normArea || attrArea === normArea) {
          anyMatch = true;
          break;
        }

        // Entity registry area match
        const entRegistry = (hass as unknown as { entities?: Record<string, { area_id?: string }> }).entities;
        if (entRegistry?.[entId]?.area_id?.toLowerCase() === normArea) {
          if (stateVal === "home" || stateVal === "on") {
            anyMatch = true;
            break;
          }
        }
      }

      if (!anyMatch && hasOutage) {
        return { pass: true, outage: true };
      }
      const pass = isNegated ? !anyMatch : anyMatch;
      return { pass, outage: false };
    }

    // Zero entities specified: check area entities directly
    const areaEntities = entityIdsInHaArea(hass, targetArea);
    const anyActive = areaEntities.some((id) => {
      const st = states[id]?.state?.toLowerCase();
      return st === "on" || st === "home" || st === "occupied";
    });
    const pass = isNegated ? !anyActive : anyActive;
    return { pass, outage: false };
  }

  // Zone condition evaluation
  if (targetZones.length > 0 && entityIds.length > 0) {
    const isEntityInZone = (entId: string, zoneId: string): boolean => {
      const s = states[entId];
      if (!s) return false;

      const rawState = String(s.state ?? "").toLowerCase();
      const inZones = Array.isArray(s.attributes?.in_zones)
        ? (s.attributes.in_zones as string[]).map((z) => String(z).toLowerCase())
        : [];

      const normZone = zoneId.toLowerCase().startsWith("zone.")
        ? zoneId.toLowerCase()
        : `zone.${zoneId.toLowerCase()}`;
      const zoneShort = normZone.replace(/^zone\./, "");
      const zoneEntity = states[normZone] || states[zoneId.toLowerCase()];
      const zoneFriendly = zoneEntity?.attributes?.friendly_name
        ? String(zoneEntity.attributes.friendly_name).toLowerCase()
        : undefined;

      if (inZones.includes(normZone) || inZones.includes(zoneShort)) return true;

      if (zoneShort === "home") {
        if (rawState === "home") return true;
        if (rawState === "not_home" || rawState === "away") return false;
      }
      if (rawState === zoneShort || rawState === normZone) return true;
      if (zoneFriendly && rawState === zoneFriendly) return true;

      return false;
    };

    let anyInZone = false;
    let anyOutage = false;

    for (const entId of entityIds) {
      const s = states[entId];
      if (!s || s.state === "unavailable" || s.state === "unknown") {
        anyOutage = true;
        continue;
      }
      if (targetZones.some((z) => isEntityInZone(entId, z))) {
        anyInZone = true;
        break;
      }
    }

    if (!anyInZone && anyOutage) {
      return { pass: true, outage: true };
    }
    const pass = isNegated ? !anyInZone : anyInZone;
    return { pass, outage: false };
  }

  return { pass: true, outage: false };
}

/**
 * Evaluates Device conditions and domain-specific verbs (e.g. garage_door.is_open, cover.is_closed).
 */
export function evaluateDeviceOrActionCondition(
  entityId: string,
  cond: Record<string, unknown>,
  hass: HomeAssistant | RenderHass
): ConditionResult {
  const states = (hass as Partial<HomeAssistant>).states ?? {};
  const stateObj = states[entityId];
  if (!stateObj) return { pass: true, outage: true };

  const raw = cond.attribute ? stateObj.attributes?.[cond.attribute as string] : stateObj.state;
  const strVal = String(raw ?? "").toLowerCase();

  // Outage handling
  if (strVal === "unavailable" || strVal === "unknown") {
    const isExplicit = isExplicitOutageCheck(cond.state) || isExplicitOutageCheck(cond.state_not);
    if (!isExplicit) return { pass: true, outage: true };
  }

  const condType = String(cond.condition ?? "").toLowerCase();
  const actionType = String(cond.type ?? "").toLowerCase();

  const verb = condType.includes(".")
    ? condType.split(".").pop()!
    : condType === "device"
      ? actionType
      : condType;

  switch (verb) {
    case "is_open":
      return {
        pass: strVal === "open" || strVal === "opening" || strVal === "on" || strVal === "unlocked",
        outage: false,
      };
    case "is_closed":
      return {
        pass: strVal === "closed" || strVal === "closing" || strVal === "off" || strVal === "locked",
        outage: false,
      };
    case "is_on":
      return { pass: strVal === "on", outage: false };
    case "is_off":
      return { pass: strVal === "off", outage: false };
    case "is_locked":
      return { pass: strVal === "locked" || strVal === "locking", outage: false };
    case "is_unlocked":
      return { pass: strVal === "unlocked" || strVal === "unlocking", outage: false };
    case "is_home":
      return { pass: strVal === "home" || strVal === "on", outage: false };
    case "is_not_home":
      return { pass: strVal !== "home" && strVal !== "on", outage: false };
    case "is_detected":
    case "is_motion":
      return {
        pass: strVal === "on" || strVal === "detected" || strVal === "motion",
        outage: false,
      };
    case "is_clear":
    case "is_no_motion":
      return {
        pass: strVal === "off" || strVal === "clear" || strVal === "no_motion",
        outage: false,
      };
    case "is_occupied":
      return { pass: strVal === "on" || strVal === "occupied" || strVal === "home", outage: false };
    case "is_not_occupied":
      return { pass: strVal === "off" || strVal === "not_occupied" || strVal === "not_home", outage: false };
    default:
      return { pass: true, outage: false };
  }
}

/**
 * Evaluates a Time condition (after, before, weekday / weekdays) in the Home Assistant timezone.
 */
export function evaluateTimeCondition(
  cond: Record<string, unknown>,
  hass: HomeAssistant | RenderHass
): ConditionResult {
  const timeZone = (hass as Partial<HomeAssistant>)?.config?.time_zone;
  const now = new Date();

  let currentWeekday = "";
  let currentSeconds = 0;

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || undefined,
      hour12: false,
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(now);
    let hour = 0;
    let min = 0;
    let sec = 0;
    for (const p of parts) {
      if (p.type === "weekday") currentWeekday = p.value.toLowerCase().slice(0, 3);
      else if (p.type === "hour") hour = parseInt(p.value, 10);
      else if (p.type === "minute") min = parseInt(p.value, 10);
      else if (p.type === "second") sec = parseInt(p.value, 10);
    }
    if (hour === 24) hour = 0;
    currentSeconds = hour * 3600 + min * 60 + sec;
  } catch {
    const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
    currentWeekday = days[now.getDay()];
    currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
  }

  // 1. Weekday check: supports both HA automation `weekday` and dashboard `weekdays`
  const rawWeekdays = cond.weekday ?? cond.weekdays;
  if (rawWeekdays !== undefined && rawWeekdays !== null) {
    const list = Array.isArray(rawWeekdays) ? rawWeekdays : [rawWeekdays];
    const normalized = list.map((d) => String(d).trim().toLowerCase().slice(0, 3));
    if (normalized.length > 0 && !normalized.includes(currentWeekday)) {
      return { pass: false, outage: false };
    }
  }

  // 2. Time bounds (after / before)
  const parseTimeStringToSeconds = (str: string): number | undefined => {
    const m = str.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return undefined;
    const h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const s = m[3] ? parseInt(m[3], 10) : 0;
    if (h < 0 || h > 23 || min < 0 || min > 59 || s < 0 || s > 59) return undefined;
    return h * 3600 + min * 60 + s;
  };

  const resolveTimeSeconds = (val: unknown): number | undefined => {
    if (typeof val !== "string") return undefined;
    const trimmed = val.trim();
    if (!trimmed) return undefined;
    if (isEntityId(trimmed)) {
      const states = (hass as Partial<HomeAssistant>).states ?? {};
      const st = states[trimmed]?.state;
      if (!st || st === "unavailable" || st === "unknown") return undefined;
      return parseTimeStringToSeconds(st);
    }
    return parseTimeStringToSeconds(trimmed);
  };

  const afterSec = resolveTimeSeconds(cond.after);
  const beforeSec = resolveTimeSeconds(cond.before);

  if (afterSec !== undefined && beforeSec !== undefined) {
    if (afterSec <= beforeSec) {
      if (currentSeconds < afterSec || currentSeconds >= beforeSec) {
        return { pass: false, outage: false };
      }
    } else {
      // Overnight span (e.g. 22:00 to 06:00)
      if (currentSeconds < afterSec && currentSeconds >= beforeSec) {
        return { pass: false, outage: false };
      }
    }
  } else if (afterSec !== undefined) {
    if (currentSeconds < afterSec) {
      return { pass: false, outage: false };
    }
  } else if (beforeSec !== undefined) {
    if (currentSeconds >= beforeSec) {
      return { pass: false, outage: false };
    }
  }

  return { pass: true, outage: false };
}

/**
 * Evaluates a single condition node.
 */
function evaluateConditionInternal(
  cond: unknown,
  hass: HomeAssistant | RenderHass,
  defaultEntityId?: string
): ConditionResult {
  if (!cond || typeof cond !== "object") {
    return { pass: true, outage: false };
  }

  const c = cond as Record<string, unknown>;
  const conditionType = String(c.condition ?? "").toLowerCase();

  // 1. Logical groups: AND
  if (conditionType === "and" || Array.isArray(c.and)) {
    const list = Array.isArray(c.conditions)
      ? (c.conditions as VisibilityCondition[])
      : Array.isArray(c.and)
        ? (c.and as VisibilityCondition[])
        : [];
    if (list.length === 0) return { pass: true, outage: false };
    const results = list.map((nested) =>
      evaluateConditionInternal(nested, hass, defaultEntityId)
    );
    const pass = results.every((r) => r.pass);
    const outage = results.some((r) => r.outage);
    return { pass, outage };
  }

  // 2. Logical groups: OR
  if (conditionType === "or" || Array.isArray(c.or)) {
    const list = Array.isArray(c.conditions)
      ? (c.conditions as VisibilityCondition[])
      : Array.isArray(c.or)
        ? (c.or as VisibilityCondition[])
        : [];
    if (list.length === 0) return { pass: true, outage: false };
    const results = list.map((nested) =>
      evaluateConditionInternal(nested, hass, defaultEntityId)
    );
    const pass = results.some((r) => r.pass);
    const outage = results.some((r) => r.outage);
    return { pass, outage };
  }

  // 3. Logical groups: NOT
  if (conditionType === "not" || Array.isArray(c.not)) {
    const list = Array.isArray(c.conditions)
      ? (c.conditions as VisibilityCondition[])
      : Array.isArray(c.not)
        ? (c.not as VisibilityCondition[])
        : [];
    if (list.length === 0) return { pass: true, outage: false };
    const results = list.map((nested) =>
      evaluateConditionInternal(nested, hass, defaultEntityId)
    );

    // Fail-open protection under NOT:
    // If an inner condition encountered an outage, do not invert fail-open to false.
    if (results.some((r) => r.outage)) {
      return { pass: true, outage: true };
    }

    const pass = !results.some((r) => r.pass);
    return { pass, outage: false };
  }

  // 4. Client-side condition: Screen (media_query)
  if (conditionType === "screen") {
    if (typeof window === "undefined" || !window.matchMedia) {
      return { pass: true, outage: false };
    }
    const query = typeof c.media_query === "string" ? c.media_query.trim() : "";
    if (!query) return { pass: true, outage: false };
    try {
      const pass = window.matchMedia(query).matches;
      return { pass, outage: false };
    } catch {
      return { pass: true, outage: false };
    }
  }

  // 5. Client-side condition: User
  if (conditionType === "user") {
    const userHass = hass as Partial<HomeAssistant>;
    const userId = userHass.user?.id;
    if (!userId) return { pass: true, outage: false };
    const allowed = Array.isArray(c.users) ? (c.users as string[]) : [];
    if (allowed.length === 0) return { pass: true, outage: false };
    return { pass: allowed.includes(userId), outage: false };
  }

  // 6. Time condition (weekday, weekdays, after, before, timezone aware)
  if (conditionType === "time") {
    return evaluateTimeCondition(c, hass);
  }

  // 7. Trigger condition: dashboard cards have no automation trigger context
  if (conditionType === "trigger") {
    return { pass: false, outage: false };
  }

  // 8. Sun condition (ascending/descending, horizon, sunrise/sunset)
  if (conditionType === "sun" || conditionType.startsWith("sun.")) {
    return evaluateSunCondition(c, hass);
  }

  // 9. Zone, Area, or Location condition
  if (
    conditionType === "zone" ||
    conditionType.startsWith("zone.") ||
    conditionType === "area" ||
    conditionType.startsWith("area.") ||
    conditionType === "location" ||
    (conditionType === "device" && (c.type === "is_in_zone" || c.type === "is_not_in_zone"))
  ) {
    return evaluateZoneOrAreaCondition(c, hass, defaultEntityId);
  }

  // 10. Entity-based conditions: state, numeric_state, device, or domain verbs
  const entityIds = extractSubjectEntityIds(c);
  if (entityIds.length === 0 && defaultEntityId) {
    entityIds.push(defaultEntityId);
  }

  // If device_id is provided without entity_id, attempt to resolve via entity registry
  if (entityIds.length === 0 && typeof c.device_id === "string") {
    const entRegistry = (hass as unknown as { entities?: Record<string, { device_id?: string; entity_id?: string }> }).entities;
    if (entRegistry) {
      const found = Object.values(entRegistry).find((e) => e?.device_id === c.device_id);
      if (found?.entity_id) entityIds.push(found.entity_id);
    }
  }

  if (entityIds.length === 0) {
    return { pass: true, outage: false };
  }

  const primaryEntityId = entityIds[0];
  const states = (hass as Partial<HomeAssistant>).states ?? {};
  const stateObj = states[primaryEntityId];
  const isMissing = !stateObj;
  const isUnavailable = !isMissing && (stateObj.state === "unavailable" || stateObj.state === "unknown");
  const isOutage = isMissing || isUnavailable;

  const explicitOutage =
    isExplicitOutageCheck(c.state) || isExplicitOutageCheck(c.state_not);

  if (isOutage && !explicitOutage) {
    return { pass: true, outage: true };
  }

  // Device verbs or domain conditions (e.g. garage_door.is_open, cover.is_closed, type: is_open)
  const isDeviceOrDomainAction =
    conditionType === "device" ||
    conditionType.includes(".") ||
    typeof c.type === "string";

  if (isDeviceOrDomainAction && conditionType !== "numeric_state" && conditionType !== "state") {
    return evaluateDeviceOrActionCondition(primaryEntityId, c, hass);
  }

  // Numeric state condition
  if (conditionType === "numeric_state") {
    const attr = typeof c.attribute === "string" ? c.attribute : undefined;
    const rawVal = attr && stateObj ? stateObj.attributes?.[attr] : stateObj?.state;
    const num = Number(rawVal);
    if (Number.isNaN(num)) {
      return { pass: true, outage: true };
    }

    if (c.above !== undefined) {
      let aboveVal: number;
      if (typeof c.above === "string" && isEntityId(c.above) && states[c.above]) {
        aboveVal = Number(states[c.above]?.state);
      } else {
        aboveVal = Number(c.above);
      }
      if (!Number.isNaN(aboveVal) && !(num > aboveVal)) {
        return { pass: false, outage: false };
      }
    }

    if (c.below !== undefined) {
      let belowVal: number;
      if (typeof c.below === "string" && isEntityId(c.below) && states[c.below]) {
        belowVal = Number(states[c.below]?.state);
      } else {
        belowVal = Number(c.below);
      }
      if (!Number.isNaN(belowVal) && !(num < belowVal)) {
        return { pass: false, outage: false };
      }
    }

    return { pass: true, outage: false };
  }

  // State condition
  const attr = typeof c.attribute === "string" ? c.attribute : undefined;
  const rawVal = attr && stateObj ? stateObj.attributes?.[attr] : stateObj?.state;
  const actualState =
    rawVal === undefined || rawVal === null ? (isMissing ? "unavailable" : "") : String(rawVal);

  const resolveTargetState = (val: unknown): string => {
    if (typeof val === "string" && isEntityId(val) && states[val]) {
      return String(states[val]?.state ?? val);
    }
    return String(val);
  };

  if (c.state_not !== undefined) {
    const list = Array.isArray(c.state_not) ? c.state_not : [c.state_not];
    const targets = list.map(resolveTargetState);
    if (targets.some((t) => t === actualState)) {
      return { pass: false, outage: false };
    }
  }

  if (c.state !== undefined) {
    const list = Array.isArray(c.state) ? c.state : [c.state];
    const targets = list.map(resolveTargetState);
    const match = targets.some((t) => t === actualState);
    if (!match) {
      return { pass: false, outage: false };
    }
  }

  return { pass: true, outage: false };
}

/**
 * Determines whether a single condition evaluates to true.
 */
export function evaluateCondition(
  cond: unknown,
  hass: HomeAssistant | RenderHass,
  defaultEntityId?: string
): boolean {
  return evaluateConditionInternal(cond, hass, defaultEntityId).pass;
}

/**
 * Evaluates whether an array of visibility conditions are all met (AND conjunction).
 */
export function evaluateConditions(
  conditions: readonly VisibilityCondition[],
  hass: HomeAssistant | RenderHass,
  defaultEntityId?: string
): boolean {
  return conditions.every((cond) => evaluateCondition(cond, hass, defaultEntityId));
}

/**
 * Determines whether a piece of furniture should be displayed based on its visibility rules.
 * Runs the synchronous pure micro-evaluator against the provided Home Assistant state.
 */
export function isFurnitureVisible(
  f: Furniture,
  hass?: HomeAssistant | RenderHass
): boolean {
  if (!f.visibility || f.visibility.length === 0) return true;
  if (!hass) return true;
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

    const add = (id: unknown) => {
      if (typeof id === "string" && isEntityId(id) && !entities.includes(id)) {
        entities.push(id.trim());
      }
    };

    for (const ent of extractSubjectEntityIds(cond)) add(ent);

    // Threshold or state entity comparisons
    if (typeof cond.above === "string") add(cond.above);
    if (typeof cond.below === "string") add(cond.below);
    if (typeof cond.state === "string") add(cond.state);
    if (typeof cond.state_not === "string") add(cond.state_not);

    // Sun conditions watch sun.sun
    const cType = String(cond.condition ?? "").toLowerCase();
    if (cType === "sun" || cType.startsWith("sun.")) {
      add("sun.sun");
    }

    // Time condition entities (if after/before references an entity)
    if (typeof cond.after === "string" && isEntityId(cond.after)) add(cond.after);
    if (typeof cond.before === "string" && isEntityId(cond.before)) add(cond.before);

    // Zone conditions
    for (const z of extractZoneIds(cond)) add(z);

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

/**
 * Checks if a config defines any furniture with time visibility conditions.
 */
export function hasTimeConditions(config?: FloorplanCardConfig): boolean {
  if (!config) return false;
  const floors = config.floors ?? [];
  const walk = (c: unknown): boolean => {
    if (!c || typeof c !== "object") return false;
    const cond = c as Record<string, unknown>;
    if (cond.condition === "time") return true;
    if (Array.isArray(cond.conditions) && cond.conditions.some(walk)) return true;
    if (Array.isArray(cond.and) && cond.and.some(walk)) return true;
    if (Array.isArray(cond.or) && cond.or.some(walk)) return true;
    if (Array.isArray(cond.not) && cond.not.some(walk)) return true;
    return false;
  };

  for (const floor of floors) {
    for (const f of floor.furniture ?? []) {
      for (const cond of f.visibility ?? []) {
        if (walk(cond)) return true;
      }
    }
  }
  return false;
}

/**
 * Extracts all unique media query strings defined across all furniture visibility conditions
 * on all floors in a floorplan configuration.
 */
export function collectConditionMediaQueries(config: FloorplanCardConfig): string[] {
  const queries: string[] = [];
  const floors = config.floors ?? [];

  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as Record<string, unknown>;
    if (cond.condition === "screen" && typeof cond.media_query === "string") {
      const q = cond.media_query.trim();
      if (q && !queries.includes(q)) queries.push(q);
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

  for (const floor of floors) {
    for (const f of floor.furniture ?? []) {
      for (const cond of f.visibility ?? []) {
        walk(cond);
      }
    }
  }

  return queries;
}
