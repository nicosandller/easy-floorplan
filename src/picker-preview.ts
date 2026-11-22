/**
 * The sample plan the card shows in Home Assistant's "Add card" picker (issue
 * #434), so its tile shows what the card does next to core cards that draw
 * themselves, instead of a line of text.
 *
 * The picker hands one config to both the tile and the card you pick, from
 * {@link FloorplanCard.getStubConfig}, so the sample cannot live there: a new
 * card would start with somebody else's living room. Instead the card notices
 * it is inside the picker, and only while its config is still the blank new
 * plan, and draws this sample in its place. The config the picker hands on is
 * untouched, so picking the tile still opens an empty plan.
 */
import type { FloorplanCardConfig, HomeAssistant } from "./types";

/** The lamp's entity. Not a real one: its state is supplied with the sample. */
export const PICKER_PREVIEW_LAMP = "light.easy_floorplan_sample_lamp";

/** One room with a door, a window, a sofa and a lit lamp. */
export function pickerPreviewConfig(base: Partial<FloorplanCardConfig> = {}): FloorplanCardConfig {
  return {
    ...base,
    type: base.type ?? "custom:easy-floorplan-card",
    width: 500,
    height: 300,
    showViewControls: false,
    walls: [
      { id: "north", x1: 50, y1: 40, x2: 450, y2: 40 },
      { id: "east", x1: 450, y1: 40, x2: 450, y2: 260 },
      { id: "south", x1: 450, y1: 260, x2: 50, y2: 260 },
      { id: "west", x1: 50, y1: 260, x2: 50, y2: 40 },
    ],
    openings: [
      { id: "door", type: "door", x: 140, y: 260, angle: 0, length: 60 },
      { id: "window", type: "window", x: 300, y: 40, angle: 0, length: 100 },
    ],
    items: [{ id: "lamp", kind: "light", entity: PICKER_PREVIEW_LAMP, x: 160, y: 120, glow: true }],
    furniture: [{ id: "sofa", type: "sofa", x: 330, y: 190, w: 110, h: 50 }],
    texts: [],
    trackers: [],
    areas: [
      {
        id: "living",
        name: "Living room",
        points: [{ x: 50, y: 40 }, { x: 450, y: 40 }, { x: 450, y: 260 }, { x: 50, y: 260 }],
      },
    ],
  } as FloorplanCardConfig;
}

/** `hass` with the sample lamp switched on, warm and fully bright. */
export function pickerPreviewHass(hass: HomeAssistant): HomeAssistant {
  if (hass.states[PICKER_PREVIEW_LAMP]) return hass;
  return {
    ...hass,
    states: {
      ...hass.states,
      [PICKER_PREVIEW_LAMP]: {
        entity_id: PICKER_PREVIEW_LAMP,
        state: "on",
        attributes: { friendly_name: "Lamp", brightness: 255, color_mode: "rgb", rgb_color: [255, 190, 110] },
        last_changed: "",
        last_updated: "",
        context: { id: "", user_id: null, parent_id: null },
      },
    },
  } as HomeAssistant;
}

/**
 * Whether `el` sits in Home Assistant's card picker: its nearest shadow root
 * belongs to `hui-card-picker`, which renders each tile's card straight into
 * its own shadow tree. Anywhere else, including the card editor's preview,
 * this is false and the card draws its own config as always.
 */
export function isInCardPicker(el: Element): boolean {
  const root = el.getRootNode();
  return root instanceof ShadowRoot && root.host.localName === "hui-card-picker";
}

/**
 * Whether a config is still the blank plan a new card starts from: nothing
 * drawn on it and no floors. Anything a person has added means the card is
 * theirs, and it is drawn as it is.
 */
export function isBlankPlan(c: Partial<FloorplanCardConfig> | undefined): boolean {
  if (!c) return false;
  const lists = ["walls", "openings", "items", "texts", "furniture", "trackers", "areas", "floors"] as const;
  return lists.every((k) => {
    const v = (c as Record<string, unknown>)[k];
    return v == null || (Array.isArray(v) && v.length === 0);
  });
}
