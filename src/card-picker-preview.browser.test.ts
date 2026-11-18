/**
 * The card as a tile in Home Assistant's card picker (issue #434). The picker
 * renders each card into its own shadow tree, so a stand-in `hui-card-picker`
 * with a shadow root is the context the card has to recognise.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import { FloorplanCard } from "./floorplan-card";
import { PICKER_PREVIEW_LAMP } from "./picker-preview";
import type { FloorplanCardConfig } from "./types";

if (!customElements.get("hui-card-picker")) customElements.define("hui-card-picker", class extends HTMLElement {});

const hass = {
  states: {},
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mount(config: Partial<FloorplanCardConfig>, inPicker: boolean) {
  const host = document.createElement(inPicker ? "hui-card-picker" : "div");
  document.body.appendChild(host);
  const parent = inPicker ? host.attachShadow({ mode: "open" }) : host;
  const preview = document.createElement("div");
  preview.style.width = "400px";
  parent.appendChild(preview);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  // The picker sets the config and hass before it attaches the card.
  card.setConfig(config as FloorplanCardConfig);
  card.hass = hass;
  preview.appendChild(card);
  await card.updateComplete;
  await card.updateComplete;
  return card;
}

const stub = () => ({ type: "custom:easy-floorplan-card", ...FloorplanCard.getStubConfig() });

describe("the card picker tile (issue #434)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws the sample room with its lamp lit", async () => {
    const card = await mount(stub(), true);
    const root = card.shadowRoot!;
    expect(root.querySelector(".fp-item.on")).not.toBeNull();
    expect(root.querySelector(".fp-glow")).not.toBeNull();
    expect(card.hass!.states[PICKER_PREVIEW_LAMP]?.state).toBe("on");
  });

  it("leaves the config the picker hands on untouched", async () => {
    const config = stub();
    const before = JSON.stringify(config);
    await mount(config, true);
    expect(JSON.stringify(config)).toBe(before);
  });

  it("keeps the lamp lit when the picker passes a new hass", async () => {
    const card = await mount(stub(), true);
    card.hass = { ...hass } as FloorplanCard["hass"];
    await card.updateComplete;
    expect(card.hass!.states[PICKER_PREVIEW_LAMP]?.state).toBe("on");
    expect(card.shadowRoot!.querySelector(".fp-item.on")).not.toBeNull();
  });

  it("draws a blank plan as blank anywhere else, such as the editor's preview", async () => {
    const card = await mount(stub(), false);
    expect(card.shadowRoot!.querySelector(".fp-item")).toBeNull();
    expect(card.hass!.states[PICKER_PREVIEW_LAMP]).toBeUndefined();
  });

  it("draws someone's own plan as it is, even in the picker", async () => {
    const own = { ...stub(), items: [{ id: "mine", kind: "sensor", x: 10, y: 10 }] };
    const card = await mount(own as Partial<FloorplanCardConfig>, true);
    expect([...card.shadowRoot!.querySelectorAll(".fp-item")]).toHaveLength(1);
    expect(card.hass!.states[PICKER_PREVIEW_LAMP]).toBeUndefined();
  });
});
