import { LitElement, html, css, svg, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, FloorplanCardConfig, FloorItem, FloorText } from "./types";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
} from "./types";
import { WALL_THICKNESS, renderOpening, renderRipple, renderFurniture, defaultIcon } from "./render";

const ACTIVE_DOMAINS = new Set(["light", "switch", "cover", "fan", "input_boolean"]);

@customElement("easy-floorplan-card")
export class FloorplanCard extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: FloorplanCardConfig;

  public setConfig(config: FloorplanCardConfig): void {
    if (!config) throw new Error("Invalid configuration");
    this._config = {
      ...config,
      width: config.width ?? DEFAULT_WIDTH,
      height: config.height ?? DEFAULT_HEIGHT,
      walls: config.walls ?? [],
      openings: config.openings ?? [],
      items: config.items ?? [],
      texts: config.texts ?? [],
      furniture: config.furniture ?? [],
    };
  }

  public getCardSize(): number {
    return 6;
  }

  public static async getConfigElement() {
    await import("./editor");
    return document.createElement("easy-floorplan-card-editor");
  }

  public static getStubConfig(): Partial<FloorplanCardConfig> {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, walls: [], openings: [], items: [] };
  }

  private _isOn(item: FloorItem): boolean {
    const st = this.hass?.states[item.entity]?.state;
    return st === "on" || st === "open" || st === "home" || st === "playing";
  }

  private _stateText(item: FloorItem): string {
    const stateObj = this.hass?.states[item.entity];
    if (!stateObj) return "—";
    const unit = stateObj.attributes?.unit_of_measurement;
    return unit ? `${stateObj.state} ${unit}` : stateObj.state;
  }

  private _itemIcon(item: FloorItem): string {
    if (item.icon) return item.icon;
    return this.hass?.states[item.entity]?.attributes?.icon ?? defaultIcon(item.kind);
  }

  private _label(item: FloorItem): string {
    return (
      item.name ?? this.hass?.states[item.entity]?.attributes?.friendly_name ?? item.entity ?? ""
    );
  }

  private _onItemClick(item: FloorItem): void {
    if (!this.hass || !item.entity) return;
    const domain = item.entity.split(".")[0];
    if (ACTIVE_DOMAINS.has(domain)) {
      this.hass.callService("homeassistant", "toggle", { entity_id: item.entity });
    } else {
      this.dispatchEvent(
        new CustomEvent("hass-more-info", {
          detail: { entityId: item.entity },
          bubbles: true,
          composed: true,
        })
      );
    }
  }

  private _renderBadge(item: FloorItem): TemplateResult {
    const size = item.size ?? DEFAULT_ITEM_SIZE;
    return html`
      <div
        class="badge"
        style="width:${size}px;height:${size}px;transform:rotate(${item.angle ?? 0}deg);"
      >
        <ha-icon
          icon=${this._itemIcon(item)}
          style="--mdc-icon-size:${Math.round(size * 0.62)}px;"
        ></ha-icon>
      </div>
    `;
  }

  private _renderItem(item: FloorItem, c: FloorplanCardConfig): TemplateResult {
    const on = this._isOn(item);
    const showState = item.showState ?? item.kind === "sensor";
    const showIcon = item.showIcon ?? true;
    const display = item.display ?? "badge";
    const rippleColor = item.rippleColor ?? "var(--primary-color, #03a9f4)";
    const rippleSize = item.rippleSize ?? DEFAULT_RIPPLE_SIZE;

    let visual: TemplateResult | typeof nothing = nothing;
    if (display === "ripple") {
      visual = renderRipple(on, rippleColor, rippleSize);
    } else if (display === "iconRipple") {
      visual = html`<div class="stack">
        ${renderRipple(on, rippleColor, rippleSize)}
        ${showIcon ? html`<div class="stack-icon">${this._renderBadge(item)}</div>` : nothing}
      </div>`;
    } else if (showIcon) {
      visual = this._renderBadge(item);
    }

    return html`
      <div
        class="item ${on ? "on" : "off"}"
        style="left:${(item.x / c.width) * 100}%; top:${(item.y / c.height) * 100}%;"
        title=${this._label(item)}
        @click=${() => this._onItemClick(item)}
      >
        ${visual}
        ${showState ? html`<span class="label">${this._stateText(item)}</span>` : nothing}
      </div>
    `;
  }

  private _renderText(t: FloorText, c: FloorplanCardConfig): TemplateResult {
    return html`
      <div
        class="text"
        style="left:${(t.x / c.width) * 100}%; top:${(t.y / c.height) * 100}%;
               font-size:${t.size ?? DEFAULT_TEXT_SIZE}px;
               color:${t.color ?? "var(--primary-text-color)"};
               transform:translate(-50%,-50%) rotate(${t.angle ?? 0}deg);"
      >
        ${t.text}
      </div>
    `;
  }

  protected render(): TemplateResult {
    if (!this._config) return html`${nothing}`;
    const c = this._config;
    return html`
      <ha-card .header=${c.title ?? nothing}>
        <div
          class="stage"
          style="aspect-ratio: ${c.width} / ${c.height}; background:${c.background ??
          "var(--card-background-color, #fff)"};"
        >
          <svg viewBox="0 0 ${c.width} ${c.height}" preserveAspectRatio="none">
            ${(c.furniture ?? []).map((f) => renderFurniture(f))}
            ${c.walls.map(
              (w) => svg`
                <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
                      class="wall" stroke-width=${WALL_THICKNESS} stroke-linecap="round" />`
            )}
            ${c.openings.map((o) =>
              renderOpening(o, "var(--primary-text-color)", "var(--card-background-color, #fff)")
            )}
          </svg>
          <div class="items">
            ${(c.texts ?? []).map((t) => this._renderText(t, c))}
            ${c.items.map((it) => this._renderItem(it, c))}
          </div>
        </div>
      </ha-card>
    `;
  }

  static styles = css`
    ha-card {
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }
    .stage {
      position: relative;
      width: 100%;
      padding: 0;
    }
    svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    .wall {
      stroke: var(--primary-text-color);
    }
    .items {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .item {
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: auto;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    .badge {
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: var(--card-background-color, #fff);
      border: 1.5px solid var(--divider-color, #ccc);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--primary-text-color);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    .item.on .badge {
      background: var(--state-light-active-color, #fdd835);
      border-color: var(--state-light-active-color, #fdd835);
      color: var(--text-primary-color, #212121);
    }
    ha-icon {
      --mdc-icon-size: 22px;
    }
    .label {
      font-size: 12px;
      line-height: 1;
      padding: 1px 4px;
      border-radius: 4px;
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      white-space: nowrap;
    }
    .text {
      position: absolute;
      pointer-events: none;
      white-space: nowrap;
      font-weight: 500;
      line-height: 1;
    }
    .stack {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .stack-icon {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ripple {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ripple .ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid var(--fp-ripple-color);
      opacity: 0;
    }
    .ripple.active .ring {
      animation: fp-ripple 1.8s ease-out infinite;
    }
    .ripple .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--fp-ripple-color);
      opacity: 0.4;
    }
    .ripple.active .dot {
      opacity: 0.9;
    }
    @keyframes fp-ripple {
      0% {
        transform: scale(0.15);
        opacity: 0.7;
      }
      100% {
        transform: scale(1);
        opacity: 0;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "easy-floorplan-card": FloorplanCard;
  }
}
