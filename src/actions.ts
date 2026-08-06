import type { ActionConfig, HomeAssistant } from "./types";

/**
 * Domains where a bare tap toggles instead of opening more-info (legacy card
 * behavior). `cover` is deliberately absent (issue #47): an accidental tap on
 * a shutter icon used to physically move the shutter — real hardware, slow to
 * undo. Covers now open more-info like HA's Tile card; users who want the old
 * behavior set `tap_action: { action: toggle }` on the item.
 */
const TOGGLE_DOMAINS = new Set(["light", "switch", "fan", "input_boolean"]);

/** The action an item performs when no tap_action is configured. */
export function defaultItemAction(entity: string | undefined): ActionConfig {
  const domain = entity?.split(".")[0] ?? "";
  return TOGGLE_DOMAINS.has(domain) ? { action: "toggle" } : { action: "more-info" };
}

export function hasAction(config?: ActionConfig): boolean {
  return config !== undefined && config.action !== "none";
}

export function actionForGesture(
  item: {
    entity?: string;
    tap_action?: ActionConfig;
    hold_action?: ActionConfig;
    double_tap_action?: ActionConfig;
  },
  gesture: "tap" | "hold" | "double_tap"
): ActionConfig | undefined {
  if (gesture === "tap") return item.tap_action ?? defaultItemAction(item.entity);
  return gesture === "hold" ? item.hold_action : item.double_tap_action;
}

/**
 * Whether a gesture would actually do anything — the same guards
 * {@link executeAction} applies before it acts, asked ahead of time.
 *
 * `hasAction` only says a config exists and isn't "none". That is not the same
 * question: a `toggle` with no entity, a `navigate` with no path and a
 * `call-service` with no service all pass it and then do nothing.
 */
function gestureDoesSomething(
  item: { entity?: string },
  config: ActionConfig | undefined
): boolean {
  if (!config || config.action === "none") return false;
  switch (config.action) {
    case "toggle":
      return !!item.entity;
    case "more-info":
      return !!(config.entity ?? item.entity);
    case "navigate":
      return !!config.navigation_path;
    case "url":
      return !!config.url_path;
    case "perform-action":
    case "call-service":
      return serviceFromAction(config) !== null;
    case "fire-dom-event":
      // Always dispatches; whether anything listens is not ours to know.
      return true;
    default:
      return false;
  }
}

/**
 * Whether pressing this device does anything at all (issue #134) — any of its
 * three gestures.
 *
 * Drives both the press effect and the pointer cursor. A device with no entity
 * bound (issue #39: hardware that exists physically but not in HA) and one set
 * to `tap_action: none` both look pressable today and answer to nothing;
 * animating them would turn a small lie into a louder one.
 */
export function itemIsInteractive(item: {
  entity?: string;
  tap_action?: ActionConfig;
  hold_action?: ActionConfig;
  double_tap_action?: ActionConfig;
}): boolean {
  return (["tap", "hold", "double_tap"] as const).some((g) =>
    gestureDoesSomething(item, actionForGesture(item, g))
  );
}

export interface ServiceCall {
  domain: string;
  service: string;
  data?: Record<string, unknown>;
  target?: Record<string, unknown>;
}

/** Both spellings of the service action; HA renamed call-service → perform-action in 2024.8. */
export function serviceFromAction(config: ActionConfig): ServiceCall | null {
  const svc = config.perform_action ?? config.service;
  if (!svc || !svc.includes(".")) return null;
  const [domain, service] = svc.split(".", 2);
  return { domain, service, data: config.data ?? config.service_data, target: config.target };
}

/** Execute a Lovelace action. Mirrors HA's handle-action for the shapes the card supports. */
export function executeAction(
  node: HTMLElement,
  hass: HomeAssistant,
  item: { entity?: string },
  config: ActionConfig | undefined
): void {
  if (!config || config.action === "none") return;
  if (config.confirmation) {
    const text =
      (typeof config.confirmation === "object" && config.confirmation.text) ||
      `Are you sure you want to ${config.action}?`;
    if (!globalThis.confirm?.(text)) return;
  }
  switch (config.action) {
    case "toggle":
      if (item.entity) hass.callService("homeassistant", "toggle", { entity_id: item.entity });
      break;
    case "more-info": {
      const entityId = config.entity ?? item.entity;
      if (entityId) {
        node.dispatchEvent(
          new CustomEvent("hass-more-info", { detail: { entityId }, bubbles: true, composed: true })
        );
      }
      break;
    }
    case "navigate":
      if (config.navigation_path) {
        history.pushState(null, "", config.navigation_path);
        // HA routes on this window-level event (fireEvent equivalent).
        const ev = new Event("location-changed") as Event & { detail: { replace: boolean } };
        ev.detail = { replace: false };
        window.dispatchEvent(ev);
      }
      break;
    case "url":
      if (config.url_path) window.open(config.url_path);
      break;
    case "perform-action":
    case "call-service": {
      const call = serviceFromAction(config);
      if (call) hass.callService(call.domain, call.service, call.data as never, call.target as never);
      break;
    }
    case "fire-dom-event":
      node.dispatchEvent(new CustomEvent("ll-custom", { detail: config, bubbles: true, composed: true }));
      break;
  }
}
