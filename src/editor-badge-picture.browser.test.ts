/**
 * The editor canvas previews a badge picture the way the card draws it
 * (issue #420): the same picture, the same icon fallback when there is none
 * or the entity is offline. A preview that disagrees with the card is worse
 * than none, since the plan gets tuned against it.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorItem, FloorplanCardConfig } from "./types";

// A generated flat-colour square: nobody's photo.
const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#3366cc"/></svg>'
)}`;

function config(item: Partial<FloorItem>): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [{ id: "i1", x: 500, y: 300, entity: "person.someone", badgeContent: "picture", ...item } as FloorItem],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

async function mount(state: string, attributes: Record<string, unknown>) {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = {
    states: { "person.someone": { entity_id: "person.someone", state, attributes } },
    entities: {},
  } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config({}));
  host.appendChild(ed);
  await ed.updateComplete;
  const badge = ed.shadowRoot!.querySelector(".edit-item .badge") as HTMLElement;
  return {
    badge,
    img: () => badge.querySelector<HTMLImageElement>("img.badge-picture"),
    icon: () => badge.querySelector("ha-icon"),
  };
}

describe("the editor previews a badge picture (issue #420)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("draws the entity's picture, clipped to the badge", async () => {
    const t = await mount("home", { entity_picture: PLACEHOLDER });
    expect(t.badge).toBeTruthy();
    expect(t.img()?.getAttribute("src")).toBe(PLACEHOLDER);
    expect(t.icon()).toBeNull();
    expect(getComputedStyle(t.img()!).borderRadius).toBe(getComputedStyle(t.badge).borderRadius);
    // Never a native image drag in place of moving the device.
    expect(getComputedStyle(t.img()!).pointerEvents).toBe("none");
  });

  it("shows the icon when there is no picture or the entity is offline", async () => {
    expect((await mount("home", {})).img()).toBeNull();
    document.body.innerHTML = "";
    const offline = await mount("unavailable", { entity_picture: PLACEHOLDER });
    expect(offline.img()).toBeNull();
    expect(offline.icon()).toBeTruthy();
  });
});
