import { describe, it, expect } from "vitest";
import { html, nothing } from "lit";
import type { Area, Furniture, FurnitureType, ItemKind } from "./types";
import { SKIN_ACCENT, SKIN_WALL, MAX_SKIN_WALL_WIDTH } from "./skins";
import {
  DEFAULT_GLOW_RADIUS,
  DEFAULT_GLOW_COLOR,
  GLOW_MIN_OPACITY,
  GLOW_MAX_OPACITY,
  GLOW_MIN_RADIUS,
  DEFAULT_PRESS_EFFECT,
  BADGE_MIN_LIGHTNESS,
  FURNITURE_GLOW_TRANSMISSION,
  SUN_ELEVATION_NIGHT,
  SUN_ELEVATION_DAY,
} from "./types";
import {
  snapToWall,
  openingDefaultOpen,
  openingMotion,
  openingMirror,
  sliderStyleOf,
  openingHasTwoPanels,
  secondPanelOf,
  openingFromDeviceClass,
  windowSash,
  shutterAmount,
  shutterStyleOf,
  imageFitRatio,
  sunBrightness,
  renderSunDimMask,
  renderWallMask,
  renderDeadSpace,
  renderDeadSpaceHatch,
  DEAD_SPACE_HATCH_GAP,
  DEAD_SPACE_HATCH_OPACITY,
  shutterActive,
  openingClickAction,
  openingActionForGesture,
  openingIsPressable,
  hasShutterMark,
  shutterMarkPoint,
  shutterMarkIcon,
  shutterMarkNormal,
  SHUTTER_MARK_OFFSET,
  SHUTTER_MARK_PIXEL_OFFSET,
  SHUTTER_MARK_SIZE,
  SHUTTER_MARK_ICON_SIZE,
  resolveOpeningOpen,
  resolveOpeningAmount,
  kindFromEntity,
  defaultIcon,
  renderFurniture,
  furnitureColor,
  entityDefaultIcon,
  trackerSensorReading,
  openingInMotion,
  openingIsActive,
  entityStateText,
  itemStateText,
  itemBadgeLabel,
  editorItemLabel,
  itemHiddenWhenInactive,
  resolveStateColor,
  itemLabelSize,
  areaLabelSize,
  areaLabelFontSize,
  wallThickness,
  wallStrokeStyle,
  normalizeOverlayScale,
  overlayLength,
  hassRenderInputsChanged,
  collectWatchedEntities,
  isEntityOn,
  entityIsActive,
  resolveItemIcon,
  matchStateRule,
  badgeContentOf,
  pressEffectOf,
  badgeValue,
  badgeReading,
  badgeValueSize,
  resolveIconAnimation,
  domainIconAnimation,
  isPresenceEntity,
  itemIconSize,
  normalizePlanRotation,
  rotatedCanvasSize,
  rotatePlanPoint,
  planRotationTransform,
  polygonCentroid,
  areaZoomTransform,
  IDENTITY_ZOOM,
  renderArea,
  renderAreaBorder,
  WALL_THICKNESS,
  areaColor,
  glowPaint,
  lightBadgePaint,
  editorGlowPaint,
  glowReach,
  wallsLightPassesThrough,
  renderGlowMask,
  renderOpening,
  renderGlow,
  renderRipple,
} from "./render";
import type { FloorplanCardConfig, Opening, RenderHass } from "./types";
import { symbolCatalog, symbolSize } from "./symbols";

/**
 * Render a Lit template to the string it would emit, for asserting on markup.
 *
 * One copy on purpose. There were nine, in three variants that had already
 * drifted: the weakest stringified Lit's `nothing` **symbol** into the markup
 * as the literal text "Symbol(lit-nothing)", which is how a vacuous assertion
 * slipped through once before (#111) — a test looking for an absent value
 * found that text and passed. This is the strict variant: `nothing`, null and
 * booleans all render as nothing at all, which is what the browser does.
 *
 * Note the output is Lit's *interpolated* form, so attribute values come out
 * unquoted — assertions read `toContain("fill=#4caf50")`, not `fill="#4caf50"`.
 */
const flattenMarkup = (node: unknown): string => {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "symbol") return "";
  if (Array.isArray(node)) return node.map(flattenMarkup).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    return strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? flattenMarkup(values[i]) : ""),
      "",
    );
  }
  return String(node);
};

describe("flattenMarkup — the test helper itself", () => {
  // Every markup assertion in this file runs through it, so a weakened copy
  // would not fail loudly: it would quietly make assertions pass. This is the
  // guard on the consolidation.
  it("renders Lit's omit sentinel as nothing at all, not as its symbol text", () => {
    expect(flattenMarkup(nothing)).toBe("");
    expect(flattenMarkup(html`<i a=${nothing}></i>`)).toBe("<i a=></i>");
    expect(flattenMarkup(html`<i a=${nothing}></i>`)).not.toContain("Symbol");
  });

  it("drops null, undefined and booleans, as the browser does", () => {
    for (const v of [null, undefined, true, false]) expect(flattenMarkup(v)).toBe("");
  });

  it("still interpolates real values, so assertions are not vacuous", () => {
    expect(flattenMarkup(html`<i a=${"x"} b=${2}></i>`)).toBe("<i a=x b=2></i>");
    expect(flattenMarkup([html`<a></a>`, html`<b></b>`])).toBe("<a></a><b></b>");
  });
});

describe("snapToWall", () => {
  const hWall = { x1: 0, y1: 0, x2: 100, y2: 0 }; // horizontal
  const vWall = { x1: 0, y1: 0, x2: 0, y2: 100 }; // vertical

  it("projects a nearby point onto a horizontal wall (angle 0)", () => {
    const r = snapToWall(50, 5, [hWall], 35);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(50);
    expect(r!.y).toBeCloseTo(0);
    expect(r!.angle).toBeCloseTo(0);
  });

  it("reports a 90° angle for a vertical wall", () => {
    const r = snapToWall(5, 50, [vWall], 35);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(0);
    expect(r!.y).toBeCloseTo(50);
    expect(Math.abs(r!.angle)).toBeCloseTo(90);
  });

  it("clamps the projection to the wall's endpoints", () => {
    // A point just past the right end snaps to the endpoint, not beyond it.
    const r = snapToWall(110, 5, [hWall], 35);
    expect(r).not.toBeNull();
    expect(r!.x).toBeCloseTo(100);
    expect(r!.y).toBeCloseTo(0);
  });

  it("returns null when no wall is within the threshold", () => {
    expect(snapToWall(50, 200, [hWall], 35)).toBeNull();
  });

  it("picks the closest of several walls", () => {
    const r = snapToWall(50, 8, [hWall, { x1: 0, y1: 100, x2: 100, y2: 100 }], 35);
    expect(r!.y).toBeCloseTo(0); // nearer to the top wall
  });

  it("ignores zero-length walls", () => {
    expect(snapToWall(0, 0, [{ x1: 10, y1: 10, x2: 10, y2: 10 }], 35)).toBeNull();
  });
});

describe("openingDefaultOpen", () => {
  it("draws only swing doors open by default; windows and sliding openings closed", () => {
    expect(openingDefaultOpen({ type: "door" } as Opening)).toBe(true);
    expect(openingDefaultOpen({ type: "window" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "door", motion: "slide" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "window", motion: "slide" } as Opening)).toBe(false);
  });
});

describe("openingMotion", () => {
  it("defaults to swing and reads the motion field", () => {
    expect(openingMotion({ type: "door" } as Opening)).toBe("swing");
    expect(openingMotion({ type: "door", motion: "slide" } as Opening)).toBe("slide");
    expect(openingMotion({ type: "window", motion: "slide" } as Opening)).toBe("slide");
    expect(openingMotion({ type: "door", motion: "roll" } as Opening)).toBe("roll");
  });
});

describe("roll-up openings (issue #45)", () => {
  it("draw closed by default, like sliders", () => {
    expect(openingDefaultOpen({ type: "door", motion: "roll" } as Opening)).toBe(false);
    expect(openingDefaultOpen({ type: "window", motion: "roll" } as Opening)).toBe(false);
  });
  it("have no slider panel arrangement", () => {
    expect(sliderStyleOf({ type: "door", motion: "roll", sliderStyle: "bypass" } as Opening)).toBe(
      "single",
    );
  });
});

describe("openingMirror", () => {
  it("defaults to no mirror", () => {
    expect(openingMirror({ type: "door" } as Opening)).toEqual({ sx: 1, sy: 1 });
  });
  it("flipH mirrors x, flipV mirrors y, both mirror both", () => {
    expect(openingMirror({ type: "door", flipH: true } as Opening)).toEqual({ sx: -1, sy: 1 });
    expect(openingMirror({ type: "door", flipV: true } as Opening)).toEqual({ sx: 1, sy: -1 });
    expect(openingMirror({ type: "door", flipH: true, flipV: true } as Opening)).toEqual({
      sx: -1,
      sy: -1,
    });
  });
});

describe("sliderStyleOf", () => {
  it("reflects the configured style only when the opening is sliding", () => {
    expect(sliderStyleOf({ type: "door", motion: "slide" } as Opening)).toBe("single");
    expect(sliderStyleOf({ type: "door", motion: "slide", sliderStyle: "bypass" } as Opening)).toBe(
      "bypass",
    );
    expect(
      sliderStyleOf({ type: "window", motion: "slide", sliderStyle: "biparting" } as Opening),
    ).toBe("biparting");
  });
  it("is single for swinging openings regardless of sliderStyle", () => {
    expect(sliderStyleOf({ type: "door", sliderStyle: "bypass" } as Opening)).toBe("single");
  });
  it("carries the biparting-bypass style through (issue #145)", () => {
    expect(
      sliderStyleOf({ type: "door", motion: "slide", sliderStyle: "biparting-bypass" } as Opening),
    ).toBe("biparting-bypass");
  });
});

describe("openingHasTwoPanels / secondPanelOf (issue #145)", () => {
  const slider = (extra: Partial<Opening> = {}) =>
    ({ type: "door", motion: "slide", ...extra }) as Opening;

  it("is true for exactly the two biparting styles", () => {
    expect(openingHasTwoPanels(slider({ sliderStyle: "biparting" }))).toBe(true);
    expect(openingHasTwoPanels(slider({ sliderStyle: "biparting-bypass" }))).toBe(true);
    // bypass moves one panel past a fixed one; single moves the only panel.
    expect(openingHasTwoPanels(slider({ sliderStyle: "bypass" }))).toBe(false);
    expect(openingHasTwoPanels(slider())).toBe(false);
    // A swing door has leaves, but no sliding panel to bind a second sensor to.
    expect(openingHasTwoPanels({ type: "door", sliderStyle: "biparting" } as Opening)).toBe(false);
  });

  it("swaps in the second entity and keeps everything else", () => {
    const o = slider({
      sliderStyle: "biparting",
      entity: "binary_sensor.left",
      secondaryEntity: "binary_sensor.right",
      invert: true,
      length: 90,
    });
    expect(secondPanelOf(o)).toEqual({ ...o, entity: "binary_sensor.right" });
  });

  it("resolves the second panel independently, sharing invert", () => {
    const o = slider({
      sliderStyle: "biparting",
      entity: "binary_sensor.left",
      secondaryEntity: "binary_sensor.right",
    });
    const panel = secondPanelOf(o);
    expect(resolveOpeningAmount(panel, { state: "on" })).toBe(1);
    expect(resolveOpeningAmount(panel, { state: "off" })).toBe(0);
    expect(openingIsActive(panel, { state: "on" })).toBe(true);
    expect(openingIsActive(panel, { state: "off" })).toBe(false);
    // Position-aware covers drive the panel partway, and invert flips it.
    expect(
      resolveOpeningAmount(panel, { state: "open", attributes: { current_position: 40 } }),
    ).toBeCloseTo(0.4);
    expect(
      resolveOpeningAmount(secondPanelOf({ ...o, invert: true }), {
        state: "open",
        attributes: { current_position: 40 },
      }),
    ).toBeCloseTo(0.6);
    // An outage on one leaf fails that leaf closed, not the whole opening.
    expect(resolveOpeningAmount(panel, { state: "unavailable" })).toBe(0);
    expect(openingIsActive(panel, { state: "unavailable" })).toBe(false);
  });
});

describe("openingFromDeviceClass", () => {
  it("maps window-like cover device classes to a window", () => {
    expect(openingFromDeviceClass("window")).toEqual({ type: "window", motion: undefined });
    expect(openingFromDeviceClass("blind")).toEqual({ type: "window", motion: "slide" });
    expect(openingFromDeviceClass("shade")).toEqual({ type: "window", motion: "slide" });
    expect(openingFromDeviceClass("curtain")).toEqual({ type: "window", motion: "slide" });
  });
  it("maps door-like device classes to a door", () => {
    expect(openingFromDeviceClass("door")).toEqual({ type: "door", motion: undefined });
    expect(openingFromDeviceClass("gate")).toEqual({ type: "door", motion: undefined });
  });
  it("garage doors and roller shutters roll up (issue #45)", () => {
    expect(openingFromDeviceClass("garage")).toEqual({ type: "door", motion: "roll" });
    expect(openingFromDeviceClass("garage_door")).toEqual({ type: "door", motion: "roll" });
    expect(openingFromDeviceClass("shutter")).toEqual({ type: "window", motion: "roll" });
  });
  it("defaults unknown / missing device classes to a swing door", () => {
    expect(openingFromDeviceClass(undefined)).toEqual({ type: "door", motion: undefined });
    expect(openingFromDeviceClass("opening")).toEqual({ type: "door", motion: undefined });
  });
});

describe("openingClickAction", () => {
  it("toggles a cover that supports open/close", () => {
    expect(openingClickAction("cover.blind", 3)).toBe("cover-toggle"); // OPEN|CLOSE
    expect(openingClickAction("cover.garage", 11)).toBe("cover-toggle"); // OPEN|CLOSE|STOP
  });
  it("opens more-info for read-only or position-only entities", () => {
    expect(openingClickAction("cover.blind", 4)).toBe("more-info"); // SET_POSITION only
    expect(openingClickAction("cover.blind", 0)).toBe("more-info");
    expect(openingClickAction("binary_sensor.door", 0)).toBe("more-info");
  });
});

describe("resolveOpeningOpen", () => {
  const door = { type: "door", entity: "binary_sensor.x" } as Opening;
  const slider = { type: "door", motion: "slide", entity: "cover.x" } as Opening;

  it("maps on/open to open and everything else to closed", () => {
    expect(resolveOpeningOpen(door, "on")).toBe(true);
    expect(resolveOpeningOpen(door, "open")).toBe(true);
    expect(resolveOpeningOpen(door, "off")).toBe(false);
    expect(resolveOpeningOpen(door, "closed")).toBe(false);
  });

  it("treats a moving cover (opening/closing) as open", () => {
    expect(resolveOpeningOpen(door, "opening")).toBe(true);
    expect(resolveOpeningOpen(door, "closing")).toBe(true);
    // unavailable/unknown are not open
    expect(resolveOpeningOpen(door, "unavailable")).toBe(false);
  });

  it("invert flips the interpretation", () => {
    expect(resolveOpeningOpen({ ...door, invert: true }, "on")).toBe(false);
    expect(resolveOpeningOpen({ ...door, invert: true }, "off")).toBe(true);
  });

  it("fails closed on a sensor outage, even when inverted", () => {
    // A stale "open" during unavailable/unknown is worse than showing closed —
    // invert must not flip an outage into "open".
    expect(resolveOpeningOpen(door, "unavailable")).toBe(false);
    expect(resolveOpeningOpen(door, "unknown")).toBe(false);
    expect(resolveOpeningOpen({ ...door, invert: true }, "unavailable")).toBe(false);
    expect(resolveOpeningOpen({ ...door, invert: true }, "unknown")).toBe(false);
  });

  it("falls back to the type default when no entity or unknown state", () => {
    expect(resolveOpeningOpen({ type: "door" } as Opening, undefined)).toBe(true);
    expect(resolveOpeningOpen({ type: "window" } as Opening, undefined)).toBe(false);
    expect(resolveOpeningOpen({ type: "door", motion: "slide" } as Opening, undefined)).toBe(false);
    // entity bound but state not yet available → default
    expect(resolveOpeningOpen(slider, undefined)).toBe(false);
  });

  it("a slider bound to a cover resolves like a door", () => {
    expect(resolveOpeningOpen(slider, "open")).toBe(true);
    expect(resolveOpeningOpen(slider, "closed")).toBe(false);
  });
});

describe("resolveOpeningAmount", () => {
  const door = { type: "door", entity: "cover.x" } as Opening;
  const atPos = (pos: number) => ({ state: "open", attributes: { current_position: pos } });

  it("uses current_position/100 for position covers", () => {
    expect(resolveOpeningAmount(door, atPos(0))).toBe(0);
    expect(resolveOpeningAmount(door, atPos(50))).toBe(0.5);
    expect(resolveOpeningAmount(door, atPos(100))).toBe(1);
  });

  it("clamps out-of-range positions and applies invert", () => {
    expect(resolveOpeningAmount(door, atPos(150))).toBe(1);
    expect(resolveOpeningAmount(door, atPos(-10))).toBe(0);
    expect(resolveOpeningAmount({ ...door, invert: true }, atPos(30))).toBeCloseTo(0.7);
  });

  it("falls back to a binary 0/1 when there is no position attribute", () => {
    expect(resolveOpeningAmount(door, { state: "open" })).toBe(1);
    expect(resolveOpeningAmount(door, { state: "closed" })).toBe(0);
  });

  it("uses the type default when there is no entity/state", () => {
    expect(resolveOpeningAmount({ type: "door" } as Opening, undefined)).toBe(1);
    expect(resolveOpeningAmount({ type: "door", motion: "slide" } as Opening, undefined)).toBe(0);
  });

  it("fails closed (0) on a sensor outage, ignoring any stale position", () => {
    // A cover that goes unavailable can leave a stale current_position; it must
    // not keep rendering open (and invert must not flip an outage into open).
    expect(
      resolveOpeningAmount(door, { state: "unavailable", attributes: { current_position: 100 } }),
    ).toBe(0);
    expect(resolveOpeningAmount(door, { state: "unknown" })).toBe(0);
    expect(
      resolveOpeningAmount({ ...door, invert: true }, {
        state: "unavailable",
        attributes: { current_position: 0 },
      }),
    ).toBe(0);
  });
});

describe("kindFromEntity", () => {
  it("maps known domains to their kind", () => {
    expect(kindFromEntity("light.kitchen")).toBe("light");
    expect(kindFromEntity("binary_sensor.door")).toBe("binary_sensor");
    expect(kindFromEntity("cover.garage")).toBe("cover");
  });
  it("maps the domains that carry their own meaning", () => {
    expect(kindFromEntity("media_player.tv")).toBe("media_player");
    expect(kindFromEntity("fan.ceiling")).toBe("fan");
    expect(kindFromEntity("camera.doorbell")).toBe("camera");
    expect(kindFromEntity("lock.front")).toBe("lock");
    expect(kindFromEntity("humidifier.dehumidifier")).toBe("humidifier");
    expect(kindFromEntity("vacuum.roomba")).toBe("vacuum");
  });
  it("falls back to generic for unknown domains", () => {
    expect(kindFromEntity("automation.morning")).toBe("generic");
    expect(kindFromEntity("scene.movie")).toBe("generic");
    expect(kindFromEntity("weird")).toBe("generic");
  });
});

describe("defaultIcon", () => {
  it("gives every kind an icon that is not the generic circle", () => {
    const kinds: ItemKind[] = [
      "light", "switch", "sensor", "binary_sensor", "climate", "cover",
      "media_player", "fan", "camera", "lock", "humidifier", "vacuum",
    ];
    for (const k of kinds) {
      expect(defaultIcon(k), k).toMatch(/^mdi:/);
      expect(defaultIcon(k), k).not.toBe("mdi:circle");
    }
    expect(defaultIcon("generic")).toBe("mdi:circle");
  });
});

describe("entityDefaultIcon for domains without a device class", () => {
  it("distinguishes a television from a doorbell", () => {
    // Both have no device class. Before, both rendered mdi:circle.
    expect(entityDefaultIcon("media_player.tv", undefined, true)).toBe("mdi:television-play");
    expect(entityDefaultIcon("media_player.tv", undefined, false)).toBe("mdi:television-off");
    expect(entityDefaultIcon("camera.doorbell", undefined, true)).toBe("mdi:cctv");
  });
  it("shows a lock as open when it is unlocked", () => {
    expect(entityDefaultIcon("lock.front", undefined, true)).toBe("mdi:lock-open-variant");
    expect(entityDefaultIcon("lock.front", undefined, false)).toBe("mdi:lock");
  });
  it("still returns undefined for a domain it knows nothing about", () => {
    expect(entityDefaultIcon("automation.x", undefined, true)).toBeUndefined();
  });
  it("does not shadow a binary_sensor's device-class icon", () => {
    expect(entityDefaultIcon("binary_sensor.d", "door", true)).toBe("mdi:door-open");
  });
});

describe("trackerSensorReading", () => {
  const states = {
    "sensor.x": { state: "2.5" },
    "sensor.bad": { state: "unavailable" },
    "sensor.text": { state: "open" },
  };
  it("parses a numeric entity state", () => {
    expect(trackerSensorReading(states, "sensor.x")).toBe(2.5);
  });
  it("returns null for missing entity, missing state, or non-numeric reading", () => {
    expect(trackerSensorReading(states, undefined)).toBeNull();
    expect(trackerSensorReading(undefined, "sensor.x")).toBeNull();
    expect(trackerSensorReading(states, "sensor.missing")).toBeNull();
    expect(trackerSensorReading(states, "sensor.bad")).toBeNull();
    expect(trackerSensorReading(states, "sensor.text")).toBeNull();
  });
});

