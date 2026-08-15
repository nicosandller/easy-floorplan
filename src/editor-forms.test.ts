import { describe, it, expect } from "vitest";
import {
  isLiveField,
  diffFormValue,
  normalizeFormPatch,
  openingForm,
  itemForm,
  textForm,
  furnitureForm,
  trackerForm,
  wallForm,
  projectForm,
  projectDisplayForm,
  projectPressForm,
  projectSkinForm,
  projectSunForm,
  projectReliefForm,
  projectDeadSpaceForm,
  floorImageForm,
  areaForm,
  areaNameForm,
} from "./editor-forms";
import type { FormField } from "./editor-forms";
import type { Area, Opening, FloorItem, Floor, FloorplanCardConfig } from "./types";
import { DEFAULT_GLOW_RADIUS, DEFAULT_PRESS_EFFECT } from "./types";
import { DEFAULT_SKIN, SKINS, MAX_SKIN_WALL_WIDTH } from "./skins";
import { DEFAULT_SUN_BEARING } from "./render";

const fields: FormField[] = [
  { name: "name", label: "Name", selector: { text: {} } },
  { name: "text", label: "Text", required: true, selector: { text: {} } },
  { name: "size", label: "Size", selector: { number: { min: 16, max: 160, mode: "slider" } } },
  { name: "length", label: "Length", required: true, selector: { number: { min: 1, mode: "box" } } },
  { name: "angle", label: "Angle", selector: { number: { min: 0, max: 360, mode: "slider" } } },
  { name: "display", label: "Display", selector: { select: { options: [] } } },
  { name: "showIcon", label: "Show icon", selector: { boolean: {} } },
  { name: "icon", label: "Icon", selector: { icon: {} } },
  { name: "entity", label: "Entity", selector: { entity: {} } },
];
const f = (n: string) => fields.find((x) => x.name === n)!;

describe("isLiveField", () => {
  it("marks text and number selectors live, others discrete", () => {
    expect(isLiveField(f("name"))).toBe(true);
    expect(isLiveField(f("size"))).toBe(true);
    expect(isLiveField(f("display"))).toBe(false);
    expect(isLiveField(f("showIcon"))).toBe(false);
    expect(isLiveField(f("entity"))).toBe(false);
    expect(isLiveField(f("icon"))).toBe(false);
  });
});

describe("diffFormValue", () => {
  it("returns only schema keys whose value identity changed", () => {
    const prev = { name: "a", size: 20, id: "x" };
    const next = { name: "b", size: 20, id: "y" };
    expect(diffFormValue(prev, next, fields)).toEqual({ name: "b" });
  });

  it("empty diff for identical payloads", () => {
    const data = { name: "a", size: 20 };
    expect(Object.keys(diffFormValue(data, { ...data }, fields)).length).toBe(0);
  });
});

describe("normalizeFormPatch", () => {
  it("maps empty optional strings to undefined, keeps required ones", () => {
    const out = normalizeFormPatch({ name: "" }, fields);
    expect("name" in out).toBe(true);
    expect(out.name).toBeUndefined();
    expect(normalizeFormPatch({ text: "" }, fields).text).toBe("");
    const icon = normalizeFormPatch({ icon: "" }, fields);
    expect("icon" in icon).toBe(true);
    expect(icon.icon).toBeUndefined();
  });

  it("drops invalid required numbers (keep-old), passes undefined optionals through", () => {
    expect("length" in normalizeFormPatch({ length: undefined }, fields)).toBe(false);
    expect("length" in normalizeFormPatch({ length: Number.NaN }, fields)).toBe(false);
    const out = normalizeFormPatch({ size: undefined }, fields);
    expect("size" in out).toBe(true);
    expect(out.size).toBeUndefined();
  });

  it("clamps numbers to the selector range and wraps angle", () => {
    expect(normalizeFormPatch({ length: 0 }, fields).length).toBe(1);
    expect(normalizeFormPatch({ size: 999 }, fields).size).toBe(160);
    expect(normalizeFormPatch({ angle: 360 }, fields).angle).toBe(0);
    expect(normalizeFormPatch({ angle: -30 }, fields).angle).toBe(330);
  });

  it("parses numeric strings from plain-input fallbacks", () => {
    expect(normalizeFormPatch({ length: "42" }, fields).length).toBe(42);
  });

  it("coerces booleans", () => {
    expect(normalizeFormPatch({ showIcon: undefined }, fields).showIcon).toBe(false);
    expect(normalizeFormPatch({ showIcon: true }, fields).showIcon).toBe(true);
  });

  it("ignores keys not in the schema", () => {
    expect("id" in normalizeFormPatch({ id: "z" }, fields)).toBe(false);
  });
});

const door = { id: "o1", type: "door", x: 0, y: 0, length: 90, angle: 0 } as Opening;

describe("openingForm", () => {
  it("swing door shows hinge + opens, no slide fields", () => {
    const names = openingForm(door).fields.map((x) => x.name);
    expect(names).toContain("hinge");
    expect(names).toContain("opens");
    expect(names).not.toContain("style");
    expect(names).not.toContain("slide");
  });

  it("sliding opening shows slide + style, hides hinge; biparting hides slide", () => {
    const slide = openingForm({ ...door, motion: "slide" } as Opening).fields.map((x) => x.name);
    expect(slide).toContain("slide");
    expect(slide).toContain("style");
    expect(slide).not.toContain("hinge");
    expect(slide).not.toContain("opens");
    const bi = openingForm({ ...door, motion: "slide", sliderStyle: "biparting" } as Opening);
    expect(bi.fields.map((x) => x.name)).not.toContain("slide");
  });

  it("roll-up opening hides swing and slide fields (issue #45)", () => {
    const motionField = openingForm(door).fields.find((x) => x.name === "motion")!;
    const opts = (motionField.selector as { select: { options: { value: string }[] } }).select
      .options.map((o) => o.value);
    expect(opts).toEqual(["swing", "slide", "roll"]);
    const roll = openingForm({ ...door, motion: "roll" } as Opening).fields.map((x) => x.name);
    expect(roll).not.toContain("hinge");
    expect(roll).not.toContain("opens");
    expect(roll).not.toContain("slide");
    expect(roll).not.toContain("style");
    expect(openingForm(door).toPatch({ motion: "roll" })).toEqual({
      motion: "roll",
      sliderStyle: undefined,
    });
  });

  it("invert only offered with an entity; entity filter targets covers and binary_sensors", () => {
    expect(openingForm(door).fields.map((x) => x.name)).not.toContain("invert");
    const bound = openingForm({ ...door, entity: "cover.x" } as Opening);
    expect(bound.fields.map((x) => x.name)).toContain("invert");
    const entity = bound.fields.find((x) => x.name === "entity")!;
    expect(entity.selector).toEqual({ entity: { filter: [{ domain: ["binary_sensor", "cover"] }] } });
  });

  it("maps view-model patches back to config shape", () => {
    const form = openingForm(door);
    expect(form.toPatch({ motion: "swing" })).toEqual({ motion: undefined, sliderStyle: undefined });
    expect(form.toPatch({ motion: "slide" })).toEqual({ motion: "slide" });
    expect(form.toPatch({ hinge: "right" })).toEqual({ flipH: true });
    expect(form.toPatch({ hinge: "left" })).toEqual({ flipH: undefined });
    expect(form.toPatch({ opens: "other" })).toEqual({ flipV: true });
    expect(form.toPatch({ slide: "left" })).toEqual({ flipH: undefined });
    expect(form.toPatch({ style: "single" })).toEqual({ sliderStyle: undefined });
    expect(form.toPatch({ style: "bypass" })).toEqual({ sliderStyle: "bypass" });
    expect(form.toPatch({ invert: false })).toEqual({ invert: undefined });
    expect(form.toPatch({ invert: true })).toEqual({ invert: true });
    expect(form.toPatch({ entity: undefined })).toEqual({ entity: undefined });
    expect(form.toPatch({ length: 50, angle: 10 })).toEqual({ length: 50, angle: 10 });
  });

  it("exposes derived view-model values in data", () => {
    const d = openingForm({ ...door, flipH: true } as Opening).data;
    expect(d.motion).toBe("swing");
    expect(d.hinge).toBe("right");
    expect(d.opens).toBe("this");
    expect(d.style).toBe("single");
  });
});

