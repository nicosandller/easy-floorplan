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
  type ZoneVisibilityCondition,
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

const TARGET_KEYS = [
  "entity_id",
  "device_id",
  "area_id",
  "floor_id",
  "label_id",
] as const;

function isIdList(value: unknown): boolean {
  return (
    typeof value === "string" ||
    (Array.isArray(value) && value.every((id) => typeof id === "string"))
  );
}

function isTargetMapping(target: unknown, allowExclude: boolean): boolean {
  return (
    typeof target === "object" &&
    target !== null &&
    !Array.isArray(target) &&
    Object.entries(target).every(([key, value]) =>
      key === "exclude"
        ? allowExclude && isTargetMapping(value, false)
        : (TARGET_KEYS as readonly string[]).includes(key) && isIdList(value)
    )
  );
}

/**
 * Validates whether a target object conforms to Home Assistant service target schema.
 */
export function isValidTarget(target: unknown): boolean {
  return isTargetMapping(target, true);
}

function ensureArray<T>(val: T | T[] | undefined): T[] {
  if (val === undefined || val === null) return [];
  return Array.isArray(val) ? val : [val];
}

/**
 * The person state while a zone is their active zone: "home" for zone.home,
 * otherwise the zone friendly name. Passive zones never become the active state.
 */
export function activeZoneState(
  hass: HomeAssistant | RenderHass,
  zoneId: string
): string | undefined {
  const fullHass = hass as Partial<HomeAssistant>;
  const stateObj = fullHass.states?.[zoneId];
  if (!stateObj || stateObj.attributes?.passive) {
    return undefined;
  }
  return zoneId === "zone.home" ? "home" : (stateObj.attributes?.friendly_name as string | undefined);
}

function resolveTargetEntityIds(
  hass: Partial<HomeAssistant>,
  target: Record<string, unknown>
): Set<string> {
  const targetEntities = new Set<string>(ensureArray(target.entity_id as string | string[] | undefined));
  const targetDevices = new Set<string>(ensureArray(target.device_id as string | string[] | undefined));
  const targetAreas = new Set<string>(ensureArray(target.area_id as string | string[] | undefined));
  const targetFloors = new Set<string>(ensureArray(target.floor_id as string | string[] | undefined));
  const targetLabels = new Set<string>(ensureArray(target.label_id as string | string[] | undefined));

  const entities = hass.entities as Record<string, { entity_id?: string; area_id?: string | null; device_id?: string | null; labels?: string[] } | undefined> | undefined;
  const devices = hass.devices as Record<string, { id?: string; area_id?: string | null; labels?: string[] } | undefined> | undefined;
  const areas = hass.areas as Record<string, { area_id?: string; floor_id?: string | null; labels?: string[] } | undefined> | undefined;

  // 1. Expand labels -> areas, devices, entities
  if (targetLabels.size > 0) {
    if (areas) {
      for (const area of Object.values(areas)) {
        if (area && area.area_id && Array.isArray(area.labels) && area.labels.some((l) => targetLabels.has(l))) {
          targetAreas.add(area.area_id);
        }
      }
    }
    if (devices) {
      for (const device of Object.values(devices)) {
        if (device && device.id && Array.isArray(device.labels) && device.labels.some((l) => targetLabels.has(l))) {
          targetDevices.add(device.id);
        }
      }
    }
    if (entities) {
      for (const [entityId, entity] of Object.entries(entities)) {
        const id = entity?.entity_id ?? entityId;
        if (Array.isArray(entity?.labels) && entity.labels.some((l) => targetLabels.has(l))) {
          targetEntities.add(id);
        }
      }
    }
  }

  // 2. Expand floors -> areas
  if (targetFloors.size > 0 && areas) {
    for (const area of Object.values(areas)) {
      if (area && area.area_id && area.floor_id && targetFloors.has(area.floor_id)) {
        targetAreas.add(area.area_id);
      }
    }
  }

  // 3. Expand areas -> entities & devices
  if (targetAreas.size > 0) {
    if (devices) {
      for (const device of Object.values(devices)) {
        if (device && device.id && device.area_id && targetAreas.has(device.area_id)) {
          targetDevices.add(device.id);
        }
      }
    }
    if (entities) {
      for (const [entityId, entity] of Object.entries(entities)) {
        const id = entity?.entity_id ?? entityId;
        if (entity && entity.area_id && targetAreas.has(entity.area_id)) {
          targetEntities.add(id);
        }
      }
    }
  }

  // 4. Expand devices -> entities
  if (targetDevices.size > 0 && entities) {
    for (const [entityId, entity] of Object.entries(entities)) {
      const id = entity?.entity_id ?? entityId;
      if (entity && entity.device_id && targetDevices.has(entity.device_id)) {
        targetEntities.add(id);
      }
    }
  }

  return targetEntities;
}