describe("entityDefaultIcon", () => {
  it("maps a binary_sensor shown as a Lock to lock icons per state (issue #29)", () => {
    // on = unlocked for HA's lock device class
    expect(entityDefaultIcon("binary_sensor.front_door_lock", "lock", true)).toBe("mdi:lock-open");
    expect(entityDefaultIcon("binary_sensor.front_door_lock", "lock", false)).toBe("mdi:lock");
  });

  it("is state-aware for other binary_sensor device classes", () => {
    expect(entityDefaultIcon("binary_sensor.d", "door", true)).toBe("mdi:door-open");
    expect(entityDefaultIcon("binary_sensor.d", "door", false)).toBe("mdi:door-closed");
    expect(entityDefaultIcon("binary_sensor.m", "motion", true)).toBe("mdi:motion-sensor");
    expect(entityDefaultIcon("binary_sensor.w", "window", false)).toBe("mdi:window-closed");
  });

  it("maps sensor device classes (state-independent)", () => {
    expect(entityDefaultIcon("sensor.t", "temperature", false)).toBe("mdi:thermometer");
    expect(entityDefaultIcon("sensor.h", "humidity", true)).toBe("mdi:water-percent");
  });

  it("maps cover device classes per state", () => {
    expect(entityDefaultIcon("cover.g", "garage", true)).toBe("mdi:garage-open");
    expect(entityDefaultIcon("cover.g", "garage", false)).toBe("mdi:garage");
  });

  it("returns undefined for unknown device classes, missing class, or unmapped domains", () => {
    expect(entityDefaultIcon("binary_sensor.x", "made_up", true)).toBeUndefined();
    expect(entityDefaultIcon("binary_sensor.x", undefined, true)).toBeUndefined();
    expect(entityDefaultIcon("light.x", "lock", true)).toBeUndefined();
  });
});

describe("defaultIcon", () => {
  it("returns a sensible mdi icon per kind", () => {
    expect(defaultIcon("light")).toBe("mdi:lightbulb");
    expect(defaultIcon("cover")).toBe("mdi:window-shutter");
    expect(defaultIcon("generic")).toBe("mdi:circle");
  });
});

describe("openingInMotion", () => {
  it("reads the transient cover states as motion", () => {
    expect(openingInMotion("opening")).toBe(true);
    expect(openingInMotion("closing")).toBe(true);
  });
  it("reads settled, absent and outage states as still", () => {
    expect(openingInMotion("open")).toBe(false);
    expect(openingInMotion("closed")).toBe(false);
    expect(openingInMotion("on")).toBe(false);
    expect(openingInMotion(undefined)).toBe(false);
    expect(openingInMotion("unavailable")).toBe(false);
  });
});

describe("openingIsActive", () => {
  const cover = { type: "door", entity: "cover.garage" } as Opening;

  it("accents a cover that is open", () => {
    expect(openingIsActive(cover, { state: "open", attributes: { current_position: 100 } })).toBe(
      true,
    );
  });

  it("accents a cover that has begun opening but not yet moved", () => {
    // A real garage door reports opening at position 0 for a full second, and a
    // rest-only-position cover reports it for the whole travel. Drawn shut, it
    // must still read as in motion, or a tap looks like it did nothing.
    expect(openingIsActive(cover, { state: "opening", attributes: { current_position: 0 } })).toBe(
      true,
    );
  });

  it("accents a cover that is closing but still reports itself fully open", () => {
    expect(openingIsActive(cover, { state: "closing", attributes: { current_position: 100 } })).toBe(
      true,
    );
  });

  it("leaves a settled closed cover unaccented", () => {
    expect(openingIsActive(cover, { state: "closed", attributes: { current_position: 0 } })).toBe(
      false,
    );
  });

  it("never accents during a sensor outage, even with a stale open position", () => {
    expect(
      openingIsActive(cover, { state: "unavailable", attributes: { current_position: 100 } }),
    ).toBe(false);
  });

  it("leaves an opening with no entity unaccented", () => {
    expect(openingIsActive({ type: "door" } as Opening, undefined)).toBe(false);
  });
});

describe("resolveOpeningAmount keeps trusting a live position", () => {
  const cover = { type: "door", entity: "cover.garage" } as Opening;
  it("does not snap a live-position cover open the moment it starts moving", () => {
    // Regression guard: overriding a mid-travel position with the binary state
    // would jump 0 -> 1 -> 0.07 on covers that stream position every second.
    expect(resolveOpeningAmount(cover, { state: "opening", attributes: { current_position: 0 } })).toBe(0);
    expect(resolveOpeningAmount(cover, { state: "opening", attributes: { current_position: 7 } })).toBeCloseTo(0.07);
  });
});

// Stand-in for the real `hass`: `formatEntityState` rounds to the entity's
// configured precision and applies HA's unit spacing, and states are seeded raw
// — so a card that renders `stateObj.state` directly cannot pass these tests.
function fakeHass(
  entities: { entity_id: string; state: string; unit?: string }[],
  displayPrecision: Record<string, number> = {},
): RenderHass {
  const states: Record<string, { entity_id: string; state: string; attributes: object }> = {};
  for (const e of entities) {
    states[e.entity_id] = {
      entity_id: e.entity_id,
      state: e.state,
      attributes: e.unit ? { unit_of_measurement: e.unit } : {},
    };
  }
  const formatEntityState = (stateObj: { entity_id: string; state: string; attributes: any }) => {
    const raw = stateObj.state;
    if (raw === "unavailable") return "Unavailable";
    if (raw === "unknown") return "Unknown";
    const dp = displayPrecision[stateObj.entity_id];
    const num = Number(raw);
    const body = dp != null && Number.isFinite(num) ? num.toFixed(dp) : raw;
    const unit: string | undefined = stateObj.attributes.unit_of_measurement;
    if (!unit) return body;
    return unit === "%" || unit === "°" ? `${body}${unit}` : `${body} ${unit}`;
  };
  return { states, formatEntityState } as unknown as RenderHass;
}

// Real sensors: raw two-decimal states, both configured to display one.
const TEMP = "sensor.living_area_sensor_temperature";
const HUMIDITY = "sensor.living_area_sensor_humidity";
const livingArea = () =>
  fakeHass(
    [
      { entity_id: TEMP, state: "17.94", unit: "°C" },
      { entity_id: HUMIDITY, state: "49.31", unit: "%" },
    ],
    { [TEMP]: 1, [HUMIDITY]: 1 },
  );

describe("entityStateText", () => {
  it("renders a sensor at the precision HA is configured to display", () => {
    expect(entityStateText(livingArea(), TEMP)).toBe("17.9 °C");
  });

  it("lets HA decide the spacing between value and unit", () => {
    expect(entityStateText(livingArea(), HUMIDITY)).toBe("49.3%");
  });

  it("renders an unavailable entity the way HA does, with no unit appended", () => {
    const hass = fakeHass([{ entity_id: TEMP, state: "unavailable", unit: "°C" }], { [TEMP]: 1 });
    expect(entityStateText(hass, TEMP)).toBe("Unavailable");
  });

  it("leaves a state HA has no precision for untouched", () => {
    const hass = fakeHass([{ entity_id: "sensor.raw", state: "17.94", unit: "°C" }]);
    expect(entityStateText(hass, "sensor.raw")).toBe("17.94 °C");
  });

  it("shows an em dash when the entity is absent, unset, or hass has not arrived", () => {
    expect(entityStateText(livingArea(), "sensor.missing")).toBe("—");
    expect(entityStateText(livingArea(), undefined)).toBe("—");
    expect(entityStateText(undefined, TEMP)).toBe("—");
  });
});

describe("itemStateText", () => {
  it("renders the primary entity alone when no secondary is paired", () => {
    expect(itemStateText(livingArea(), { entity: TEMP })).toBe("17.9 °C");
  });

  it("pairs a temperature entity with its humidity entity", () => {
    expect(itemStateText(livingArea(), { entity: TEMP, secondaryEntity: HUMIDITY })).toBe(
      "17.9 °C · 49.3%",
    );
  });

  it("still renders the primary when the secondary entity is missing", () => {
    expect(itemStateText(livingArea(), { entity: TEMP, secondaryEntity: "sensor.gone" })).toBe(
      "17.9 °C · —",
    );
  });
});

describe("itemBadgeLabel (issues #61, #59)", () => {
  const named = () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).friendly_name = "Living Temp";
    return h;
  };

  it("keeps the historic default: sensors show state, nothing else shows", () => {
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "sensor" })).toBe("17.9 °C");
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "light" })).toBe("");
  });

  it("showName renders the friendly name; a config name override wins", () => {
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "light", showName: true })).toBe(
      "Living Temp",
    );
    expect(
      itemBadgeLabel(named(), { entity: TEMP, kind: "light", showName: true, name: "Lamp" }),
    ).toBe("Lamp");
  });

  it("falls back to the entity id when there is no friendly name", () => {
    expect(itemBadgeLabel(livingArea(), { entity: TEMP, kind: "light", showName: true })).toBe(
      TEMP,
    );
  });

  it("name and state combine as one line", () => {
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "sensor", showName: true })).toBe(
      "Living Temp · 17.9 °C",
    );
    expect(
      itemBadgeLabel(named(), { entity: TEMP, kind: "light", showName: true, showState: true }),
    ).toBe("Living Temp · 17.9 °C");
  });

  it("showState: false silences even a sensor; name alone still shows", () => {
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "sensor", showState: false })).toBe("");
    expect(
      itemBadgeLabel(named(), { entity: TEMP, kind: "sensor", showState: false, showName: true }),
    ).toBe("Living Temp");
  });

  it("no entity, no state line (issue #39) — only a configured name can label it", () => {
    expect(itemBadgeLabel(named(), { entity: "", kind: "sensor" })).toBe("");
    expect(itemBadgeLabel(named(), { entity: "", kind: "sensor", showName: true })).toBe("");
    expect(
      itemBadgeLabel(named(), { entity: "", kind: "sensor", showName: true, name: "Detector" }),
    ).toBe("Detector");
  });
});

// Issue #135: the editing canvas showed an id where the card shows a state, so
// turning "Show state" on changed nothing you could see without leaving it.
describe("editorItemLabel (#135)", () => {
  const named = () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).friendly_name = "Living Temp";
    return h;
  };

  it("draws the card's own line whenever the card draws one", () => {
    const sensor = { entity: TEMP, kind: "sensor" as const };
    expect(editorItemLabel(named(), sensor)).toEqual({ text: "17.9 °C", live: true });
    // …and matches the card exactly, rather than approximating it.
    expect(editorItemLabel(named(), sensor).text).toBe(itemBadgeLabel(named(), sensor));

    const withName = { entity: TEMP, kind: "light" as const, showName: true, showState: true };
    expect(editorItemLabel(named(), withName)).toEqual({
      text: itemBadgeLabel(named(), withName),
      live: true,
    });
  });

  it("falls back to an editor-only name when the card would draw nothing", () => {
    // A light shows no label by default. Without this the canvas would be a
    // field of identical circles with nothing to drag-and-tell-apart.
    const light = { entity: "light.kitchen", kind: "light" as const };
    expect(itemBadgeLabel(named(), light)).toBe("");
    expect(editorItemLabel(named(), light)).toEqual({ text: "light.kitchen", live: false });
    // A configured name wins over the entity id, as it always did.
    expect(editorItemLabel(named(), { ...light, name: "Ceiling" })).toEqual({
      text: "Ceiling",
      live: false,
    });
    // Nothing bound at all: the kind is the last resort (issue #39).
    expect(editorItemLabel(named(), { entity: "", kind: "generic" as const })).toEqual({
      text: "generic",
      live: false,
    });
  });

  it("`live` is what separates a preview from editor chrome", () => {
    // The flag drives the dim styling, so it must never be true for a label
    // the card will not render — that is the whole signal.
    const off = editorItemLabel(named(), { entity: TEMP, kind: "light" as const });
    expect(off.live).toBe(false);
    const on = editorItemLabel(named(), {
      entity: TEMP,
      kind: "light" as const,
      showState: true,
    });
    expect(on.live).toBe(true);
  });

  it("survives having no hass at all, as the editor does outside HA", () => {
    expect(editorItemLabel(undefined, { entity: "light.k", kind: "light" as const })).toEqual({
      text: "light.k",
      live: false,
    });
  });
});

describe("overlay scaling", () => {
  it("normalizes the mode, defaulting anything unrecognized to fixed", () => {
    expect(normalizeOverlayScale("plan")).toBe("plan");
    expect(normalizeOverlayScale(undefined)).toBe("fixed");
    expect(normalizeOverlayScale("fixed")).toBe("fixed");
    expect(normalizeOverlayScale("PLAN")).toBe("fixed");
    expect(normalizeOverlayScale(1)).toBe("fixed");
  });

  it("emits screen pixels under fixed and canvas units under plan", () => {
    expect(overlayLength(14, "fixed")).toBe("14px");
    expect(overlayLength(14, "plan")).toBe("calc(14 * var(--fp-u, 1px))");
  });

  // Without the fallback an undefined --fp-u makes the whole declaration
  // invalid at computed-value time and the measure silently inherits.
  it("falls back to a sane length if --fp-u never resolves", () => {
    expect(overlayLength(14, "plan")).toContain("var(--fp-u, 1px)");
  });

  // Nothing else asserts that `scale` is actually threaded through a render
  // path: dropping the argument at one of the badge/item call sites would
  // otherwise still pass. renderRipple is exported, so it anchors the wiring.
  it("threads the mode through a real render path, not just the helper", () => {
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 3, "plan"))).toContain(
      "width:calc(80 * var(--fp-u, 1px))"
    );
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 3, "fixed"))).toContain("width:80px");
  });

  it("clamps the area name size to the same range item labels use", () => {
    expect(areaLabelSize(undefined)).toBe(14);
    expect(areaLabelSize(20)).toBe(20);
    expect(areaLabelSize(2)).toBe(8);
    expect(areaLabelSize(999)).toBe(40);
  });

  // Review on #148: an inline font-size beats any non-!important card-mod rule,
  // and card-mod was the only way to resize a room name before this option
  // existed. An untouched card must keep leaving the size to the stylesheet.
  describe("areaLabelFontSize — leaves card-mod's hook alone when it can", () => {
    it("emits nothing for a default area under the default mode", () => {
      expect(areaLabelFontSize(undefined, "fixed")).toBe("");
    });

    it("emits the size once the area asks for one", () => {
      expect(areaLabelFontSize(20, "fixed")).toBe("font-size:20px;");
    });

    it("always emits under plan, where the stylesheet's px would be wrong", () => {
      expect(areaLabelFontSize(undefined, "plan")).toBe(
        "font-size:calc(14 * var(--fp-u, 1px));"
      );
      expect(areaLabelFontSize(20, "plan")).toBe("font-size:calc(20 * var(--fp-u, 1px));");
    });

    it("clamps and neutralizes a hand-edited size on the way to the sink", () => {
      expect(areaLabelFontSize(999, "fixed")).toBe("font-size:40px;");
      expect(areaLabelFontSize("14;}body{display:none", "fixed")).toBe("font-size:14px;");
    });
  });

  // Same style-sink guard as itemLabelSize: these land in an inline style, so a
  // hand-edited config must not be able to close the declaration.
  it("neutralizes style-injection payloads before they reach the style sink", () => {
    expect(areaLabelSize("20px;color:red")).toBe(14);
    expect(overlayLength(areaLabelSize("14;}body{display:none"), "plan")).toBe(
      "calc(14 * var(--fp-u, 1px))"
    );
  });
});

describe("wallThickness — clamped to the skin-safe range at the sink", () => {
  it("defaults to WALL_THICKNESS when unset", () => {
    expect(wallThickness(undefined)).toBe(8);
  });

  it("passes a value inside the range through unchanged", () => {
    expect(wallThickness(5)).toBe(5);
  });

  it("floors at 2", () => {
    expect(wallThickness(0)).toBe(2);
    expect(wallThickness(-5)).toBe(2);
  });

  it("caps at MAX_SKIN_WALL_WIDTH — past this the doorway mask stops fully clearing the wall", () => {
    expect(wallThickness(30)).toBe(MAX_SKIN_WALL_WIDTH);
    expect(wallThickness(24)).toBe(MAX_SKIN_WALL_WIDTH);
  });

  it("neutralizes a style-injection payload before it reaches the style sink", () => {
    expect(wallThickness("5px;color:red")).toBe(8);
  });
});

describe("wallStrokeStyle — leaves the skin's stroke-width alone when it can", () => {
  it("emits nothing for an untouched wall, so the skin's --fp-skin-wall-width wins", () => {
    expect(wallStrokeStyle(undefined)).toBe("");
  });

  it("emits a clamped stroke-width once the wall asks for one", () => {
    expect(wallStrokeStyle(5)).toBe("stroke-width:5;");
    expect(wallStrokeStyle(30)).toBe(`stroke-width:${MAX_SKIN_WALL_WIDTH};`);
  });
});

describe("itemLabelSize (review on #62: clamp at the style sink)", () => {
  it("clamps to the editor's 8–40 range and defaults when unset", () => {
    expect(itemLabelSize(undefined)).toBe(12);
    expect(itemLabelSize(20)).toBe(20);
    expect(itemLabelSize(4)).toBe(8);
    expect(itemLabelSize(999)).toBe(40);
  });

  it("coerces numeric strings and neutralizes style-injection payloads", () => {
    expect(itemLabelSize("20")).toBe(20);
    // A config string must never pass through to the style attribute.
    expect(itemLabelSize("20px;color:red")).toBe(12);
    expect(itemLabelSize("9;position:fixed;inset:0;background:red")).toBe(12);
    expect(itemLabelSize(Number.NaN)).toBe(12);
    expect(itemLabelSize(null)).toBe(12);
  });
});

describe("hassRenderInputsChanged", () => {
  const watched = [TEMP];
  const tempState = { entity_id: TEMP, state: "17.94" };
  // HA starts with a placeholder that echoes the raw state, then swaps in the real one.
  const rawFormatter = (s: { state: string }) => s.state;
  const preciseFormatter = () => "17.9 °C";
  const base = () =>
    ({ states: { [TEMP]: tempState }, formatEntityState: preciseFormatter }) as any;

  it("ignores a tick where nothing this plan draws has moved", () => {
    const next = { ...base(), states: { [TEMP]: tempState, "light.elsewhere": { state: "on" } } };
    expect(hassRenderInputsChanged(base(), next, watched)).toBe(false);
  });

  it("notices a watched entity's new state object", () => {
    const next = { ...base(), states: { [TEMP]: { entity_id: TEMP, state: "18.02" } } };
    expect(hassRenderInputsChanged(base(), next, watched)).toBe(true);
  });

  it("notices HA swapping its startup formatter for the real one", () => {
    // Until this lands the card shows raw states, and no state object moves with it.
    const prev = { ...base(), formatEntityState: rawFormatter };
    expect(hassRenderInputsChanged(prev, base(), watched)).toBe(true);
  });

  it("notices HA rebuilding the formatter after a precision or locale edit", () => {
    // HA rebuilds it asynchronously as a new function, so its identity — not
    // `entities` or `locale` — is what signals that a reading's text changed.
    const next = { ...base(), formatEntityState: () => "17.94 °C" };
    expect(hassRenderInputsChanged(base(), next, watched)).toBe(true);
  });

  it("ignores entities the plan does not watch", () => {
    const next = { ...base(), states: { [TEMP]: tempState, [HUMIDITY]: { state: "50.0" } } };
    expect(hassRenderInputsChanged(base(), next, watched)).toBe(false);
  });
});

