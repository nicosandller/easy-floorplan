/**
 * Tap / hold / double-tap gesture detection — the canonical Lovelace
 * `actionHandler` directive used across HA core and community cards
 * (Mushroom, boilerplate-card), adapted to this card's imports. A singleton
 * `<action-handler>` element on document.body owns the timers; bound
 * elements fire an `action` event with `{ action: "tap"|"hold"|"double_tap" }`.
 */
import { noChange } from "lit";
import { AttributePart, directive, Directive, DirectiveParameters } from "lit/directive.js";

export interface ActionHandlerOptions {
  hasHold?: boolean;
  hasDoubleClick?: boolean;
  disabled?: boolean;
}

export interface ActionHandlerDetail {
  action: "tap" | "hold" | "double_tap";
}

interface ActionHandlerElement extends HTMLElement {
  actionHandler?: {
    options: ActionHandlerOptions;
    start?: (ev: Event) => void;
    end?: (ev: Event) => void;
    handleKeyDown?: (ev: KeyboardEvent) => void;
  };
}

const HOLD_TIME = 500;
const DOUBLE_TAP_TIME = 250;

class ActionHandler extends HTMLElement {
  public holdTime = HOLD_TIME;

  protected timer?: number;

  protected held = false;

  /** Set when the gesture turned into a scroll/drag — suppresses the tap. */
  private cancelled = false;

  private dblClickTimeout?: number;

  public connectedCallback(): void {
    Object.assign(this.style, {
      position: "fixed",
      width: "0",
      height: "0",
    });
    ["touchcancel", "mouseout", "mouseup", "touchmove", "mousewheel", "wheel", "scroll"].forEach(
      (ev) => {
        document.addEventListener(
          ev,
          () => {
            this.cancelled = true;
            if (this.timer) {
              clearTimeout(this.timer);
              this.timer = undefined;
            }
          },
          { passive: true }
        );
      }
    );
  }

  public bind(element: ActionHandlerElement, options: ActionHandlerOptions = {}): void {
    if (element.actionHandler && deepEqualOptions(options, element.actionHandler.options)) {
      return;
    }
    if (element.actionHandler) {
      element.removeEventListener("touchstart", element.actionHandler.start!);
      element.removeEventListener("touchend", element.actionHandler.end!);
      element.removeEventListener("touchcancel", element.actionHandler.end!);
      element.removeEventListener("mousedown", element.actionHandler.start!);
      element.removeEventListener("click", element.actionHandler.end!);
      element.removeEventListener("keydown", element.actionHandler.handleKeyDown!);
    } else {
      element.addEventListener("contextmenu", (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
      });
    }
    element.actionHandler = { options };
    if (options.disabled) return;

    element.actionHandler.start = () => {
      this.cancelled = false;
      this.held = false;
      if (options.hasHold) {
        this.timer = window.setTimeout(() => {
          this.held = true;
        }, this.holdTime);
      }
    };

    element.actionHandler.end = (ev: Event) => {
      // A gesture that scrolled/dragged since start is not a tap.
      if (["touchend", "touchcancel"].includes(ev.type) && this.cancelled) {
        if (this.timer) clearTimeout(this.timer);
        this.timer = undefined;
        return;
      }
      // Prevent the mouse event a touch tap synthesizes from double-firing.
      if (ev.type === "touchend" || ev.type === "touchcancel") {
        if (ev.cancelable) ev.preventDefault();
        if (ev.type === "touchcancel") {
          if (this.timer) clearTimeout(this.timer);
          this.timer = undefined;
          return;
        }
      }
      const target = ev.target as HTMLElement;
      if (options.hasHold && this.timer) {
        clearTimeout(this.timer);
        this.timer = undefined;
      }
      if (options.hasHold && this.held) {
        fireActionEvent(target, "hold");
      } else if (options.hasDoubleClick) {
        if ((ev.type === "click" && (ev as MouseEvent).detail < 2) || !this.dblClickTimeout) {
          this.dblClickTimeout = window.setTimeout(() => {
            this.dblClickTimeout = undefined;
            fireActionEvent(target, "tap");
          }, DOUBLE_TAP_TIME);
        } else {
          clearTimeout(this.dblClickTimeout);
          this.dblClickTimeout = undefined;
          fireActionEvent(target, "double_tap");
        }
      } else {
        fireActionEvent(target, "tap");
      }
    };

    element.actionHandler.handleKeyDown = (ev: KeyboardEvent) => {
      if (!["Enter", " "].includes(ev.key)) return;
      // Space must activate, not scroll the dashboard.
      ev.preventDefault();
      (ev.currentTarget as ActionHandlerElement).actionHandler!.end!(ev);
    };

    element.addEventListener("touchstart", element.actionHandler.start, { passive: true });
    element.addEventListener("touchend", element.actionHandler.end);
    element.addEventListener("touchcancel", element.actionHandler.end);
    element.addEventListener("mousedown", element.actionHandler.start, { passive: true });
    element.addEventListener("click", element.actionHandler.end);
    element.addEventListener("keydown", element.actionHandler.handleKeyDown);
  }
}

function deepEqualOptions(a: ActionHandlerOptions, b: ActionHandlerOptions): boolean {
  return (
    a.hasHold === b.hasHold && a.hasDoubleClick === b.hasDoubleClick && a.disabled === b.disabled
  );
}

function fireActionEvent(target: HTMLElement, action: ActionHandlerDetail["action"]): void {
  target.dispatchEvent(
    new CustomEvent("action", { detail: { action }, bubbles: true, composed: true })
  );
}

function getActionHandler(): ActionHandler {
  const body = document.body;
  const existing = body.querySelector("action-handler-easy-floorplan") as ActionHandler | null;
  if (existing) return existing;
  const actionhandler = document.createElement("action-handler-easy-floorplan") as ActionHandler;
  body.appendChild(actionhandler);
  return actionhandler;
}

if (!customElements.get("action-handler-easy-floorplan")) {
  customElements.define("action-handler-easy-floorplan", ActionHandler);
}

export const actionHandlerBind = (
  element: ActionHandlerElement,
  options?: ActionHandlerOptions
): void => {
  getActionHandler().bind(element, options);
};

export const actionHandler = directive(
  class extends Directive {
    update(part: AttributePart, [options]: DirectiveParameters<this>) {
      actionHandlerBind(part.element as ActionHandlerElement, options);
      return noChange;
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    render(_options?: ActionHandlerOptions) {}
  }
);