describe("openingForm — two-panel sliders (issue #145)", () => {
  const slider = (extra: Partial<Opening> = {}) =>
    ({ ...door, motion: "slide", ...extra }) as Opening;
  const names = (o: Opening) => openingForm(o).fields.map((x) => x.name);
  // Every style with a second moving panel for `secondaryEntity` to drive.
  const TWO_PANEL = ["biparting", "biparting-bypass", "converging"] as const;

  it("offers every slider style", () => {
    const styleField = openingForm(slider()).fields.find((x) => x.name === "style")!;
    const opts = (styleField.selector as { select: { options: { value: string }[] } }).select
      .options.map((o) => o.value);
    expect(opts).toEqual(["single", "bypass", "biparting", "biparting-bypass", "converging"]);
  });

  it("hides the slide direction for each of them — both panels move", () => {
    for (const sliderStyle of TWO_PANEL) {
      expect(names(slider({ sliderStyle }))).not.toContain("slide");
    }
    expect(names(slider({ sliderStyle: "bypass" }))).toContain("slide");
  });

  it("offers a second panel entity only on a bound two-panel slider", () => {
    // Nothing to bind without a first entity, or with only one moving panel.
    expect(names(slider({ sliderStyle: "biparting" }))).not.toContain("secondaryEntity");
    expect(names(slider({ sliderStyle: "bypass", entity: "binary_sensor.a" })))
      .not.toContain("secondaryEntity");
    expect(names({ ...door, entity: "binary_sensor.a" } as Opening))
      .not.toContain("secondaryEntity");
    for (const sliderStyle of TWO_PANEL) {
      const bound = openingForm(slider({ sliderStyle, entity: "binary_sensor.a" }));
      expect(bound.fields.map((x) => x.name)).toContain("secondaryEntity");
      const field = bound.fields.find((x) => x.name === "secondaryEntity")!;
      // Same pickers as the first panel: a contact or a cover per leaf.
      expect(field.selector).toEqual({
        entity: { filter: [{ domain: ["binary_sensor", "cover"] }] },
      });
    }
  });

  it("carries the bound second entity in data", () => {
    const d = openingForm(
      slider({ sliderStyle: "biparting", entity: "binary_sensor.a", secondaryEntity: "binary_sensor.b" })
    ).data;
    expect(d.secondaryEntity).toBe("binary_sensor.b");
    expect(openingForm(slider({ sliderStyle: "biparting" })).data.secondaryEntity).toBe("");
  });

  it("drops the second entity when the opening stops having two panels", () => {
    const form = openingForm(
      slider({ sliderStyle: "biparting", entity: "binary_sensor.a", secondaryEntity: "binary_sensor.b" })
    );
    // Leaving biparting, or leaving sliding altogether, strips the now-dead
    // binding — the same rule that already drops sliderStyle.
    expect(form.toPatch({ style: "single" }).secondaryEntity).toBeUndefined();
    expect(form.toPatch({ style: "bypass" }).secondaryEntity).toBeUndefined();
    expect(form.toPatch({ motion: "swing" }).secondaryEntity).toBeUndefined();
    expect(form.toPatch({ motion: "roll" }).secondaryEntity).toBeUndefined();
    // Switching between two-panel styles keeps it: they all have a second leaf.
    for (const sliderStyle of TWO_PANEL) {
      expect(form.toPatch({ style: sliderStyle })).toEqual({ sliderStyle });
    }
    expect(form.toPatch({ secondaryEntity: "binary_sensor.c" })).toEqual({
      secondaryEntity: "binary_sensor.c",
    });
  });
});