describe("isEntityOn / resolveItemIcon", () => {
  it("treats on/open/home/playing as on", () => {
    for (const s of ["on", "open", "home", "playing"]) expect(isEntityOn(s)).toBe(true);
    for (const s of ["off", "closed", "idle", undefined]) expect(isEntityOn(s)).toBe(false);
  });

  it("resolves icon precedence: override → entity icon → device_class → kind default", () => {
    const item = { entity: "binary_sensor.a", kind: "sensor" as const };
    expect(resolveItemIcon({ ...item, icon: "mdi:override" }, undefined)).toBe("mdi:override");
    expect(
      resolveItemIcon(item, { state: "on", attributes: { icon: "mdi:from-entity" } })
    ).toBe("mdi:from-entity");
    expect(
      resolveItemIcon(item, { state: "on", attributes: { device_class: "door" } })
    ).toBe(entityDefaultIcon("binary_sensor.a", "door", true));
    expect(resolveItemIcon(item, undefined)).toBe(defaultIcon("sensor"));
  });

  it("honours the entity-registry icon: config override → registry → entity attr", () => {
    const item = { entity: "binary_sensor.a", kind: "sensor" as const };
    // Registry icon wins when there's no config override.
    expect(resolveItemIcon(item, { state: "on", attributes: {} }, "mdi:from-registry")).toBe(
      "mdi:from-registry"
    );
    // A config icon still beats the registry.
    expect(
      resolveItemIcon({ ...item, icon: "mdi:config" }, undefined, "mdi:from-registry")
    ).toBe("mdi:config");
    // The registry beats the entity's own attribute icon.
    expect(
      resolveItemIcon(item, { state: "on", attributes: { icon: "mdi:from-entity" } }, "mdi:from-registry")
    ).toBe("mdi:from-registry");
    // Absent registry icon: unchanged behaviour.
    expect(
      resolveItemIcon(item, { state: "on", attributes: { icon: "mdi:from-entity" } }, undefined)
    ).toBe("mdi:from-entity");
  });

  // Issue #106: "you can not only change the color, but also the icon
  // depending on the state" — blinds open vs. blinds closed.
  describe("icon from a state rule (#106)", () => {
    const blind = {
      entity: "cover.blind",
      kind: "cover" as const,
      stateColor: [
        { state: "open", color: "#4caf50", icon: "mdi:blinds-open" },
        { state: "closed", color: "#9e9e9e", icon: "mdi:blinds" },
      ],
    };
    const st = (state: string) => ({ state, attributes: {} });

    it("swaps the glyph with the state", () => {
      expect(resolveItemIcon(blind, st("open"))).toBe("mdi:blinds-open");
      expect(resolveItemIcon(blind, st("closed"))).toBe("mdi:blinds");
    });

    it("beats a config icon — which used to freeze the glyph outright", () => {
      const pinned = { ...blind, icon: "mdi:pinned" };
      expect(resolveItemIcon(pinned, st("open"))).toBe("mdi:blinds-open");
      // No rule matches: the config icon is still in charge.
      expect(resolveItemIcon(pinned, st("opening"))).toBe("mdi:pinned");
    });

    it("a rule with no icon changes nothing (colour-only rules are unaffected)", () => {
      const colourOnly = { ...blind, stateColor: [{ state: "open", color: "#4caf50" }] };
      expect(resolveItemIcon(colourOnly, st("open"))).toBe(
        entityDefaultIcon("cover.blind", undefined, true) ?? defaultIcon("cover")
      );
      expect(resolveItemIcon({ ...colourOnly, icon: "mdi:pinned" }, st("open"))).toBe("mdi:pinned");
    });

    it("judges the rule on the same reading the colour uses (an attribute when set)", () => {
      const climate = {
        entity: "climate.hall",
        kind: "climate" as const,
        attribute: "hvac_action",
        stateColor: [{ state: "heating", color: "red", icon: "mdi:fire" }],
      };
      expect(resolveItemIcon(climate, { state: "heat", attributes: { hvac_action: "heating" } })).toBe(
        "mdi:fire"
      );
      expect(resolveItemIcon(climate, { state: "heat", attributes: { hvac_action: "idle" } })).toBe(
        defaultIcon("climate")
      );
    });

    it("drops an unusable icon rather than rendering an empty box", () => {
      const hostile = {
        ...blind,
        icon: "mdi:fallback",
        stateColor: [{ state: "open", color: "red", icon: '"><script>' }],
      };
      const icon = resolveItemIcon(hostile, st("open"));
      expect(icon).toBe("mdi:fallback");
      expect(icon).not.toContain("<");
    });

    it("a threshold rule can carry an icon too", () => {
      const battery = {
        entity: "sensor.battery",
        kind: "sensor" as const,
        stateColor: [
          { above: 80, color: "green", icon: "mdi:battery" },
          { color: "red", icon: "mdi:battery-alert" },
        ],
      };
      expect(resolveItemIcon(battery, st("95"))).toBe("mdi:battery");
      expect(resolveItemIcon(battery, st("12"))).toBe("mdi:battery-alert");
    });
  });
});

describe("collectWatchedEntities", () => {
  it("collects opening, item, secondary, and tracker entities across floors", () => {
    const cfg = {
      floors: [
        {
          id: "f1",
          name: "F1",
          walls: [],
          texts: [],
          furniture: [],
          openings: [{ id: "o1", type: "door", x: 0, y: 0, entity: "cover.door" }],
          items: [
            { id: "i1", kind: "light", x: 0, y: 0, entity: "light.a", secondaryEntity: "sensor.b" },
          ],
          trackers: [
            {
              id: "t1",
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              xSensor: { entity: "sensor.x", min: 0, max: 5, presence: { entity: "binary_sensor.p" } },
            },
          ],
        },
      ],
    } as unknown as FloorplanCardConfig;
    const got = collectWatchedEntities(cfg);
    for (const id of ["cover.door", "light.a", "sensor.b", "sensor.x", "binary_sensor.p"]) {
      expect(got.has(id)).toBe(true);
    }
  });

  it("skips unset entities and handles a legacy flat config", () => {
    const got = collectWatchedEntities({
      items: [{ id: "i", kind: "light", x: 0, y: 0, entity: "light.legacy" }],
    } as unknown as FloorplanCardConfig);
    expect(got.has("light.legacy")).toBe(true);
    expect(got.size).toBe(1);
  });

  // Issue #82: miss this and an entity-bound plant never repaints, because
  // nothing tells the card its sensor is worth re-rendering for.
  it("collects entity-bound furniture (issue #82)", () => {
    const got = collectWatchedEntities({
      furniture: [
        { id: "p", type: "plant", x: 0, y: 0, w: 40, h: 40, entity: "sensor.soil" },
        { id: "t", type: "table", x: 0, y: 0, w: 40, h: 40 },
      ],
    } as unknown as FloorplanCardConfig);
    expect(got.has("sensor.soil")).toBe(true);
    expect(got.size).toBe(1);
  });
});

describe("furnitureColor (issue #82)", () => {
  const plant = (extra: Record<string, unknown>) =>
    ({ id: "p", type: "plant", x: 0, y: 0, w: 40, h: 40, ...extra }) as Furniture;

  it("is undefined without an entity, so unbound furniture stays static", () => {
    expect(furnitureColor(plant({ stateColor: [{ color: "red" }] }), "42")).toBeUndefined();
    expect(furnitureColor(plant({ activeColor: "red" }), "on")).toBeUndefined();
  });

  it("resolves the matching threshold rule", () => {
    const f = plant({
      entity: "sensor.soil",
      stateColor: [
        { above: 80, color: "green" },
        { above: 65, color: "yellow" },
        { color: "red" },
      ],
    });
    expect(furnitureColor(f, "90")).toBe("green");
    expect(furnitureColor(f, "70")).toBe("yellow");
    expect(furnitureColor(f, "40")).toBe("red");
  });

  it("falls back to activeColor only while the entity is active", () => {
    const f = plant({ entity: "binary_sensor.cabinet", activeColor: "orange" });
    expect(furnitureColor(f, "on")).toBe("orange");
    expect(furnitureColor(f, "off")).toBeUndefined();
    expect(furnitureColor(f, "unavailable")).toBeUndefined();
  });

  it("prefers a matching rule over activeColor", () => {
    const f = plant({
      entity: "binary_sensor.cabinet",
      activeColor: "orange",
      stateColor: [{ state: "on", color: "purple" }],
    });
    expect(furnitureColor(f, "on")).toBe("purple");
  });

  // The color reaches a `stroke` attribute, so the allowlist (#64) has to run
  // on this path too — not only on the item label's.
  it("gates hostile colors through cssColor", () => {
    const f = plant({ entity: "sensor.soil", stateColor: [{ color: "red;fill:url(#x)" }] });
    expect(furnitureColor(f, "1")).toBeUndefined();
  });
});

describe("the sectional's L-shaped outline", () => {
  const w = 200;
  const h = 160;
  // Fractions the sectional symbol is drawn to: the chaise's share of the
  // width, and the main run's depth from the back.
  const CHAISE = 0.42;
  const SEAT = 0.55;

  /** The base polygon's corners, read back out of the rendered glyph. */
  function outline(hand?: "left" | "right"): Array<[number, number]> {
    const markup = flattenMarkup(
      renderFurniture({ id: "s", type: "sectional", x: 0, y: 0, w, h, hand })
    );
    const pts = markup.match(/<polygon[^>]*\spoints=([^\s>]+(?:\s[-\d.]+,[-\d.]+)*)/)?.[1];
    expect(pts, "the sectional draws a polygon base").toBeTruthy();
    return pts!
      .trim()
      .split(/\s+/)
      .map((p) => p.split(",").map(Number) as [number, number]);
  }

  function area(pts: Array<[number, number]>): number {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i]!;
      const [x2, y2] = pts[(i + 1) % pts.length]!;
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  it("is an L: six corners, not a rectangle", () => {
    expect(outline("right")).toHaveLength(6);
  });

  it("fills the bounding box minus the notch", () => {
    const expected = w * h - (w - w * CHAISE) * (h - h * SEAT);
    expect(area(outline("right"))).toBeCloseTo(expected, 6);
  });

  it("puts the chaise on the right when hand is right", () => {
    // the front edge (max y) should only be occupied on the right half
    const front = outline("right").filter(([, y]) => y === h / 2).map(([x]) => x);
    expect(Math.min(...front)).toBeGreaterThan(0);
    expect(Math.max(...front)).toBeCloseTo(w / 2, 6);
  });

  it("defaults to right-handed", () => {
    expect(outline()).toEqual(outline("right"));
  });

  it("stays inside its bounding box", () => {
    for (const [x, y] of outline("right")) {
      expect(Math.abs(x)).toBeLessThanOrEqual(w / 2 + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(h / 2 + 1e-9);
    }
  });

  // The two hands were always one polygon reflected, and still are — only now
  // the reflection is a transform on the group rather than a mapped point list,
  // so it applies to every part of the glyph and to any other symbol too.
  it("draws the left hand as the right one mirrored, not a second shape", () => {
    expect(outline("left")).toEqual(outline("right"));
    const left = flattenMarkup(
      renderFurniture({ id: "s", type: "sectional", x: 10, y: 20, w, h, hand: "left" })
    );
    const right = flattenMarkup(
      renderFurniture({ id: "s", type: "sectional", x: 10, y: 20, w, h, hand: "right" })
    );
    expect(left).toContain("rotate(0) scale(-1 1)");
    expect(right).not.toContain("scale(-1 1)");
    expect(left.replace(" scale(-1 1)", "")).toBe(right);
  });
});

describe("every furniture type renders and has a default size", () => {
  const types: FurnitureType[] = [
    "table", "roundTable", "desk", "chair", "sofa", "bed", "wardrobe", "rug",
    "plant", "fridge", "stove", "sink", "toilet", "stairs", "tv",
    "washer", "dryer", "dishwasher", "waterHeater", "airHandler", "bathtub",
    "vanity", "sectional", "fishTank", "piano", "hotTub",
  ];

  it("has a default size for each", () => {
    for (const t of types) {
      const s = symbolSize(t);
      expect(s, t).toBeTruthy();
      expect(s.w, t).toBeGreaterThan(0);
      expect(s.h, t).toBeGreaterThan(0);
    }
  });

  it("renders each without throwing", () => {
    for (const t of types) {
      const { w, h } = symbolSize(t);
      expect(() => renderFurniture({ id: t, type: t, x: 0, y: 0, w, h }), t).not.toThrow();
    }
  });

  // The fallback the old `switch`'s `default` case gave an unrecognised type,
  // now that a type can name a symbol this install simply doesn't have.
  it("draws an unknown type as a plain box rather than nothing", () => {
    const markup = flattenMarkup(
      renderFurniture({ id: "x", type: "no-such-symbol", x: 0, y: 0, w: 100, h: 60 })
    );
    expect(markup).toContain("<rect");
    expect(markup).toContain("fp-furniture-no-such-symbol");
  });

  it("renders a sectional of each hand", () => {
    for (const hand of ["left", "right"] as const) {
      expect(() =>
        renderFurniture({ id: "s", type: "sectional", x: 0, y: 0, w: 230, h: 180, hand }),
      ).not.toThrow();
    }
  });
});

describe("isEntityOn", () => {
  it("is on, open, home, or playing — nothing else", () => {
    for (const s of ["on", "open", "home", "playing"]) expect(isEntityOn(s), s).toBe(true);
    for (const s of ["off", "closed", "away", "paused", undefined]) expect(isEntityOn(s), s).toBe(false);
  });
});

describe("entityIsActive — domains that never say \"on\"", () => {
  it("a lock is active when it is not locked", () => {
    expect(entityIsActive("lock.front", "unlocked")).toBe(true);
    expect(entityIsActive("lock.front", "unlocking")).toBe(true);
    expect(entityIsActive("lock.front", "locked")).toBe(false);
  });

  it("a vacuum is active while it is working, not while it is docked", () => {
    expect(entityIsActive("vacuum.roomba", "cleaning")).toBe(true);
    expect(entityIsActive("vacuum.roomba", "returning")).toBe(true);
    for (const s of ["docked", "idle", "paused"]) {
      expect(entityIsActive("vacuum.roomba", s), s).toBe(false);
    }
  });

  it("a camera is active while recording or streaming", () => {
    expect(entityIsActive("camera.door", "recording")).toBe(true);
    expect(entityIsActive("camera.door", "idle")).toBe(false);
  });

  it("falls back to the generic on/off test for every other domain", () => {
    expect(entityIsActive("light.a", "on")).toBe(true);
    expect(entityIsActive("binary_sensor.a", "off")).toBe(false);
    expect(entityIsActive("device_tracker.a", "home")).toBe(true);
    expect(entityIsActive(undefined, "on")).toBe(true);
  });

  it("an outage is never active, whatever the domain says", () => {
    for (const e of ["lock.a", "vacuum.a", "light.a"]) {
      expect(entityIsActive(e, "unavailable"), e).toBe(false);
      expect(entityIsActive(e, "unknown"), e).toBe(false);
      expect(entityIsActive(e, undefined), e).toBe(false);
    }
  });

  // The bug: DOMAIN_STATE_ICONS gives lock/vacuum/camera an `on` icon that the
  // generic predicate (isEntityOn) could never reach, so they were frozen on
  // their off icon. This branch has no resolveItemIcon wrapper — floorplan-card's
  // _itemIcon calls entityDefaultIcon(entity, deviceClass, on) directly — so the
  // integration is exercised here instead of through a wrapper.
  it("an unlocked lock now reaches its open icon", () => {
    expect(entityDefaultIcon("lock.front", undefined, entityIsActive("lock.front", "unlocked"))).toBe(
      "mdi:lock-open-variant",
    );
    expect(entityDefaultIcon("lock.front", undefined, entityIsActive("lock.front", "locked"))).toBe(
      "mdi:lock",
    );
  });
});

describe("resolveIconAnimation (issue #48)", () => {
  it("auto: a running fan spins, playback and a cleaning vacuum pulse", () => {
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "on")).toBe("spin");
    expect(resolveIconAnimation({ entity: "media_player.tv" }, "playing")).toBe("pulse");
    expect(resolveIconAnimation({ entity: "vacuum.robo" }, "cleaning")).toBe("pulse");
  });

  it("auto: everything else stays still, even when active", () => {
    expect(resolveIconAnimation({ entity: "light.a" }, "on")).toBeUndefined();
    expect(resolveIconAnimation({ entity: "switch.a" }, "on")).toBeUndefined();
  });

  it("never animates an inactive entity — including forced spin/pulse", () => {
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "off")).toBeUndefined();
    expect(
      resolveIconAnimation({ entity: "light.a", iconAnimation: "spin" }, "off"),
    ).toBeUndefined();
    expect(
      resolveIconAnimation({ entity: "media_player.tv", iconAnimation: "pulse" }, "paused"),
    ).toBeUndefined();
  });

  it("fail-closed: unavailable/unknown/missing state never animates", () => {
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "unavailable")).toBeUndefined();
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "unknown")).toBeUndefined();
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, undefined)).toBeUndefined();
    expect(resolveIconAnimation({}, "on")).toBeUndefined();
  });

  it("explicit spin/pulse override the domain default while active", () => {
    expect(resolveIconAnimation({ entity: "light.a", iconAnimation: "spin" }, "on")).toBe("spin");
    expect(resolveIconAnimation({ entity: "fan.ceiling", iconAnimation: "pulse" }, "on")).toBe(
      "pulse",
    );
  });

  it("none disables the domain default", () => {
    expect(resolveIconAnimation({ entity: "fan.ceiling", iconAnimation: "none" }, "on")).toBeUndefined();
  });
});

describe("domainIconAnimation (issue #127)", () => {
  it("names what auto means, so the editor can offer it by name", () => {
    expect(domainIconAnimation("fan.ceiling")).toBe("spin");
    expect(domainIconAnimation("media_player.tv")).toBe("pulse");
    expect(domainIconAnimation("vacuum.robo")).toBe("pulse");
    expect(domainIconAnimation("light.a")).toBeUndefined();
    expect(domainIconAnimation(undefined)).toBeUndefined();
  });

  it("is the same table resolveIconAnimation applies, so the two cannot drift", () => {
    // Active fan, nothing configured → auto → spin, both ways round.
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "on")).toBe(
      domainIconAnimation("fan.ceiling"),
    );
  });
});

describe("isPresenceEntity (issue #127)", () => {
  it("accepts the binary-sensor classes that mean someone is there", () => {
    for (const dc of ["motion", "occupancy", "presence"]) {
      expect(isPresenceEntity("binary_sensor.hall", dc)).toBe(true);
    }
  });

  it("accepts trackers and people on their domain alone", () => {
    expect(isPresenceEntity("device_tracker.phone", undefined)).toBe(true);
    expect(isPresenceEntity("person.sam", undefined)).toBe(true);
  });

  it("rejects sensors that detect something else, and an unclassed one", () => {
    expect(isPresenceEntity("binary_sensor.front_door", "door")).toBe(false);
    expect(isPresenceEntity("binary_sensor.leak", "moisture")).toBe(false);
    // No class at all could be anything — guessing from the name would ring
    // doorbells and smoke alarms.
    expect(isPresenceEntity("binary_sensor.presence", undefined)).toBe(false);
  });

  it("rejects other domains, whatever class they carry", () => {
    expect(isPresenceEntity("light.a", "motion")).toBe(false);
    expect(isPresenceEntity("sensor.motion", "motion")).toBe(false);
    expect(isPresenceEntity(undefined, "motion")).toBe(false);
  });
});

describe("resolveItemIcon without an entity (issue #39)", () => {
  it("falls back to the kind default when no entity is bound", () => {
    expect(resolveItemIcon({ entity: "", kind: "sensor" }, undefined)).toBe(
      defaultIcon("sensor"),
    );
    expect(resolveItemIcon({ kind: "light" }, undefined)).toBe(defaultIcon("light"));
  });

  it("still honors an explicit icon override", () => {
    expect(resolveItemIcon({ entity: "", kind: "sensor", icon: "mdi:smoke-detector" }, undefined)).toBe(
      "mdi:smoke-detector",
    );
  });
});

describe("itemIconSize (issue #39: off-center glyphs at small sizes)", () => {
  it("keeps the familiar 22px icon for the 34px default badge", () => {
    expect(itemIconSize(34)).toBe(22);
  });

  it("matches the badge's parity so centering slack is a whole pixel per side", () => {
    for (const badge of [16, 18, 20, 24, 28, 34, 48]) {
      expect((badge - itemIconSize(badge)) % 2, `badge ${badge}`).toBe(0);
    }
    // 18px badge: naive round(18 * 0.62) = 11 leaves a half-pixel; we want 12.
    expect(itemIconSize(18)).toBe(12);
  });

  it("never collapses below 2px", () => {
    expect(itemIconSize(1)).toBeGreaterThanOrEqual(2);
  });
});

describe("plan rotation (issue #33)", () => {
  const W = 1000;
  const H = 600;

  it("normalizes to the four supported steps, defaulting everything else to 0", () => {
    expect(normalizePlanRotation(undefined)).toBe(0);
    expect(normalizePlanRotation(90)).toBe(90);
    expect(normalizePlanRotation(450)).toBe(90);
    expect(normalizePlanRotation(-90)).toBe(270);
    expect(normalizePlanRotation(360)).toBe(0);
    expect(normalizePlanRotation(45)).toBe(0);
    expect(normalizePlanRotation("90" as unknown)).toBe(0);
    expect(normalizePlanRotation(Number.NaN)).toBe(0);
  });

  it("swaps the displayed canvas size for quarter turns only", () => {
    expect(rotatedCanvasSize(W, H, 0)).toEqual({ w: W, h: H });
    expect(rotatedCanvasSize(W, H, 90)).toEqual({ w: H, h: W });
    expect(rotatedCanvasSize(W, H, 180)).toEqual({ w: W, h: H });
    expect(rotatedCanvasSize(W, H, 270)).toEqual({ w: H, h: W });
  });

  it("maps corners of the plan onto corners of the rotated frame", () => {
    // Top-left of the plan…
    expect(rotatePlanPoint(0, 0, W, H, 0)).toEqual({ x: 0, y: 0 });
    expect(rotatePlanPoint(0, 0, W, H, 90)).toEqual({ x: H, y: 0 }); // …top-right
    expect(rotatePlanPoint(0, 0, W, H, 180)).toEqual({ x: W, y: H }); // …bottom-right
    expect(rotatePlanPoint(0, 0, W, H, 270)).toEqual({ x: 0, y: W }); // …bottom-left
    // An interior point keeps its distances to the edges it rotates onto.
    expect(rotatePlanPoint(100, 50, W, H, 90)).toEqual({ x: H - 50, y: 100 });
    expect(rotatePlanPoint(100, 50, W, H, 270)).toEqual({ x: 50, y: W - 100 });
  });

  it("rotating four quarter turns is the identity", () => {
    let p = { x: 123, y: 456 };
    let w = W;
    let h = H;
    for (let i = 0; i < 4; i++) {
      p = rotatePlanPoint(p.x, p.y, w, h, 90);
      [w, h] = [h, w];
    }
    expect(p).toEqual({ x: 123, y: 456 });
  });

  it("group transform matches the point mapping", () => {
    // Apply the SVG transform math manually and compare with rotatePlanPoint.
    const apply = (t: string, x: number, y: number) => {
      const m = t.match(/translate\((-?\d+) (-?\d+)\) rotate\((-?\d+)\)/);
      if (!m) return { x, y };
      const [tx, ty, deg] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const rad = (deg * Math.PI) / 180;
      return {
        x: Math.round(tx + x * Math.cos(rad) - y * Math.sin(rad)) + 0,
        y: Math.round(ty + x * Math.sin(rad) + y * Math.cos(rad)) + 0,
      };
    };
    for (const rot of [90, 180, 270] as const) {
      const t = planRotationTransform(W, H, rot);
      for (const [x, y] of [
        [0, 0],
        [W, H],
        [123, 456],
      ]) {
        expect(apply(t, x, y), `rot ${rot} point ${x},${y}`).toEqual(
          rotatePlanPoint(x, y, W, H, rot),
        );
      }
    }
    expect(planRotationTransform(W, H, 0)).toBe("");
  });
});

