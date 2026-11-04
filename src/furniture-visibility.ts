/**
 * Pure condition evaluator and entity collector for Furniture Visibility (Issue #310).
 * Implements Home Assistant's dashboard card visibility condition schema:
 * - condition: "state"
 * - condition: "numeric_state"
 * - condition: "screen" (responsive media queries)
 * - condition: "user" (user ID matching)
 * - condition: "time" (time of day and day of week)
 * - condition: "location" (person presence / zone matching)
 * - condition: "and" | "or" | "not"
 *
 * Designed to evaluate against Home Assistant state and provide fail-open
 * outage protection during integration reconnects/restarts.
 */

import {
  getFloors,
  type FloorplanCardConfig,
  type Furniture,
  type HomeAssistant,
  type LocationCondition,
  type RenderHass,
  type TimeCondition,
  type VisibilityCondition,
} from "./types";

/** Periodic polling interval for live time condition transitions (10 seconds). */
export const TIME_CONDITION_TICK_MS = 10_000;

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
 * Extracts the single primary subject entity ID from a condition object:
 * cond.entity, cond.entity_id, cond.target.entity_id, cond.target.entity.
 * HA's card condition takes one entity.
 */
export function extractSubjectEntityId(c: unknown): string | undefined {
  if (!c || typeof c !== "object") return undefined;
  const cond = c as Record<string, unknown>;

  const check = (val: unknown): string | undefined => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (isEntityId(trimmed)) return trimmed;
    }
    return undefined;
  };

  return (
    check(cond.entity) ??
    check(cond.entity_id) ??
    (cond.target && typeof cond.target === "object"
      ? check((cond.target as Record<string, unknown>).entity_id) ??
        check((cond.target as Record<string, unknown>).entity)
      : undefined)
  );
}

/**
 * Compares a target state against an actual Home Assistant state.
 * HA's own card conditions match exactly (no semantic aliasing).
 * Supports:
 * - Exact equality
 * - Case-insensitive string matching
 * - Numeric equivalence (e.g. 0 -> "0", 1.0 -> "1")
 */
export function statesMatch(target: unknown, actual: unknown): boolean {
  if (target === actual) return true;
  if (target === undefined || target === null || actual === undefined || actual === null) {
    return target === actual;
  }

  const targetStr = String(target).trim();
  const actualStr = String(actual).trim();
  if (targetStr.toLowerCase() === actualStr.toLowerCase()) return true;

  const numTarget = Number(target);
  const numActual = Number(actual);
  if (
    targetStr !== "" &&
    actualStr !== "" &&
    !Number.isNaN(numTarget) &&
    !Number.isNaN(numActual) &&
    numTarget === numActual
  ) {
    return true;
  }

  return false;
}

/**
 * Formats a Date in a specific timezone into hours, minutes, seconds, and lowercase weekday name.
 */
export function getTimeInZone(
  date: Date,
  timeZone?: string
): { hours: number; minutes: number; seconds: number; weekday: string } {
  const opts: Intl.DateTimeFormatOptions = {
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
  };
  if (timeZone) {
    try {
      opts.timeZone = timeZone;
    } catch {
      // Invalid time zone: fall back to local
    }
  }
  const parts = new Intl.DateTimeFormat("en-US", opts).formatToParts(date);
  let hours = date.getHours();
  let minutes = date.getMinutes();
  let seconds = date.getSeconds();
  let weekday = "";
  for (const p of parts) {
    if (p.type === "hour") {
      const val = parseInt(p.value, 10);
      if (!Number.isNaN(val)) hours = val;
    } else if (p.type === "minute") {
      const val = parseInt(p.value, 10);
      if (!Number.isNaN(val)) minutes = val;
    } else if (p.type === "second") {
      const val = parseInt(p.value, 10);
      if (!Number.isNaN(val)) seconds = val;
    } else if (p.type === "weekday") {
      weekday = p.value.toLowerCase();
    }
  }
  return { hours, minutes, seconds, weekday };
}

/**
 * Parses "HH:MM" or "HH:MM:SS" into total seconds from midnight.
 */
export function parseTimeString(timeStr?: string): number | undefined {
  if (!timeStr || typeof timeStr !== "string") return undefined;
  const parts = timeStr.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  const s = parts.length === 3 ? Number(parts[2]) : 0;
  if (Number.isNaN(h) || Number.isNaN(m) || Number.isNaN(s)) return undefined;
  if (h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) return undefined;
  return h * 3600 + m * 60 + s;
}