/**
 * Resolves zone entity IDs from target (supporting entity_id, area_id, floor_id, label_id, and exclude),
 * matching Home Assistant's resolveLocationZones.
 */
export function resolveLocationZones(
  hass: HomeAssistant | RenderHass,
  target?: unknown
): string[] {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return [];
  }
  const fullHass = hass as Partial<HomeAssistant>;
  const t = target as Record<string, unknown>;

  const included = resolveTargetEntityIds(fullHass, t);
  if (t.exclude && typeof t.exclude === "object" && !Array.isArray(t.exclude)) {
    const excluded = resolveTargetEntityIds(fullHass, t.exclude as Record<string, unknown>);
    for (const id of excluded) {
      included.delete(id);
    }
  }

  const states = fullHass.states ?? {};
  const result: string[] = [];
  for (let entityId of included) {
    if (typeof entityId !== "string") continue;
    if (!entityId.startsWith("zone.")) {
      if (`zone.${entityId}` in states) {
        entityId = `zone.${entityId}`;
      } else if (!(entityId in states)) {
        continue;
      }
    }
    if (entityId.startsWith("zone.") && entityId in states) {
      result.push(entityId);
    }
  }
  return result;
}

/**
 * Resolves the logged-in user's person entity ID (e.g. "person.john") from Home Assistant state.
 */
export function getUserPerson(hass: HomeAssistant | RenderHass): string | undefined {
  const fullHass = hass as Partial<HomeAssistant>;
  const states = fullHass.states;
  if (!states) return undefined;

  const userId = fullHass.user?.id;
  // 1. Direct match by user_id attribute on person.* entity (HA standard)
  if (userId) {
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (entityId.startsWith("person.") && stateObj?.attributes?.user_id === userId) {
        return entityId;
      }
    }
  }

  // 2. Name / username match if user_id is not mapped on entity attributes
  const userName = fullHass.user?.name;
  if (userName) {
    const cleanUser = userName.toLowerCase().trim().replace(/\s+/g, "_");
    for (const [entityId, stateObj] of Object.entries(states)) {
      if (!entityId.startsWith("person.")) continue;
      const stripped = entityId.replace(/^person\./, "").toLowerCase();
      if (stripped === cleanUser) return entityId;
      const friendly = typeof stateObj?.attributes?.friendly_name === "string"
        ? (stateObj.attributes.friendly_name as string).toLowerCase().trim()
        : undefined;
      if (friendly === userName.toLowerCase().trim()) return entityId;
    }
  }

  // 3. Single-person fallback if instance only tracks 1 person
  const personEntities = Object.keys(states).filter((id) => id.startsWith("person."));
  if (personEntities.length === 1) {
    return personEntities[0];
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
    return { pass: false, outage: false };
  }

  const stateStr = personEntity.state;
  if (stateStr === "unavailable" || stateStr === "unknown") {
    return { pass: true, outage: true };
  }

  // Exact case match for locations (aligned with HA: condition.locations?.includes(stateObj.state))
  if (Array.isArray(cond.locations) && cond.locations.includes(stateStr)) {
    return { pass: true, outage: false };
  }

  // Away matches "not_home" (or legacy "away")
  if (cond.away === true && (stateStr === "not_home" || stateStr === "away")) {
    return { pass: true, outage: false };
  }

  if (cond.target != null) {
    if (!isValidTarget(cond.target)) {
      return { pass: false, outage: false };
    }
    const zones = resolveLocationZones(hass, cond.target);
    if (zones.length === 0) {
      return { pass: false, outage: false };
    }

    const inZones = personEntity.attributes?.in_zones;
    const matchesZoneState = (zoneId: string): boolean => {
      const az = activeZoneState(hass, zoneId);
      if (az === undefined) return false;
      if (az === stateStr) return true;
      if (az.toLowerCase() === "home" && stateStr.toLowerCase() === "home") return true;
      return false;
    };

    // Legacy device trackers don't report in_zones (person only adds
    // zone.home for them), so their state, the active zone name, is all there
    // is. Trackers that do report it have an empty list only when not_home.
    if (!Array.isArray(inZones) || inZones.length === 0) {
      const pass =
        stateStr !== "not_home" &&
        stateStr !== "away" &&
        zones.some(matchesZoneState);
      return { pass, outage: false };
    }

    if (cond.match_mode === "active_zone") {
      const activeZone = inZones.find(matchesZoneState);
      const pass = activeZone !== undefined && zones.includes(activeZone);
      return { pass, outage: false };
    }

    // Default / "any_zone":
    const pass = inZones.some((zone) => zones.includes(zone));
    return { pass, outage: false };
  }

  return { pass: false, outage: false };
}

/**
 * Great-circle distance between two GPS coordinates in meters via Haversine formula.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Checks whether an entity is currently inside a given zone.
 */