describe("fishTank glyph scales with its size (issue #72 review)", () => {
  /** Flatten a Lit template (and nested ones) back to markup. */
  const bubbleRadius = (w: number, h: number) => {
    const markup = flattenMarkup(renderFurniture({ id: "f", type: "fishTank", x: 0, y: 0, w, h }));
    return Number(markup.match(/<circle[^>]*\sr=([\d.]+)/)?.[1]);
  };

  it("the bubble scales with the tank instead of a fixed radius", () => {
    const small = bubbleRadius(50, 20);
    const large = bubbleRadius(200, 80);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
  });

  // Issue #82: the entity-driven color replaces the configured one across the
  // whole drawing — base shape and detail strokes alike, not just the outline.
  describe("renderFurniture color override", () => {
    const markupOf = (override?: string) =>
      flattenMarkup(
        renderFurniture(
          { id: "f", type: "plant", x: 0, y: 0, w: 40, h: 40, color: "#111111" },
          override,
        ),
      );

    it("uses the configured color when no override is passed", () => {
      const markup = markupOf();
      expect(markup).toContain("#111111");
      expect(markup).not.toContain("#ff0000");
    });

    it("the override replaces every occurrence of the configured color", () => {
      const markup = markupOf("#ff0000");
      expect(markup).toContain("#ff0000");
      expect(markup).not.toContain("#111111");
    });
  });
});

describe("itemStateText with attributes (issue #70)", () => {
  const climate = () => {
    const h = livingArea();
    (h.states as Record<string, unknown>)["climate.home"] = {
      entity_id: "climate.home",
      state: "heat",
      attributes: { current_temperature: 21.5, current_humidity: 45 },
    };
    return h;
  };

  it("attribute replaces the state as the primary reading", () => {
    expect(itemStateText(climate(), { entity: "climate.home", attribute: "current_temperature" }))
      .toBe("21.5");
  });

  it("secondaryAttribute without a second entity reads the same entity", () => {
    expect(
      itemStateText(climate(), {
        entity: "climate.home",
        attribute: "current_temperature",
        secondaryAttribute: "current_humidity",
      }),
    ).toBe("21.5 · 45");
  });

  it("secondaryAttribute applies to secondaryEntity when both are set", () => {
    expect(
      itemStateText(climate(), {
        entity: "climate.home",
        secondaryEntity: TEMP,
        secondaryAttribute: "unit_of_measurement",
      }),
    ).toBe("heat · °C");
  });

  it("uses HA's attribute formatter when the frontend provides it", () => {
    const h = climate() as unknown as Record<string, unknown>;
    h.formatEntityAttributeValue = (_s: unknown, a: string) => `fmt:${a}`;
    expect(
      itemStateText(h as never, { entity: "climate.home", attribute: "current_temperature" }),
    ).toBe("fmt:current_temperature");
  });

  it("missing attribute renders the em dash", () => {
    expect(itemStateText(climate(), { entity: "climate.home", attribute: "nope" })).toBe("—");
  });
});

describe("resolveStateColor (issue #68)", () => {
  const rules = [
    { above: 26, color: "red" },
    { above: 24, color: "orange" },
    { color: "white" },
  ];

  it("highest matching threshold wins", () => {
    expect(resolveStateColor(rules, "27.1")).toBe("red");
    expect(resolveStateColor(rules, 25)).toBe("orange");
    expect(resolveStateColor(rules, "20")).toBe("white");
  });

  it("boundary is strict: exactly the threshold falls through", () => {
    expect(resolveStateColor(rules, 26)).toBe("orange");
    expect(resolveStateColor(rules, 24)).toBe("white");
  });

  it("non-numeric values only match the default rule", () => {
    expect(resolveStateColor(rules, "heat")).toBe("white");
    expect(resolveStateColor(rules, undefined)).toBe("white");
    expect(resolveStateColor([{ above: 24, color: "orange" }], "heat")).toBeUndefined();
  });

  it("rule order doesn't matter; malformed rules are skipped", () => {
    expect(resolveStateColor([...rules].reverse(), 30)).toBe("red");
    expect(
      resolveStateColor([null, { above: "x" }, { above: 24, color: "orange" }] as never, 25),
    ).toBe("orange");
  });

  it("no rules, no color", () => {
    expect(resolveStateColor(undefined, 30)).toBeUndefined();
    expect(resolveStateColor([], 30)).toBeUndefined();
  });

  // Exact-state rules (issue #79): the same mechanism for entities whose
  // value is a word rather than a number.
  describe("state rules (issue #79)", () => {
    const cover = [
      { state: "open", color: "red" },
      { state: "closed", color: "green" },
      { color: "gray" },
    ];

    it("matches an exact state, case- and space-insensitively", () => {
      expect(resolveStateColor(cover, "open")).toBe("red");
      expect(resolveStateColor(cover, "OPEN")).toBe("red");
      expect(resolveStateColor(cover, " closed ")).toBe("green");
    });

    it("an unmatched state falls to the default rule", () => {
      expect(resolveStateColor(cover, "opening")).toBe("gray");
      expect(resolveStateColor(cover, undefined)).toBe("gray");
      expect(resolveStateColor([{ state: "open", color: "red" }], "closed")).toBeUndefined();
    });

    it("an exact state beats a matching threshold", () => {
      const mixed = [
        { above: 10, color: "orange" },
        { state: "50", color: "blue" },
      ];
      expect(resolveStateColor(mixed, "50")).toBe("blue");
      expect(resolveStateColor(mixed, "60")).toBe("orange");
    });

    it("the first listed state rule wins a duplicate", () => {
      expect(
        resolveStateColor(
          [
            { state: "on", color: "first" },
            { state: "on", color: "second" },
          ],
          "on",
        ),
      ).toBe("first");
    });

    // A half-filled row in the editor ("state is", nothing typed yet) has no
    // condition, so it behaves as the default rule rather than matching every
    // reading or none of them.
    it("a blank state is no condition at all", () => {
      const rules = [{ state: "", color: "red" }];
      expect(resolveStateColor(rules, "anything")).toBe("red");
      expect(resolveStateColor(rules, "")).toBe("red");
    });
  });

  // The colour and the icon (#106) must come off the *same* matched rule, so
  // the matcher returns the rule and resolveStateColor is a wrapper over it.
  describe("matchStateRule (#106)", () => {
    it("returns the very rule object that supplied the colour", () => {
      const hot = { above: 26, color: "red", icon: "mdi:fire" };
      const rs = [hot, { above: 24, color: "orange" }, { color: "white" }];
      expect(matchStateRule(rs, 30)).toBe(hot);
      expect(matchStateRule(rs, 30)?.icon).toBe("mdi:fire");
      // …and the wrapper still answers exactly as it did.
      expect(resolveStateColor(rs, 30)).toBe(hot.color);
    });

    it("agrees with resolveStateColor across the whole precedence table", () => {
      const rs = [
        { above: 26, color: "red" },
        { above: 24, color: "orange" },
        { state: "heat", color: "blue" },
        { color: "white" },
      ];
      for (const v of [30, 25, 20, "heat", "HEAT", "", null, undefined, true, "nonsense"]) {
        expect(matchStateRule(rs, v)?.color).toBe(resolveStateColor(rs, v));
      }
    });

    it("no rules, no match", () => {
      expect(matchStateRule(undefined, 1)).toBeUndefined();
      expect(matchStateRule([], 1)).toBeUndefined();
    });
  });
});

describe("pressEffectOf (#134)", () => {
  it("defaults to the scale dip when nothing is configured", () => {
    expect(pressEffectOf({})).toBe(DEFAULT_PRESS_EFFECT);
    expect(pressEffectOf({})).toBe("scale");
  });

  it("passes every effect the card has a rule for", () => {
    for (const e of ["scale", "ripple", "flash", "none"] as const) {
      expect(pressEffectOf({ pressEffect: e })).toBe(e);
    }
  });

  it("falls back to the default rather than to nothing on a junk value", () => {
    // The value becomes a class name. Left unchecked, a typo would emit
    // `press-typo`, match no rule, and look exactly like "feature missing".
    expect(pressEffectOf({ pressEffect: "dip" as never })).toBe("scale");
    expect(pressEffectOf({ pressEffect: "" as never })).toBe("scale");
    expect(pressEffectOf({ pressEffect: 42 as never })).toBe("scale");
    // …but an explicit "none" is a real choice and must survive.
    expect(pressEffectOf({ pressEffect: "none" })).toBe("none");
  });
});

describe("badgeContentOf (#106)", () => {
  it("defaults to the icon", () => {
    expect(badgeContentOf({})).toBe("icon");
    expect(badgeContentOf({ showIcon: true })).toBe("icon");
  });

  it("honours a legacy showIcon: false as 'no badge'", () => {
    expect(badgeContentOf({ showIcon: false })).toBe("none");
  });

  it("an explicit badgeContent wins over the boolean it replaced", () => {
    expect(badgeContentOf({ badgeContent: "value", showIcon: false })).toBe("value");
    expect(badgeContentOf({ badgeContent: "icon", showIcon: false })).toBe("icon");
    expect(badgeContentOf({ badgeContent: "none", showIcon: true })).toBe("none");
  });

  it("ignores a junk value rather than blanking the badge", () => {
    expect(badgeContentOf({ badgeContent: "bogus" as never })).toBe("icon");
    expect(badgeContentOf({ badgeContent: "bogus" as never, showIcon: false })).toBe("none");
  });
});

describe("badgeValue (#106)", () => {
  const hass = (states: Record<string, { state: string; attributes?: object }>) =>
    ({
      states: Object.fromEntries(
        Object.entries(states).map(([id, s]) => [id, { entity_id: id, attributes: {}, ...s }]),
      ),
    }) as unknown as RenderHass;

  it("shows a thermostat's temperature — its state is a mode, not a number", () => {
    const h = hass({
      "climate.hall": { state: "heat", attributes: { current_temperature: 21.4 } },
    });
    expect(badgeValue(h, { entity: "climate.hall" })).toBe("21°");
  });

  // The case from the issue: colour by hvac_action, still read the temperature.
  it("falls through a non-numeric configured attribute to the domain reading", () => {
    const h = hass({
      "climate.hall": {
        state: "heat",
        attributes: { hvac_action: "heating", current_temperature: 21.4 },
      },
    });
    expect(badgeValue(h, { entity: "climate.hall", attribute: "hvac_action" })).toBe("21°");
  });

  it("uses a numeric configured attribute when there is one", () => {
    const h = hass({
      "climate.hall": { state: "heat", attributes: { temperature: 19, current_temperature: 21.4 } },
    });
    expect(badgeValue(h, { entity: "climate.hall", attribute: "temperature" })).toBe("19");
  });

  it("reads a sensor's own state, with a compact unit", () => {
    const h = hass({
      "sensor.co2": { state: "780", attributes: { unit_of_measurement: "ppm" } },
      "sensor.temp": { state: "17.94", attributes: { unit_of_measurement: "°C" } },
      "sensor.hum": { state: "45.2", attributes: { unit_of_measurement: "%" } },
      "sensor.lux": { state: "1200", attributes: { unit_of_measurement: "lx" } },
      "sensor.aqi": { state: "12", attributes: { unit_of_measurement: "µg/m³" } },
    });
    expect(badgeValue(h, { entity: "sensor.co2" })).toBe("780"); // ppm dropped
    expect(badgeValue(h, { entity: "sensor.temp" })).toBe("18°"); // °C collapses
    expect(badgeValue(h, { entity: "sensor.hum" })).toBe("45%");
    expect(badgeValue(h, { entity: "sensor.lux" })).toBe("1200lx");
    expect(badgeValue(h, { entity: "sensor.aqi" })).toBe("12"); // too long to fit
  });

  it("keeps one decimal only for small non-integers", () => {
    const h = hass({
      "sensor.power": { state: "1.24", attributes: { unit_of_measurement: "kW" } },
      "sensor.big": { state: "1234.6", attributes: { unit_of_measurement: "W" } },
      "sensor.whole": { state: "9", attributes: {} },
    });
    expect(badgeValue(h, { entity: "sensor.power" })).toBe("1.2kW");
    // Watts fold into kW rather than becoming a five-glyph reading.
    expect(badgeValue(h, { entity: "sensor.big" })).toBe("1.2kW");
    expect(badgeValue(h, { entity: "sensor.whole" })).toBe("9");
  });

  // A smart plug: the switch has no reading, its power sensor does.
  it("falls back to the secondary entity, which is what makes a plug work", () => {
    const h = hass({
      "switch.plug": { state: "on" },
      "sensor.plug_power": { state: "1240", attributes: { unit_of_measurement: "W" } },
    });
    expect(
      badgeValue(h, { entity: "switch.plug", secondaryEntity: "sensor.plug_power" }),
    ).toBe("1.2kW");
  });

  it("returns undefined when nothing numeric exists, so the badge keeps its icon", () => {
    const h = hass({
      "light.kitchen": { state: "on" },
      "cover.blind": { state: "closed" },
      "sensor.dead": { state: "unavailable", attributes: { unit_of_measurement: "°C" } },
      "sensor.blank": { state: "" },
    });
    expect(badgeValue(h, { entity: "light.kitchen" })).toBeUndefined();
    expect(badgeValue(h, { entity: "cover.blind" })).toBeUndefined();
    expect(badgeValue(h, { entity: "sensor.dead" })).toBeUndefined();
    expect(badgeValue(h, { entity: "sensor.blank" })).toBeUndefined();
    expect(badgeValue(h, { entity: "" })).toBeUndefined();
    expect(badgeValue(undefined, { entity: "sensor.temp" })).toBeUndefined();
  });

  it("does not borrow the state's unit for an unrelated attribute", () => {
    const h = hass({
      "sensor.temp": { state: "18", attributes: { unit_of_measurement: "°C", battery_level: 87 } },
    });
    expect(badgeValue(h, { entity: "sensor.temp", attribute: "battery_level" })).toBe("87");
  });

  it("a humidifier reads its current humidity", () => {
    const h = hass({ "humidifier.bed": { state: "on", attributes: { current_humidity: 44 } } });
    expect(badgeValue(h, { entity: "humidifier.bed" })).toBe("44%");
  });

  // Issue #136: the guess was usually right, but it was only a guess and
  // nothing said which entity it landed on.
  describe("choosing which entity the badge reads (#136)", () => {
    const plug = () =>
      hass({
        "switch.plug": { state: "on" },
        "sensor.plug_power": { state: "1240", attributes: { unit_of_measurement: "W" } },
      });
    const twoSensors = () =>
      hass({
        "sensor.a": { state: "21.4", attributes: { unit_of_measurement: "°C" } },
        "sensor.b": { state: "63", attributes: { unit_of_measurement: "%" } },
      });

    it("reports which entity the reading came from", () => {
      // The plug's switch says "on" — not a number — so the badge is showing
      // the power sensor. The form has to be able to say so.
      expect(badgeReading(plug(), { entity: "switch.plug", secondaryEntity: "sensor.plug_power" }))
        .toEqual({ text: "1.2kW", source: "secondary" });
      expect(badgeReading(twoSensors(), { entity: "sensor.a", secondaryEntity: "sensor.b" }))
        .toEqual({ text: "21°", source: "primary" });
    });

    it("badgeValue is exactly badgeReading's text, across the whole chain", () => {
      const cases = [
        { entity: "switch.plug", secondaryEntity: "sensor.plug_power" },
        { entity: "sensor.a", secondaryEntity: "sensor.b" },
        { entity: "sensor.a", secondaryEntity: "sensor.b", badgeEntity: "secondary" as const },
        { entity: "switch.plug", badgeEntity: "primary" as const },
        { entity: "nope.missing" },
      ];
      for (const item of cases) {
        const h = { ...plug().states, ...twoSensors().states };
        const both = { states: h } as unknown as RenderHass;
        expect(badgeValue(both, item)).toBe(badgeReading(both, item)?.text);
      }
    });

    it("an explicit secondary wins even when the primary has a number of its own", () => {
      // The case with no expression at all before this: the fallback never
      // reached the second sensor, because the first one answered.
      const h = twoSensors();
      expect(badgeValue(h, { entity: "sensor.a", secondaryEntity: "sensor.b" })).toBe("21°");
      expect(
        badgeValue(h, { entity: "sensor.a", secondaryEntity: "sensor.b", badgeEntity: "secondary" }),
      ).toBe("63%");
    });

    it("an explicit choice does not fall through to the other entity", () => {
      // Asked for the switch, which has no number: the badge shows its icon
      // rather than quietly showing a different device's reading.
      const h = plug();
      const item = { entity: "switch.plug", secondaryEntity: "sensor.plug_power" } as const;
      expect(badgeValue(h, { ...item, badgeEntity: "primary" })).toBeUndefined();
      // …and the reverse: an unreadable secondary does not borrow the primary.
      expect(
        badgeValue(hass({ "sensor.a": { state: "21" }, "switch.b": { state: "on" } }), {
          entity: "sensor.a",
          secondaryEntity: "switch.b",
          badgeEntity: "secondary",
        }),
      ).toBeUndefined();
    });

    it("an absent badgeEntity reproduces the old chain exactly", () => {
      // The back-compat guard: every config written before this key existed.
      const h = { ...plug().states, ...twoSensors().states };
      const both = { states: h } as unknown as RenderHass;
      expect(badgeValue(both, { entity: "switch.plug", secondaryEntity: "sensor.plug_power" }))
        .toBe("1.2kW");
      expect(badgeValue(both, { entity: "sensor.a", secondaryEntity: "sensor.b" })).toBe("21°");
      expect(badgeValue(both, { entity: "sensor.a" })).toBe("21°");
    });

    it("an explicit primary still gets its attribute and domain reading", () => {
      const h = hass({
        "climate.hall": {
          state: "heat",
          attributes: { hvac_action: "heating", current_temperature: 21.4 },
        },
        "sensor.hum": { state: "44", attributes: { unit_of_measurement: "%" } },
      });
      const item = { entity: "climate.hall", secondaryEntity: "sensor.hum" } as const;
      // Domain reading, not the mode.
      expect(badgeValue(h, { ...item, badgeEntity: "primary" })).toBe("21°");
      // A non-numeric configured attribute still falls through to it.
      expect(
        badgeValue(h, { ...item, attribute: "hvac_action", badgeEntity: "primary" }),
      ).toBe("21°");
    });

    it("secondaryAttribute still resolves against the primary when no second entity", () => {
      const h = hass({
        "climate.hall": { state: "heat", attributes: { current_humidity: 44 } },
      });
      expect(
        badgeValue(h, {
          entity: "climate.hall",
          secondaryAttribute: "current_humidity",
          badgeEntity: "secondary",
        }),
      ).toBe("44");
    });
  });
});

describe("badgeValueSize (#106)", () => {
  // Measured advance widths for the badge's 600-weight face, in units of
  // font-size. Sizing must keep the rendered text inside the circle for every
  // one of these — the bug this replaced sized by string length, which put
  // "1240W" 3.2px outside an 18px badge.
  const MEASURED: Record<string, number> = {
    "9°": 1.18,
    "21°": 1.66,
    "-12°": 2.17,
    "45%": 2.38,
    "100%": 2.91,
    "782": 1.95,
    "9999": 2.76,
    "1240W": 3.54,
    "1.2kW": 3.07,
    "12.5A": 2.88,
  };

  it("keeps the rendered text inside the badge at every realistic size", () => {
    for (const badge of [24, 30, 34, 48, 80]) {
      for (const [text, perPx] of Object.entries(MEASURED)) {
        const size = badgeValueSize(badge, text);
        const width = size * perPx;
        // Either it fits, or sizing hit the documented 6px legibility floor —
        // below which shrinking further would trade an overhang for a smudge.
        const ok = width <= badge - 3 || size === 6;
        expect({ badge, text, size, width: +width.toFixed(1), ok }).toEqual({
          badge, text, size, width: +width.toFixed(1), ok: true,
        });
      }
    }
  });

  it("sizes by glyph width, not string length", () => {
    // Same length, very different widths: all three must not get one size.
    const sizes = ["21°", "782", "45%"].map((t) => badgeValueSize(34, t));
    expect(new Set(sizes).size).toBeGreaterThan(1);
    // The narrowest reading gets the largest type.
    expect(badgeValueSize(34, "21°")).toBeGreaterThan(badgeValueSize(34, "45%"));
    expect(badgeValueSize(34, "45%")).toBeGreaterThan(badgeValueSize(34, "1240W"));
  });

  it("gives the default badge a legible 21° and a fitting 1240W", () => {
    expect(badgeValueSize(34, "21°")).toBe(14);
    expect(badgeValueSize(34, "1240W")).toBe(8);
  });

  it("caps short readings so 9° does not balloon, and floors long ones at 6px", () => {
    // 46% of 80 is 36.8 → 37, nudged down to 36 for the badge's even parity.
    expect(badgeValueSize(80, "9°")).toBe(36);
    // A 5-glyph reading in a tiny badge hits the legibility floor rather than
    // shrinking into a smudge; it wants a bigger badge instead.
    expect(badgeValueSize(18, "1240W")).toBe(6);
  });

  it("shares itemIconSize's parity nudge, and survives a junk size", () => {
    expect(badgeValueSize(34, "21°") % 2).toBe(0);
    expect(badgeValueSize(19, "9°") % 2).toBe(1);
    expect(badgeValueSize("40px;color:red" as never, "21°")).toBe(badgeValueSize(34, "21°"));
  });
});