describe("itemForm", () => {
  const item = { id: "i", entity: "light.a", kind: "light", x: 0, y: 0 } as FloorItem;

  it("offers Cast light on lights only, with its controls behind the toggle (#6)", () => {
    const names = (it: FloorItem) => itemForm(it).fields.map((x) => x.name);
    expect(names(item)).toContain("glow");
    // Radius/colour would be noise on a device that isn't casting yet.
    expect(names(item)).not.toContain("glowRadius");
    const lit = { ...item, glow: true } as FloorItem;
    expect(names(lit)).toContain("glowRadius");
    expect(names(lit)).toContain("glowColor");
    expect(itemForm(lit).data.glowRadius).toBe(DEFAULT_GLOW_RADIUS);
    // A sensor has no colour to cast, so it is never offered.
    expect(names({ ...item, kind: "sensor", entity: "sensor.temp" } as FloorItem)).not.toContain("glow");
  });

  it("offers Ripple on presence devices only, sized behind the toggle (#127)", () => {
    const motion = { ...item, entity: "binary_sensor.hall", kind: "binary_sensor" } as FloorItem;
    const names = (it: FloorItem, dc?: string) => itemForm(it, undefined, dc).fields.map((x) => x.name);
    // A light is not something that detects presence, whatever it can do.
    expect(names(item)).not.toContain("ripple");
    expect(names(item, "motion")).not.toContain("ripple");
    // Nor is a binary sensor whose class says door / leak / nothing at all.
    expect(names(motion)).not.toContain("ripple");
    expect(names(motion, "door")).not.toContain("ripple");
    for (const dc of ["motion", "occupancy", "presence"]) {
      expect(names(motion, dc)).toContain("ripple");
    }
    expect(names({ ...item, entity: "device_tracker.phone" } as FloorItem)).toContain("ripple");
    // Size only once the ring is actually on, exactly like Cast light's radius.
    expect(names(motion, "motion")).not.toContain("rippleSize");
    const ringed = { ...motion, display: "iconRipple" } as FloorItem;
    expect(names(ringed, "motion")).toContain("rippleSize");
    // A ring set on something else still reads back, so toPatch keeps it.
    expect(itemForm({ ...item, display: "iconRipple" } as FloorItem).data.ripple).toBe(true);
  });

  it("offers Show name, and Label size only while a label line renders (#61, #59)", () => {
    // A light shows no label by default → no size slider.
    const light = itemForm(item);
    expect(light.fields.map((x) => x.name)).toContain("showName");
    expect(light.fields.map((x) => x.name)).not.toContain("labelSize");
    // Sensors label by default; showName or showState also reveal the slider.
    const sensor = itemForm({ ...item, entity: "sensor.a", kind: "sensor" } as FloorItem);
    expect(sensor.fields.map((x) => x.name)).toContain("labelSize");
    const namedLight = itemForm({ ...item, showName: true } as FloorItem);
    expect(namedLight.fields.map((x) => x.name)).toContain("labelSize");
    expect(namedLight.data.showName).toBe(true);
    expect(namedLight.data.labelSize).toBe(12);
    expect(
      itemForm({ ...item, showName: true, labelSize: 20 } as FloorItem).data.labelSize
    ).toBe(20);
  });

  it("offers the three action fields with behavior-preserving defaults", () => {
    const fs = itemForm(item).fields;
    expect(fs.find((x) => x.name === "tap_action")!.selector).toEqual({
      ui_action: { default_action: "toggle" },
    });
    expect(fs.find((x) => x.name === "hold_action")!.selector).toEqual({
      ui_action: { default_action: "none" },
    });
    const sensor = itemForm({ ...item, entity: "sensor.a" } as FloorItem).fields;
    expect(sensor.find((x) => x.name === "tap_action")!.selector).toEqual({
      ui_action: { default_action: "more-info" },
    });
  });

  it("data presents effective defaults", () => {
    const d = itemForm(item).data;
    expect(d.badgeMode).toBe("icon");
    expect(d.ripple).toBe(false);
    expect(d.showState).toBe(false);
    expect(d.angle).toBe(0);
  });

  it("merges Display, Animate icon and Badge shows into one dropdown (#127)", () => {
    const names = itemForm(item).fields.map((x) => x.name);
    // The three switches it stands in for are gone from the form…
    expect(names).not.toContain("display");
    expect(names).not.toContain("iconAnimation");
    expect(names).not.toContain("badgeContent");
    expect(names).not.toContain("showIcon");
    expect(names).toContain("badgeMode");
    const f = itemForm(item).fields.find((x) => x.name === "badgeMode")!;
    const opts = (f.selector as { select: { options: { value: string }[] } }).select.options.map(
      (o) => o.value
    );
    // No "auto": the menu names the animation, never the config's word for
    // "whatever this domain does" (#127).
    expect(opts).toEqual(["icon", "spin", "pulse", "value", "none"]);
  });

  it("shows the animation auto resolves to, not the word auto (#127)", () => {
    const mode = (entity: string, it: Partial<FloorItem> = {}) =>
      itemForm({ ...item, entity, ...it } as FloorItem).data.badgeMode;
    // Untouched configs: the dropdown reads what the card is already playing.
    expect(mode("fan.ceiling")).toBe("spin");
    expect(mode("media_player.tv")).toBe("pulse");
    expect(mode("vacuum.robo")).toBe("pulse");
    expect(mode("light.a")).toBe("icon");
    // An explicit "auto" reads the same as no key at all…
    expect(mode("fan.ceiling", { iconAnimation: "auto" })).toBe("spin");
    // …while "none" is the user saying "still", even on a fan.
    expect(mode("fan.ceiling", { iconAnimation: "none" })).toBe("icon");
    // Picking "still" writes the key that turns the domain default off.
    expect(itemForm({ ...item, entity: "fan.ceiling" } as FloorItem).toPatch({ badgeMode: "icon" })
      .iconAnimation).toBe("none");
  });

  it("reads the badge mode off the three keys it replaced (#127)", () => {
    const mode = (it: Partial<FloorItem>) => itemForm({ ...item, ...it } as FloorItem).data.badgeMode;
    expect(mode({})).toBe("icon");
    expect(mode({ iconAnimation: "none" })).toBe("icon");
    expect(mode({ iconAnimation: "spin" })).toBe("spin");
    expect(mode({ iconAnimation: "pulse" })).toBe("pulse");
    expect(mode({ badgeContent: "value" })).toBe("value");
    expect(mode({ badgeContent: "none" })).toBe("none");
    // A legacy showIcon: false still reads as "no badge" (issue #106).
    expect(mode({ showIcon: false })).toBe("none");
    // Ripple-only draws no badge at all, whatever badgeContent says.
    expect(mode({ display: "ripple", badgeContent: "icon" })).toBe("none");
    expect(mode({ display: "iconRipple", iconAnimation: "spin" })).toBe("spin");
    // The ring is read off `display` alone.
    expect(itemForm({ ...item, display: "iconRipple" } as FloorItem).data.ripple).toBe(true);
    expect(itemForm({ ...item, display: "ripple" } as FloorItem).data.ripple).toBe(true);
  });

  it("expands the merged dropdown back into display/animation/content (#127)", () => {
    const f = itemForm(item);
    expect(f.toPatch({ badgeMode: "spin" })).toEqual({
      badgeContent: "icon",
      iconAnimation: "spin",
      display: "badge",
      showIcon: undefined,
    });
    // "Still" is an animation choice, not a missing one.
    expect(f.toPatch({ badgeMode: "icon" }).iconAnimation).toBe("none");
    // Value/Nothing say nothing about animation, so the stored one survives a
    // trip through them.
    expect(f.toPatch({ badgeMode: "value" })).toEqual({
      badgeContent: "value",
      display: "badge",
      showIcon: undefined,
    });
    // The ring toggle alone is still a complete statement about `display`:
    // the mode comes off the item.
    expect(f.toPatch({ ripple: true }).display).toBe("iconRipple");
    expect(
      itemForm({ ...item, badgeContent: "none" } as FloorItem).toPatch({ ripple: true }).display
    ).toBe("ripple");
    expect(
      itemForm({ ...item, display: "iconRipple" } as FloorItem).toPatch({ ripple: false }).display
    ).toBe("badge");
    // Both at once, and unrelated edits, pass through untouched.
    expect(f.toPatch({ badgeMode: "none", ripple: true }).display).toBe("ripple");
    expect(f.toPatch({ size: 40 })).toEqual({ size: 40 });
    expect(f.toPatch({ size: 40, badgeMode: "value" }).size).toBe(40);
  });

  // Issue #136: which of a device's two entities the value badge reads.
  describe("Badge reads (#136)", () => {
    const plug = {
      ...item,
      entity: "switch.plug",
      secondaryEntity: "sensor.plug_power",
      badgeContent: "value",
    } as FloorItem;
    const names = (it: FloorItem, src?: Parameters<typeof itemForm>[3]) =>
      itemForm(it, undefined, undefined, src).fields.map((x) => x.name);

    it("appears only when the badge shows a value AND there is a second entity", () => {
      expect(names(plug)).toContain("badgeEntity");
      // Nothing to choose between with one entity.
      expect(names({ ...plug, secondaryEntity: undefined } as FloorItem)).not.toContain(
        "badgeEntity",
      );
      // Nothing to read at all when the badge holds an icon or nothing.
      expect(names({ ...plug, badgeContent: "icon" } as FloorItem)).not.toContain("badgeEntity");
      expect(names({ ...plug, badgeContent: "none" } as FloorItem)).not.toContain("badgeEntity");
      // A ripple-only device draws no badge, so the question is moot there too.
      expect(names({ ...plug, display: "ripple" } as FloorItem)).not.toContain("badgeEntity");
    });

    it("opens on the entity the badge is actually reading, not a bare default", () => {
      // The trap: this plug's badge shows its power sensor through the
      // fallback, with no badgeEntity stored. A form defaulting to "primary"
      // would name the switch while the badge shows watts — and the next
      // unrelated edit would save that and drop the reading to an icon.
      const asRead = itemForm(plug, undefined, undefined, { source: "secondary" });
      expect(asRead.data.badgeEntity).toBe("secondary");
      // A stored choice always wins over the live reading.
      expect(
        itemForm({ ...plug, badgeEntity: "primary" } as FloorItem, undefined, undefined, {
          source: "secondary",
        }).data.badgeEntity,
      ).toBe("primary");
    });

    it("names the entities, with no 'Automatic' among them (#127's precedent)", () => {
      const field = itemForm(plug, undefined, undefined, {
        source: "secondary",
        primaryLabel: "Kitchen plug",
        secondaryLabel: "Kitchen plug power",
      }).fields.find((x) => x.name === "badgeEntity")!;
      const opts = (field.selector as { select: { options: { value: string; label: string }[] } })
        .select.options;
      expect(opts.map((o) => o.value)).toEqual(["primary", "secondary"]);
      expect(opts.map((o) => o.label)).toEqual(["Kitchen plug", "Kitchen plug power"]);
      expect(opts.map((o) => o.value)).not.toContain("auto");
    });

    it("falls back to entity ids when hass has no friendly names", () => {
      const field = itemForm(plug).fields.find((x) => x.name === "badgeEntity")!;
      const opts = (field.selector as { select: { options: { label: string }[] } }).select.options;
      expect(opts.map((o) => o.label)).toEqual(["switch.plug", "sensor.plug_power"]);
    });

    it("passes the choice straight through as a config key", () => {
      expect(itemForm(plug).toPatch({ badgeEntity: "secondary" }).badgeEntity).toBe("secondary");
    });
  });

  it("moves the icon out of the form, next to the rules that override it (#127)", () => {
    expect(itemForm(item).fields.map((x) => x.name)).not.toContain("icon");
    expect(itemForm(item).data.icon).toBeUndefined();
  });

  it("scopes the entity/secondaryEntity pickers to the area's entities when given", () => {
    const unscoped = itemForm(item);
    expect(unscoped.fields.find((x) => x.name === "entity")!.selector).toEqual({ entity: {} });
    const scoped = itemForm({ ...item, entity: "light.kitchen" } as FloorItem, {
      entities: ["light.kitchen", "switch.kitchen"],
      name: "Kitchen",
    });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "switch.kitchen"] },
    });
    expect(scoped.fields.find((x) => x.name === "secondaryEntity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "switch.kitchen"] },
    });
  });

  it("an empty area list does NOT filter — an empty picker would hide everything", () => {
    // Regression: `[]` is truthy, so the old code emitted
    // `include_entities: []` and the picker listed nothing at all — the
    // common case when a linked HA area has no entities assigned.
    const scoped = itemForm(item, { entities: [], name: "Kitchen" });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({ entity: {} });
    expect(scoped.fields.find((x) => x.name === "entity")!.helper).toBeUndefined();
  });

  it("always keeps the bound entity pickable, even from another area", () => {
    const scoped = itemForm({ ...item, entity: "light.hallway" } as FloorItem, {
      entities: ["light.kitchen"],
      name: "Kitchen",
    });
    expect(scoped.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["light.kitchen", "light.hallway"] },
    });
  });

  it("says why the list is short, and how to widen it", () => {
    const scoped = itemForm(item, { entities: ["light.kitchen"], name: "Kitchen" });
    const helper = scoped.fields.find((x) => x.name === "entity")!.helper!;
    expect(helper).toContain("Kitchen");
    expect(helper).toContain("Filter entities");
    // The secondary picker keeps its own explanation too.
    expect(scoped.fields.find((x) => x.name === "secondaryEntity")!.helper).toContain(
      "Shown next to the primary state"
    );
  });
});

