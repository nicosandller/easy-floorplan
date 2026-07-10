import type { ActionConfig, HomeAssistant } from "./types";

/** Domains where a bare tap toggles instead of opening more-info (legacy card behavior). */
const TOGGLE_DOMAINS = new Set(["light", "switch", "cover", "fan", "input_boolean"]);

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
