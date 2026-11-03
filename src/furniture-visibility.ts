/**
 * Pure condition evaluator and entity collector for Furniture Visibility (Issue #310).
 * Implements Home Assistant's dashboard card visibility condition schema:
 * - condition: "state"
 * - condition: "numeric_state"
 * - condition: "screen" (responsive media queries)
 * - condition: "user" (user ID matching)
 * - condition: "and" | "or" | "not"
 *
 * Designed to evaluate against Home Assistant state and provide fail-open
 * outage protection during integration reconnects/restarts.
 */

import {
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
export function extractSubjectEntityIds(
  c: unknown,
  hass?: HomeAssistant | RenderHass
): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const ids: string[] = [];

  const reg =
    hass && "entities" in hass && hass.entities
      ? (hass.entities as Record<string, { id?: string; device_id?: string; [key: string]: unknown }>)
      : undefined;

  const add = (val: unknown) => {
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (isEntityId(trimmed)) {
        if (!ids.includes(trimmed)) ids.push(trimmed);
        return;
      }
      // If val is not an entity_id (e.g. an entity registry ID or UUID),
      // try to resolve it from hass.entities if available
      if (reg) {
        const match = Object.entries(reg).find(
          ([entId, entry]) => entId === trimmed || entry?.id === trimmed
        );
        if (match && isEntityId(match[0]) && !ids.includes(match[0])) {
          ids.push(match[0]);
        }
      }
    } else if (Array.isArray(val)) {
      for (const item of val) {
        add(item);
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

  if (cond.options && typeof cond.options === "object") {
    const opt = cond.options as Record<string, unknown>;
    add(opt.entity);
    add(opt.entity_id);
    if (opt.target && typeof opt.target === "object") {
      const optTarget = opt.target as Record<string, unknown>;
      add(optTarget.entity_id);
      add(optTarget.entity);
    }
  }

  // Fallback: If no entity IDs were found, but device_id is present and hass.entities is available:
  if (ids.length === 0 && reg && typeof cond.device_id === "string") {
    const devId = cond.device_id.trim();
    const domain = typeof cond.domain === "string" ? cond.domain.trim() : "";
    const match = Object.entries(reg).find(
      ([entId, entry]) =>
        entry?.device_id === devId &&
        (domain ? entId.startsWith(`${domain}.`) : true)
    );
    if (match && isEntityId(match[0]) && !ids.includes(match[0])) {
      ids.push(match[0]);
    }
  }

  return ids;
}

const OPEN_ALIASES = new Set(["open", "opened", "opening", "on", "unlocked", "true", "1"]);
const CLOSED_ALIASES = new Set(["closed", "closing", "off", "locked", "false", "0"]);
const AWAY_ALIASES = new Set(["not_home", "away"]);

/**
 * Compares a target state against an actual Home Assistant state.
 * Supports:
 * - Case-insensitive string matching
 * - Open / on / unlocked aliases
 * - Closed / off / locked aliases
 * - Home / away aliases
 * - Boolean coercion (e.g. true -> "on"/"open", false -> "off"/"closed")
 * - Numeric equivalence (e.g. 0 -> "0", 1.0 -> "1")
 */
export function statesMatch(target: unknown, actual: unknown): boolean {
  if (target === actual) return true;
  if (target === undefined || target === null || actual === undefined || actual === null) {
    return target === actual;
  }

  const targetStr = String(target).trim().toLowerCase();
  const actualStr = String(actual).trim().toLowerCase();
  if (targetStr === actualStr) return true;

  if (OPEN_ALIASES.has(targetStr) && OPEN_ALIASES.has(actualStr)) return true;
  if (CLOSED_ALIASES.has(targetStr) && CLOSED_ALIASES.has(actualStr)) return true;
  if (AWAY_ALIASES.has(targetStr) && AWAY_ALIASES.has(actualStr)) return true;

  const numTarget = Number(target);
  const numActual = Number(actual);
  if (!Number.isNaN(numTarget) && !Number.isNaN(numActual) && numTarget === numActual) {
    return true;
  }

  return false;
}

function deviceTypeToTargetState(type: string): { target: string; negate?: boolean } {
  const t = type.toLowerCase().trim();
  if (
    t === "is_no_motion" ||
    t === "is_clear" ||
    t === "is_no_problem" ||
    t === "is_not_occupied" ||
    t === "is_disconnected"
  ) {
    return { target: "off" };
  }
  if (
    t === "is_motion" ||
    t === "is_problem" ||
    t === "is_detected" ||
    t === "is_occupied" ||
    t === "is_connected"
  ) {
    return { target: "on" };
  }
  if (t === "is_not_home") {
    return { target: "not_home" };
  }
  if (t.startsWith("is_not_")) {
    return { target: t.replace(/^is_not_/, ""), negate: true };
  }
  if (t.startsWith("is_")) {
    return { target: t.replace(/^is_/, "") };
  }
  return { target: t };
}

function isEntityInZone(
  stateObj: { state: string; attributes?: Record<string, unknown> } | undefined,
  targetZone: string,
  states: Record<string, { state: string; attributes?: Record<string, unknown> } | undefined>
): boolean {
  if (!stateObj) return false;

  const cleanTarget = targetZone.trim().toLowerCase();
  const bareZone = cleanTarget.startsWith("zone.") ? cleanTarget.slice(5) : cleanTarget;
  const fullZone = cleanTarget.startsWith("zone.") ? cleanTarget : `zone.${cleanTarget}`;

  // 1. Check in_zones attribute (array of zone entity_ids)
  const inZones = stateObj.attributes?.in_zones;
  if (Array.isArray(inZones)) {
    if (
      inZones.some((z) => {
        const s = String(z).trim().toLowerCase();
        return s === cleanTarget || s === bareZone || s === fullZone;
      })
    ) {
      return true;
    }
  }

  // 2. Check zone attribute
  const zoneAttr = stateObj.attributes?.zone;
  if (zoneAttr) {
    const s = String(zoneAttr).trim().toLowerCase();
    if (s === cleanTarget || s === bareZone || s === fullZone) {
      return true;
    }
  }

  // 3. Check entity state
  const curState = stateObj.state.trim().toLowerCase();
  if (bareZone === "home" && curState === "home") {
    return true;
  }
  if (curState === bareZone || curState === fullZone) {
    return true;
  }

  // 4. Check zone's friendly_name against state
  const zoneEntity = states[fullZone];
  const friendlyName = zoneEntity?.attributes?.friendly_name;
  if (typeof friendlyName === "string" && friendlyName.trim().toLowerCase() === curState) {
    return true;
  }

  return false;
}

function parseTimeMinutes(timeVal: unknown): number | null {
  if (typeof timeVal !== "string") return null;
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(timeVal.trim());
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
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

  // 6. Numeric state condition
  if (conditionType === "numeric_state") {
    const entityIds = extractSubjectEntityIds(c, hass);
    if (entityIds.length === 0) {
      return { pass: false, outage: false };
    }
    const primaryEntityId = entityIds[0];
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

  // 7. State condition
  if (conditionType === "state") {
    const entityIds = extractSubjectEntityIds(c, hass);
    if (entityIds.length === 0) {
      return { pass: false, outage: false };
    }
    const primaryEntityId = entityIds[0];
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

  // 8. Device condition or purpose-specific domain condition (e.g. cover.is_closed, light.is_on)
  const isDevice = conditionType === "device";
  const isPurposeSpecific =
    conditionType.includes(".") && !conditionType.startsWith("zone.");

  if (isDevice || isPurposeSpecific) {
    const states = (hass as Partial<HomeAssistant>).states ?? {};
    const entityIds = extractSubjectEntityIds(c, hass);

    if (entityIds.length === 0) {
      if (typeof c.device_id === "string" || typeof c.entity_id === "string") {
        return { pass: true, outage: true };
      }
      return { pass: false, outage: false };
    }

    let actionOrType = String(c.type ?? "");
    if (!actionOrType && isPurposeSpecific) {
      const dotIdx = conditionType.indexOf(".");
      actionOrType = conditionType.slice(dotIdx + 1);
    }

    let target: unknown;
    let negate = false;

    if (c.state !== undefined) {
      target = c.state;
    } else if (actionOrType.toLowerCase() === "is_hvac_mode") {
      const opt = (c.options && typeof c.options === "object" ? c.options : {}) as Record<
        string,
        unknown
      >;
      target = c.hvac_mode ?? opt.hvac_mode ?? "";
    } else {
      const parsed = deviceTypeToTargetState(actionOrType);
      target = parsed.target;
      negate = Boolean(parsed.negate);
    }

    const opt = (c.options && typeof c.options === "object" ? c.options : {}) as Record<
      string,
      unknown
    >;
    const behavior = String(opt.behavior ?? c.behavior ?? "any").toLowerCase();

    const results = entityIds.map((entId) => {
      const stateObj = states[entId];
      const isMissing = !stateObj;
      const isUnavailable =
        !isMissing && (stateObj.state === "unavailable" || stateObj.state === "unknown");
      if (isMissing || isUnavailable) {
        return { pass: true, outage: true };
      }
      const match = statesMatch(target, stateObj.state);
      const pass = negate ? !match : match;
      return { pass, outage: false };
    });

    if (results.some((r) => r.outage)) {
      return { pass: true, outage: true };
    }

    const pass = behavior === "all" ? results.every((r) => r.pass) : results.some((r) => r.pass);
    return { pass, outage: false };
  }

  // 9. Zone condition
  if (
    conditionType === "zone" ||
    conditionType === "zone.in_zone" ||
    conditionType === "zone.not_in_zone"
  ) {
    const entityIds = extractSubjectEntityIds(c, hass);
    if (entityIds.length === 0) {
      return { pass: false, outage: false };
    }

    const opt = (c.options && typeof c.options === "object" ? c.options : {}) as Record<
      string,
      unknown
    >;
    const rawZones: unknown[] = [];
    const collectZone = (val: unknown) => {
      if (typeof val === "string") rawZones.push(val);
      else if (Array.isArray(val)) {
        for (const item of val) {
          if (typeof item === "string") rawZones.push(item);
        }
      }
    };
    collectZone(c.zone);
    collectZone(c.zones);
    collectZone(opt.zone);
    collectZone(opt.zones);

    const targetZones = rawZones.length > 0 ? (rawZones as string[]) : ["zone.home"];

    const states = (hass as Partial<HomeAssistant>).states ?? {};

    // Outage check: if any subject entity is missing or unavailable, fail open
    for (const entId of entityIds) {
      const stateObj = states[entId];
      if (!stateObj || stateObj.state === "unavailable" || stateObj.state === "unknown") {
        return { pass: true, outage: true };
      }
    }

    const behavior = String(opt.behavior ?? c.behavior ?? "any").toLowerCase();
    const isNegated = conditionType === "zone.not_in_zone" || c.not_in_zone === true;

    const inZoneResults = entityIds.map((entId) => {
      const stateObj = states[entId];
      return targetZones.some((z) => isEntityInZone(stateObj, z, states));
    });

    const passResult =
      behavior === "all" ? inZoneResults.every(Boolean) : inZoneResults.some(Boolean);

    const pass = isNegated ? !passResult : passResult;
    return { pass, outage: false };
  }

  // 10. Time condition
  if (conditionType === "time") {
    const now = new Date();
    // Weekday check
    const weekdaysRaw = c.weekday ?? c.weekdays;
    if (weekdaysRaw !== undefined) {
      const list = (Array.isArray(weekdaysRaw) ? weekdaysRaw : [weekdaysRaw]).map((w) =>
        String(w).trim().toLowerCase().slice(0, 3)
      );
      const dayNames = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const currentDay = dayNames[now.getDay()];
      if (!list.includes(currentDay)) {
        return { pass: false, outage: false };
      }
    }

    const curMin = now.getHours() * 60 + now.getMinutes();
    const afterMin = c.after !== undefined ? parseTimeMinutes(c.after) : null;
    const beforeMin = c.before !== undefined ? parseTimeMinutes(c.before) : null;

    if (afterMin !== null && beforeMin !== null) {
      if (afterMin <= beforeMin) {
        if (!(curMin >= afterMin && curMin < beforeMin)) {
          return { pass: false, outage: false };
        }
      } else {
        // Spans midnight, e.g. after 22:00, before 06:00
        if (!(curMin >= afterMin || curMin < beforeMin)) {
          return { pass: false, outage: false };
        }
      }
    } else if (afterMin !== null) {
      if (curMin < afterMin) {
        return { pass: false, outage: false };
      }
    } else if (beforeMin !== null) {
      if (curMin >= beforeMin) {
        return { pass: false, outage: false };
      }
    }

    return { pass: true, outage: false };
  }

  // Any other unsupported condition type (e.g. template, sun, etc.) fails closed
  return { pass: false, outage: false };
}

/**
 * Evaluates a single visibility condition against Home Assistant state.
 */
export function evaluateCondition(
  cond: unknown,
  hass: HomeAssistant | RenderHass,
  _defaultEntityId?: string
): boolean {
  return evaluateConditionInternal(cond, hass).pass;
}

/**
 * Evaluates a list of visibility conditions (logical AND by default).
 */
export function evaluateConditions(
  conditions: readonly VisibilityCondition[],
  hass: HomeAssistant | RenderHass,
  _defaultEntityId?: string
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
 * Collects all Home Assistant entity IDs referenced by a set of visibility conditions.
 */
export function collectConditionEntities(
  conditions?: readonly VisibilityCondition[],
  defaultEntityId?: string,
  hass?: HomeAssistant | RenderHass
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

    const addZone = (z: unknown) => {
      if (typeof z === "string") {
        const trimmed = z.trim();
        if (isEntityId(trimmed)) add(trimmed);
        else if (isEntityId(`zone.${trimmed}`)) add(`zone.${trimmed}`);
      } else if (Array.isArray(z)) {
        for (const item of z) addZone(item);
      }
    };

    for (const ent of extractSubjectEntityIds(cond, hass)) add(ent);

    if (cond.zone !== undefined) addZone(cond.zone);
    if (cond.zones !== undefined) addZone(cond.zones);
    if (cond.options && typeof cond.options === "object") {
      const opt = cond.options as Record<string, unknown>;
      if (opt.zone !== undefined) addZone(opt.zone);
      if (opt.zones !== undefined) addZone(opt.zones);
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
  const floors = config.floors ?? [];

  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as Record<string, unknown>;
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