describe("windowSash (issue #73)", () => {
  it("defaults to double; single only for swing windows", () => {
    expect(windowSash({ type: "window" } as Opening)).toBe("double");
    expect(windowSash({ type: "window", sash: "single" } as Opening)).toBe("single");
    expect(windowSash({ type: "door", sash: "single" } as Opening)).toBe("double");
    expect(windowSash({ type: "window", motion: "slide", sash: "single" } as Opening)).toBe(
      "double",
    );
  });
});

describe("shutterAmount / shutterActive (issue #74)", () => {
  const st = (state: string, pos?: number) =>
    ({ state, attributes: pos === undefined ? {} : { current_position: pos } });

  it("position wins, clamped to 0..1", () => {
    expect(shutterAmount(st("open", 50))).toBe(0.5);
    expect(shutterAmount(st("open", 120))).toBe(1);
    expect(shutterAmount(st("closed", 0))).toBe(0);
  });

  it("falls back to open-ish states without a position", () => {
    expect(shutterAmount(st("open"))).toBe(1);
    expect(shutterAmount(st("opening"))).toBe(1);
    expect(shutterAmount(st("closed"))).toBe(0);
  });

  it("fails closed on an outage or missing state", () => {
    expect(shutterAmount(undefined)).toBe(0);
    expect(shutterAmount(st("unavailable", 80))).toBe(0);
    expect(shutterActive(st("unknown"))).toBe(false);
  });

  it("active while (partly) open or in transit", () => {
    expect(shutterActive(st("open", 40))).toBe(true);
    expect(shutterActive(st("closing", 0))).toBe(true);
    expect(shutterActive(st("closed", 0))).toBe(false);
  });
});

describe("shutterAmount / shutterActive — inverted shutters (issue #74 follow-up)", () => {
  const st = (state: string, pos?: number) =>
    ({ state, attributes: pos === undefined ? {} : { current_position: pos } });

  it("inverts the position, not just the state", () => {
    expect(shutterAmount(st("open", 100), true)).toBe(0);
    expect(shutterAmount(st("closed", 0), true)).toBe(1);
    expect(shutterAmount(st("open", 30), true)).toBeCloseTo(0.7);
  });

  it("inverts the open-ish states of a plain contact", () => {
    // A reed contact on a hinged shutter reads `on` while the panels are shut.
    expect(shutterAmount(st("on"), true)).toBe(0);
    expect(shutterAmount(st("off"), true)).toBe(1);
    expect(shutterAmount(st("open"), true)).toBe(0);
    expect(shutterAmount(st("closed"), true)).toBe(1);
  });

  it("an outage still fails closed — invert must never flip it open", () => {
    // The whole point of checking the outage first: 1 - 0 would read as a
    // wide-open shutter drawn from a reading we do not have.
    expect(shutterAmount(st("unavailable"), true)).toBe(0);
    expect(shutterAmount(st("unknown"), true)).toBe(0);
    expect(shutterAmount(st("unavailable", 100), true)).toBe(0);
    expect(shutterAmount(undefined, true)).toBe(0);
    expect(shutterActive(st("unavailable"), true)).toBe(false);
    expect(shutterActive(st("unknown", 0), true)).toBe(false);
    expect(shutterActive(undefined, true)).toBe(false);
  });

  it("active follows the inverted reading", () => {
    expect(shutterActive(st("on"), true)).toBe(false); // inverted: shut
    expect(shutterActive(st("off"), true)).toBe(true); // inverted: open
    expect(shutterActive(st("open", 100), true)).toBe(false);
  });

  it("transit is active either way round", () => {
    // Something is moving out there whichever end the contact calls "open".
    for (const invert of [false, true]) {
      expect(shutterActive(st("opening", 0), invert)).toBe(true);
      expect(shutterActive(st("closing", 100), invert)).toBe(true);
    }
  });

  it("without the flag nothing changes (default is uninverted)", () => {
    expect(shutterAmount(st("open", 30))).toBeCloseTo(0.3);
    expect(shutterAmount(st("on"))).toBe(1);
    expect(shutterActive(st("closed", 0))).toBe(false);
  });
});

describe("openingActionForGesture (issue #74 follow-up)", () => {
  const o = (extra: Partial<Opening> = {}) =>
    ({ id: "o", type: "window", x: 0, y: 0, length: 90, angle: 0, ...extra }) as Opening;
  /** A cover that can open and close; everything else reports no features. */
  const toggleable = (id: string) => (id.startsWith("cover.") ? 3 : 0);
  const none = () => 0;

  it("tap opens more-info on the window itself", () => {
    expect(openingActionForGesture(o({ entity: "binary_sensor.win" }), "tap", none)).toEqual({
      entity: "binary_sensor.win",
      config: { action: "more-info" },
    });
  });

  it("tap toggles a cover that can open and close, and only that", () => {
    expect(openingActionForGesture(o({ entity: "cover.win" }), "tap", toggleable)).toEqual({
      entity: "cover.win",
      config: { action: "toggle" },
    });
    // Position-only cover: no open/close bits, so more-info rather than a
    // toggle the hardware could not honour.
    expect(openingActionForGesture(o({ entity: "cover.win" }), "tap", () => 4)?.config).toEqual({
      action: "more-info",
    });
  });

  it("a shutter-only opening is driven by its shutter as the primary", () => {
    const shutterOnly = o({ shutterEntity: "cover.tapparella" });
    expect(openingActionForGesture(shutterOnly, "tap", toggleable)).toEqual({
      entity: "cover.tapparella",
      config: { action: "toggle" },
    });
    // Nothing is left over to be a secondary, so hold has nothing to open.
    expect(openingActionForGesture(shutterOnly, "hold", toggleable)).toBeUndefined();
  });

  it("with both bound, the tap stays on the window and hold reaches the shutter", () => {
    const both = o({ entity: "binary_sensor.win", shutterEntity: "cover.tapparella" });
    // The shutter is real hardware that takes seconds to travel: a tap must
    // never be silently retargeted at it (the lesson of issue #47).
    expect(openingActionForGesture(both, "tap", toggleable)).toEqual({
      entity: "binary_sensor.win",
      config: { action: "more-info" },
    });
    expect(openingActionForGesture(both, "hold", toggleable)).toEqual({
      entity: "cover.tapparella",
      config: { action: "more-info" },
    });
  });

  it("tapTarget: shutter swaps which entity leads", () => {
    const both = o({
      entity: "binary_sensor.win",
      shutterEntity: "cover.tapparella",
      tapTarget: "shutter",
    });
    // The tap opens the shutter's dialog — it does NOT drive the motor, even
    // though the cover could be toggled. Choosing which entity answers is not
    // choosing to move hardware on a tap (issue #47).
    expect(openingActionForGesture(both, "tap", toggleable)).toEqual({
      entity: "cover.tapparella",
      config: { action: "more-info" },
    });
    // …and hold picks up whichever one the tap left alone.
    expect(openingActionForGesture(both, "hold", toggleable)).toEqual({
      entity: "binary_sensor.win",
      config: { action: "more-info" },
    });
  });

  it("tapTarget is ignored unless there are two entities to choose between", () => {
    // Shutter-only: it is already the primary, and stays a plain cover tap.
    expect(
      openingActionForGesture(
        o({ shutterEntity: "cover.tapparella", tapTarget: "shutter" }),
        "tap",
        toggleable
      )
    ).toEqual({ entity: "cover.tapparella", config: { action: "toggle" } });
    // Window-only: nothing to swap to, so the choice cannot strand the press.
    expect(
      openingActionForGesture(o({ entity: "cover.win", tapTarget: "shutter" }), "tap", toggleable)
    ).toEqual({ entity: "cover.win", config: { action: "toggle" } });
  });

  it("a configured tap_action still wins, and lands on the chosen entity", () => {
    const both = o({
      entity: "binary_sensor.win",
      shutterEntity: "cover.tapparella",
      tapTarget: "shutter",
      tap_action: { action: "toggle" },
    });
    // Asking for a toggle *and* pointing the tap at the shutter is how you
    // move the shutter with one press — both halves stated explicitly.
    expect(openingActionForGesture(both, "tap", toggleable)).toEqual({
      entity: "cover.tapparella",
      config: { action: "toggle" },
    });
  });

  it("tapTarget: opening is the default, spelled out", () => {
    const both = { entity: "binary_sensor.win", shutterEntity: "cover.tapparella" };
    expect(openingActionForGesture(o({ ...both, tapTarget: "opening" }), "tap", toggleable)).toEqual(
      openingActionForGesture(o(both), "tap", toggleable)
    );
    expect(openingActionForGesture(o({ ...both, tapTarget: "opening" }), "hold", toggleable)).toEqual(
      { entity: "cover.tapparella", config: { action: "more-info" } }
    );
  });

  it("double-tap does nothing by default", () => {
    const both = o({ entity: "binary_sensor.win", shutterEntity: "cover.tapparella" });
    expect(openingActionForGesture(both, "double_tap", toggleable)).toBeUndefined();
    expect(openingActionForGesture(o({ entity: "cover.win" }), "double_tap", toggleable))
      .toBeUndefined();
  });

  it("an opening with nothing bound resolves no gesture at all", () => {
    for (const g of ["tap", "hold", "double_tap"] as const) {
      expect(openingActionForGesture(o(), g, toggleable)).toBeUndefined();
    }
  });

  it("a configured action wins over the default, on the primary", () => {
    const cfg = { action: "toggle" };
    const both = o({
      entity: "binary_sensor.win",
      shutterEntity: "cover.tapparella",
      tap_action: cfg,
    });
    expect(openingActionForGesture(both, "tap", toggleable)).toEqual({
      entity: "binary_sensor.win",
      config: cfg,
    });
  });

  it("a configured action's own entity picks which of the two it acts on", () => {
    const both = o({
      entity: "binary_sensor.win",
      shutterEntity: "cover.tapparella",
      tap_action: { action: "toggle", entity: "cover.tapparella" },
      hold_action: { action: "more-info", entity: "binary_sensor.win" },
    });
    expect(openingActionForGesture(both, "tap", toggleable)?.entity).toBe("cover.tapparella");
    // Naming the shutter on the tap is a decision, so it overrides the rule
    // that the default tap never moves it.
    expect(openingActionForGesture(both, "hold", toggleable)?.entity).toBe("binary_sensor.win");
  });

  it("a configured action survives even with no entity to act on", () => {
    // navigate/url need none, and dropping them would silently kill the press.
    const nav = { action: "navigate", navigation_path: "/lovelace/0" };
    const press = openingActionForGesture(o({ tap_action: nav }), "tap", none);
    expect(press).toEqual({ entity: undefined, config: nav });
  });

  it("an explicit none is honoured rather than falling back to the default", () => {
    const off = o({ entity: "cover.win", tap_action: { action: "none" } });
    expect(openingActionForGesture(off, "tap", toggleable)?.config).toEqual({ action: "none" });
  });
});

describe("the shutter badge (issue #74 follow-up)", () => {
  const win = (extra: Partial<Opening> = {}) =>
    ({ id: "o", type: "window", x: 500, y: 100, length: 90, angle: 0, ...extra }) as Opening;

  const both = { entity: "binary_sensor.win", shutterEntity: "cover.t" };

  it("is earned only by an opening with both entities bound", () => {
    expect(hasShutterMark(win())).toBe(false);
    expect(hasShutterMark(win({ entity: "binary_sensor.win" }))).toBe(false);
    // A shutter alone has no second entity to reveal — the symbol is it.
    expect(hasShutterMark(win({ shutterEntity: "cover.t" }))).toBe(false);
    expect(hasShutterMark(win(both))).toBe(true);
  });

  it("can be switched off, and off is the only value worth storing", () => {
    expect(hasShutterMark(win({ ...both, showShutterIcon: false }))).toBe(false);
    // Absent means shown: a discoverability aid nobody switches on helps nobody.
    expect(hasShutterMark(win({ ...both, showShutterIcon: undefined }))).toBe(true);
    expect(hasShutterMark(win({ ...both, showShutterIcon: true }))).toBe(true);
    // Switching it off says nothing about the gestures.
    expect(
      openingActionForGesture(win({ ...both, showShutterIcon: false }), "hold", () => 0)?.entity
    ).toBe("cover.t");
  });

  it("sits off the wall on the shutter's side, along the opening's normal", () => {
    // Horizontal wall: straight out in +y, the side the shutter is drawn on.
    expect(shutterMarkPoint(win())).toEqual({ x: 500, y: 100 + SHUTTER_MARK_OFFSET });
    // flipV moves the shutter to the other face; the badge follows it.
    expect(shutterMarkPoint(win({ flipV: true }))).toEqual({
      x: 500,
      y: 100 - SHUTTER_MARK_OFFSET,
    });
  });

  it("follows the wall's rotation", () => {
    // A wall running north-south (angle -90): the normal points along -x.
    const west = shutterMarkPoint(win({ x: 172, y: 269.5, angle: -90 }));
    expect(west.x).toBeCloseTo(172 + SHUTTER_MARK_OFFSET);
    expect(west.y).toBeCloseTo(269.5);
    const east = shutterMarkPoint(win({ x: 172, y: 269.5, angle: -90, flipV: true }));
    expect(east.x).toBeCloseTo(172 - SHUTTER_MARK_OFFSET);
    expect(east.y).toBeCloseTo(269.5);
    // 180° puts it back on the other side of a horizontal wall.
    expect(shutterMarkPoint(win({ angle: 180 })).y).toBeCloseTo(100 - SHUTTER_MARK_OFFSET);
  });

  it("takes a custom distance, so callers can nudge it off a crowded wall", () => {
    expect(shutterMarkPoint(win(), 40)).toEqual({ x: 500, y: 140 });
  });

  it("shows the entity's own icon: config override, then registry, then state", () => {
    const o = { shutterEntity: "cover.s" };
    const st = { state: "open", attributes: { icon: "mdi:from-state", device_class: "shutter" } };
    expect(shutterMarkIcon({ ...o, shutterIcon: "mdi:mine" }, st, true, "mdi:from-registry")).toBe(
      "mdi:mine"
    );
    expect(shutterMarkIcon(o, st, true, "mdi:from-registry")).toBe("mdi:from-registry");
    expect(shutterMarkIcon(o, st, true)).toBe("mdi:from-state");
  });

  it("an override is one glyph for both states, by definition", () => {
    const o = { shutterEntity: "cover.s", shutterIcon: "mdi:mine" };
    const st = (state: string) => ({ state, attributes: { device_class: "shutter" } });
    expect(shutterMarkIcon(o, st("open"), true)).toBe("mdi:mine");
    expect(shutterMarkIcon(o, st("closed"), false)).toBe("mdi:mine");
  });

  it("falls back to HA's own device-class pair, which is state-aware", () => {
    const o = { shutterEntity: "cover.s" };
    const st = (state: string) => ({ state, attributes: { device_class: "shutter" } });
    expect(shutterMarkIcon(o, st("open"), true)).toBe("mdi:window-shutter-open");
    expect(shutterMarkIcon(o, st("closed"), false)).toBe("mdi:window-shutter");
  });

  it("still says shutter when the entity declares no class at all", () => {
    // An unclassed cover, or a bare contact — neither has a pair of its own,
    // and an empty icon box would say less than a wrong-but-readable one.
    expect(shutterMarkIcon({ shutterEntity: "cover.s" }, { state: "on", attributes: {} }, true)).toBe(
      "mdi:window-shutter-open"
    );
    expect(shutterMarkIcon({ shutterEntity: "cover.s" }, undefined, false)).toBe(
      "mdi:window-shutter"
    );
    expect(shutterMarkIcon({ shutterEntity: "binary_sensor.s" }, undefined, true)).toBe(
      "mdi:window-shutter-open"
    );
  });

  it("refuses an icon string that isn't one (issue #64/#106), at every level", () => {
    const nasty = { state: "open", attributes: { icon: "mdi:x;background:url(//evil)" } };
    const o = { shutterEntity: "cover.s", shutterIcon: "mdi:evil;}" };
    expect(shutterMarkIcon(o, nasty, true, "mdi:y;}")).toBe("mdi:window-shutter-open");
  });

  it("the open half follows the *inverted* reading, not the raw state", () => {
    // shutterAmount has already applied shutterInvert by the time the card
    // asks for the glyph, so a reversed contact gets the right one.
    const contact = { state: "on", attributes: {} };
    const open = shutterAmount(contact, true) > 0;
    expect(open).toBe(false);
    expect(shutterMarkIcon({ shutterEntity: "binary_sensor.s" }, contact, open)).toBe(
      "mdi:window-shutter"
    );
  });

  it("is pushed off the opening in screen pixels too, along the wall's normal", () => {
    // The canvas offset scales with the plan; the badge does not. Without the
    // pixel half, a large canvas in a narrow card pulls the badge onto the
    // opening it describes — and that opening is a tap target.
    // Sized against the badge's own radius, so the circle clears the opening
    // whichever unit `overlayScale` (#148) puts them both in.
    expect(SHUTTER_MARK_PIXEL_OFFSET).toBeGreaterThan(SHUTTER_MARK_SIZE / 2);
    expect(SHUTTER_MARK_ICON_SIZE).toBeLessThan(SHUTTER_MARK_SIZE);
    expect(shutterMarkNormal(win())).toEqual({ x: -0, y: 1 });
    expect(shutterMarkNormal(win({ flipV: true }))).toEqual({ x: 0, y: -1 });
  });

  it("turns that push with the wall and with the plan's display rotation", () => {
    const west = shutterMarkNormal(win({ angle: -90 }));
    expect(west.x).toBeCloseTo(1);
    expect(west.y).toBeCloseTo(0);
    // The badge lives in the HTML overlay, which does not rotate with the SVG,
    // so a rotated plan (issue #33) has to turn the vector itself.
    const rotated = shutterMarkNormal(win(), 90);
    expect(rotated.x).toBeCloseTo(-1);
    expect(rotated.y).toBeCloseTo(0);
    expect(shutterMarkNormal(win(), 180).y).toBeCloseTo(-1);
    expect(shutterMarkNormal(win(), 270).x).toBeCloseTo(1);
  });

  it("the normal always points where the badge's anchor already went", () => {
    // Same direction as shutterMarkPoint's own offset, or the two halves of
    // the offset would fight each other.
    for (const o of [win(), win({ flipV: true }), win({ angle: -90 }), win({ angle: 37 })]) {
      const at = shutterMarkPoint(o);
      const n = shutterMarkNormal(o);
      expect(Math.sign(at.x - o.x) || 0).toBe(Math.sign(Number(n.x.toFixed(6))) || 0);
      expect(Math.sign(at.y - o.y) || 0).toBe(Math.sign(Number(n.y.toFixed(6))) || 0);
    }
  });
});

describe("openingIsPressable (issue #74 follow-up)", () => {
  const o = (extra: Partial<Opening> = {}) =>
    ({ id: "o", type: "window", x: 0, y: 0, length: 90, angle: 0, ...extra }) as Opening;
  const none = () => 0;

  it("an unbound opening is not a button", () => {
    expect(openingIsPressable(o(), none)).toBe(false);
  });

  it("either entity alone makes it pressable", () => {
    expect(openingIsPressable(o({ entity: "binary_sensor.win" }), none)).toBe(true);
    // The gap this closes: a shutter-only opening answered to nothing before.
    expect(openingIsPressable(o({ shutterEntity: "cover.tapparella" }), none)).toBe(true);
  });

  it("tap_action: none leaves nothing pressable — unless another gesture does", () => {
    expect(openingIsPressable(o({ entity: "cover.win", tap_action: { action: "none" } }), none))
      .toBe(false);
    // Hold still resolves (both entities bound), so it is a button again.
    expect(
      openingIsPressable(
        o({ entity: "cover.win", shutterEntity: "cover.s", tap_action: { action: "none" } }),
        none
      )
    ).toBe(true);
    // …or because a gesture was configured by hand.
    expect(
      openingIsPressable(
        o({
          entity: "cover.win",
          tap_action: { action: "none" },
          double_tap_action: { action: "more-info" },
        }),
        none
      )
    ).toBe(true);
  });
});

describe("collectWatchedEntities includes shutter entities (issue #74)", () => {
  it("watches shutterEntity alongside the opening entity", () => {
    const cfg = {
      type: "t", width: 1000, height: 600,
      floors: [{ id: "f", name: "F", walls: [], items: [], texts: [], furniture: [], trackers: [],
        openings: [{ id: "o", type: "window", x: 0, y: 0, length: 90, angle: 0,
          entity: "binary_sensor.win", shutterEntity: "cover.shutter" }] }],
    } as unknown as FloorplanCardConfig;
    const ids = collectWatchedEntities(cfg);
    expect(ids.has("binary_sensor.win")).toBe(true);
    expect(ids.has("cover.shutter")).toBe(true);
  });
});

