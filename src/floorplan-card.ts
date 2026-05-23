import { LitElement, html, css, svg, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HomeAssistant, FloorplanCardConfig, FloorItem, FloorText, Floor } from "./types";
import {
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  DEFAULT_ITEM_SIZE,
  DEFAULT_TEXT_SIZE,
  DEFAULT_RIPPLE_SIZE,
  getFloors,
} from "./types";
import {
  WALL_THICKNESS,
  renderOpening,
  openingDefaultOpen,
  renderRipple,
  renderFurniture,
  defaultIcon,
} from "./render";
import type { Opening } from "./types";

const ACTIVE_DOMAINS = new Set(["light", "switch", "cover", "fan", "input_boolean"]);

@customElement("easy-floorplan-card")
export class FloorplanCard extends LitElement {
  private static _nextWallMaskId = 0;

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private _config?: FloorplanCardConfig;
  /** View-state: which floor is shown. Never persisted to config. */
  @state() private _activeFloorId?: string;
  private readonly _wallMaskId = `fp-wall-mask-${FloorplanCard._nextWallMaskId++}`;

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

  /** Whether an opening should be drawn open, from its entity state (or the default). */
  private _openingIsOpen(o: Opening): boolean {
    if (!o.entity) return openingDefaultOpen(o);
    const st = this.hass?.states[o.entity]?.state;
    if (st === undefined) return openingDefaultOpen(o);
    // A contact sensor / cover is "open" when on/open; everything else is closed.
    const open = st === "on" || st === "open";
    return o.invert ? !open : open;
  }

  /** Formatted "state unit" for a single entity, or "—" when unavailable. */
  private _entityStateText(entityId?: string): string {
    if (!entityId) return "—";
    const stateObj = this.hass?.states[entityId];
    if (!stateObj) return "—";
    const unit = stateObj.attributes?.unit_of_measurement;
    return unit ? `${stateObj.state} ${unit}` : stateObj.state;
  }

  /** State text for the item: primary entity, plus secondary (e.g. humidity) when set. */
  private _stateText(item: FloorItem): string {
    const primary = this._entityStateText(item.entity);
    if (!item.secondaryEntity) return primary;
    return `${primary} · ${this._entityStateText(item.secondaryEntity)}`;
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
    const floors = getFloors(c);
    const active =
      floors.find((f) => f.id === this._activeFloorId) ??
      floors.find((f) => f.id === c.defaultFloor) ??
      floors[0];
    return html`
      <ha-card .header=${c.title ?? nothing}>
        <div
          class="stage"
          style="aspect-ratio: ${c.width} / ${c.height}; background:${c.background ??
          "var(--card-background-color, #fff)"};"
        >
          <svg viewBox="0 0 ${c.width} ${c.height}" preserveAspectRatio="none">
            ${active.image
              ? svg`<image href=${active.image} x="0" y="0" width=${c.width} height=${c.height}
                          preserveAspectRatio="none" opacity=${active.imageOpacity ?? 1} />`
              : nothing}
            ${active.furniture.map((f) => renderFurniture(f))}
            <defs>
              <mask id=${this._wallMaskId} maskUnits="userSpaceOnUse">
                <rect x="0" y="0" width=${c.width} height=${c.height} fill="white" />
                ${active.openings.map((o) => {
                  const cutH = WALL_THICKNESS + 4;
                  const half = o.length / 2;
                  return svg`<rect x=${o.x - half} y=${o.y - cutH / 2}
                                   width=${o.length} height=${cutH} fill="black"
                                   transform="rotate(${o.angle} ${o.x} ${o.y})" />`;
                })}
              </mask>
            </defs>
            <g mask=${`url(#${this._wallMaskId})`}>
              ${active.walls.map(
                (w) => svg`
                <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2}
                      class="wall" stroke-width=${WALL_THICKNESS} stroke-linecap="round" />`
              )}
            </g>
            ${active.openings.map((o) => {
              const isOpen = this._openingIsOpen(o);
              return renderOpening(
                o,
                "var(--primary-text-color)",
                "var(--card-background-color, #fff)",
                isOpen,
                !!o.entity && isOpen,
                o.activeColor ?? "var(--primary-color, #03a9f4)",
                false
              );
            })}
          </svg>
          <div class="items">
            ${active.texts.map((t) => this._renderText(t, c))}
            ${active.items.map((it) => this._renderItem(it, c))}
          </div>
          ${floors.length > 1 ? this._renderFloorSwitcher(floors, active) : nothing}
        </div>
      </ha-card>
    `;
  }

  private _renderFloorSwitcher(floors: Floor[], active: Floor): TemplateResult {
    return html`
      <div class="floor-switcher">
        ${floors.map(
          (f) => html`
            <button
              class=${f.id === active.id ? "active" : ""}
              title=${f.name}
              @click=${() => {
                this._activeFloorId = f.id;
              }}
            >
              ${f.name}
            </button>
          `
        )}
      </div>
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
    .floor-switcher {
      position: absolute;
      top: 8px;
      right: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      pointer-events: auto;
      z-index: 1;
    }
    .floor-switcher button {
      cursor: pointer;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      border-radius: 6px;
      padding: 4px 8px;
      font-size: 12px;
      line-height: 1;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .floor-switcher button.active {
      background: var(--primary-color, #03a9f4);
      color: #fff;
      border-color: var(--primary-color, #03a9f4);
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
    .fp-door-leaf,
    .fp-leaf-r {
      transform-box: fill-box;
      transition: transform 0.5s ease;
    }
    .fp-door-leaf {
      transform-origin: left center;
    }
    .fp-leaf-r {
      transform-origin: right center;
    }
    .fp-door-leaf rect,
    .fp-leaf-r rect {
      transition: fill 0.5s ease;
    }
    .fp-door-arc {
      transition: stroke-dashoffset 0.5s ease, stroke 0.5s ease;
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