describe("areaNameForm", () => {
  const area = (extra: Partial<Area> = {}): Area => ({
    id: "a",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    ...extra,
  });

  it("offers the HA areas as a typeable dropdown (so HA renders it natively)", () => {
    const name = areaNameForm(area(), ["Bedroom", "Living Room"]).fields[0];
    expect(name.selector).toEqual({
      select: {
        options: [
          { value: "Bedroom", label: "Bedroom" },
          { value: "Living Room", label: "Living Room" },
        ],
        custom_value: true,
        mode: "dropdown",
        sort: false,
      },
    });
  });

  it("degrades to a plain text field when there are no HA areas to offer", () => {
    expect(areaNameForm(area()).fields[0].selector).toEqual({ text: {} });
  });

  it("carries the current name as its data", () => {
    expect(areaNameForm(area({ name: "Kitchen" })).data).toEqual({ name: "Kitchen" });
    expect(areaNameForm(area()).data).toEqual({ name: "" });
  });
});

describe("areaForm", () => {
  const area = (extra: Partial<Area> = {}): Area => ({
    id: "a",
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    ...extra,
  });

  it("data presents effective defaults (showName true, DEFAULT_AREA_OPACITY)", () => {
    const d = areaForm(area()).data;
    expect(d).toMatchObject({ showName: true, opacity: 0.25, labelSize: 14 });
  });

  it("name size appears only while the name renders", () => {
    const names = (a: Area) => areaForm(a).fields.map((f) => f.name);
    expect(names(area())).toContain("labelSize");
    expect(names(area({ showName: false }))).not.toContain("labelSize");
  });

  it("the conditional-color controls appear once an entity is bound (issue #6)", () => {
    const names = (a: Area) => areaForm(a).fields.map((f) => f.name);
    // The Entity picker shipped without these, so binding an entity in the
    // editor resolved no color and the whole feature looked unimplemented.
    expect(names(area())).not.toContain("activeOpacity");
    expect(names(area())).not.toContain("highlight");
    const bound = names(area({ entity: "binary_sensor.occ" }));
    expect(bound).toContain("activeOpacity");
    expect(bound).toContain("highlight");
  });

  it("active opacity falls back to the resting opacity, highlight to fill", () => {
    const d = areaForm(area({ entity: "binary_sensor.occ", opacity: 0.1 })).data;
    expect(d).toMatchObject({ activeOpacity: 0.1, highlight: "fill" });
    const set = areaForm(area({ entity: "x", activeOpacity: 0.4, highlight: "border" })).data;
    expect(set).toMatchObject({ activeOpacity: 0.4, highlight: "border" });
  });

  it("drops the default highlight from the config instead of writing it out", () => {
    const { toPatch } = areaForm(area({ entity: "binary_sensor.occ" }));
    expect(toPatch({ highlight: "fill" }).highlight).toBeUndefined();
    expect(toPatch({ highlight: "border" }).highlight).toBe("border");
    // Untouched keys survive — it rewrites one field, not the form.
    expect(toPatch({ highlight: "fill", activeOpacity: 0.5 }).activeOpacity).toBe(0.5);
  });

  it("data reflects an explicit showName/opacity", () => {
    const d = areaForm(area({ name: "Kitchen", showName: false, opacity: 0.5 })).data;
    expect(d).toMatchObject({ showName: false, opacity: 0.5 });
  });

  it("keeps name out of the style form — it's its own form, above the link status", () => {
    expect(areaForm(area({ name: "Kitchen" })).fields.some((x) => x.name === "name")).toBe(false);
  });

  it("opacity field is a 0..1 slider", () => {
    const f = areaForm(area()).fields.find((x) => x.name === "opacity")!;
    expect(f.selector).toEqual({ number: { min: 0, max: 1, step: 0.05, mode: "slider" } });
  });

  it("clamps an out-of-range opacity patch via normalizeFormPatch", () => {
    const fields = areaForm(area()).fields;
    expect(normalizeFormPatch({ opacity: 5 }, fields)).toEqual({ opacity: 1 });
    expect(normalizeFormPatch({ opacity: -1 }, fields)).toEqual({ opacity: 0 });
  });
});