describe("polygonCentroid", () => {
  it("averages the vertices", () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    expect(polygonCentroid(square)).toEqual({ x: 5, y: 5 });
  });

  it("returns the origin for an empty polygon", () => {
    expect(polygonCentroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("areaZoomTransform", () => {
  it("returns the identity transform for an empty polygon", () => {
    expect(areaZoomTransform([], 100, 100, 0)).toEqual(IDENTITY_ZOOM);
  });

  it("centers a small room and scales it up, capped at maxScale", () => {
    // A 10x10 room centered in a 100x100 canvas — the padded bbox is small,
    // so scale would blow past maxScale without the cap. Centered (not near
    // an edge) so the pan clamp below doesn't interfere with this assertion.
    const room = [{ x: 45, y: 45 }, { x: 55, y: 45 }, { x: 55, y: 55 }, { x: 45, y: 55 }];
    const t = areaZoomTransform(room, 100, 100, 0, 0.15, 4);
    expect(t.scale).toBe(4);
    // Room center (50,50) as a fraction of the canvas is (0.5, 0.5); at 4x
    // that must land back on the wrapper's own center (50%) — i.e. no pan.
    expect(t.txPercent).toBeCloseTo(50 - 4 * 0.5 * 100);
    expect(t.tyPercent).toBeCloseTo(50 - 4 * 0.5 * 100);
  });

  it("never zooms out past 1x for a room bigger than the canvas", () => {
    const room = [{ x: -50, y: -50 }, { x: 500, y: -50 }, { x: 500, y: 500 }, { x: -50, y: 500 }];
    const t = areaZoomTransform(room, 100, 100, 0);
    expect(t.scale).toBe(1);
  });

  it("accounts for whole-plan rotation the same way rotatePlanPoint does", () => {
    // A 100x50 canvas rotated 90°: the displayed frame is 50x100. A room
    // spanning the full un-rotated width should end up spanning the
    // *displayed* height once rotated, not overflow it.
    const room = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 10 }, { x: 0, y: 10 }];
    const t = areaZoomTransform(room, 100, 50, 90);
    // The rotated bbox should exactly fill the 50-wide, 100-tall displayed
    // canvas along its constraining axis, so scale caps at 1 (room already
    // spans the full displayed height).
    expect(t.scale).toBe(1);
  });

  it("clamps the pan so a room near a corner never uncovers the plan", () => {
    // A 10x10 room in the corner of a 980x700 canvas at 4x scale, mirroring
    // the reviewer's reproduction (canvas 980x700, area (40,40)-(140,110)).
    const room = [{ x: 40, y: 40 }, { x: 140, y: 40 }, { x: 140, y: 110 }, { x: 40, y: 110 }];
    const t = areaZoomTransform(room, 980, 700, 0);
    // Uncentered pan would be positive (panning the plan's top-left corner
    // into view, uncovering blank space beyond it) — clamped to exactly 0.
    expect(t.txPercent).toBe(0);
    expect(t.tyPercent).toBe(0);
  });

  it("clamps the pan to 0 when scale floors to 1 (room too big to zoom into)", () => {
    // A room taller than the canvas: scale floors to 1, and without the
    // clamp the pan would still shift the plan sideways for no zoom at all.
    const room = [{ x: 40, y: 40 }, { x: 400, y: 40 }, { x: 400, y: 660 }, { x: 40, y: 660 }];
    const t = areaZoomTransform(room, 980, 700, 0);
    expect(t.scale).toBe(1);
    expect(t.txPercent).toBe(0);
    expect(t.tyPercent).toBe(0);
  });

  it("returns the identity transform for a non-finite input instead of emitting NaN", () => {
    // A single hand-edited non-numeric coordinate must never reach the style
    // sink — NaN there would invalidate --fp-inv-zoom and, through it, every
    // device badge's transform on the plan.
    const room = [
      { x: Number.NaN, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(areaZoomTransform(room, 100, 100, 0)).toEqual(IDENTITY_ZOOM);
  });
});

describe("renderArea", () => {
  /** Flatten a Lit template back to markup (see the fishTank glyph test above). */
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("emits the vertex points and the default fill/opacity", () => {
    const markup = flattenMarkup(renderArea({ id: "a", points: square }));
    expect(markup).toContain("points=0,0 10,0 10,10 0,10");
    expect(markup).toContain(`fill=${SKIN_ACCENT}`);
    expect(markup).toContain("fill-opacity=0.25");
  });

  it("honors a custom color and opacity", () => {
    const markup = flattenMarkup(renderArea({ id: "a", points: square, color: "#ff0000", opacity: 0.6 }));
    expect(markup).toContain("fill=#ff0000");
    expect(markup).toContain("fill-opacity=0.6");
  });

  it("falls back to the default color for an unsafe value (css-safe gate)", () => {
    const markup = flattenMarkup(
      renderArea({ id: "a", points: square, color: "red;position:fixed;inset:0" })
    );
    expect(markup).toContain(`fill=${SKIN_ACCENT}`);
    expect(markup).not.toContain("position:fixed");
  });

  it("uses the live fill color over the resting one (#6)", () => {
    const markup = flattenMarkup(renderArea({ id: "a", points: square, color: "#ff0000" }, "#4caf50"));
    expect(markup).toContain("fill=#4caf50");
    expect(markup).not.toContain("fill=#ff0000");
  });

  it("applies activeOpacity only while live (#6)", () => {
    const a = { id: "a", points: square, opacity: 0.2, activeOpacity: 0.7 };
    expect(flattenMarkup(renderArea(a, "#4caf50"))).toContain("fill-opacity=0.7");
    expect(flattenMarkup(renderArea(a))).toContain("fill-opacity=0.2");
  });

  it("keeps the resting opacity when activeOpacity is unset (#6)", () => {
    const markup = flattenMarkup(renderArea({ id: "a", points: square, opacity: 0.2 }, "#4caf50"));
    expect(markup).toContain("fill-opacity=0.2");
  });

  it("never strokes — the outline is renderAreaBorder's pass, above the walls", () => {
    const cases: Area[] = [
      { id: "a", points: square },
      { id: "a", points: square, borderColor: "#123456", borderWidth: 5 },
      { id: "a", points: square, highlight: "border" },
      { id: "a", points: square, highlight: "both" },
    ];
    for (const a of cases) {
      const markup = flattenMarkup(renderArea(a, "#4caf50"));
      expect(markup).toContain('stroke="none"');
      expect(markup).toContain('stroke-width="0"');
      expect(markup).not.toContain("stroke=#123456");
    }
  });

  it("highlight=border leaves the fill at rest (#6)", () => {
    const a = { id: "a", points: square, color: "#ff0000", highlight: "border" as const };
    expect(flattenMarkup(renderArea(a, "#4caf50"))).toContain("fill=#ff0000");
  });

  it("highlight=border ignores activeOpacity, which is a fill concern (#6)", () => {
    const a = {
      id: "a",
      points: square,
      opacity: 0.2,
      activeOpacity: 0.7,
      highlight: "border" as const,
    };
    expect(flattenMarkup(renderArea(a, "#4caf50"))).toContain("fill-opacity=0.2");
  });

  it("highlight=both still paints the live fill (#6)", () => {
    const a = { id: "a", points: square, highlight: "both" as const };
    expect(flattenMarkup(renderArea(a, "#4caf50"))).toContain("fill=#4caf50");
  });
});

describe("renderAreaBorder", () => {
  /** Flatten a Lit template back to markup (see the fishTank glyph test above). */
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("draws nothing by default (#6)", () => {
    expect(renderAreaBorder({ id: "a", points: square })).toBe(nothing);
  });

  it("draws nothing for a live area that highlights only its fill (#6)", () => {
    expect(renderAreaBorder({ id: "a", points: square }, "#4caf50")).toBe(nothing);
    expect(
      renderAreaBorder({ id: "a", points: square, highlight: "fill" }, "#4caf50")
    ).toBe(nothing);
  });

  it("never fills — the fill is renderArea's pass, below the walls", () => {
    const markup = flattenMarkup(renderAreaBorder({ id: "a", points: square, borderColor: "#123456" }));
    expect(markup).toContain('fill="none"');
    expect(markup).toContain("points=0,0 10,0 10,10 0,10");
  });

  it("honors a static borderColor and borderWidth (#6)", () => {
    const markup = flattenMarkup(
      renderAreaBorder({ id: "a", points: square, borderColor: "#123456", borderWidth: 5 })
    );
    expect(markup).toContain("stroke=#123456");
    expect(markup).toContain("stroke-width=5");
  });

  it("falls back to the thinner default width for a static border (#6)", () => {
    const markup = flattenMarkup(renderAreaBorder({ id: "a", points: square, borderColor: "#123456" }));
    expect(markup).toContain("stroke-width=3");
  });

  it("defaults a live border to the room's own half of the wall", () => {
    // The wall is centered on the line the polygon follows, so the room owns
    // half of it. Anything wider spills onto the floor and over furniture.
    const a = { id: "a", points: square, highlight: "border" as const };
    expect(flattenMarkup(renderAreaBorder(a, "#4caf50"))).toContain(
      `stroke-width=${WALL_THICKNESS / 2}`
    );
  });

  it("lets an explicit borderWidth override the live default", () => {
    const a = { id: "a", points: square, highlight: "border" as const, borderWidth: 2 };
    expect(flattenMarkup(renderAreaBorder(a, "#4caf50"))).toContain("stroke-width=2");
  });

  it("keeps a live border inside the opening cut, so it never crosses a doorway", () => {
    // renderWallMask cuts WALL_THICKNESS + 4 across, so the hole reaches this
    // far either side of the wall's centerline. A clipped border runs its
    // visible width inward from that same line; outrun the cut and the overhang
    // paints straight across every door and window on the plan.
    const reach = (WALL_THICKNESS + 4) / 2;
    const a = { id: "a", points: square, highlight: "border" as const };
    const drawn = flattenMarkup(renderAreaBorder(a, "#4caf50", "c"));
    const visible = Number(/stroke-width=([\d.]+)/.exec(drawn)![1]) / 2;
    expect(visible).toBeLessThanOrEqual(reach);
  });

  it("clips a live border to its own room, so a shared wall splits", () => {
    const a = { id: "a", points: square, highlight: "border" as const };
    const markup = flattenMarkup(renderAreaBorder(a, "#4caf50", "clip-1"));
    expect(markup).toContain('<clipPath id=clip-1>');
    expect(markup).toContain("clip-path=url(#clip-1)");
  });

  it("draws a clipped border at double width, so borderWidth is what is seen", () => {
    const a = { id: "a", points: square, highlight: "border" as const };
    // Half of the stroke is clipped away, leaving the room's half-wall showing.
    expect(flattenMarkup(renderAreaBorder(a, "#4caf50", "c"))).toContain(
      `stroke-width=${WALL_THICKNESS}`
    );
    const wide = { ...a, borderWidth: 5 };
    expect(flattenMarkup(renderAreaBorder(wide, "#4caf50", "c"))).toContain("stroke-width=10");
  });

  it("carries the CSS hooks under its own class, so fill and outline differ (#105)", () => {
    const a = {
      id: "area_hall",
      points: square,
      highlight: "border" as const,
      entity: "binary_sensor.hall_occupancy",
    };
    const markup = flattenMarkup(renderAreaBorder(a, "#4caf50", "c"));
    expect(markup).toContain('class="fp-area-border"');
    expect(markup).toContain("data-id=area_hall");
    expect(markup).toContain("data-entity=binary_sensor.hall_occupancy");
  });

  it("keeps the hooks off the clip path, which is never rendered (#105)", () => {
    // A <clipPath> paints nothing, so a rule matching one would appear to do
    // nothing at all. Only the drawn polygon carries the hooks.
    const a = { id: "area_hall", points: square, highlight: "border" as const };
    const markup = flattenMarkup(renderAreaBorder(a, "#4caf50", "c"));
    expect(markup).toContain("<clipPath");
    expect(markup.match(/data-id=/g)).toHaveLength(1);
    expect(markup.match(/class="fp-area-border"/g)).toHaveLength(1);
  });

  it("never clips a static border — decoration is drawn as authored (#6)", () => {
    const a = { id: "a", points: square, borderColor: "#123456" };
    const markup = flattenMarkup(renderAreaBorder(a, undefined, "clip-1"));
    expect(markup).not.toContain("clip-path");
    expect(markup).toContain("stroke-width=3");
  });

  it("drops an unsafe borderColor rather than drawing it (#64)", () => {
    expect(
      renderAreaBorder({ id: "a", points: square, borderColor: "red;position:fixed;inset:0" })
    ).toBe(nothing);
  });

  it("highlight=border paints the live color (#6)", () => {
    const a = { id: "a", points: square, highlight: "border" as const };
    expect(flattenMarkup(renderAreaBorder(a, "#4caf50"))).toContain("stroke=#4caf50");
  });

  it("highlight=both paints the outline too (#6)", () => {
    const a = { id: "a", points: square, highlight: "both" as const };
    expect(flattenMarkup(renderAreaBorder(a, "#4caf50"))).toContain("stroke=#4caf50");
  });

  it("a live color overrides a static borderColor when it targets the border (#6)", () => {
    const a = { id: "a", points: square, borderColor: "#111111", highlight: "border" as const };
    const markup = flattenMarkup(renderAreaBorder(a, "#4caf50"));
    expect(markup).toContain("stroke=#4caf50");
    expect(markup).not.toContain("#111111");
  });

  it("keeps the static borderColor while the area is at rest (#6)", () => {
    const a = { id: "a", points: square, borderColor: "#111111", highlight: "border" as const };
    expect(flattenMarkup(renderAreaBorder(a))).toContain("stroke=#111111");
  });
});

describe("areaColor", () => {
  const base = { id: "a", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] };

  it("returns undefined for an unbound area", () => {
    expect(areaColor({ ...base, activeColor: "#4caf50" }, "on")).toBeUndefined();
  });

  it("prefers a matching stateColor rule over activeColor", () => {
    const a = {
      ...base,
      entity: "sensor.co2",
      activeColor: "#4caf50",
      stateColor: [{ above: 1000, color: "#ff0000" }, { color: "#00ff00" }],
    };
    expect(areaColor(a, "1200")).toBe("#ff0000");
    expect(areaColor(a, "400")).toBe("#00ff00");
  });

  it("uses activeColor when active and no rule matches", () => {
    const a = { ...base, entity: "binary_sensor.occupancy", activeColor: "#4caf50" };
    expect(areaColor(a, "on")).toBe("#4caf50");
  });

  it("returns undefined when the bound entity is inactive", () => {
    const a = { ...base, entity: "binary_sensor.occupancy", activeColor: "#4caf50" };
    expect(areaColor(a, "off")).toBeUndefined();
  });

  it("gates an unsafe activeColor through css-safe (#64)", () => {
    const a = { ...base, entity: "binary_sensor.occupancy", activeColor: "red;position:fixed;inset:0" };
    expect(areaColor(a, "on")).toBeUndefined();
  });
});

describe("dead-space hatching (issue #88)", () => {
  const ring = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ];

  it("fills the region with the hatch pattern rather than a flat colour", () => {
    const markup = flattenMarkup(renderDeadSpace(ring, "hatch-1"));
    expect(markup).toContain("fill=url(#hatch-1)");
    expect(markup).toContain("points=0,0 100,0 100,100 0,100");
    expect(markup).toContain('stroke="none"');
  });

  it("carries the class card-mod targets, and no other", () => {
    expect(flattenMarkup(renderDeadSpace(ring, "h"))).toContain('class="fp-dead-space"');
  });

  it("keeps a stub wall's spike solid instead of punching a hole through it", () => {
    // A ring that walks out along a dead-end wall and back reverses direction
    // over the same line; under evenodd that zero-width spike reads as a hole
    // and scratches a line across the hatching.
    expect(flattenMarkup(renderDeadSpace(ring, "h"))).toContain('fill-rule="nonzero"');
  });

  it("spaces the hatch in canvas units, so every region hatches at one pitch", () => {
    // patternUnits="objectBoundingBox" (the SVG default) would scale the tile
    // to each polygon, so a cupboard would come out finely cross-hatched and a
    // courtyard coarsely — the same plan drawn at two densities.
    const markup = flattenMarkup(renderDeadSpaceHatch("hatch-1"));
    expect(markup).toContain('patternUnits="userSpaceOnUse"');
    expect(markup).toContain(`width=${DEAD_SPACE_HATCH_GAP}`);
  });

  it("draws the tile upright and turns the tile, so the lines meet across it", () => {
    // A line drawn corner-to-corner inside an upright tile leaves a visible
    // seam at every tile edge; rotating the whole pattern does not.
    const markup = flattenMarkup(renderDeadSpaceHatch("hatch-1"));
    expect(markup).toContain('patternTransform="rotate(45)"');
    expect(markup).toContain(`x1="0" y1="0" x2="0" y2=${DEAD_SPACE_HATCH_GAP}`);
  });

  it("takes the wall colour from the skin, so a skinned plan hatches in its ink", () => {
    expect(flattenMarkup(renderDeadSpaceHatch("h"))).toContain(SKIN_WALL);
  });

  it("stays faint — an absence, not something to draw the eye", () => {
    expect(DEAD_SPACE_HATCH_OPACITY).toBeLessThan(0.5);
    expect(flattenMarkup(renderDeadSpace(ring, "h"))).toContain(
      `fill-opacity=${DEAD_SPACE_HATCH_OPACITY}`
    );
  });
});

describe("renderWallMask region (issue #102)", () => {

  it("states its own region instead of inheriting the viewport default", () => {
    const markup = flattenMarkup(renderWallMask([], 1000, 600, "m1"));
    const mask = markup.slice(markup.indexOf("<mask"), markup.indexOf(">", markup.indexOf("<mask")));
    // Without these, the region falls back to -10%..110% of the viewport, which
    // the rotated card swaps — clipping walls past x=660 on a 1000x600 plan.
    expect(mask).toContain('x=-8');
    expect(mask).toContain('y=-8');
    expect(mask).toContain("width=1016");
    expect(mask).toContain("height=616");
  });

  it("covers the whole plan even where the viewport is narrower than it", () => {
    // A 90°-rotated 1000x600 plan is drawn into a 600x1000 viewport, so the
    // region must reach plan x=1000 regardless of that 600.
    const markup = flattenMarkup(renderWallMask([], 1000, 600, "m2"));
    const nums = [...markup.matchAll(/(?:x|y|width|height)=(-?\d+)/g)].map((m) => Number(m[1]));
    const right = 1000 + 8;
    expect(Math.max(...nums)).toBeGreaterThanOrEqual(right);
  });
});

describe("sunBrightness (issue #113)", () => {
  it("is min deep at night and max in full daylight", () => {
    expect(sunBrightness(-40, 0.45, 1)).toBeCloseTo(0.45, 5);
    expect(sunBrightness(SUN_ELEVATION_NIGHT, 0.45, 1)).toBeCloseTo(0.45, 5);
    expect(sunBrightness(60, 0.45, 1)).toBeCloseTo(1, 5);
    expect(sunBrightness(SUN_ELEVATION_DAY, 0.45, 1)).toBeCloseTo(1, 5);
  });

  it("ramps smoothly and monotonically across civil twilight", () => {
    const xs = [-6, -4, -2, 0, 2, 4, 6];
    const ys = xs.map((e) => sunBrightness(e, 0.45, 1));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    // Sunset (0°) sits halfway: the ramp is symmetric about the horizon.
    expect(sunBrightness(0, 0, 1)).toBeCloseTo(0.5, 5);
  });

  it("eases at both ends rather than cornering", () => {
    // Smoothstep: near the clamps the rate is slower than in the middle.
    const nearEnd = sunBrightness(-5, 0, 1) - sunBrightness(-6, 0, 1);
    const middle = sunBrightness(0.5, 0, 1) - sunBrightness(-0.5, 0, 1);
    expect(middle).toBeGreaterThan(nearEnd);
  });

  it("fails bright: a missing or unreadable elevation leaves the plan lit", () => {
    // The opposite would strand a plan dark with nothing on screen to explain
    // why — worse than ignoring the feature until sun.sun comes back.
    expect(sunBrightness(undefined, 0.45, 1)).toBe(1);
    expect(sunBrightness(null, 0.45, 1)).toBe(1);
    expect(sunBrightness("unavailable", 0.45, 1)).toBe(1);
    expect(sunBrightness(Number.NaN, 0.45, 1)).toBe(1);
    // The nasty ones: all of these coerce to 0, which is mid-ramp, not night.
    expect(sunBrightness("", 0.45, 1)).toBe(1);
    expect(sunBrightness("   ", 0.45, 1)).toBe(1);
    expect(sunBrightness(false, 0.45, 1)).toBe(1);
    expect(sunBrightness([], 0.45, 1)).toBe(1);
    // But a real 0° is sunset, and must still ramp.
    expect(sunBrightness(0, 0.45, 1)).toBeCloseTo(0.725, 3);
  });

  it("tolerates min and max given the wrong way round", () => {
    expect(sunBrightness(-40, 1, 0.3)).toBeCloseTo(0.3, 5);
    expect(sunBrightness(40, 1, 0.3)).toBeCloseTo(1, 5);
  });

  it("reads a numeric string, as HA attributes sometimes arrive", () => {
    expect(sunBrightness("6", 0.45, 1)).toBeCloseTo(1, 5);
  });
});

describe("renderSunDimMask — lit rooms hold back the night (issue #113)", () => {
  const lamp = (extra = {}) =>
    ({ id: "i1", entity: "light.a", kind: "light", x: 200, y: 150, glow: true, ...extra }) as never;
  const on = (attributes: Record<string, unknown> = { brightness: 255 }) =>
    ({ "light.a": { entity_id: "light.a", state: "on", attributes } }) as never;

  it("clears fully at the centre and fades to nothing at the radius", () => {
    const markup = flattenMarkup(renderSunDimMask([lamp()], on(), 1000, 600, "sd"));
    // Black hides the dim; white keeps it. Full brightness clears completely.
    expect(markup).toContain('stop-opacity=1');
    expect(markup).toContain('stop-opacity="0"');
    expect(markup).toContain('fill="white"');
    expect(markup).toContain("cx=200");
    expect(markup).toContain(`r=${DEFAULT_GLOW_RADIUS}`);
  });

  it("honours a custom glowRadius, so clearing and pool share a shape", () => {
    const markup = flattenMarkup(renderSunDimMask([lamp({ glowRadius: 90 })], on(), 1000, 600, "sd"));
    expect(markup).toContain("r=90");
  });

  it("clears in proportion to brightness, like the pool itself", () => {
    const at = (brightness: number) => {
      const m = flattenMarkup(renderSunDimMask([lamp()], on({ brightness }), 1000, 600, "sd"));
      return Number(/stop-opacity=([\d.]+)/.exec(m)?.[1]);
    };
    expect(at(255)).toBeCloseTo(1, 5);
    // GLOW_MIN_OPACITY / GLOW_MAX_OPACITY — a lamp dimmed to nothing still
    // clears about a third, matching the pool it casts.
    expect(at(0)).toBeCloseTo(GLOW_MIN_OPACITY / GLOW_MAX_OPACITY, 5);
    expect(at(128)).toBeGreaterThan(at(0));
    expect(at(128)).toBeLessThan(at(255));
  });

  it("a light that is off, unavailable or missing clears nothing", () => {
    const off = { "light.a": { entity_id: "light.a", state: "off", attributes: {} } } as never;
    expect(renderSunDimMask([lamp()], off, 1000, 600, "sd")).toBe(nothing);
    const dead = { "light.a": { entity_id: "light.a", state: "unavailable", attributes: {} } } as never;
    expect(renderSunDimMask([lamp()], dead, 1000, 600, "sd")).toBe(nothing);
    expect(renderSunDimMask([lamp()], undefined, 1000, 600, "sd")).toBe(nothing);
  });

  it("a device without Cast light never clears, however bright its entity", () => {
    // Only glow devices define a radius, so only they can hold back the dark.
    expect(renderSunDimMask([lamp({ glow: false })], on(), 1000, 600, "sd")).toBe(nothing);
    expect(renderSunDimMask([], on(), 1000, 600, "sd")).toBe(nothing);
  });

  it("states its own region, so rotation cannot clip the clearing (issue #102)", () => {
    const markup = flattenMarkup(renderSunDimMask([lamp()], on(), 1000, 600, "sd"));
    expect(markup).toContain("width=1016");
    expect(markup).toContain("height=616");
  });

  it("clips the clearing at walls, like the pool it mirrors (issue #108)", () => {
    const walls = [{ id: "w", x1: 300, y1: 0, x2: 300, y2: 400 }];
    const withWalls = flattenMarkup(
      renderSunDimMask([lamp({ x: 190, glowRadius: 200 })], on(), 600, 400, "sd", walls)
    );
    expect(withWalls).toContain("<clipPath");
    expect(withWalls).toContain("clip-path=url(#sd-0-clip)");
    // No wall in reach: a plain circle, no clip, no wasted work.
    const noWalls = flattenMarkup(renderSunDimMask([lamp()], on(), 600, 400, "sd", []));
    expect(noWalls).not.toContain("<clipPath");
    const farWall = [{ id: "w", x1: 9000, y1: 0, x2: 9000, y2: 400 }];
    expect(flattenMarkup(renderSunDimMask([lamp()], on(), 600, 400, "sd", farWall))).not.toContain("<clipPath");
  });

  it("hangs the clip id off the gradient id, so it stays pinned too (issue #119)", () => {
    // Same trap as the gradient: a clip id that renumbered on toggle would
    // strand the circle on a stale clip path.
    const walls = [{ id: "w", x1: 300, y1: 0, x2: 300, y2: 400 }];
    const items = [
      lamp({ id: "A", entity: "light.a", x: 150, glowRadius: 200 }),
      lamp({ id: "B", entity: "light.b", x: 190, glowRadius: 200 }),
      lamp({ id: "C", entity: "light.c", x: 200, glowRadius: 200 }),
    ];
    const states = (bOn: boolean) =>
      ({
        "light.a": { entity_id: "light.a", state: "on", attributes: { brightness: 255 } },
        "light.b": { entity_id: "light.b", state: bOn ? "on" : "off", attributes: {} },
        "light.c": { entity_id: "light.c", state: "on", attributes: { brightness: 255 } },
      }) as never;
    const clips = (bOn: boolean) => {
      const m = flattenMarkup(renderSunDimMask(items, states(bOn), 600, 400, "sd", walls));
      return [...m.matchAll(/id=(sd-\d+-clip)/g)].map((x) => x[1]);
    };
    expect(clips(false)).toEqual(["sd-0-clip", "sd-2-clip"]);
    expect(clips(true)).toEqual(["sd-0-clip", "sd-1-clip", "sd-2-clip"]);
  });

  it("keeps every lamp's gradient id pinned to its item index, not its rank", () => {
    // The bug this guards: compacting the list to only-lit lamps shifted every
    // later lamp's DOM position when one toggled, rewriting the id on an
    // existing <radialGradient> and stranding the circle that referenced it on
    // a stale paint server — a hard-edged disc at full strength instead of a
    // falloff. Only lamps *after* the toggled one were affected, which is what
    // made it look intermittent.
    const items = [
      lamp({ id: "A", entity: "light.a", x: 150 }),
      lamp({ id: "B", entity: "light.b", x: 450 }),
      lamp({ id: "C", entity: "light.c", x: 750 }),
    ];
    const states = (bOn: boolean) =>
      ({
        "light.a": { entity_id: "light.a", state: "on", attributes: { brightness: 255 } },
        "light.b": { entity_id: "light.b", state: bOn ? "on" : "off", attributes: {} },
        "light.c": { entity_id: "light.c", state: "on", attributes: { brightness: 255 } },
      }) as never;

    const idsFor = (bOn: boolean) => {
      const m = flattenMarkup(renderSunDimMask(items, states(bOn), 1000, 600, "sd"));
      return [...m.matchAll(/id=(sd-\d+)/g)].map((x) => x[1]);
    };
    // C is index 2 and must stay sd-2 whether or not B is lit.
    expect(idsFor(false)).toEqual(["sd-0", "sd-2"]);
    expect(idsFor(true)).toEqual(["sd-0", "sd-1", "sd-2"]);

    // And each circle still points at its own lamp's gradient.
    const off = flattenMarkup(renderSunDimMask(items, states(false), 1000, 600, "sd"));
    expect(off).toContain("cx=750");
    expect(off).toContain("url(#sd-2)");
    expect(off).not.toContain("sd-1");
  });

  it("gives each lamp its own gradient id, so pools do not share a falloff", () => {
    const two = [lamp(), lamp({ id: "i2", x: 700 })];
    const markup = flattenMarkup(renderSunDimMask(two, on(), 1000, 600, "sd"));
    expect(markup).toContain("id=sd-0");
    expect(markup).toContain("id=sd-1");
  });
});

describe("collectWatchedEntities watches the sun (issue #113)", () => {
  const base = { type: "custom:easy-floorplan-card", width: 100, height: 100 } as never;

  it("watches sun.sun only when the option is on", () => {
    expect(collectWatchedEntities(base).has("sun.sun")).toBe(false);
    // Without this the plan is lit once and then frozen — the trap #82 and #6
    // each fell into.
    expect(collectWatchedEntities({ ...(base as object), sunDimming: true } as never).has("sun.sun"))
      .toBe(true);
  });
});

describe("imageFitRatio (issue #86)", () => {
  it("maps each fit onto SVG's own aspect-ratio handling", () => {
    expect(imageFitRatio("contain")).toBe("xMidYMid meet");
    expect(imageFitRatio("cover")).toBe("xMidYMid slice");
    expect(imageFitRatio("stretch")).toBe("none");
  });

  it("keeps stretching when unset, so existing traced plans do not shift", () => {
    expect(imageFitRatio(undefined)).toBe("none");
    // A value from a hand-written config we don't recognise must not silently
    // become "contain" and move every wall off the image it was traced over.
    expect(imageFitRatio("fill" as never)).toBe("none");
  });
});

describe("shutterStyleOf (issue #74)", () => {
  it("infers from the bound entity: contacts hinge, covers roll", () => {
    expect(shutterStyleOf({ shutterEntity: "binary_sensor.persiana" })).toBe("swing");
    expect(shutterStyleOf({ shutterEntity: "cover.tapparella" })).toBe("roll");
  });

  it("an explicit style always wins", () => {
    expect(shutterStyleOf({ shutterEntity: "cover.x", shutterStyle: "swing" })).toBe("swing");
    expect(shutterStyleOf({ shutterEntity: "binary_sensor.x", shutterStyle: "roll" })).toBe("roll");
  });

  it("defaults to roll with nothing bound, so existing configs are untouched", () => {
    expect(shutterStyleOf({})).toBe("roll");
  });
});

describe("glowPaint (issue #6)", () => {
  const light = (state: string, attributes: Record<string, unknown> = {}) =>
    ({ entity_id: "light.x", state, attributes }) as never;

  it("paints a color-capable light's own rgb", () => {
    const paint = glowPaint({}, light("on", { rgb_color: [255, 170, 80], brightness: 255 }));
    expect(paint?.color).toBe("rgb(255, 170, 80)");
    expect(paint?.opacity).toBeCloseTo(GLOW_MAX_OPACITY, 5);
  });

  it("scales strength with brightness, inside the legible band", () => {
    const dim = glowPaint({}, light("on", { rgb_color: [255, 255, 255], brightness: 0 }));
    const half = glowPaint({}, light("on", { rgb_color: [255, 255, 255], brightness: 128 }));
    expect(dim?.opacity).toBeCloseTo(GLOW_MIN_OPACITY, 5);
    expect(half?.opacity).toBeGreaterThan(GLOW_MIN_OPACITY);
    expect(half?.opacity).toBeLessThan(GLOW_MAX_OPACITY);
    // The floor is the point: a dimmed lamp stays visible rather than vanishing.
    expect(dim?.opacity).toBeGreaterThan(0);
  });

  it("a brightness-only light falls back to a warm white", () => {
    // light.kitchen_lights on a real install: supported_color_modes ["brightness"].
    const paint = glowPaint({}, light("on", { brightness: 255 }));
    expect(paint?.color).toBe(DEFAULT_GLOW_COLOR);
  });

  it("an on/off-only light casts at full strength", () => {
    // light.main_living_room_switch_l1: supported_color_modes ["onoff"].
    const paint = glowPaint({}, light("on"));
    expect(paint?.color).toBe(DEFAULT_GLOW_COLOR);
    expect(paint?.opacity).toBeCloseTo(GLOW_MAX_OPACITY, 5);
  });

  it("honors a configured glowColor for a light that has none of its own", () => {
    expect(glowPaint({ glowColor: "#00ff00" }, light("on", { brightness: 128 }))?.color)
      .toBe("#00ff00");
    // ...but never over a light that CAN report one.
    expect(glowPaint({ glowColor: "#00ff00" }, light("on", { rgb_color: [1, 2, 3] }))?.color)
      .toBe("rgb(1, 2, 3)");
  });

  it("gates an unsafe glowColor through css-safe (#64)", () => {
    expect(glowPaint({ glowColor: "red;position:fixed;inset:0" }, light("on"))?.color)
      .toBe(DEFAULT_GLOW_COLOR);
  });

  it("casts nothing when off, unavailable, unknown or missing (fails closed)", () => {
    expect(glowPaint({}, light("off", { rgb_color: [255, 0, 0] }))).toBeUndefined();
    expect(glowPaint({}, light("unavailable"))).toBeUndefined();
    expect(glowPaint({}, light("unknown"))).toBeUndefined();
    expect(glowPaint({}, undefined)).toBeUndefined();
  });

  it("ignores a malformed rgb_color rather than emitting a broken color", () => {
    expect(glowPaint({}, light("on", { rgb_color: [255, 0] }))?.color).toBe(DEFAULT_GLOW_COLOR);
    expect(glowPaint({}, light("on", { rgb_color: "red;position:fixed" }))?.color).toBe(DEFAULT_GLOW_COLOR);
    expect(glowPaint({}, light("on", { rgb_color: [null, 1, 2] }))?.color).toBe(DEFAULT_GLOW_COLOR);
  });

  it("clamps out-of-range channels instead of trusting the integration", () => {
    expect(glowPaint({}, light("on", { rgb_color: [300, -20, 12.6] }))?.color).toBe("rgb(255, 0, 13)");
  });

  // Issue #123: dimming should draw the light in, not only thin it.
  describe("brightness scales the pool's reach (#123)", () => {
    it("full brightness casts the configured radius, unchanged", () => {
      expect(glowPaint({ glowRadius: 200 }, light("on", { brightness: 255 }))?.radius).toBe(200);
    });

    it("a dimmer lamp reaches less far, down to a floor that stays visible", () => {
      const at = (b: number) => glowPaint({ glowRadius: 200 }, light("on", { brightness: b }))!.radius;
      expect(at(255)).toBe(200);
      expect(at(128)).toBeCloseTo(200 * (GLOW_MIN_RADIUS + (1 - GLOW_MIN_RADIUS) * (128 / 255)), 5);
      expect(at(0)).toBeCloseTo(200 * GLOW_MIN_RADIUS, 5);
      // Monotonic, and never collapses to a dot under the lamp's own icon.
      expect(at(0)).toBeLessThan(at(128));
      expect(at(128)).toBeLessThan(at(255));
      expect(at(0)).toBeGreaterThan(0);
    });

    it("a bulb with no brightness to report keeps the full radius", () => {
      // An on/off-only light: "on" means fully on, so nothing shrinks.
      expect(glowPaint({ glowRadius: 200 }, light("on"))?.radius).toBe(200);
    });

    it("defaults and gates the configured radius through css-safe", () => {
      expect(glowPaint({}, light("on", { brightness: 255 }))?.radius).toBe(DEFAULT_GLOW_RADIUS);
      // A hostile value falls back rather than reaching the SVG (#64/#65).
      expect(glowPaint({ glowRadius: "6; evil" as never }, light("on", { brightness: 255 }))?.radius)
        .toBe(DEFAULT_GLOW_RADIUS);
    });

    it("the sun-dimming clearing shrinks with the pool, staying the same shape", () => {
      // These are documented as the same shape by construction; the clearing
      // reading glowRadius directly would silently break that once the pool
      // started scaling.
      const items = [
        { id: "i1", entity: "light.a", kind: "light", x: 300, y: 200, glow: true, glowRadius: 200 },
      ] as never;
      const at = (brightness: number) => {
        const states = {
          "light.a": { entity_id: "light.a", state: "on", attributes: { brightness } },
        } as never;
        const markup = flattenMarkup(renderSunDimMask(items, states, 1000, 600, "sd"));
        return Number(/r=(\d+(?:\.\d+)?)/.exec(markup)![1]);
      };
      expect(at(255)).toBe(200);
      expect(at(0)).toBeCloseTo(200 * GLOW_MIN_RADIUS, 5);
      expect(at(0)).toBeLessThan(at(255));
    });
  });
});

// @ombre33 on #106: every badge is the theme yellow while the lamps are green,
// blue and pink. The badge should look like the bulb.
describe("lightBadgePaint (#106)", () => {
  const light = (state: string, attributes: Record<string, unknown> = {}) =>
    ({ entity_id: "light.x", state, attributes }) as never;

  it("wears a colour-capable bulb's own rgb at full brightness", () => {
    expect(lightBadgePaint(light("on", { rgb_color: [0, 200, 100], brightness: 255 }))).toBe(
      "rgb(0, 200, 100)",
    );
  });

  it("darkens with brightness, down to a floor that is still recognisably the bulb", () => {
    const full = lightBadgePaint(light("on", { rgb_color: [200, 100, 50], brightness: 255 }));
    const half = lightBadgePaint(light("on", { rgb_color: [200, 100, 50], brightness: 128 }));
    const off = lightBadgePaint(light("on", { rgb_color: [200, 100, 50], brightness: 0 }));
    expect(full).toBe("rgb(200, 100, 50)");
    // Each channel scaled by the same factor — the hue is preserved, only the
    // lightness moves.
    expect(half).toBe(
      `rgb(${[200, 100, 50]
        .map((c) => Math.round(c * (BADGE_MIN_LIGHTNESS + (1 - BADGE_MIN_LIGHTNESS) * (128 / 255))))
        .join(", ")})`,
    );
    expect(off).toBe(
      `rgb(${[200, 100, 50].map((c) => Math.round(c * BADGE_MIN_LIGHTNESS)).join(", ")})`,
    );
    // The floor is the point: a barely-lit lamp is still identifiable.
    expect(off).not.toBe("rgb(0, 0, 0)");
  });

  it("leaves a bulb that reports no colour completely alone", () => {
    // The no-surprise guarantee, and the reason this is not glowPaint: that one
    // falls back to a warm white, which would repaint every plain bulb amber.
    expect(lightBadgePaint(light("on", { brightness: 255 }))).toBeUndefined();
    expect(lightBadgePaint(light("on"))).toBeUndefined();
    expect(glowPaint({}, light("on"))?.color).toBe(DEFAULT_GLOW_COLOR);
  });

  it("paints nothing when off, unavailable, unknown or missing (fails closed)", () => {
    expect(lightBadgePaint(light("off", { rgb_color: [255, 0, 0] }))).toBeUndefined();
    expect(lightBadgePaint(light("unavailable", { rgb_color: [255, 0, 0] }))).toBeUndefined();
    expect(lightBadgePaint(light("unknown", { rgb_color: [255, 0, 0] }))).toBeUndefined();
    expect(lightBadgePaint(undefined)).toBeUndefined();
  });

  it("ignores a malformed rgb_color rather than emitting a broken colour", () => {
    expect(lightBadgePaint(light("on", { rgb_color: [255, 0] }))).toBeUndefined();
    expect(lightBadgePaint(light("on", { rgb_color: "red;position:fixed" }))).toBeUndefined();
    expect(lightBadgePaint(light("on", { rgb_color: [null, 1, 2] }))).toBeUndefined();
  });

  it("clamps out-of-range channels instead of trusting the integration", () => {
    expect(lightBadgePaint(light("on", { rgb_color: [300, -20, 12.6], brightness: 255 }))).toBe(
      "rgb(255, 0, 13)",
    );
  });
});

// Issue #143: "doors act as walls and stop the light pool, regardless of
// open/close status". Walls and openings are stored independently, so the glow
// sweep saw uncut walls where the plan draws a hole.
describe("wallsLightPassesThrough (#143)", () => {
  const wall = (x1: number, y1: number, x2: number, y2: number, id = "w") => ({ id, x1, y1, x2, y2 });
  // A door centred on a horizontal wall at y=100, spanning x 480..520.
  const door = (extra: Partial<Opening> = {}): Opening =>
    ({ id: "d", type: "door", x: 500, y: 100, length: 40, angle: 0, ...extra }) as Opening;
  const spans = (out: { x1: number; x2: number }[]) =>
    out.map((w) => [Math.round(w.x1), Math.round(w.x2)]);

  it("cuts the doorway out of the wall when the door is open", () => {
    const out = wallsLightPassesThrough([wall(0, 100, 1000, 100)], [door()], () => 1);
    expect(spans(out)).toEqual([
      [0, 480],
      [520, 1000],
    ]);
  });

  it("leaves the wall whole when the door is shut — today's behaviour, kept", () => {
    const walls = [wall(0, 100, 1000, 100)];
    const out = wallsLightPassesThrough(walls, [door()], () => 0);
    expect(out).toEqual(walls);
    // Same object, so nothing downstream re-derives for a plan of shut doors.
    expect(wallsLightPassesThrough(walls, [], () => 1)).toBe(walls);
  });

  it("asks each opening how open it is exactly once, whatever the wall count", () => {
    // openAmount reads hass. Asked inside the wall loop it became walls x
    // openings state lookups per render — hundreds, to answer three questions.
    const walls = Array.from({ length: 40 }, (_, i) =>
      wall(0, 100 + i * 10, 1000, 100 + i * 10, `w${i}`)
    );
    const openings = [door(), door({ id: "d2", x: 300 } as Partial<Opening>), door({ id: "d3", x: 700 } as Partial<Opening>)];
    let asked = 0;
    wallsLightPassesThrough(walls, openings, () => {
      asked++;
      return 1;
    });
    expect(asked).toBe(openings.length);
  });

  it("hands back the very same array when nothing is open", () => {
    // Lets a caller compare identity to know the light sees the walls it
    // always did — and skips the whole scan on the common case.
    const walls = [wall(0, 100, 1000, 100)];
    expect(wallsLightPassesThrough(walls, [door(), door({ id: "d2" } as Partial<Opening>)], () => 0)).toBe(walls);
    expect(wallsLightPassesThrough(walls, [], () => 1)).toBe(walls);
  });

  it("opens the gap in proportion, so a half-open cover half-blocks", () => {
    const out = wallsLightPassesThrough([wall(0, 100, 1000, 100)], [door()], () => 0.5);
    // 40 * 0.5 = 20 wide, centred on x=500.
    expect(spans(out)).toEqual([
      [0, 490],
      [510, 1000],
    ]);
  });

  it("only cuts the wall the opening actually sits on", () => {
    const walls = [wall(0, 100, 1000, 100, "on"), wall(0, 400, 1000, 400, "far")];
    const out = wallsLightPassesThrough(walls, [door()], () => 1);
    // The far wall survives untouched; the near one is in two pieces.
    expect(out.filter((w) => w.id === "far")).toEqual([walls[1]]);
    expect(out.filter((w) => w.id.startsWith("on"))).toHaveLength(2);
  });

  it("handles a door at a wall's end without emitting a zero-length stub", () => {
    // Door hard against x=0: there is no wall to the left of it.
    const out = wallsLightPassesThrough(
      [wall(0, 100, 1000, 100)],
      [door({ x: 10 } as Partial<Opening>)],
      () => 1
    );
    expect(spans(out)).toEqual([[30, 1000]]);
  });

  it("merges two openings that overlap instead of double-cutting", () => {
    const out = wallsLightPassesThrough(
      [wall(0, 100, 1000, 100)],
      [door(), door({ id: "d2", x: 530 } as Partial<Opening>)],
      () => 1
    );
    expect(spans(out)).toEqual([
      [0, 480],
      [550, 1000],
    ]);
  });

  it("cuts a vertical wall the same way — the maths is not axis-aligned", () => {
    const out = wallsLightPassesThrough(
      [wall(200, 0, 200, 1000)],
      [door({ x: 200, y: 500, angle: 90 } as Partial<Opening>)],
      () => 1
    );
    expect(out.map((w) => [Math.round(w.y1), Math.round(w.y2)])).toEqual([
      [0, 480],
      [520, 1000],
    ]);
  });

  it("a shut room stays shut — light escapes by no wall at all", () => {
    // The other half of the feature. Cutting gaps must not leak light past the
    // walls that have no opening in them, or through one that is closed.
    const room = [
      wall(300, 200, 700, 200, "n"),
      wall(700, 200, 700, 500, "e"),
      wall(700, 500, 300, 500, "s"),
      wall(300, 500, 300, 200, "w"),
    ];
    const shutDoor = door({ x: 500, y: 500, length: 90 } as Partial<Opening>);
    const lit = wallsLightPassesThrough(room, [shutDoor], () => 0);
    const poly = glowReach(500, 350, 340, lit)!;
    expect(poly).toBeDefined();
    const inside = (x: number, y: number) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
      }
      return hit;
    };
    expect(inside(500, 350)).toBe(true); // the room itself is lit
    for (const [x, y] of [
      [500, 560], // past the shut door
      [500, 140], // past the north wall
      [770, 350], // past the east wall
      [230, 350], // past the west wall
      [740, 540], // diagonally out of the corner
    ]) {
      expect({ x, y, lit: inside(x, y) }).toEqual({ x, y, lit: false });
    }
  });

  it("an open window lets light out just as a door does", () => {
    // Windows are not special-cased: the rule is the opening's own state.
    const room = [
      wall(300, 200, 700, 200, "n"),
      wall(700, 200, 700, 500, "e"),
      wall(700, 500, 300, 500, "s"),
      wall(300, 500, 300, 200, "w"),
    ];
    const win = { id: "win", type: "window", x: 700, y: 350, length: 90, angle: 90 } as Opening;
    const beyondEast = (amount: number) => {
      const poly = glowReach(500, 350, 340, wallsLightPassesThrough(room, [win], () => amount));
      if (!poly) return true;
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > 350 !== b.y > 350 && 770 < ((b.x - a.x) * (350 - a.y)) / (b.y - a.y) + a.x)
          hit = !hit;
      }
      return hit;
    };
    expect(beyondEast(0)).toBe(false);
    expect(beyondEast(1)).toBe(true);
  });

  it("lets the pool through an open door, and not through a shut one", () => {
    // The end-to-end claim, through glowReach itself: a lamp beside a doorway.
    const walls = [wall(0, 360, 1000, 360)];
    const doorway = [door({ x: 500, y: 360, length: 80 } as Partial<Opening>)];
    const beyond = (amount: number) => {
      const lit = wallsLightPassesThrough(walls, doorway, () => amount);
      const poly = glowReach(500, 300, 200, lit);
      // No blocking wall left in range at all means an unclipped circle.
      if (!poly) return true;
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!;
        const b = poly[j]!;
        if (a.y > 420 !== b.y > 420 && 500 < ((b.x - a.x) * (420 - a.y)) / (b.y - a.y) + a.x)
          hit = !hit;
      }
      return hit;
    };
    expect(beyond(0)).toBe(false); // shut: the room beyond stays dark
    expect(beyond(1)).toBe(true); // open: light reaches through
  });
});