export function isEntityInZone(
  hass: HomeAssistant | RenderHass,
  entityId: string,
  rawZoneId: string
): { inZone: boolean; outage: boolean } {
  const fullHass = hass as Partial<HomeAssistant>;
  const states = fullHass.states ?? {};

  // If states haven't loaded yet, fail open
  if (Object.keys(states).length === 0) {
    return { inZone: false, outage: true };
  }

  const entityObj = states[entityId];
  if (!entityObj) {
    return { inZone: false, outage: true };
  }

  const stateStr = entityObj.state;
  if (stateStr === "unavailable" || stateStr === "unknown") {
    return { inZone: false, outage: true };
  }

  const zoneId = rawZoneId.startsWith("zone.") ? rawZoneId : `zone.${rawZoneId}`;
  const zoneObj = states[zoneId];
  if (zoneObj && (zoneObj.state === "unavailable" || zoneObj.state === "unknown")) {
    return { inZone: false, outage: true };
  }

  // 1. Check in_zones attribute (HA standard for person and device_tracker)
  const inZones = entityObj.attributes?.in_zones;
  if (Array.isArray(inZones)) {
    const bareZone = zoneId.replace(/^zone\./, "");
    if (
      inZones.includes(zoneId) ||
      inZones.includes(rawZoneId) ||
      inZones.includes(bareZone)
    ) {
      return { inZone: true, outage: false };
    }
  }

  // 2. State-based matching
  const az = activeZoneState(hass, zoneId);
  if (az !== undefined) {
    if (stateStr === az) {
      return { inZone: true, outage: false };
    }
    if (az.toLowerCase() === "home" && stateStr.toLowerCase() === "home") {
      return { inZone: true, outage: false };
    }
  }

  if (zoneId === "zone.home" && stateStr.toLowerCase() === "home") {
    return { inZone: true, outage: false };
  }

  const friendlyName = zoneObj?.attributes?.friendly_name;
  if (
    typeof friendlyName === "string" &&
    stateStr.toLowerCase() === friendlyName.toLowerCase()
  ) {
    return { inZone: true, outage: false };
  }

  const bareZone = zoneId.replace(/^zone\./, "");
  if (stateStr.toLowerCase() === bareZone.toLowerCase()) {
    return { inZone: true, outage: false };
  }

  // 3. GPS coordinate distance check
  const entityLat =
    entityObj.attributes?.latitude != null ? Number(entityObj.attributes.latitude) : NaN;
  const entityLon =
    entityObj.attributes?.longitude != null ? Number(entityObj.attributes.longitude) : NaN;
  const zoneLat =
    zoneObj?.attributes?.latitude != null ? Number(zoneObj.attributes.latitude) : NaN;
  const zoneLon =
    zoneObj?.attributes?.longitude != null ? Number(zoneObj.attributes.longitude) : NaN;

  if (
    !Number.isNaN(entityLat) &&
    !Number.isNaN(entityLon) &&
    !Number.isNaN(zoneLat) &&
    !Number.isNaN(zoneLon)
  ) {
    const radius = Number(zoneObj?.attributes?.radius ?? 100);
    const dist = haversineDistanceMeters(entityLat, entityLon, zoneLat, zoneLon);
    if (!Number.isNaN(dist) && !Number.isNaN(radius) && dist <= radius) {
      return { inZone: true, outage: false };
    }
  }

  return { inZone: false, outage: false };
}

/**
 * Evaluates Home Assistant zone conditions (e.g. condition: zone, zone.in_zone, not_in_zone).
 */