describe("textForm / furnitureForm / trackerForm", () => {
  it("text field is required (empty stays empty, not undefined)", () => {
    const form = textForm({ id: "t", x: 0, y: 0, text: "hi" });
    expect(form.fields.find((x) => x.name === "text")!.required).toBe(true);
  });

  it("furniture type options carry human labels", () => {
    const form = furnitureForm({ id: "f", type: "roundTable", x: 0, y: 0, w: 10, h: 10 } as never);
    const type = form.fields.find((x) => x.name === "type")!;
    const options = (type.selector.select as { options: { value: string; label: string }[] }).options;
    expect(options.find((o) => o.value === "roundTable")!.label).toBe("round table");
  });

  it("tracker exposes rounded position", () => {
    const d = trackerForm({ id: "t", x: 1.6, y: 2.2, w: 20, h: 20 } as never).data;
    expect(d).toMatchObject({ x: 2, y: 2, w: 20, h: 20 });
  });

  // Issue #82: furniture can bind an entity so the drawing goes live.
  it("furniture offers an optional entity, empty when unbound", () => {
    const form = furnitureForm({ id: "f", type: "plant", x: 0, y: 0, w: 10, h: 10 } as never);
    const entity = form.fields.find((x) => x.name === "entity")!;
    expect(entity.required).toBeUndefined();
    expect(entity.selector).toEqual({ entity: {} });
    expect(form.data.entity).toBe("");
  });

  it("furniture entity picker scopes to a linked HA area when given one", () => {
    const form = furnitureForm({ id: "f", type: "plant", x: 0, y: 0, w: 10, h: 10 } as never, {
      entities: ["sensor.soil"],
      name: "Living room",
    });
    expect(form.fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: { include_entities: ["sensor.soil"] },
    });
  });

  it("sectional keeps its chaise-side field alongside the entity", () => {
    const form = furnitureForm({
      id: "f",
      type: "sectional",
      x: 0,
      y: 0,
      w: 10,
      h: 10,
      entity: "binary_sensor.x",
    } as never);
    expect(form.fields.map((x) => x.name)).toContain("hand");
    expect(form.data).toMatchObject({ hand: "right", entity: "binary_sensor.x" });
  });

  it("non-sectional furniture has no chaise-side field or data", () => {
    const form = furnitureForm({ id: "f", type: "table", x: 0, y: 0, w: 10, h: 10 } as never);
    expect(form.fields.map((x) => x.name)).not.toContain("hand");
    expect("hand" in form.data).toBe(false);
  });
});

describe("wallForm / projectForm / floorImageForm", () => {
  it("wall exposes rounded coordinates", () => {
    const d = wallForm({ id: "w", x1: 1.4, y1: 2.6, x2: 3, y2: 4 }).data;
    expect(d).toMatchObject({ x1: 1, y1: 3, x2: 3, y2: 4 });
  });

  it("wall defaults thickness to WALL_THICKNESS and strips it back out at the default", () => {
    const form = wallForm({ id: "w", x1: 0, y1: 0, x2: 1, y2: 1 });
    expect(form.data.thickness).toBe(8);
    expect(form.toPatch({ thickness: 8 })).toEqual({ thickness: undefined });
    expect(form.toPatch({ thickness: 5 })).toEqual({ thickness: 5 });
  });

  it("wall reflects a custom thickness in its data", () => {
    const d = wallForm({ id: "w", x1: 0, y1: 0, x2: 1, y2: 1, thickness: 10 }).data;
    expect(d.thickness).toBe(10);
  });

  it("wall's thickness slider is capped at MAX_SKIN_WALL_WIDTH", () => {
    const field = wallForm({ id: "w", x1: 0, y1: 0, x2: 1, y2: 1 }).fields.find(
      (f) => f.name === "thickness"
    )!;
    expect((field.selector.number as { max: number }).max).toBe(MAX_SKIN_WALL_WIDTH);
  });

  it("project fields are required numbers with min 1", () => {
    const form = projectForm({ type: "t", width: 1000, height: 600 } as FloorplanCardConfig);
    const width = form.fields.find((x) => x.name === "width")!;
    expect(width.required).toBe(true);
    expect((width.selector.number as { min: number }).min).toBe(1);
  });

  it("rotation lives in the bottom-row display form, defaults to 0°, and patches as a number", () => {
    const form = projectDisplayForm({ type: "t", width: 1000, height: 600 } as FloorplanCardConfig);
    expect(form.fields.map((x) => x.name)).toEqual(["rotation", "overlayScale"]);
    expect(form.data.rotation).toBe("0");
    // 0 comes back as undefined so an unrotated plan stays out of the YAML.
    expect(form.toPatch({ rotation: "0" })).toEqual({ rotation: undefined });
    expect(form.toPatch({ rotation: "90" })).toEqual({ rotation: 90 });
    const rotated = projectDisplayForm({
      type: "t",
      width: 1000,
      height: 600,
      rotation: 270,
    } as FloorplanCardConfig);
    expect(rotated.data.rotation).toBe("270");
  });

  it("skin offers every built-in and keeps the default out of the YAML", () => {
    const base = { type: "t", width: 1000, height: 600 } as FloorplanCardConfig;
    const form = projectSkinForm(base);
    expect(form.fields.map((x) => x.name)).toEqual(["skin"]);
    const options = (form.fields[0].selector.select as { options: { value: string }[] }).options;
    expect(options.map((o) => o.value)).toEqual(SKINS.map((s) => s.id));
    expect(form.data.skin).toBe(DEFAULT_SKIN);
    expect(form.toPatch({ skin: DEFAULT_SKIN })).toEqual({ skin: undefined });
    expect(form.toPatch({ skin: "tron" })).toEqual({ skin: "tron" });
  });

  it("press effect offers all four and keeps the default out of the YAML (#134)", () => {
    const base = { type: "t", width: 1000, height: 600 } as FloorplanCardConfig;
    const form = projectPressForm(base);
    expect(form.fields.map((x) => x.name)).toEqual(["pressEffect"]);
    const options = (form.fields[0].selector.select as { options: { value: string; label: string }[] })
      .options;
    expect(options.map((o) => o.value)).toEqual(["scale", "ripple", "flash", "none"]);
    // A device already has its own "Ripple" toggle (the presence ring), so
    // this one is named apart from it.
    expect(options.find((o) => o.value === "ripple")!.label).toBe("Ink ripple");
    expect(form.data.pressEffect).toBe(DEFAULT_PRESS_EFFECT);
    expect(form.toPatch({ pressEffect: DEFAULT_PRESS_EFFECT })).toEqual({ pressEffect: undefined });
    expect(form.toPatch({ pressEffect: "ripple" })).toEqual({ pressEffect: "ripple" });
    // "None" is a choice, not an absence — it has to be written down.
    expect(form.toPatch({ pressEffect: "none" })).toEqual({ pressEffect: "none" });
  });

  it("press effect reads a junk value back as the default it renders as (#134)", () => {
    const form = projectPressForm({
      type: "t",
      width: 1000,
      height: 600,
      pressEffect: "sparkle",
    } as never);
    expect(form.data.pressEffect).toBe(DEFAULT_PRESS_EFFECT);
  });

  it("skin reads back a skin we don't ship as the default, matching what it renders as", () => {
    const form = projectSkinForm({
      type: "t",
      width: 1000,
      height: 600,
      skin: "nintendo",
    } as FloorplanCardConfig);
    expect(form.data.skin).toBe(DEFAULT_SKIN);
  });

  it("skin's helper describes the skin currently selected", () => {
    const tron = SKINS.find((s) => s.id === "tron")!;
    const form = projectSkinForm({
      type: "t",
      width: 1000,
      height: 600,
      skin: "tron",
    } as FloorplanCardConfig);
    expect(form.fields[0].helper).toBe(tron.description);
  });

  it("overlay scale shares that form, defaults to fixed, and stays out of the YAML when default", () => {
    const form = projectDisplayForm({ type: "t", width: 1000, height: 600 } as FloorplanCardConfig);
    expect(form.data.overlayScale).toBe("fixed");
    expect(form.toPatch({ overlayScale: "fixed" })).toEqual({ overlayScale: undefined });
    expect(form.toPatch({ overlayScale: "plan" })).toEqual({ overlayScale: "plan" });
    // Patching one field must not invent a value for the other.
    expect(form.toPatch({ rotation: "90" })).toEqual({ rotation: 90 });
    const scaled = projectDisplayForm({
      type: "t",
      width: 1000,
      height: 600,
      overlayScale: "plan",
    } as FloorplanCardConfig);
    expect(scaled.data.overlayScale).toBe("plan");
  });

  it("image opacity appears only when an image is set", () => {
    expect(floorImageForm({ image: "x.png" } as Floor).fields.map((x) => x.name)).toContain(
      "imageOpacity"
    );
    expect(floorImageForm({} as Floor).fields.map((x) => x.name)).not.toContain("imageOpacity");
  });

  it("offers the fit only alongside an image, defaulting to stretch (issue #86)", () => {
    const withImage = floorImageForm({ image: "x.png" } as Floor);
    expect(withImage.fields.map((x) => x.name)).toContain("imageFit");
    expect(withImage.data.imageFit).toBe("stretch");
    expect(floorImageForm({} as Floor).fields.map((x) => x.name)).not.toContain("imageFit");
    expect(floorImageForm({ image: "x.png", imageFit: "contain" } as Floor).data.imageFit).toBe(
      "contain"
    );
  });

  it("drops the default fit from the config instead of writing it out", () => {
    const { toPatch } = floorImageForm({ image: "x.png" } as Floor);
    expect(toPatch({ imageFit: "stretch" }).imageFit).toBeUndefined();
    expect(toPatch({ imageFit: "cover" }).imageFit).toBe("cover");
    // Untouched keys must survive the patch — it rewrites one field, not the form.
    expect(toPatch({ imageFit: "stretch", imageOpacity: 0.5 }).imageOpacity).toBe(0.5);
  });
});

