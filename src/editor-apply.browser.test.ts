/**
 * Apply on a card that has not been saved yet (issue #429).
 *
 * Until the first Save, HA's dialog *adds* the card on every save, so Apply
 * refuses with APPLY_NEW_CARD. The button used to stay enabled and say so only
 * once pressed, which made the most prominent control in a new editor the
 * first error a new user saw. Now it is disabled up front with the reason as
 * its tooltip. The editor is mounted inside a stand-in for HA's dialog, behind
 * a shadow root as in Home Assistant, so the ancestor walk is the real one.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import { APPLY_NEW_CARD } from "./editor-save";
import type { FloorplanCardConfig } from "./types";

const CONFIG: FloorplanCardConfig = {
  type: "custom:easy-floorplan-card",
  width: 1000,
  height: 600,
  floors: [
    {
      id: "f1",
      name: "Floor 1",
      walls: [],
      openings: [],
      items: [],
      texts: [],
      furniture: [],
      trackers: [],
      areas: [],
    },
  ],
};

async function mountInDialog(isNew: boolean) {
  const saved: unknown[] = [];
  const dialog = document.createElement("div") as HTMLDivElement & {
    _params: { saveCardConfig: (c: unknown) => void; isNew: boolean };
    _cardConfig: unknown;
  };
  dialog._params = { saveCardConfig: (c) => void saved.push(c), isNew };
  dialog._cardConfig = CONFIG;
  dialog.style.width = "900px";
  document.body.appendChild(dialog);
  const shadow = dialog.attachShadow({ mode: "open" });

  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(CONFIG);
  shadow.appendChild(ed);
  await ed.updateComplete;
  const button = () => ed.shadowRoot!.querySelector<HTMLButtonElement>(".apply-btn")!;
  return { ed, button, saved };
}

describe("Apply on a new card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is disabled, with the reason as its tooltip", async () => {
    const { button } = await mountInDialog(true);
    expect(button().disabled).toBe(true);
    expect(button().title).toBe(APPLY_NEW_CARD);
  });

  it("is enabled on a card already on the dashboard, and saves", async () => {
    const { ed, button, saved } = await mountInDialog(false);
    expect(button().disabled).toBe(false);
    expect(button().title).not.toBe(APPLY_NEW_CARD);

    button().click();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await ed.updateComplete;
    expect(saved).toHaveLength(1);
  });
});