/**
 * Checks whether the current time (in seconds) falls between afterSec and beforeSec.
 * Supports midnight crossing when after > before (e.g. 22:00 to 06:00).
 */
export function checkTimeRange(
  nowSec: number,
  afterSec?: number,
  beforeSec?: number
): boolean {
  if (afterSec === undefined && beforeSec === undefined) return true;
  if (afterSec !== undefined && beforeSec !== undefined) {
    if (afterSec <= beforeSec) {
      return nowSec >= afterSec && nowSec < beforeSec;
    }
    // Midnight crossing
    return nowSec >= afterSec || nowSec < beforeSec;
  }
  if (afterSec !== undefined) {
    return nowSec >= afterSec;
  }
  return nowSec < beforeSec!;
}

/**
 * Evaluates a time condition against the current time and Home Assistant timezone.
 */
export function checkTimeCondition(
  cond: TimeCondition,
  hass: HomeAssistant | RenderHass
): ConditionResult {
  const fullHass = hass as Partial<HomeAssistant>;
  const localeTimeZone = (fullHass.locale as Record<string, unknown> | undefined)?.time_zone;
  const timeZone =
    localeTimeZone === "server" ? fullHass.config?.time_zone : undefined;
  const now = new Date();
  const { hours, minutes, seconds, weekday } = getTimeInZone(now, timeZone);

  if (cond.weekdays && cond.weekdays.length > 0) {
    const days = cond.weekdays.map((d) => String(d).toLowerCase());
    if (!days.includes(weekday)) {
      return { pass: false, outage: false };
    }
  }

  if (!cond.after && !cond.before) {
    return { pass: true, outage: false };
  }

  const nowSec = hours * 3600 + minutes * 60 + seconds;
  const afterSec = parseTimeString(cond.after);
  const beforeSec = parseTimeString(cond.before);
  const pass = checkTimeRange(nowSec, afterSec, beforeSec);
  return { pass, outage: false };
}

/**
 * Resolves the logged-in user's person entity ID (e.g. "person.john") from Home Assistant state.
 */
export function getUserPerson(hass: HomeAssistant | RenderHass): string | undefined {
  const fullHass = hass as Partial<HomeAssistant>;
  const userId = fullHass.user?.id;
  if (!userId || !fullHass.states) return undefined;
  for (const [entityId, stateObj] of Object.entries(fullHass.states)) {
    if (entityId.startsWith("person.") && stateObj?.attributes?.user_id === userId) {
      return entityId;
    }
  }
  return undefined;
}

/**
 * Evaluates a location condition against the logged-in user's person entity and current zone.
 */
export function checkLocationCondition(
  cond: LocationCondition,
  hass: HomeAssistant | RenderHass
): ConditionResult {
  const fullHass = hass as Partial<HomeAssistant>;
  const states = fullHass.states ?? {};

  // If states haven't loaded yet, fail open
  if (Object.keys(states).length === 0) {
    return { pass: true, outage: true };
  }

  const userPersonId = getUserPerson(hass);
  if (!userPersonId) {
    return { pass: false, outage: false };
  }

  const personEntity = states[userPersonId];
  if (!personEntity) {
    return { pass: true, outage: true };
  }

  const stateStr = personEntity.state;
  if (stateStr === "unavailable" || stateStr === "unknown") {
    return { pass: true, outage: true };
  }

  if (cond.away) {
    return { pass: stateStr === "not_home", outage: false };
  }

  if (Array.isArray(cond.locations) && cond.locations.length > 0) {
    const locs = cond.locations.map((l) => String(l).toLowerCase());
    return { pass: locs.includes(stateStr.toLowerCase()), outage: false };
  }

  if (cond.target && typeof cond.target === "object") {
    const targetObj = cond.target as Record<string, unknown>;
    const targetVal = targetObj.entity_id;
    const targetIds: string[] = [];
    if (typeof targetVal === "string") targetIds.push(targetVal);
    else if (Array.isArray(targetVal)) {
      for (const id of targetVal) {
        if (typeof id === "string") targetIds.push(id);
      }
    }

    if (targetIds.length > 0) {
      const inZones = Array.isArray(personEntity.attributes?.in_zones)
        ? (personEntity.attributes.in_zones as string[])
        : [];

      const matchesActiveZone = (tid: string): boolean => {
        if (tid.toLowerCase() === stateStr.toLowerCase()) return true;
        const stripped = tid.replace(/^zone\./i, "");
        if (stripped.toLowerCase() === stateStr.toLowerCase()) return true;
        const zoneObj = states[tid];
        const friendly = zoneObj?.attributes?.friendly_name;
        if (typeof friendly === "string" && friendly.toLowerCase() === stateStr.toLowerCase()) {
          return true;
        }
        return false;
      };

      if (cond.match_mode === "active_zone") {
        const pass = targetIds.some(matchesActiveZone);
        return { pass, outage: false };
      }

      // Default or "any_zone":
      if (inZones.length > 0) {
        const pass = targetIds.some((t) => inZones.includes(t));
        return { pass, outage: false };
      }

      const pass = targetIds.some(matchesActiveZone);
      return { pass, outage: false };
    }
  }

  return { pass: true, outage: false };
}