describe("openingForm — sash and shutter (issues #73 / #74)", () => {
  const win = { id: "w1", type: "window", x: 0, y: 0, length: 90, angle: 0 } as Opening;

  it("offers glazing on doors only — a window is glass by definition", () => {
    expect(openingForm(door).fields.map((x) => x.name)).toContain("glazed");
    expect(openingForm(win).fields.map((x) => x.name)).not.toContain("glazed");
    expect(openingForm(door).data.glazed).toBe(false);
    expect(openingForm(win).data.glazed).toBe(true);
    expect(openingForm({ ...door, glazed: true } as Opening).data.glazed).toBe(true);
    // Only a door's yes is worth writing down; its no is the default.
    expect(openingForm(door).toPatch({ glazed: true })).toEqual({ glazed: true });
    expect(openingForm(door).toPatch({ glazed: false })).toEqual({ glazed: undefined });
  });

  it("every swing opening offers a leaf count; only sliders and rollers don't", () => {
    const names = openingForm(win).fields.map((x) => x.name);
    expect(names).toContain("sash");
    // Doors too now: a double door is as ordinary as a double casement.
    expect(openingForm(door).fields.map((x) => x.name)).toContain("sash");
    expect(
      openingForm({ ...win, motion: "slide" } as Opening).fields.map((x) => x.name)
    ).not.toContain("sash");
    expect(
      openingForm({ ...win, motion: "roll" } as Opening).fields.map((x) => x.name)
    ).not.toContain("sash");
  });

  it("names the leaf count after what it is, and opens on this type's default", () => {
    const field = (o: Opening) => openingForm(o).fields.find((x) => x.name === "sash")!;
    expect(field(win).label).toBe("Sashes");
    expect(field(door).label).toBe("Leaves");
    expect(openingForm(win).data.sash).toBe("double");
    expect(openingForm(door).data.sash).toBe("single");
  });

  it("the hinge is offered only where there is one leaf to hang", () => {
    // A double is hinged at both jambs, so there is no side left to choose.
    expect(openingForm(win).fields.map((x) => x.name)).not.toContain("hinge");
    expect(openingForm(door).fields.map((x) => x.name)).toContain("hinge");
    expect(
      openingForm({ ...win, sash: "single" } as Opening).fields.map((x) => x.name)
    ).toContain("hinge");
    expect(
      openingForm({ ...door, sash: "double" } as Opening).fields.map((x) => x.name)
    ).not.toContain("hinge");
  });

  it("writes down only the value that isn't this type's default", () => {
    // The defaults run opposite ways, so the same patch means different things.
    expect(openingForm(win).toPatch({ sash: "single" })).toEqual({ sash: "single" });
    expect(openingForm(win).toPatch({ sash: "double" })).toEqual({ sash: undefined });
    expect(openingForm(door).toPatch({ sash: "double" })).toEqual({ sash: "double" });
    expect(openingForm(door).toPatch({ sash: "single" })).toEqual({ sash: undefined });
  });

  it("every opening offers a Shutter picker taking covers or contact sensors", () => {
    // Doors get shutters too (French/patio doors), and a hinged shutter
    // usually reports through a binary_sensor rather than a cover (#74).
    for (const o of [win, door]) {
      const f = openingForm(o).fields.find((x) => x.name === "shutterEntity");
      expect(f).toBeDefined();
      expect(f!.selector).toEqual({
        entity: { filter: [{ domain: ["cover", "binary_sensor"] }] },
      });
    }
  });

  it("the shutter type appears only once one is bound, and defaults per domain", () => {
    expect(openingForm(win).fields.map((x) => x.name)).not.toContain("shutterStyle");
    const contact = openingForm({ ...win, shutterEntity: "binary_sensor.shutter" } as Opening);
    expect(contact.fields.map((x) => x.name)).toContain("shutterStyle");
    expect(contact.data.shutterStyle).toBe("swing");
    const roller = openingForm({ ...win, shutterEntity: "cover.tapparella" } as Opening);
    expect(roller.data.shutterStyle).toBe("roll");
    // An explicit choice overrides the domain default either way.
    expect(
      openingForm({ ...win, shutterEntity: "cover.x", shutterStyle: "swing" } as Opening).data
        .shutterStyle
    ).toBe("swing");
  });

  it("patches map back to config shape (double stays out of the YAML)", () => {
    const form = openingForm(win);
    expect(form.toPatch({ sash: "single" })).toEqual({ sash: "single" });
    expect(form.toPatch({ sash: "double" })).toEqual({ sash: undefined });
    expect(form.data.sash).toBe("double");
    expect(openingForm({ ...win, sash: "single" } as Opening).data.sash).toBe("single");
  });
});

