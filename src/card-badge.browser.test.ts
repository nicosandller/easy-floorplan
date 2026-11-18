/**
 * What the card actually renders into a badge, in a real browser.
 *
 * This exists because of the bug it is named for: a device set to show its
 * reading rendered the reading in the editor and the icon on the card. The
 * card's own render path was never covered — the node suite cannot import
 * `floorplan-card.ts` at all, since defining a custom element needs a DOM —
 * so every test of "value or icon" was a test of the pure helper that decides
 * the text, and the helper was right the whole time. What was wrong was the
 * wiring around it, which only a mounted card can see (issue #254).
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import { badgeValue } from "./render";
import type { FloorItem, FloorplanCardConfig } from "./types";

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
        items: [
          { id: "s1", kind: "sensor", entity: "sensor.temp", x: 500, y: 300, ...item } as FloorItem,
        ],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [],
      },
    ],
  };
}

const hass = {
  states: {
    "sensor.temp": {
      entity_id: "sensor.temp",
      state: "21.5",
      attributes: { unit_of_measurement: "°C" },
    },
  },
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

async function mountCard(item: Partial<FloorItem>) {
  const host = document.createElement("div");
  host.style.width = "900px";
  host.style.height = "540px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(config(item));
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  return {
    card,
    badgeValue: () => root.querySelector(".badge .badge-value")?.textContent?.trim(),
    badgeIcon: () => root.querySelector(".badge ha-icon")?.getAttribute("icon") ?? undefined,
  };
}

describe("badge contents on the rendered card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  // What the helper says this device's badge should read. Asserting against
  // it rather than a literal keeps these about the *wiring* — whether the card
  // renders the answer at all — which is what broke. How a reading is worded
  // is `badgeValue`'s own business and has its own tests.
  const expected = badgeValue(hass as never, {
    entity: "sensor.temp",
  } as never);

  it("shows the reading when the badge is set to Value (issue #254)", async () => {
    const t = await mountCard({ badgeContent: "value" });
    expect(expected).toBeTruthy(); // the fixture has something to show
    expect(t.badgeValue()).toBe(expected);
    // …and the glyph it replaces is not also drawn.
    expect(t.badgeIcon()).toBeUndefined();
  });

  it("still shows the icon when the badge is set to Icon", async () => {
    const t = await mountCard({ badgeContent: "icon" });
    expect(t.badgeValue()).toBeUndefined();
    expect(t.badgeIcon()).toBeTruthy();
  });

  it("shows the reading through a ripple too, which is the path that kept working", async () => {
    // Both branches of the same `if` call the badge renderer, and the merge
    // that broke this one left the other correct — so a test of either alone
    // would have missed it.
    const t = await mountCard({ badgeContent: "value", display: "iconRipple" });
    expect(t.badgeValue()).toBe(expected);
  });

  it("falls back to the icon when the entity has nothing numeric to show", async () => {
    const t = await mountCard({ badgeContent: "value", entity: "sensor.missing" });
    expect(t.badgeValue()).toBeUndefined();
    expect(t.badgeIcon()).toBeTruthy();
  });
});

describe("a light's brightness badge reads percent, on the card too (issue #359)", () => {
  // The issue's exact device: a light whose badge reads its brightness
  // reading, with no label shown. The label path words that reading through
  // HA's own attribute formatter as a percentage; the badge printed the raw
  // 0-255 number instead. Here the card is mounted with the issue's config,
  // down to the keys the reporter pasted.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mountLight(
    state: { state: string; attributes?: Record<string, unknown> },
    extra?: Partial<FloorItem>,
    formatAttribute?: (stateObj: unknown, attribute: string) => string,
  ) {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);

    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{
        id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
        items: [{
          id: "item_27locph",
          entity: "light.office_main_lights",
          x: 176.86,
          y: 141.63,
          kind: "light",
          showState: true,
          size: 24,
          readings: [{ attribute: "brightness" }],
          badgeContent: "value",
          display: "badge",
          badgeEntity: 0,
          ...extra,
        } as unknown as FloorItem],
      }],
    } as FloorplanCardConfig);
    card.hass = {
      states: {
        "light.office_main_lights": {
          entity_id: "light.office_main_lights",
          attributes: {},
          ...state,
        },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
      ...(formatAttribute ? { formatEntityAttributeValue: formatAttribute } : {}),
    } as unknown as FloorplanCard["hass"];
    host.appendChild(card);
    await card.updateComplete;

    const root = card.shadowRoot!;
    return {
      labelText: () => root.querySelector(".label")?.textContent?.trim(),
      badgeValue: () => root.querySelector(".badge .badge-value")?.textContent?.trim(),
      badgeIcon: () => root.querySelector(".badge ha-icon")?.getAttribute("icon") ?? undefined,
    };
  }

  it("shows the dimmer as a percentage while the light is on", async () => {
    const t = await mountLight({ state: "on", attributes: { brightness: 128 } });
    expect(t.badgeValue()).toBe("50%");
    expect(t.badgeIcon()).toBeUndefined();
  });

  it("keeps the full range readable: min, mid and max", async () => {
    expect((await mountLight({ state: "on", attributes: { brightness: 1 } })).badgeValue())
      .toBe("0%");
    expect((await mountLight({ state: "on", attributes: { brightness: 128 } })).badgeValue())
      .toBe("50%");
    expect((await mountLight({ state: "on", attributes: { brightness: 255 } })).badgeValue())
      .toBe("100%");
  });

  it.each([
    { brightness: 128, shown: "50%" },
    { brightness: 101, shown: "40%" },
  ])("reads the same on the badge as on the label HA words ($brightness)", async ({ brightness, shown }) => {
    // HA's own formatter words a light's brightness as a percentage; stand in
    // for it with that rule, as the #260 test stands in for the cover's, and
    // hold the label and the badge to one text.
    const t = await mountLight(
      { state: "on", attributes: { brightness } },
      undefined,
      (st, attribute) => {
        const raw = (st as { attributes: Record<string, unknown> }).attributes[attribute];
        return attribute === "brightness" ? `${Math.round(((raw as number) / 255) * 100)}%` : "?";
      },
    );
    expect(t.labelText()).toContain(shown);
    expect(t.badgeValue()).toBe(shown);
  });

  it.each([{}, { brightness: null }])("falls back to the icon for an off light with no numeric brightness (%j)", async (attributes) => {
    const t = await mountLight({ state: "off", attributes });
    expect(t.badgeValue()).toBeUndefined();
    expect(t.badgeIcon()).toBeTruthy();
  });
});

describe("an attribute reading is worded by HA, on the card too (issue #260)", () => {
  // A cover's position is a bare number on the state object; the "%" comes
  // from HA's own attribute formatter. The editor hands the real `hass` to the
  // helper that asks for it, the card hands it a RenderHass built from that —
  // and the build did not carry the formatter, so the same cover read "50%"
  // while you were editing it and "50" once you saved.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mountCover() {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);

    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{
        id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
        items: [{
          id: "c1", kind: "cover", entity: "cover.blind", x: 500, y: 300,
          name: "Blind", showName: true, showState: true, attribute: "current_position",
        } as unknown as FloorItem],
      }],
    } as FloorplanCardConfig);
    card.hass = {
      states: {
        "cover.blind": {
          entity_id: "cover.blind",
          state: "open",
          attributes: { current_position: 50, device_class: "shutter" },
        },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
      formatEntityAttributeValue: (_st: unknown, attribute: string) =>
        attribute === "current_position" ? "50%" : "?",
    } as unknown as FloorplanCard["hass"];
    host.appendChild(card);
    await card.updateComplete;
    return card;
  }

  it("keeps the unit HA put on the position", async () => {
    const card = await mountCover();
    expect(card.shadowRoot?.querySelector(".label")?.textContent?.trim()).toContain("50%");
  });
});

describe("a device is drawn from one instant, not two", () => {
  // Replay renders the plan from `renderHass` — history at the playback head.
  // Anything in a device that still read `this.hass` disagreed with the rest
  // of the same device the moment the head moved: a motion sensor pulsing
  // because something is happening *now*, on a plan showing an hour ago.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const motion = {
    id: "m1",
    kind: "binary_sensor",
    entity: "binary_sensor.motion",
    x: 500,
    y: 300,
    display: "iconRipple",
    iconAnimation: "pulse",
  } as unknown as FloorItem;

  async function mountWithReplayAt(state: string) {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);

    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      // Replay only reaches the plan from a panel that is on screen, which
      // takes the config as well as the open flag set below.
      historyReplay: { enabled: true, lookbackSeconds: 3600 },
      floors: [
        {
          id: "f1", name: "Floor 1", walls: [], openings: [], items: [motion],
          texts: [], furniture: [], trackers: [], areas: [],
        },
      ],
    } as FloorplanCardConfig);
    // Live says the sensor is clear; the replayed instant says it detected
    // something. The plan is drawing the replayed instant.
    card.hass = {
      states: {
        "binary_sensor.motion": {
          entity_id: "binary_sensor.motion",
          state: "off",
          attributes: { device_class: "motion" },
        },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
    } as unknown as FloorplanCard["hass"];
    host.appendChild(card);
    await card.updateComplete;

    const controller = (card as unknown as { _replayController: {
      state: { enabled: boolean; historyVisible: boolean };
      historyService: () => { getStateAt: (t: number) => Map<string, unknown> };
    } })._replayController;
    // Both, because both are required: replay has been started, and the panel
    // is open. A closed panel draws live no matter what history is loaded.
    controller.state.enabled = true;
    controller.state.historyVisible = true;
    controller.historyService().getStateAt = () =>
      new Map([[
        "binary_sensor.motion",
        { entity_id: "binary_sensor.motion", state, attributes: { device_class: "motion" } },
      ]]);
    card.requestUpdate();
    await card.updateComplete;
    return card;
  }

  it("animates the icon from the replayed state, not the live one", async () => {
    const card = await mountWithReplayAt("on");
    // Live is "off"; the replayed instant is "on", and the badge follows it.
    expect(card.shadowRoot?.querySelector("ha-icon.anim-pulse")).toBeTruthy();
    // …and the ring beside it agrees, which it always did.
    expect(card.shadowRoot?.querySelector(".ripple.active")).toBeTruthy();
  });

  it("leaves both still when the replayed instant is clear", async () => {
    const card = await mountWithReplayAt("off");
    expect(card.shadowRoot?.querySelector("ha-icon.anim-pulse")).toBeFalsy();
    expect(card.shadowRoot?.querySelector(".ripple.active")).toBeFalsy();
  });
});

describe("a picture in the badge (issue #420)", () => {
  // Generated placeholders, never anyone's photo: two flat-colour squares, so
  // a changed picture is a changed src, and one URL that cannot decode.
  const square = (fill: string) =>
    `data:image/svg+xml,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="${fill}"/></svg>`
    )}`;
  const BLUE = square("#3366cc");
  const GREEN = square("#33aa66");
  const BROKEN = "data:image/png;base64,AAAA";

  afterEach(() => {
    document.body.innerHTML = "";
  });

  const hassWith = (
    person: { state: string; attributes?: Record<string, unknown> },
    hassUrl?: (path: string) => string,
  ) =>
    ({
      states: {
        "person.someone": { entity_id: "person.someone", attributes: {}, ...person },
      },
      entities: {},
      formatEntityState: (st: { state: string }) => st.state,
      ...(hassUrl ? { hassUrl } : {}),
    }) as unknown as FloorplanCard["hass"];

  async function mountPerson(
    person: { state: string; attributes?: Record<string, unknown> },
    item: Partial<FloorItem> = {},
    skin?: string,
    hassUrl?: (path: string) => string,
  ) {
    const host = document.createElement("div");
    host.style.width = "900px";
    host.style.height = "540px";
    document.body.appendChild(host);
    const card = document.createElement("easy-floorplan-card") as FloorplanCard;
    card.setConfig({
      ...config({ entity: "person.someone", kind: "sensor", badgeContent: "picture", ...item }),
      ...(skin ? { skin } : {}),
    } as FloorplanCardConfig);
    card.hass = hassWith(person, hassUrl);
    host.appendChild(card);
    await card.updateComplete;
    const root = card.shadowRoot!;
    return {
      card,
      img: () => root.querySelector<HTMLImageElement>(".badge img.badge-picture"),
      badge: () => root.querySelector<HTMLElement>(".badge"),
      badgeIcon: () => root.querySelector(".badge ha-icon")?.getAttribute("icon") ?? undefined,
    };
  }

  it("draws the entity's entity_picture instead of the icon", async () => {
    const t = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } });
    expect(t.img()?.getAttribute("src")).toBe(BLUE);
    expect(t.img()?.getAttribute("alt")).toBe("");
    expect(t.badgeIcon()).toBeUndefined();
  });

  it("leaves a plan that never asked for it on the icon", async () => {
    const t = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } }, { badgeContent: undefined });
    expect(t.img()).toBeNull();
    expect(t.badgeIcon()).toBeTruthy();
  });

  it("follows the picture when the entity's state object changes", async () => {
    // The live-update gate compares state objects; a new picture arrives as a
    // new object for an entity the plan already watches.
    const t = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } });
    t.card.hass = hassWith({ state: "home", attributes: { entity_picture: GREEN } });
    await t.card.updateComplete;
    expect(t.img()?.getAttribute("src")).toBe(GREEN);
  });

  it("falls back to the icon when the entity goes offline", async () => {
    const t = await mountPerson({ state: "unavailable", attributes: { entity_picture: BLUE } });
    expect(t.img()).toBeNull();
    expect(t.badgeIcon()).toBeTruthy();
  });

  it("falls back to the icon when the picture fails to load, and stays there", async () => {
    const t = await mountPerson({ state: "home", attributes: { entity_picture: BROKEN } });
    await expect.poll(() => t.badgeIcon(), { timeout: 3000 }).toBeTruthy();
    expect(t.img()).toBeNull();
    // A later tick for the same entity does not bring the broken image back…
    t.card.hass = hassWith({ state: "not_home", attributes: { entity_picture: BROKEN } });
    await t.card.updateComplete;
    expect(t.img()).toBeNull();
    // …but a new picture gets its own try.
    t.card.hass = hassWith({ state: "home", attributes: { entity_picture: BLUE } });
    await t.card.updateComplete;
    expect(t.img()?.getAttribute("src")).toBe(BLUE);
  });

  it("resolves a bare entity_picture path through hass.hassUrl", async () => {
    // HA hands entity_picture out as a path; the card asks the frontend for
    // the full URL, as HA's own badges do.
    const seen: string[] = [];
    const t = await mountPerson(
      { state: "home", attributes: { entity_picture: "/api/image/serve/placeholder0/512x512" } },
      {},
      undefined,
      (path) => {
        seen.push(path);
        return BLUE;
      },
    );
    expect(seen).toContain("/api/image/serve/placeholder0/512x512");
    expect(t.img()?.getAttribute("src")).toBe(BLUE);
  });

  it("fills the badge inside its border whatever the image's own size", async () => {
    const big = `data:image/svg+xml,${encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="300"><rect width="512" height="300" fill="#3366cc"/></svg>'
    )}`;
    const t = await mountPerson({ state: "home", attributes: { entity_picture: big } });
    const img = t.img()!;
    await expect.poll(() => img.complete && img.naturalWidth > 0, { timeout: 3000 }).toBe(true);
    const badge = t.badge()!;
    const r = img.getBoundingClientRect();
    expect(r.width).toBeCloseTo(badge.clientWidth, 0);
    expect(r.height).toBeCloseTo(badge.clientHeight, 0);
    expect(r.width).toBeGreaterThan(0);
  });

  it("uses the item's own picture over entity_picture", async () => {
    const t = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } }, { picture: GREEN });
    expect(t.img()?.getAttribute("src")).toBe(GREEN);
  });

  it("is clipped to the badge's shape, circle or skin square", async () => {
    const round = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } });
    expect(getComputedStyle(round.img()!).borderRadius).toBe(getComputedStyle(round.badge()!).borderRadius);
    expect(getComputedStyle(round.img()!).borderRadius).toBe("50%");
    document.body.innerHTML = "";
    const square = await mountPerson({ state: "home", attributes: { entity_picture: BLUE } }, {}, "odnetnin");
    expect(getComputedStyle(square.img()!).borderRadius).toBe("30%");
    expect(getComputedStyle(square.img()!).objectFit).toBe("cover");
    expect(getComputedStyle(square.img()!).pointerEvents).toBe("none");
  });
});
