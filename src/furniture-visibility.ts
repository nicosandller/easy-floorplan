/**
 * Pure condition evaluator and entity collector for Furniture Visibility (Issue #310).
 * Follows Home Assistant's native dashboard card visibility schema and entity conditions:
 * - condition: "state"
 * - condition: "numeric_state"
 * - condition: "screen"
 * - condition: "user"
 * - condition: "and" | "or" | "not"
 * - condition: "<domain>.<action>" (e.g. "garage_door.is_open", "garage_door.is_closed", "door.is_open", "light.is_on", "lock.is_locked")
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
 * Extracts all entity IDs referenced in a condition, checking:
 * - cond.entity
 * - cond.entity_id (string or array)
 * - cond.target.entity_id (string or array)
 * - cond.target.entity (string or array)
 */
export function extractConditionEntityIds(c: unknown): string[] {
  if (!c || typeof c !== "object") return [];
  const cond = c as Record<string, unknown>;
  const ids: string[] = [];

  const add = (val: unknown) => {
    if (typeof val === "string" && val.trim()) {
      ids.push(val.trim());
    } else if (Array.isArray(val)) {
      for (const item of val) {
        if (typeof item === "string" && item.trim()) ids.push(item.trim());
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
    return strVal === "home";
  }
  if (check === "is_not_home") {
    return strVal !== "home";
  }

  // 2. Numeric state condition
  if (condType === "numeric_state" || cond.above !== undefined || cond.below !== undefined) {
    const num = parseFloat(strVal);
    if (Number.isNaN(num)) return true; // Fail-open on non-numeric
    if (typeof cond.above === "number" && num <= cond.above) return false;
    if (typeof cond.below === "number" && num >= cond.below) return false;
    return true;
  }

  // 3. State condition (state or state_not)
  if (cond.state !== undefined) {
    const matched = Array.isArray(cond.state)
      ? cond.state.some((s) => String(s) === strVal)
      : String(cond.state) === strVal;
    if (!matched) return false;
  }

  if (cond.state_not !== undefined) {
    const matched = Array.isArray(cond.state_not)
      ? cond.state_not.every((s) => String(s) !== strVal)
      : String(cond.state_not) !== strVal;
    if (!matched) return false;
  }

  return true;
}

/**
 * Evaluates whether a single visibility condition is met.
 */
export function evaluateCondition(cond: VisibilityCondition, hass: RenderHass): boolean {
  const c = cond as Record<string, unknown>;
  const conditionType = String(c.condition ?? "");

  // Logical groups
  if (conditionType === "and") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return list.every((nested) => evaluateCondition(nested, hass));
  }
  if (conditionType === "or") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return list.some((nested) => evaluateCondition(nested, hass));
  }
  if (conditionType === "not") {
    const list = Array.isArray(c.conditions) ? (c.conditions as VisibilityCondition[]) : [];
    return !list.some((nested) => evaluateCondition(nested, hass));
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
  const entityIds = extractConditionEntityIds(c);
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
export function evaluateConditions(conditions: readonly VisibilityCondition[], hass: RenderHass): boolean {
  return conditions.every((cond) => evaluateCondition(cond, hass));
}

/**
 * Determines whether a piece of furniture should be displayed based on its visibility rules.
 *
 * Checks Home Assistant's native `checkConditionsMet` on window if exposed,
 * otherwise runs the synchronous pure micro-evaluator.
 */
export function isFurnitureVisible(f: Furniture, hass?: RenderHass): boolean {
  if (!f.visibility || f.visibility.length === 0) return true;
  if (!hass) return true;

  // 1. Dynamic probe to reuse Home Assistant's native validator if exposed
  if (typeof window !== "undefined") {
    const haCheck = (window as unknown as { checkConditionsMet?: unknown }).checkConditionsMet;
    if (typeof haCheck === "function") {
      try {
        return Boolean(haCheck(f.visibility, hass));
      } catch {
        // Fall back to pure evaluator on signature mismatch
      }
    }
  }

  // 2. Synchronous pure fallback mirroring Home Assistant validate-condition.ts
  return evaluateConditions(f.visibility, hass);
}

/**
 * Recursively extracts all referenced entity IDs from visibility conditions
 * so they can be registered with the card's reactive `watchedEntities` set.
 */
export function collectConditionEntities(conditions?: readonly VisibilityCondition[]): string[] {
  if (!conditions || conditions.length === 0) return [];
  const entities: string[] = [];
  const walk = (c: unknown) => {
    if (!c || typeof c !== "object") return;
    const cond = c as Record<string, unknown>;
    for (const id of extractConditionEntityIds(cond)) {
      entities.push(id);
    }
    if (Array.isArray(cond.conditions)) {
      for (const nested of cond.conditions) walk(nested);
    }
  };
  for (const cond of conditions) walk(cond);
  return entities;
}