describe("openingForm — shutter invert and side (issue #74 follow-up)", () => {
  const win = { id: "w1", type: "window", x: 0, y: 0, length: 90, angle: 0 } as Opening;
  const hinged = { ...win, shutterEntity: "binary_sensor.persiana" } as Opening;
  const roller = { ...win, shutterEntity: "cover.tapparella" } as Opening;
  const names = (o: Opening) => openingForm(o).fields.map((f) => f.name);

  it("offers Invert shutter only once a shutter is bound", () => {
    expect(names(win)).not.toContain("shutterInvert");
    expect(names(hinged)).toContain("shutterInvert");
    expect(names(roller)).toContain("shutterInvert");
  });

  it("keeps it separate from the opening's own Invert", () => {
    // A reed contact on the shutter and the window's own sensor routinely
    // disagree about which way round `on` means open.
    const both = { ...hinged, entity: "binary_sensor.win" } as Opening;
    expect(names(both)).toContain("invert");
    expect(names(both)).toContain("shutterInvert");
    expect(openingForm({ ...both, shutterInvert: true, invert: false } as Opening).data)
      .toMatchObject({ shutterInvert: true, invert: false });
  });

  it("asks which side only for hinged panels", () => {
    // The roll curtain is symmetric about the wall line, so the answer would
    // change nothing on screen.
    expect(names(hinged)).toContain("shutterSide");
    expect(names(roller)).not.toContain("shutterSide");
    // …and it follows the explicit style, not just the entity's domain.
    expect(names({ ...roller, shutterStyle: "swing" } as Opening)).toContain("shutterSide");
    expect(names({ ...hinged, shutterStyle: "roll" } as Opening)).not.toContain("shutterSide");
  });

  it("reads the side back off shutterFlipV", () => {
    expect(openingForm(hinged).data.shutterSide).toBe("far");
    expect(openingForm({ ...hinged, shutterFlipV: true } as Opening).data.shutterSide).toBe("near");
  });

  it("patches the side and the invert back into config keys", () => {
    const { toPatch } = openingForm(hinged);
    expect(toPatch({ shutterSide: "near" })).toEqual({ shutterFlipV: true });
    // "far" is the default, so it stays out of the YAML.
    expect(toPatch({ shutterSide: "far" })).toEqual({ shutterFlipV: undefined });
    expect(toPatch({ shutterInvert: true })).toEqual({ shutterInvert: true });
    expect(toPatch({ shutterInvert: false })).toEqual({ shutterInvert: undefined });
  });

  it("clearing the shutter clears everything that only meant something with it", () => {
    const decorated = {
      ...hinged,
      shutterStyle: "swing",
      shutterFlipV: true,
      shutterInvert: true,
      shutterActiveColor: "#ff0000",
    } as Opening;
    // Left behind, a stale invert or side would silently reapply to whatever
    // shutter is bound next.
    expect(openingForm(decorated).toPatch({ shutterEntity: undefined })).toEqual({
      shutterEntity: undefined,
      shutterStyle: undefined,
      shutterFlipV: undefined,
      shutterInvert: undefined,
      shutterActiveColor: undefined,
    });
  });

  it("binding a different shutter keeps its settings", () => {
    expect(openingForm(hinged).toPatch({ shutterEntity: "cover.other" })).toEqual({
      shutterEntity: "cover.other",
    });
  });
});

describe("openingForm — actions (issue #74 follow-up)", () => {
  const win = { id: "w1", type: "window", x: 0, y: 0, length: 90, angle: 0 } as Opening;
  const names = (o: Opening) => openingForm(o).fields.map((f) => f.name);
  const gestures = ["tap_action", "hold_action", "double_tap_action"];
  /** A cover that can open and close; everything else reports no features. */
  const toggleable = (id: string) => (id.startsWith("cover.") ? 3 : 0);
  const defaultOf = (o: Opening, name: string, featuresOf?: (id: string) => number) =>
    (openingForm(o, featuresOf).fields.find((f) => f.name === name)!.selector as {
      ui_action: { default_action: string };
    }).ui_action.default_action;

  it("offers no actions until there is something to act on", () => {
    for (const g of gestures) expect(names(win)).not.toContain(g);
  });

  it("offers all three once either entity is bound", () => {
    for (const g of gestures) {
      expect(names({ ...win, entity: "binary_sensor.win" } as Opening)).toContain(g);
      // A shutter-only opening is pressable too, so it gets them as well.
      expect(names({ ...win, shutterEntity: "cover.tapparella" } as Opening)).toContain(g);
    }
  });

  it("the tap default names what the card would actually do", () => {
    const cover = { ...win, entity: "cover.win" } as Opening;
    expect(defaultOf(cover, "tap_action", toggleable)).toBe("toggle");
    // Without a features lookup the form can only say "no features", and a
    // cover it cannot open reads more-info — same as the card would do.
    expect(defaultOf(cover, "tap_action")).toBe("more-info");
    expect(defaultOf({ ...win, entity: "binary_sensor.win" } as Opening, "tap_action", toggleable))
      .toBe("more-info");
    // A shutter-only opening taps its shutter, since nothing else is bound.
    expect(
      defaultOf({ ...win, shutterEntity: "cover.tapparella" } as Opening, "tap_action", toggleable)
    ).toBe("toggle");
  });

  it("hold defaults to more-info only when there is a shutter to reach", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    expect(defaultOf(both, "hold_action", toggleable)).toBe("more-info");
    expect(defaultOf({ ...win, entity: "binary_sensor.win" } as Opening, "hold_action")).toBe("none");
    expect(defaultOf({ ...win, shutterEntity: "cover.s" } as Opening, "hold_action")).toBe("none");
  });

  it("offers the icon switch only with two entities, and the glyph only while it is on", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    expect(names({ ...win, shutterEntity: "cover.s" } as Opening)).not.toContain("showShutterIcon");
    expect(names(both)).toContain("showShutterIcon");
    expect(names(both)).toContain("shutterIcon");
    // Nothing drawn, nothing to restyle.
    expect(names({ ...both, showShutterIcon: false } as Opening)).not.toContain("shutterIcon");
    expect(names({ ...both, showShutterIcon: false } as Opening)).toContain("showShutterIcon");
  });

  it("reads the switch back as on unless it was turned off", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    expect(openingForm(both).data.showShutterIcon).toBe(true);
    expect(openingForm({ ...both, showShutterIcon: false } as Opening).data.showShutterIcon).toBe(
      false
    );
    expect(openingForm(both).data.shutterIcon).toBe("");
    expect(openingForm({ ...both, shutterIcon: "mdi:mine" } as Opening).data.shutterIcon).toBe(
      "mdi:mine"
    );
  });

  it("writes down only the off switch, and drops both with the shutter", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    const { toPatch } = openingForm(both);
    expect(toPatch({ showShutterIcon: false })).toEqual({ showShutterIcon: false });
    expect(toPatch({ showShutterIcon: true })).toEqual({ showShutterIcon: undefined });
    expect(toPatch({ shutterIcon: "mdi:mine" })).toEqual({ shutterIcon: "mdi:mine" });
    const cleared = openingForm({
      ...both,
      showShutterIcon: false,
      shutterIcon: "mdi:mine",
    } as Opening).toPatch({ shutterEntity: undefined });
    expect(cleared.showShutterIcon).toBeUndefined();
    expect(cleared.shutterIcon).toBeUndefined();
  });

  it("offers the tap target only with two entities to choose between", () => {
    expect(names({ ...win, entity: "binary_sensor.win" } as Opening)).not.toContain("tapTarget");
    expect(names({ ...win, shutterEntity: "cover.s" } as Opening)).not.toContain("tapTarget");
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    expect(names(both)).toContain("tapTarget");
    expect(openingForm(both).data.tapTarget).toBe("opening");
    expect(openingForm({ ...both, tapTarget: "shutter" } as Opening).data.tapTarget).toBe("shutter");
  });

  it("names the opening's own half after what it is", () => {
    const label = (o: Opening) =>
      (openingForm(o).fields.find((f) => f.name === "tapTarget")!.selector as {
        select: { options: { value: string; label: string }[] };
      }).select.options[0].label;
    const bound = { entity: "binary_sensor.x", shutterEntity: "cover.s" };
    expect(label({ ...win, ...bound } as Opening)).toBe("The window");
    expect(label({ ...win, ...bound, type: "door" } as Opening)).toBe("The door");
  });

  it("the tap default follows the chosen target", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    expect(defaultOf(both, "tap_action", toggleable)).toBe("more-info");
    // Pointing it at an open/close cover still reads more-info: the choice
    // opens the shutter's dialog rather than driving the motor.
    expect(defaultOf({ ...both, tapTarget: "shutter" } as Opening, "tap_action", toggleable)).toBe(
      "more-info"
    );
  });

  it("keeps the default out of the YAML and drops it with the shutter", () => {
    const both = { ...win, entity: "binary_sensor.win", shutterEntity: "cover.s" } as Opening;
    const { toPatch } = openingForm(both);
    expect(toPatch({ tapTarget: "shutter" })).toEqual({ tapTarget: "shutter" });
    expect(toPatch({ tapTarget: "opening" })).toEqual({ tapTarget: undefined });
    // Unbinding the shutter leaves nothing to lead with.
    expect(
      openingForm({ ...both, tapTarget: "shutter" } as Opening).toPatch({ shutterEntity: undefined })
        .tapTarget
    ).toBeUndefined();
  });

  it("double-tap always defaults to nothing", () => {
    const both = { ...win, entity: "cover.win", shutterEntity: "cover.s" } as Opening;
    expect(defaultOf(both, "double_tap_action", toggleable)).toBe("none");
  });

  it("round-trips the configured actions untouched", () => {
    const tap = { action: "toggle", entity: "cover.s" };
    const o = { ...win, entity: "binary_sensor.win", tap_action: tap } as Opening;
    expect(openingForm(o).data.tap_action).toBe(tap);
    expect(openingForm(o).data.hold_action).toBeUndefined();
    expect(openingForm(o).toPatch({ tap_action: tap })).toEqual({ tap_action: tap });
    // A configured tap replaces the default the field would otherwise name.
    expect(defaultOf(o, "tap_action", toggleable)).toBe("toggle");
  });
});