interface ConditionResult {
  pass: boolean;
  outage: boolean;
}

/**
 * Internal evaluator returning both evaluation outcome and whether the pass was due to an outage.
 */
function evaluateConditionInternal(
  cond: unknown,
  hass: HomeAssistant | RenderHass
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
      evaluateConditionInternal(nested, hass)
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
      evaluateConditionInternal(nested, hass)
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
      evaluateConditionInternal(nested, hass)
    );
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

  // 6. Time condition
  if (conditionType === "time") {
    return checkTimeCondition(c as unknown as TimeCondition, hass);
  }

  // 7. Location condition
  if (conditionType === "location") {
    return checkLocationCondition(c as unknown as LocationCondition, hass);
  }

  // 8. Numeric state condition
  if (conditionType === "numeric_state") {
    const primaryEntityId = extractSubjectEntityId(c);
    if (!primaryEntityId) {
      return { pass: false, outage: false };
    }
    const states = (hass as Partial<HomeAssistant>).states ?? {};
    const stateObj = states[primaryEntityId];
    const isMissing = !stateObj;
    const isUnavailable =
      !isMissing && (stateObj.state === "unavailable" || stateObj.state === "unknown");
    const isOutage = isMissing || isUnavailable;

    if (isOutage) {
      return { pass: true, outage: true };
    }

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

  // 9. State condition
  if (conditionType === "state") {
    const primaryEntityId = extractSubjectEntityId(c);
    if (!primaryEntityId) {
      return { pass: false, outage: false };
    }
    const states = (hass as Partial<HomeAssistant>).states ?? {};
    const stateObj = states[primaryEntityId];
    const isMissing = !stateObj;
    const isUnavailable =
      !isMissing && (stateObj.state === "unavailable" || stateObj.state === "unknown");
    const isOutage = isMissing || isUnavailable;

    const explicitOutage =
      isExplicitOutageCheck(c.state) || isExplicitOutageCheck(c.state_not);

    if (isOutage && !explicitOutage) {
      return { pass: true, outage: true };
    }

    const attr = typeof c.attribute === "string" ? c.attribute : undefined;
    const rawVal = attr && stateObj ? stateObj.attributes?.[attr] : stateObj?.state;
    const actualState =
      rawVal === undefined || rawVal === null
        ? isMissing
          ? "unavailable"
          : ""
        : rawVal;

    const resolveTargetState = (val: unknown): unknown => {
      if (typeof val === "string" && isEntityId(val) && states[val]) {
        return states[val]?.state ?? val;
      }
      return val;
    };

    if (c.state_not !== undefined) {
      const list = Array.isArray(c.state_not) ? c.state_not : [c.state_not];
      const targets = list.map(resolveTargetState);
      if (targets.some((t) => statesMatch(t, actualState))) {
        return { pass: false, outage: false };
      }
    }

    if (c.state !== undefined) {
      const list = Array.isArray(c.state) ? c.state : [c.state];
      const targets = list.map(resolveTargetState);
      const match = targets.some((t) => statesMatch(t, actualState));
      if (!match) {
        return { pass: false, outage: false };
      }
    }

    return { pass: true, outage: false };
  }

  // Any other unsupported condition type fails closed
  return { pass: false, outage: false };
}

/**
 * Evaluates a single visibility condition against Home Assistant state.
 */
export function evaluateCondition(
  cond: unknown,
  hass: HomeAssistant | RenderHass
): boolean {
  return evaluateConditionInternal(cond, hass).pass;
}

/**
 * Evaluates a list of visibility conditions (logical AND by default).
 */