describe("glowReach — walls block light (issue #108)", () => {
  const wall = (x1: number, y1: number, x2: number, y2: number, id = "w") => ({ id, x1, y1, x2, y2 });
  // Even-odd point-in-polygon, for asserting what the light can reach.
  const inside = (poly: Array<{ x: number; y: number }>, x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };

  it("no wall in reach: undefined, so the pool stays an unclipped circle", () => {
    expect(glowReach(500, 300, 140, [])).toBeUndefined();
    expect(glowReach(500, 300, 140, [wall(0, 0, 1000, 0)])).toBeUndefined();
  });

  it("a wall between the light and the next room casts a shadow", () => {
    // Light above a horizontal wall; the wall spans well past the pool.
    const poly = glowReach(500, 300, 140, [wall(200, 360, 800, 360)])!;
    expect(poly).toBeDefined();
    expect(inside(poly, 500, 350)).toBe(true); // near side of the wall: lit
    expect(inside(poly, 500, 380)).toBe(false); // far side: shadow
    expect(inside(poly, 500, 200)).toBe(true); // away from the wall: untouched
  });

  it("light grazes past a wall's end instead of stopping at its angular span", () => {
    // Wall ends at x=560; past its end the light should keep going.
    const poly = glowReach(500, 300, 140, [wall(400, 360, 560, 360)])!;
    expect(inside(poly, 500, 380)).toBe(false); // behind the wall
    expect(inside(poly, 620, 380)).toBe(true); // around its end
  });

  it("a light in a closed room stays in the room", () => {
    const room = [
      wall(400, 200, 600, 200, "n"),
      wall(600, 200, 600, 400, "e"),
      wall(600, 400, 400, 400, "s"),
      wall(400, 400, 400, 200, "w"),
    ];
    const poly = glowReach(500, 300, 300, room)!;
    expect(inside(poly, 500, 300)).toBe(true);
    expect(inside(poly, 700, 300)).toBe(false);
    expect(inside(poly, 500, 500)).toBe(false);
    expect(inside(poly, 300, 300)).toBe(false);
  });

  it("the wall the lamp is mounted on does not black out its own pool", () => {
    // Wall within one wall thickness of the light: non-blocking.
    expect(glowReach(500, 300, 140, [wall(200, 302, 800, 302)])).toBeUndefined();
  });

  // Issue #123: a wedge of the pool went missing beside long walls. The sweep
  // only has vertices where it casts rays, and it cast them at the wall's
  // *declared* endpoints — far outside the swept region for an ordinary room
  // wall — so nothing sampled the angle where the boundary hands over from the
  // region's edge to the wall, and the chord across that gap cut the pool.
  describe("a long wall does not slice the pool (#123)", () => {
    const r = 140;
    // An ordinary room wall: 60 below the lamp and running well past the pool.
    const longWall = [wall(0, 360, 1000, 360)];

    it("lights the whole strip beside the wall, out to the radius", () => {
      const poly = glowReach(500, 300, r, longWall)!;
      // 5px above the wall — nothing between these and the lamp — stepping out
      // to the edge of the radius. Every one must be lit; before the fix the
      // last three were not.
      for (const dx of [0, 20, 40, 60, 80, 100, 120]) {
        const dist = Math.hypot(dx, 55);
        expect({ dx, dist: Math.round(dist), lit: inside(poly, 500 + dx, 355) }).toEqual({
          dx,
          dist: Math.round(dist),
          lit: true,
        });
      }
    });

    it("still blocks the far side, so the fix did not just delete the clipping", () => {
      const poly = glowReach(500, 300, r, longWall)!;
      expect(inside(poly, 500, 380)).toBe(false);
      expect(inside(poly, 560, 400)).toBe(false);
    });

    it("samples the angle where the wall enters the swept region", () => {
      const poly = glowReach(500, 300, r, longWall)!;
      const angles = poly.map((p) => (Math.atan2(p.y - 300, p.x - 500) * 180) / Math.PI);
      // The hand-over sits at atan2(60, 141.4) ≈ 23°, not at the declared
      // endpoint's atan2(60, 500) ≈ 6.8°.
      expect(angles.some((a) => Math.abs(a - 23.0) < 1)).toBe(true);
      expect(angles.some((a) => Math.abs(a - 6.8) < 1)).toBe(false);
    });

    it("leaves a wall that already fits inside the region alone", () => {
      // Short wall, both endpoints within the sweep: clipping is a no-op, so
      // the shadow it casts is unchanged.
      const short = [wall(480, 360, 520, 360)];
      const poly = glowReach(500, 300, r, short)!;
      expect(inside(poly, 500, 380)).toBe(false); // directly behind it
      expect(inside(poly, 600, 380)).toBe(true); // past its end
    });
  });
});