describe("area scoping never traps you (issue reported on #83)", () => {
  const item = { id: "i", entity: "", kind: "light", x: 0, y: 0 } as FloorItem;

  it("outside every area, and inside an empty one, nothing is filtered", () => {
    // No scope at all — the element sits outside every area.
    expect(itemForm(item).fields.find((x) => x.name === "entity")!.selector).toEqual({
      entity: {},
    });
    // Inside an area whose HA area has no entities: same, unfiltered.
    expect(
      itemForm(item, { entities: [], name: "Spare" }).fields.find((x) => x.name === "entity")!
        .selector
    ).toEqual({ entity: {} });
  });
});

describe("projectDeadSpaceForm (issue #88)", () => {
  const cfg = (extra = {}) =>
    ({ type: "custom:easy-floorplan-card", width: 100, height: 100, ...extra }) as FloorplanCardConfig;

  it("reads back off by default", () => {
    expect(projectDeadSpaceForm(cfg()).data).toEqual({ showDeadSpaces: false });
    expect(projectDeadSpaceForm(cfg({ showDeadSpaces: true })).data).toEqual({
      showDeadSpaces: true,
    });
  });

  it("keeps the option out of the YAML while it is off", () => {
    const { toPatch } = projectDeadSpaceForm(cfg({ showDeadSpaces: true }));
    expect(toPatch({ showDeadSpaces: false })).toEqual({ showDeadSpaces: undefined });
    expect(toPatch({ showDeadSpaces: true })).toEqual({ showDeadSpaces: true });
  });
});

describe("projectReliefForm", () => {
  const cfg = (extra = {}) =>
    ({ type: "custom:easy-floorplan-card", width: 100, height: 100, ...extra }) as FloorplanCardConfig;
  const names = (c: FloorplanCardConfig) => projectReliefForm(c).fields.map((f) => f.name);

  it("asks only whether to let the light in, until it is let in", () => {
    expect(names(cfg())).toEqual(["sunlight"]);
  });

  it("reveals north and the sun once the light is let in", () => {
    expect(names(cfg({ sunlight: true }))).toEqual([
      "sunlight",
      "north",
      "sunShade",
      "sunFollows",
    ]);
    // The angle itself only appears once the light is pinned — while it
    // follows the sun, the angle is not ours to choose.
    expect(names(cfg({ sunlight: true, sunBearing: 120 }))).toContain("sunBearing");
    expect(projectReliefForm(cfg({ sunlight: true })).data.sunFollows).toBe(true);
    expect(projectReliefForm(cfg({ sunlight: true, sunBearing: 120 })).data.sunFollows).toBe(false);
  });

  it("switching to the real sun is the *absence* of a bearing", () => {
    const { toPatch } = projectReliefForm(cfg({ sunlight: true, sunBearing: 120 }));
    expect(toPatch({ sunFollows: true })).toEqual({ sunBearing: undefined });
    // Turning it back off restores the stated angle rather than inventing one.
    expect(toPatch({ sunFollows: false })).toEqual({ sunBearing: 120 });
    expect(projectReliefForm(cfg({ sunlight: true })).toPatch({ sunFollows: false })).toEqual({
      sunBearing: DEFAULT_SUN_BEARING,
    });
  });

  it("shutting the sun out takes the angles with it", () => {
    // Left behind they would sit in the YAML meaning nothing, and come back
    // stale the next time the light is let in.
    expect(
      projectReliefForm(cfg({ sunlight: true, north: 90, sunBearing: 10 })).toPatch({
        sunlight: false,
      })
    ).toEqual({ sunlight: undefined, north: undefined, sunBearing: undefined });
  });

  it("says what following the sun costs, since it is what turns the light off", () => {
    const f = projectReliefForm(cfg({ sunlight: true })).fields.find((x) => x.name === "sunFollows")!;
    expect(f.helper).toContain("night");
  });

  it("can draw the light without the shade, and only writes that down", () => {
    expect(projectReliefForm(cfg({ sunlight: true })).data.sunShade).toBe(true);
    expect(projectReliefForm(cfg({ sunlight: true, sunShade: false })).data.sunShade).toBe(false);
    const { toPatch } = projectReliefForm(cfg({ sunlight: true }));
    expect(toPatch({ sunShade: true })).toEqual({ sunShade: undefined });
    expect(toPatch({ sunShade: false })).toEqual({ sunShade: false });
  });

  it("keeps due north out of the YAML, being the default", () => {
    const { toPatch } = projectReliefForm(cfg({ sunlight: true }));
    expect(toPatch({ north: 0 })).toEqual({ north: undefined });
    expect(toPatch({ north: 45 })).toEqual({ north: 45 });
    expect(toPatch({ wallHeight: 60 })).toEqual({ wallHeight: 60 });
  });
});

describe("projectSunForm (issue #113)", () => {
  const cfg = (extra = {}) =>
    ({ type: "custom:easy-floorplan-card", width: 100, height: 100, ...extra }) as FloorplanCardConfig;

  it("hides the brightness sliders until the option is on", () => {
    const names = (c: FloorplanCardConfig) => projectSunForm(c).fields.map((f) => f.name);
    expect(names(cfg())).toEqual(["sunDimming"]);
    expect(names(cfg({ sunDimming: true }))).toEqual([
      "sunDimming",
      "sunBrightnessMin",
      "sunBrightnessMax",
    ]);
  });

  it("presents the effective defaults", () => {
    expect(projectSunForm(cfg()).data).toMatchObject({
      sunDimming: false,
      sunBrightnessMin: 0.45,
      sunBrightnessMax: 1,
    });
    expect(projectSunForm(cfg({ sunDimming: true, sunBrightnessMin: 0.2 })).data)
      .toMatchObject({ sunDimming: true, sunBrightnessMin: 0.2 });
  });

  it("switching off clears the sliders it dragged along, not just the toggle", () => {
    const { toPatch } = projectSunForm(cfg({ sunDimming: true }));
    expect(toPatch({ sunDimming: false })).toEqual({
      sunDimming: undefined,
      sunBrightnessMin: undefined,
      sunBrightnessMax: undefined,
    });
    // Leaving them behind would resurrect stale values on re-enable.
    expect(toPatch({ sunDimming: true }).sunDimming).toBe(true);
    expect(toPatch({ sunBrightnessMin: 0.3 })).toEqual({ sunBrightnessMin: 0.3 });
  });
});