export function evaluateConditions(
  conditions: readonly VisibilityCondition[],
  hass: HomeAssistant | RenderHass
): boolean {
  return conditions.every((cond) => evaluateCondition(cond, hass));
}

/**
 * Determines whether a furniture item is visible according to its configured conditions.
 */
export function isFurnitureVisible(
  f: Furniture,
  hass?: HomeAssistant | RenderHass
): boolean {
  if (!f.visibility || f.visibility.length === 0) return true;
  if (!hass) return true;
  return evaluateConditions(f.visibility, hass);
}

/**
 * Checks whether a conditions list recursively contains a specific condition type.
 */
export function hasConditionType(
  conditions: readonly VisibilityCondition[] | undefined,
  type: string
): boolean {
  if (!conditions || conditions.length === 0) return false;
  const targetType = type.toLowerCase();
  for (const c of conditions) {
    if (!c || typeof c !== "object") continue;
    const cond = c as unknown as Record<string, unknown>;
    if (String(cond.condition ?? "").toLowerCase() === targetType) return true;
    if (Array.isArray(cond.conditions) && hasConditionType(cond.conditions as VisibilityCondition[], type)) return true;
    if (Array.isArray(cond.and) && hasConditionType(cond.and as VisibilityCondition[], type)) return true;
    if (Array.isArray(cond.or) && hasConditionType(cond.or as VisibilityCondition[], type)) return true;
    if (Array.isArray(cond.not) && hasConditionType(cond.not as VisibilityCondition[], type)) return true;
  }
  return false;
}

/**
 * Checks whether any furniture visibility rules across the floorplan reference time conditions.
 */
export function hasTimeConditions(config?: FloorplanCardConfig): boolean {
  if (!config) return false;
  for (const floor of getFloors(config)) {
    for (const f of floor.furniture ?? []) {
      if (hasConditionType(f.visibility, "time")) return true;
    }
  }
  return false;
}

/**
 * Checks whether any furniture visibility rules across the floorplan reference location conditions.
 */
export function hasLocationConditions(config?: FloorplanCardConfig): boolean {
  if (!config) return false;
  for (const floor of getFloors(config)) {
    for (const f of floor.furniture ?? []) {
      if (hasConditionType(f.visibility, "location")) return true;
    }
  }
  return false;
}

/**
 * Collects all Home Assistant entity IDs referenced by a set of visibility conditions.
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

  const add = (id: unknown) => {
    if (typeof id === "string" && isEntityId(id) && !entities.includes(id)) {
      entities.push(id.trim());
    }
  };

  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as unknown as Record<string, unknown>;

    const ent = extractSubjectEntityId(cond);
    if (ent) add(ent);

    if (cond.condition === "location" && cond.target && typeof cond.target === "object") {
      const targetObj = cond.target as Record<string, unknown>;
      if (typeof targetObj.entity_id === "string") add(targetObj.entity_id);
      else if (Array.isArray(targetObj.entity_id)) {
        for (const tid of targetObj.entity_id) add(tid);
      }
    }

    if (typeof cond.above === "string") add(cond.above);
    if (typeof cond.below === "string") add(cond.below);
    if (typeof cond.state === "string") add(cond.state);
    if (typeof cond.state_not === "string") add(cond.state_not);

    if (Array.isArray(cond.conditions)) for (const nested of cond.conditions) walk(nested);
    if (Array.isArray(cond.and)) for (const nested of cond.and) walk(nested);
    if (Array.isArray(cond.or)) for (const nested of cond.or) walk(nested);
    if (Array.isArray(cond.not)) for (const nested of cond.not) walk(nested);
  };

  for (const cond of conditions) walk(cond);
  return entities;
}

/**
 * Collects all responsive media queries referenced by screen conditions.
 */
export function collectConditionMediaQueries(config: FloorplanCardConfig): string[] {
  const queries: string[] = [];
  const floors = getFloors(config);

  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as unknown as Record<string, unknown>;
    if (cond.condition === "screen" && typeof cond.media_query === "string") {
      const q = cond.media_query.trim();
      if (q && !queries.includes(q)) queries.push(q);
    }
    if (Array.isArray(cond.conditions)) for (const nested of cond.conditions) walk(nested);
    if (Array.isArray(cond.and)) for (const nested of cond.and) walk(nested);
    if (Array.isArray(cond.or)) for (const nested of cond.or) walk(nested);
    if (Array.isArray(cond.not)) for (const nested of cond.not) walk(nested);
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