describe("styling hooks reach the DOM (issue #105)", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

  it("an area carries its config id, type class and bound entity", () => {
    const markup = flattenMarkup(
      renderArea({ id: "area_a5r5nwl", points: square, entity: "binary_sensor.smoke" } as never)
    );
    expect(markup).toContain('class="fp-area"');
    expect(markup).toContain("data-id=area_a5r5nwl");
    // Areas take an entity too (#107), so [data-entity=...] must reach them —
    // they are the case this issue was actually about.
    expect(markup).toContain("data-entity=binary_sensor.smoke");
  });

  it("every entity-bindable element answers the same [data-entity] selector", () => {
    const ent = "light.kitchen";
    const area = flattenMarkup(renderArea({ id: "a", points: square, entity: ent } as never));
    const furn = flattenMarkup(renderFurniture({ id: "f", type: "sofa", x: 0, y: 0, w: 10, h: 10, entity: ent } as never));
    const open = flattenMarkup(
      renderOpening({ id: "o", type: "door", x: 0, y: 0, length: 40, angle: 0, entity: ent } as never,
        { color: "#888", accent: "#0f0" } as never)
    );
    for (const m of [area, furn, open]) expect(m).toContain(`data-entity=${ent}`);
  });

  it("furniture carries its id, its type class and its entity", () => {
    const markup = flattenMarkup(
      renderFurniture({ id: "furn_3j66s50", type: "sofa", x: 0, y: 0, w: 10, h: 10, entity: "light.k" } as never)
    );
    expect(markup).toContain("fp-furniture fp-furniture-sofa");
    expect(markup).toContain("data-id=furn_3j66s50");
    expect(markup).toContain("data-entity=light.k");
  });

  it("an opening carries its id and door/window class", () => {
    const markup = flattenMarkup(
      renderOpening(
        { id: "door_1", type: "door", x: 0, y: 0, length: 40, angle: 0, entity: "binary_sensor.d" } as never,
        { color: "#888", accent: "#0f0" } as never
      )
    );
    expect(markup).toContain("fp-opening fp-opening-door");
    expect(markup).toContain("data-id=door_1");
    expect(markup).toContain("data-entity=binary_sensor.d");
  });

  it("hands Lit its omit sentinel, so the attribute is absent not \"undefined\"", () => {
    // A hand-written config need not carry ids, and data-id="undefined" would
    // be a hook that silently matches every element lacking one.
    //
    // Asserting on flattened markup cannot show this: String(nothing) is
    // "Symbol(lit-nothing)", so a `not.toContain("undefined")` check passes
    // without the attribute being omitted at all. Assert the slot itself is
    // Lit's `nothing` — that is the documented contract for removing an
    // attribute.
    const slotFor = (tpl: unknown, attr: string): unknown => {
      const { strings, values } = tpl as { strings: string[]; values: unknown[] };
      const i = strings.findIndex((s) => s.trimEnd().endsWith(`${attr}=`));
      expect(i, `no ${attr}= slot found`).toBeGreaterThanOrEqual(0);
      return values[i];
    };

    const area = renderArea({ points: square } as never);
    expect(slotFor(area, "data-id")).toBe(nothing);
    expect(slotFor(area, "data-entity")).toBe(nothing);

    const furn = renderFurniture({ type: "sofa", x: 0, y: 0, w: 10, h: 10 } as never);
    expect(slotFor(furn, "data-id")).toBe(nothing);
    expect(slotFor(furn, "data-entity")).toBe(nothing);

    // And the sentinel really is distinct from the failure it guards against.
    expect(nothing).not.toBe(undefined);
    expect(String(nothing)).not.toContain("undefined");
  });

  it("a hostile id stays one harmless token instead of a second class", () => {
    const markup = flattenMarkup(renderArea({ id: 'x" class="fp-wall', points: square } as never));
    // The class list is untouched, and the id collapses to a single token —
    // no quote to close the attribute, no space to start another class.
    expect(markup).toContain('class="fp-area"');
    const id = /data-id=(\S*)/.exec(markup)?.[1];
    expect(id).toBe("xclassfp-wall");
    expect(id).not.toMatch(/["'\s=]/);
  });
});

describe("renderGlowMask — furniture is dimmed, not blacked out (#108, #106)", () => {

  const twoPieces = () =>
    flattenMarkup(
      renderGlowMask(
        [
          { id: "s", type: "sofa", x: 300, y: 200, w: 100, h: 50, angle: 90 },
          { id: "t", type: "roundTable", x: 600, y: 300, w: 80, h: 80 },
        ] as never,
        1000,
        600,
        "gm"
      )
    );

  it("shades a rotated rect per furniture piece, ellipse for round types", () => {
    const markup = twoPieces();
    expect(markup).toContain("id=gm");
    expect(markup).toContain("rotate(90 300 200)");
    expect(markup).toContain("<ellipse");
    // Explicit region, not the viewport default (the issue #102 lesson).
    expect(markup).toContain("width=1016");
  });

  // The footprint comes off the symbol now (issue #90), not off a hard-coded
  // list of the three round built-ins — so a contributed round piece casts a
  // round shadow without anyone editing this file.
  it("takes a config symbol's own footprint, not just the built-in round ones", () => {
    const catalog = symbolCatalog({
      pouffe: { id: "pouffe", footprint: "ellipse", parts: [{ ellipse: [50, 50, 50, 50] }] },
      crate: { id: "crate", parts: [{ rect: [0, 0, 100, 100] }] },
    });
    const round = flattenMarkup(
      renderGlowMask([{ id: "p", type: "pouffe", x: 0, y: 0, w: 40, h: 40 }] as never,
        100, 100, "gm", catalog)
    );
    const square = flattenMarkup(
      renderGlowMask([{ id: "c", type: "crate", x: 0, y: 0, w: 40, h: 40 }] as never,
        100, 100, "gm", catalog)
    );
    expect(round).toContain("<ellipse");
    expect(square).not.toContain("<ellipse");
  });

  // This is the guard in *both* directions, and the reason the level is a
  // named constant. Each end of this dial has shipped as a bug: fully lit was
  // #108 (every sofa read as highlighted), fully dark was #106 (a lit table
  // came out as a shadow). Only a value strictly between the two is correct.
  it("blocks some of the light but not all of it", () => {
    const markup = twoPieces();
    expect(FURNITURE_GLOW_TRANSMISSION).toBeGreaterThan(0);
    expect(FURNITURE_GLOW_TRANSMISSION).toBeLessThan(1);
    // A solid black hole (a shadow) or no shape at all (a flood) would both
    // fail here: furniture must paint, and paint partially.
    const blocked = 1 - FURNITURE_GLOW_TRANSMISSION;
    expect(markup).toContain(`fill-opacity=${blocked}`);
    expect(markup).not.toContain('fill-opacity="1"');
    expect(markup).not.toContain('fill="black"');
  });

  it("clips the pool with the reach polygon only when walls are in range", () => {
    const item = { id: "i", entity: "light.x", kind: "light", x: 300, y: 200 } as never;
    const paint = { color: "#fff", opacity: 0.4, radius: DEFAULT_GLOW_RADIUS };
    const withWall = flattenMarkup(renderGlow(item, paint, "g1", [{ id: "w", x1: 0, y1: 260, x2: 1000, y2: 260 }]));
    expect(withWall).toContain("<clipPath");
    expect(withWall).toContain("clip-path=url(#g1-clip)");
    const noWall = flattenMarkup(renderGlow(item, paint, "g2", []));
    expect(noWall).not.toContain("<clipPath");
  });
});

describe("editorGlowPaint (issue #108)", () => {
  const light = (state: string, attributes: Record<string, unknown> = {}) =>
    ({ entity_id: "light.x", state, attributes }) as never;

  it("an OFF light draws nothing in the editor, exactly as on the card", () => {
    // The v1.1.0 regression: this returned a full-strength warm pool, so five
    // off living-room lamps washed the whole canvas amber.
    expect(editorGlowPaint({}, light("off"))).toBeUndefined();
    expect(editorGlowPaint({}, light("unavailable"))).toBeUndefined();
    expect(editorGlowPaint({}, light("unknown"))).toBeUndefined();
  });

  it("an ON light paints exactly what glowPaint says", () => {
    expect(editorGlowPaint({}, light("on", { rgb_color: [1, 2, 3], brightness: 255 })))
      .toEqual(glowPaint({}, light("on", { rgb_color: [1, 2, 3], brightness: 255 })));
  });

  it("only a glow with NO readable state previews lit (outside HA)", () => {
    expect(editorGlowPaint({}, undefined)).toEqual({
      color: DEFAULT_GLOW_COLOR,
      opacity: GLOW_MAX_OPACITY,
      // No state to read a brightness from: the configured size, unscaled.
      radius: DEFAULT_GLOW_RADIUS,
    });
    expect(editorGlowPaint({ glowRadius: 200 }, undefined)?.radius).toBe(200);
    expect(editorGlowPaint({ glowColor: "#00ff00" }, undefined)?.color).toBe("#00ff00");
  });
});

describe("renderGlow (issue #6)", () => {
  const item = (extra: Record<string, unknown> = {}) =>
    ({ id: "i", entity: "light.x", kind: "light", x: 300, y: 200, ...extra }) as never;

  it("centers the pool on the device and fades to nothing at the rim", () => {
    const markup = flattenMarkup(
      renderGlow(item(), { color: "rgb(1, 2, 3)", opacity: 0.5, radius: DEFAULT_GLOW_RADIUS }, "g1"),
    );
    expect(markup).toContain("cx=300");
    expect(markup).toContain("cy=200");
    expect(markup).toContain(`r=${DEFAULT_GLOW_RADIUS}`);
    // Opaque at the centre, transparent at the edge — that's the falloff.
    expect(markup).toContain('stop-opacity=0.5');
    expect(markup).toContain('stop-opacity="0"');
    expect(markup).toContain('fill=url(#g1)');
  });

  it("draws at the radius the paint carries, not the configured one (#123)", () => {
    // The size is brightness-scaled in glowPaint, so renderGlow must use what
    // it is handed — reading item.glowRadius here again would silently undo it.
    const markup = flattenMarkup(
      renderGlow(item({ glowRadius: 250 }), { color: "#fff", opacity: 0.4, radius: 137 }, "g"),
    );
    expect(markup).toContain("r=137");
    expect(markup).not.toContain("r=250");
  });

  it("carries the class the blend mode hangs off, or lights would not mix", () => {
    expect(
      flattenMarkup(renderGlow(item(), { color: "#fff", opacity: 0.4, radius: DEFAULT_GLOW_RADIUS }, "g")),
    ).toContain('class="fp-glow"');
  });
});

describe("itemHiddenWhenInactive (issue #55)", () => {
  it("hides only when asked to, and only while inactive", () => {
    expect(itemHiddenWhenInactive({ entity: "light.a", hideWhenInactive: true }, "off")).toBe(true);
    expect(itemHiddenWhenInactive({ entity: "light.a", hideWhenInactive: true }, "on")).toBe(false);
    // Off by default: an ordinary device always renders.
    expect(itemHiddenWhenInactive({ entity: "light.a" }, "off")).toBe(false);
  });

  it("uses the domain-aware active test, not a bare on/off", () => {
    // A lock is "active" when unlocked, a vacuum when cleaning — the same rule
    // the badge highlight uses, so hiding matches what the user sees elsewhere.
    expect(itemHiddenWhenInactive({ entity: "lock.front", hideWhenInactive: true }, "unlocked"))
      .toBe(false);
    expect(itemHiddenWhenInactive({ entity: "lock.front", hideWhenInactive: true }, "locked"))
      .toBe(true);
    expect(itemHiddenWhenInactive({ entity: "vacuum.r", hideWhenInactive: true }, "cleaning"))
      .toBe(false);
  });

  it("an outage or a missing entity counts as inactive (fails hidden)", () => {
    expect(itemHiddenWhenInactive({ entity: "light.a", hideWhenInactive: true }, "unavailable"))
      .toBe(true);
    expect(itemHiddenWhenInactive({ entity: "light.a", hideWhenInactive: true }, undefined))
      .toBe(true);
    expect(itemHiddenWhenInactive({ hideWhenInactive: true }, "on")).toBe(true);
  });
});