export function checkZoneCondition(
  cond: ZoneVisibilityCondition | unknown,
  hass: HomeAssistant | RenderHass
): ConditionResult {
  const c = cond as Record<string, unknown>;
  const conditionType = String(c.condition ?? "").toLowerCase();

  const isNot =
    conditionType === "zone.not_in_zone" ||
    conditionType === "not_in_zone" ||
    conditionType === "zone.occupancy_is_not_detected" ||
    c.not === true;

  // Extract entity / entity_id / target.entity_id
  let entityIds: string[] = [];
  if (typeof c.entity_id === "string") entityIds.push(c.entity_id);
  else if (Array.isArray(c.entity_id)) entityIds.push(...(c.entity_id as string[]));

  if (typeof c.entity === "string") entityIds.push(c.entity);
  else if (Array.isArray(c.entity)) entityIds.push(...(c.entity as string[]));

  if (c.target && typeof c.target === "object") {
    const targetObj = c.target as Record<string, unknown>;
    if (typeof targetObj.entity_id === "string") entityIds.push(targetObj.entity_id);
    else if (Array.isArray(targetObj.entity_id)) {
      entityIds.push(...(targetObj.entity_id as string[]));
    }
  }

  entityIds = Array.from(
    new Set(entityIds.filter((id) => typeof id === "string" && id.trim().length > 0))
  );

  // If no entity explicitly specified, fallback to logged-in user person
  if (entityIds.length === 0) {
    const userPerson = getUserPerson(hass);
    if (userPerson) {
      entityIds.push(userPerson);
    } else {
      const states = (hass as Partial<HomeAssistant>).states ?? {};
      if (Object.keys(states).length === 0) {
        return { pass: true, outage: true };
      }
      return { pass: false, outage: false };
    }
  }

  // Extract zone / options.zone / target.zone
  let zones: string[] = [];
  if (typeof c.zone === "string") zones.push(c.zone);
  else if (Array.isArray(c.zone)) zones.push(...(c.zone as string[]));

  if (c.options && typeof c.options === "object") {
    const opts = c.options as Record<string, unknown>;
    if (typeof opts.zone === "string") zones.push(opts.zone);
    else if (Array.isArray(opts.zone)) zones.push(...(opts.zone as string[]));
  }

  if (c.target && typeof c.target === "object") {
    const targetObj = c.target as Record<string, unknown>;
    if (typeof targetObj.zone === "string") zones.push(targetObj.zone);
    else if (Array.isArray(targetObj.zone)) zones.push(...(targetObj.zone as string[]));
  }

  zones = Array.from(
    new Set(zones.filter((z) => typeof z === "string" && z.trim().length > 0))
  );
  if (zones.length === 0) {
    return { pass: false, outage: false };
  }

  const matchMode = (c.match ?? c.behavior ?? "all") === "any" ? "any" : "all";

  let hasOutage = false;
  const entityResults = entityIds.map((entityId) => {
    let inAnyZone = false;
    for (const z of zones) {
      const res = isEntityInZone(hass, entityId, z);
      if (res.outage) {
        hasOutage = true;
      }
      if (res.inZone) {
        inAnyZone = true;
        break;
      }
    }
    return inAnyZone;
  });

  const pass =
    matchMode === "any"
      ? entityResults.some((matched) => matched)
      : entityResults.every((matched) => matched);

  if (isNot) {
    if (hasOutage) {
      return { pass: true, outage: true };
    }
    return { pass: !pass, outage: false };
  }

  if (!pass && hasOutage) {
    return { pass: true, outage: true };
  }

  return { pass, outage: false };
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

  // 7b. Zone condition
  if (
    conditionType === "zone" ||
    conditionType.startsWith("zone.") ||
    conditionType === "not_in_zone"
  ) {
    return checkZoneCondition(c, hass);
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
    const ct = String(cond.condition ?? "").toLowerCase();
    if (ct === targetType || ct.startsWith(`${targetType}.`)) return true;
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
 * Checks whether any furniture visibility rules across the floorplan reference location or zone conditions.
 */
export function hasLocationConditions(config?: FloorplanCardConfig): boolean {
  if (!config) return false;
  for (const floor of getFloors(config)) {
    for (const f of floor.furniture ?? []) {
      if (
        hasConditionType(f.visibility, "location") ||
        hasConditionType(f.visibility, "zone") ||
        hasConditionType(f.visibility, "not_in_zone")
      ) {
        return true;
      }
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

    if (Array.isArray(cond.entity_id)) {
      for (const eid of cond.entity_id) add(eid);
    }
    if (Array.isArray(cond.entity)) {
      for (const eid of cond.entity) add(eid);
    }

    if (cond.zone) {
      if (typeof cond.zone === "string") {
        add(cond.zone.includes(".") ? cond.zone : `zone.${cond.zone}`);
      } else if (Array.isArray(cond.zone)) {
        for (const z of cond.zone) {
          if (typeof z === "string") add(z.includes(".") ? z : `zone.${z}`);
        }
      }
    }
    if (cond.options && typeof cond.options === "object") {
      const opts = cond.options as Record<string, unknown>;
      if (typeof opts.zone === "string") {
        add(opts.zone.includes(".") ? opts.zone : `zone.${opts.zone}`);
      } else if (Array.isArray(opts.zone)) {
        for (const z of opts.zone) {
          if (typeof z === "string") add(z.includes(".") ? z : `zone.${z}`);
        }
      }
    }

    if (cond.target && typeof cond.target === "object") {
      const targetObj = cond.target as Record<string, unknown>;
      if (typeof targetObj.entity_id === "string") add(targetObj.entity_id);
      else if (Array.isArray(targetObj.entity_id)) {
        for (const tid of targetObj.entity_id) add(tid);
      }
      if (typeof targetObj.zone === "string") {
        add(targetObj.zone.includes(".") ? targetObj.zone : `zone.${targetObj.zone}`);
      } else if (Array.isArray(targetObj.zone)) {
        for (const z of targetObj.zone) {
          if (typeof z === "string") add(z.includes(".") ? z : `zone.${z}`);
        }
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
