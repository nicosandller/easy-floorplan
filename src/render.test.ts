import { describe, it, expect } from "vitest";
import { html, nothing } from "lit";
import type { Area, FloorText, Furniture, FurnitureType, ItemKind, ItemReading } from "./types";
import { SKIN_ACCENT, SKIN_WALL, MAX_SKIN_WALL_WIDTH } from "./skins";
import { MAX_AREA_ZOOM, DEFAULT_ZOOMED_OVERLAY_SCALE } from "./types";
import {
  DEFAULT_GLOW_RADIUS,
  DEFAULT_GLOW_COLOR,
  GLOW_MIN_OPACITY,
  GLOW_MAX_OPACITY,
  GLOW_MIN_RADIUS,
  DEFAULT_PRESS_EFFECT,
  DEFAULT_OFFLINE_STYLE,
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
  openingHasTwoLeaves,
  sliderStyleHasTwoLeaves,
  secondLeafOf,
  openingFromDeviceClass,
  openingSash,
  defaultSash,
  planDirection,
  sunBearingOf,
  openingAdmitsSun,
  sunReachesOpening,
  openingSunFraction,
  openingIsGlazed,
  sunBeamPolygon,
  sunLightDirection,
  sunlightStrength,
  sunlightStrengthOf,
  sunIsPinned,
  SUN_ELEVATION_FULL,
  sunShadowPolygon,
  SUN_REACH,
  SUN_REACH_REF,
  sunReachScale,
  DEFAULT_SUN_BEARING,
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
  hasOpeningMark,
  openingMarkIcon,
  openingMarkPoint,
  openingMarkNormal,
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
  furnitureFloorTarget,
  entityDefaultIcon,
  trackerSensorReading,
  renderTracker,
  openingInMotion,
  openingIsActive,
  areaActionForGesture,
  areaHasActions,
  entityStateText,
  itemStateText,
  itemBadgeLabel,
  textLabel,
  itemReadingText,
  itemReadings,
  badgeEntityIndex,
  itemHasLabel,
  labelPositionOf,
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
  offlineStyleOf,
  itemIsOffline,
  badgeValue,
  badgeReading,
  badgeValueSize,
  resolveIconAnimation,
  domainIconAnimation,
  isRippleEntity,
  itemIconSize,
  normalizePlanRotation,
  resolvePlanRotation,
  subscribeOrientation,
  rotatedCanvasSize,
  rotatePlanPoint,
  planRotationTransform,
  polygonCentroid,
  areaZoomTransform,
  resolveAreaZoom,
  zoomedOverlayScale,
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
  openingClearFraction,
  openingClearSpan,
  openingSashSpan,
  MIN_SASH_SPAN,
  glowClearSpan,
  glowClearFraction,
  renderGlowMask,
  renderOpening,
  renderGlow,
  renderRipple,
  checkHideCondition,
  itemBadgeHidden,
} from "./render";
import type { FloorplanCardConfig, Opening, RenderHass, Tracker } from "./types";
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

  it("invert flips the unbound picture, same as it flips a bound reading", () => {
    // A swing door normally draws open — inverted, and still unbound, it
    // draws shut.
    expect(openingDefaultOpen({ type: "door", invert: true } as Opening)).toBe(false);
    // A window normally draws shut — inverted, and still unbound, it draws
    // open, letting someone give an unbound window an "always open" look.
    expect(openingDefaultOpen({ type: "window", invert: true } as Opening)).toBe(true);
    // A slider/roll-up normally draws shut too, and inverts the same way.
    expect(openingDefaultOpen({ type: "door", motion: "slide", invert: true } as Opening)).toBe(true);
    // invert: false is the same as omitting it — no flip.
    expect(openingDefaultOpen({ type: "door", invert: false } as Opening)).toBe(true);
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
  it("carries the two-panel styles through (issue #145)", () => {
    for (const sliderStyle of ["biparting-bypass", "converging"] as const) {
      expect(sliderStyleOf({ type: "door", motion: "slide", sliderStyle } as Opening)).toBe(
        sliderStyle,
      );
    }
  });
});

describe("openingHasTwoLeaves / secondLeafOf (issue #145)", () => {
  const slider = (extra: Partial<Opening> = {}) =>
    ({ type: "door", motion: "slide", ...extra }) as Opening;

  it("is true for exactly the styles that move both panels", () => {
    for (const sliderStyle of ["biparting", "biparting-bypass", "converging"] as const) {
      expect(openingHasTwoLeaves(slider({ sliderStyle }))).toBe(true);
      expect(sliderStyleHasTwoLeaves(sliderStyle)).toBe(true);
    }
    // bypass moves one panel past a fixed one; single moves the only panel.
    expect(openingHasTwoLeaves(slider({ sliderStyle: "bypass" }))).toBe(false);
    expect(openingHasTwoLeaves(slider())).toBe(false);
    expect(sliderStyleHasTwoLeaves("bypass")).toBe(false);
    expect(sliderStyleHasTwoLeaves("single")).toBe(false);
    // A single-leaf swing door has no second leaf, whatever slider style is
    // left lying on it from an earlier motion.
    expect(openingHasTwoLeaves({ type: "door", sliderStyle: "biparting" } as Opening)).toBe(false);
  });

  it("is true for a hinged double, by each type's own default (issue #159)", () => {
    const swing = (extra: Partial<Opening> = {}) => ({ type: "window", ...extra }) as Opening;
    // A window opens with two casement sashes unless told otherwise…
    expect(openingHasTwoLeaves(swing())).toBe(true);
    expect(openingHasTwoLeaves(swing({ sash: "double" }))).toBe(true);
    expect(openingHasTwoLeaves(swing({ sash: "single" }))).toBe(false);
    // …a door with one leaf, unless it is a double (issue #168).
    expect(openingHasTwoLeaves(swing({ type: "door" }))).toBe(false);
    expect(openingHasTwoLeaves(swing({ type: "door", sash: "double" }))).toBe(true);
  });

  it("is false for a roll-up, whose curtain is one piece", () => {
    for (const type of ["door", "window"] as const) {
      expect(
        openingHasTwoLeaves({ type, motion: "roll", sash: "double" } as Opening)
      ).toBe(false);
    }
  });

  it("swaps in the second entity for a hinged double too", () => {
    const o = { type: "window", entity: "binary_sensor.left", secondaryEntity: "binary_sensor.right" } as Opening;
    expect(secondLeafOf(o).entity).toBe("binary_sensor.right");
    expect(resolveOpeningAmount(secondLeafOf(o), { state: "on" })).toBe(1);
  });

  it("swaps in the second entity and keeps everything else", () => {
    const o = slider({
      sliderStyle: "biparting",
      entity: "binary_sensor.left",
      secondaryEntity: "binary_sensor.right",
      invert: true,
      length: 90,
    });
    expect(secondLeafOf(o)).toEqual({ ...o, entity: "binary_sensor.right" });
  });

  it("resolves the second panel independently, sharing invert", () => {
    const o = slider({
      sliderStyle: "biparting",
      entity: "binary_sensor.left",
      secondaryEntity: "binary_sensor.right",
    });
    const panel = secondLeafOf(o);
    expect(resolveOpeningAmount(panel, { state: "on" })).toBe(1);
    expect(resolveOpeningAmount(panel, { state: "off" })).toBe(0);
    expect(openingIsActive(panel, { state: "on" })).toBe(true);
    expect(openingIsActive(panel, { state: "off" })).toBe(false);
    // Position-aware covers drive the panel partway, and invert flips it.
    expect(
      resolveOpeningAmount(panel, { state: "open", attributes: { current_position: 40 } }),
    ).toBeCloseTo(0.4);
    expect(
      resolveOpeningAmount(secondLeafOf({ ...o, invert: true }), {
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

  it("invert flips that fallback too, for an opening with no entity at all", () => {
    expect(resolveOpeningOpen({ type: "door", invert: true } as Opening, undefined)).toBe(false);
    expect(resolveOpeningOpen({ type: "window", invert: true } as Opening, undefined)).toBe(true);
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

  it("invert flips that default too, for an opening with no entity at all", () => {
    expect(resolveOpeningAmount({ type: "door", invert: true } as Opening, undefined)).toBe(0);
    expect(resolveOpeningAmount({ type: "window", invert: true } as Opening, undefined)).toBe(1);
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
  it("draws a paused media_player with its own glyph, not the playing one (issue #206 follow-up)", () => {
    // "paused" is active (entityIsActive says so too), so this is not the
    // off icon — but it should not be the same icon "playing" gets either.
    expect(entityDefaultIcon("media_player.tv", undefined, true, "paused")).toBe(
      "mdi:television-pause",
    );
    // "idle" is on with nothing loaded at all — its own glyph too, not
    // "playing" and not "paused".
    expect(entityDefaultIcon("media_player.tv", undefined, true, "idle")).toBe("mdi:television");
    // Every other active state keeps the plain play glyph.
    expect(entityDefaultIcon("media_player.tv", undefined, true, "playing")).toBe(
      "mdi:television-play",
    );
    expect(entityDefaultIcon("media_player.tv", undefined, true, "buffering")).toBe(
      "mdi:television-play",
    );
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

describe("entityDefaultIcon for climate and weather (issue #206)", () => {
  it("reads the HVAC mode, not just on/off — a running unit says which mode", () => {
    // Before: every mode fell through to the bare thermostat icon, since
    // climate had no entry in DOMAIN_STATE_ICONS at all.
    expect(entityDefaultIcon("climate.ac", undefined, true, "cool")).toBe("mdi:snowflake");
    expect(entityDefaultIcon("climate.ac", undefined, true, "heat")).toBe("mdi:fire");
    expect(entityDefaultIcon("climate.ac", undefined, true, "dry")).toBe("mdi:water-percent");
    expect(entityDefaultIcon("climate.ac", undefined, true, "fan_only")).toBe("mdi:fan");
    expect(entityDefaultIcon("climate.ac", undefined, true, "auto")).toBe("mdi:thermostat-auto");
    expect(entityDefaultIcon("climate.ac", undefined, true, "heat_cool")).toBe(
      "mdi:sun-snowflake-variant"
    );
    expect(entityDefaultIcon("climate.ac", undefined, false, "off")).toBe("mdi:power");
  });

  it("falls back to a plain on/off thermostat for a mode it doesn't recognise", () => {
    expect(entityDefaultIcon("climate.ac", undefined, true, "some_custom_mode")).toBe(
      "mdi:thermostat"
    );
    expect(entityDefaultIcon("climate.ac", undefined, false, "some_custom_mode")).toBe(
      "mdi:power"
    );
    // No state passed at all — same fallback, not a crash.
    expect(entityDefaultIcon("climate.ac", undefined, true)).toBe("mdi:thermostat");
  });

  it("reads the weather condition — before, a weather item drew a bare circle", () => {
    expect(entityDefaultIcon("weather.home", undefined, true, "sunny")).toBe("mdi:weather-sunny");
    expect(entityDefaultIcon("weather.home", undefined, true, "rainy")).toBe("mdi:weather-rainy");
    expect(entityDefaultIcon("weather.home", undefined, true, "partlycloudy")).toBe(
      "mdi:weather-partly-cloudy"
    );
    expect(entityDefaultIcon("weather.home", undefined, true, "clear-night")).toBe(
      "mdi:weather-night"
    );
    expect(entityDefaultIcon("weather.home", undefined, true, "lightning-rainy")).toBe(
      "mdi:weather-lightning-rainy"
    );
  });

  it("falls back to a generic cloud for a weather condition it doesn't recognise", () => {
    expect(entityDefaultIcon("weather.home", undefined, true, "a_new_condition")).toBe(
      "mdi:weather-cloudy"
    );
    expect(entityDefaultIcon("weather.home", undefined, true)).toBe("mdi:weather-cloudy");
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

describe("renderTracker label", () => {
  const base: Tracker = {
    id: "t1",
    x: 0,
    y: 0,
    w: 100,
    h: 100,
    xSensor: { entity: "sensor.x", min: 0, max: 100 },
    ySensor: { entity: "sensor.y", min: 0, max: 100 },
  };
  const opts = { editing: false, xReading: 50, yReading: 50 };

  it("renders the classic triangle without a label", () => {
    const out = flattenMarkup(renderTracker(base, opts));
    expect(out).toContain('<polygon class="tracker-dot"');
    expect(out).not.toContain("<text");
  });

  it("renders initials in the triangle's place when a label is set", () => {
    const out = flattenMarkup(renderTracker({ ...base, label: "FR" }, opts));
    expect(out).toContain('<text class="tracker-dot"');
    expect(out).toContain(">FR</text>");
    expect(out).not.toContain("<polygon");
    // Still a marker in the same group, so pulse / glide CSS keeps applying.
    expect(out).toContain('class="tracker-marker"');
  });

  it("treats a whitespace-only label as unset", () => {
    const out = flattenMarkup(renderTracker({ ...base, label: "  " }, opts));
    expect(out).toContain('<polygon class="tracker-dot"');
    expect(out).not.toContain("<text");
  });

  it("clamps a long label to three characters", () => {
    const out = flattenMarkup(renderTracker({ ...base, label: "Fridolin" }, opts));
    expect(out).toContain(">Fri</text>");
  });

  it("sizes the halo with the dot, so it neither thins out nor swallows the letters", () => {
    const small = flattenMarkup(renderTracker({ ...base, label: "FR", dotSize: 8 }, opts));
    const big = flattenMarkup(renderTracker({ ...base, label: "FR", dotSize: 40 }, opts));
    expect(small).toContain("stroke-width=1");
    expect(big).toContain("stroke-width=5");
  });

  it("counter-rotates the initials so they read level under plan and tracker rotation", () => {
    const flat = flattenMarkup(renderTracker({ ...base, label: "FR" }, opts));
    expect(flat).toContain('transform="rotate(0)"');
    const plan = flattenMarkup(renderTracker({ ...base, label: "FR" }, { ...opts, planRotation: 90 }));
    expect(plan).toContain('transform="rotate(-90)"');
    const both = flattenMarkup(
      renderTracker({ ...base, label: "FR", angle: 30 }, { ...opts, planRotation: 180 })
    );
    expect(both).toContain('transform="rotate(-210)"');
    // The triangle never needed this — it has no reading direction.
    expect(flattenMarkup(renderTracker(base, { ...opts, planRotation: 90 }))).not.toContain("rotate(-90)");
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
  it("renders the device's own state", () => {
    expect(itemStateText(livingArea(), { entity: TEMP })).toBe("17.9 °C");
  });

  it("renders an attribute of it when one is named (issue #70)", () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).battery = 84;
    expect(itemStateText(h, { entity: TEMP, attribute: "battery" })).toBe("84");
  });
});

// The legacy pair is a *spelling* of the first extra reading now (issue #180),
// not a mechanism of its own — so what matters is that a config written before
// that change still draws the same line.
describe("the legacy secondaryEntity pair, through the pool", () => {
  const sensor = (extra: Record<string, unknown> = {}) =>
    ({ entity: TEMP, kind: "sensor", ...extra }) as Parameters<typeof itemBadgeLabel>[1];

  it("still pairs a temperature entity with its humidity entity", () => {
    expect(itemBadgeLabel(livingArea(), sensor({ secondaryEntity: HUMIDITY }))).toBe(
      "17.9 °C · 49.3%",
    );
  });

  it("still renders the primary when the second entity is missing", () => {
    expect(itemBadgeLabel(livingArea(), sensor({ secondaryEntity: "sensor.gone" }))).toBe(
      "17.9 °C · —",
    );
  });

  it("is the first entry of the pool, ahead of any readings", () => {
    expect(
      itemReadings({ secondaryEntity: HUMIDITY, readings: [{ entity: TEMP }] }),
    ).toEqual([{ entity: HUMIDITY, attribute: undefined }, { entity: TEMP }]);
    expect(itemReadings({})).toEqual([]);
    expect(itemReadings({ readings: [{ entity: TEMP }] })).toEqual([{ entity: TEMP }]);
  });

  it("a lone secondaryAttribute still reads the device's own entity", () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).battery = 84;
    expect(itemBadgeLabel(h, sensor({ secondaryAttribute: "battery" }))).toBe("17.9 °C · 84");
    expect(itemReadings({ secondaryAttribute: "battery" })).toEqual([
      { entity: undefined, attribute: "battery" },
    ]);
  });

  it("mixes with readings, in written order", () => {
    expect(
      itemBadgeLabel(
        livingArea(),
        sensor({ secondaryEntity: HUMIDITY, readings: [{ entity: TEMP }] }),
      ),
    ).toBe("17.9 °C · 49.3% · 17.9 °C");
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

describe("more readings per device (issue #180)", () => {
  const named = () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).friendly_name = "Living Temp";
    return h;
  };

  it("appends each reading to the label line", () => {
    expect(
      itemBadgeLabel(named(), {
        entity: TEMP,
        kind: "sensor",
        readings: [{ entity: HUMIDITY }],
      }),
    ).toBe("17.9 °C · 49.3%");
  });

  it("takes as many as are configured, in order", () => {
    const h = named();
    expect(
      itemBadgeLabel(h, {
        entity: TEMP,
        kind: "sensor",
        showName: true,
        readings: [{ entity: HUMIDITY }, { entity: TEMP }],
      }),
    ).toBe("Living Temp · 17.9 °C · 49.3% · 17.9 °C");
  });

  it("shows readings even with the device's own state hidden", () => {
    // I-G-1-1's plug in discussion #173: on/off is already in the badge
    // colour, so the label is to carry the *other* numbers and not "on".
    expect(
      itemBadgeLabel(named(), {
        entity: TEMP,
        kind: "sensor",
        showState: false,
        readings: [{ entity: HUMIDITY }],
      }),
    ).toBe("49.3%");
    // …and with the name back on, the state is still the only thing missing.
    expect(
      itemBadgeLabel(named(), {
        entity: TEMP,
        kind: "sensor",
        showState: false,
        showName: true,
        readings: [{ entity: HUMIDITY }],
      }),
    ).toBe("Living Temp · 49.3%");
  });

  it("reads an attribute of the device's own entity when the row names none", () => {
    const h = named();
    (h.states[TEMP]!.attributes as Record<string, unknown>).battery = 84;
    expect(
      itemBadgeLabel(h, { entity: TEMP, kind: "sensor", readings: [{ attribute: "battery" }] }),
    ).toBe("17.9 °C · 84");
  });

  it("draws nothing for a row that names nothing — the editor's fresh row", () => {
    // "+" adds {} and the picker is filled in afterwards; a dash appearing on
    // the plan the moment you click it would be its own bug report.
    expect(itemBadgeLabel(named(), { entity: TEMP, kind: "sensor", readings: [{}] })).toBe(
      "17.9 °C",
    );
    expect(itemReadingText(named(), { entity: TEMP }, {})).toBe("");
  });

  it("a device with no entity of its own still shows a reading that names one", () => {
    expect(
      itemBadgeLabel(named(), { entity: "", kind: "light", readings: [{ entity: HUMIDITY }] }),
    ).toBe("49.3%");
    // …but an attribute row with nothing to read it off stays silent.
    expect(
      itemBadgeLabel(named(), { entity: "", kind: "light", readings: [{ attribute: "battery" }] }),
    ).toBe("");
  });

  it("leaves a device with no readings exactly as it was", () => {
    for (const readings of [undefined, []]) {
      expect(itemBadgeLabel(named(), { entity: TEMP, kind: "sensor", readings })).toBe("17.9 °C");
    }
  });

  it("still watches every reading's entity, or the line goes intermittent", () => {
    const got = collectWatchedEntities({
      items: [
        {
          id: "i",
          kind: "sensor",
          x: 0,
          y: 0,
          entity: TEMP,
          readings: [{ entity: HUMIDITY }, { attribute: "battery" }, {}],
        },
      ],
    } as unknown as FloorplanCardConfig);
    expect([...got].sort()).toEqual([TEMP, HUMIDITY].sort());
  });
});

describe("itemHasLabel / labelPositionOf (issue #180)", () => {
  it("knows a device labels itself from its readings alone", () => {
    // Both toggles off, so the historic test would have said "no label" and
    // hidden the size and position controls for a label that is on screen.
    expect(itemHasLabel({ kind: "light", readings: [{ entity: HUMIDITY }] })).toBe(true);
    expect(itemHasLabel({ kind: "light", showState: false, readings: [{ attribute: "b" }] })).toBe(
      true,
    );
    // A row that names nothing is not a label.
    expect(itemHasLabel({ kind: "light", readings: [{}] })).toBe(false);
    expect(itemHasLabel({ kind: "light" })).toBe(false);
  });

  it("keeps the historic answers for everything else", () => {
    expect(itemHasLabel({ kind: "sensor" })).toBe(true); // sensors show state
    expect(itemHasLabel({ kind: "sensor", showState: false })).toBe(false);
    expect(itemHasLabel({ kind: "light", showName: true })).toBe(true);
    expect(itemHasLabel({ kind: "light", showState: true })).toBe(true);
  });

  it("resolves the label position, defaulting to below", () => {
    expect(labelPositionOf({})).toBe("below");
    expect(labelPositionOf({ labelPosition: "below" })).toBe("below");
    expect(labelPositionOf({ labelPosition: "left" })).toBe("left");
    expect(labelPositionOf({ labelPosition: "right" })).toBe("right");
  });

  it("falls back to below on a junk value — it becomes a class name", () => {
    expect(labelPositionOf({ labelPosition: "above" as never })).toBe("below");
    expect(labelPositionOf({ labelPosition: "" as never })).toBe("below");
    expect(labelPositionOf({ labelPosition: 3 as never })).toBe("below");
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
  it("reads a missing mode as the pixels every older plan was laid out in", () => {
    // Canvas units are the better answer and new plans are *created* with them
    // (getStubConfig writes the key). Inferring them from silence is a
    // different thing entirely: it restyles every plan already in the field on
    // upgrade, which is what 1.5.0 did (issue #192). Silence means what it has
    // always meant.
    expect(normalizeOverlayScale("plan")).toBe("plan");
    expect(normalizeOverlayScale("fixed")).toBe("fixed");
    expect(normalizeOverlayScale(undefined)).toBe("fixed");
    expect(normalizeOverlayScale("PLAN")).toBe("fixed");
    expect(normalizeOverlayScale(1)).toBe("fixed");
    expect(normalizeOverlayScale("")).toBe("fixed");
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
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 0, 360, 3, "plan"))).toContain(
      "width:calc(80 * var(--fp-u, 1px))"
    );
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 0, 360, 3, "fixed"))).toContain("width:80px");
  });

  it("passes --fp-ripple-width and --fp-ripple-direction through to rendering", () => {
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 0, 180, 3, "plan"))).toContain(
      "--fp-ripple-width:180"
    );
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 0, 180, 3, "plan"))).toContain(
      "--fp-ripple-direction:0"
    );

    expect(flattenMarkup(renderRipple(true, "#fff", 80, 90, 180, 3, "plan"))).toContain(
      "--fp-ripple-width:180"
    );
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 90, 180, 3, "plan"))).toContain(
      "--fp-ripple-direction:90"
    );

    expect(flattenMarkup(renderRipple(true, "#fff", 80, 400, 400, 3, "plan"))).toContain(
      "--fp-ripple-width:360"
    );
    expect(flattenMarkup(renderRipple(true, "#fff", 80, 400, 400, 3, "plan"))).toContain(
      "--fp-ripple-direction:40"
    );
  });

  // Both values land in a `style` attribute, so they are exactly the kind of
  // config the adversarial suite exists for (css-safe.adversarial.test.ts):
  // "nothing accepted can break out of a style declaration".
  it("cannot be used to inject a style declaration", () => {
    const hostile = [
      "0; background:url(https://evil.example/x.png)",
      '0" onload="alert(1)',
      "0/*",
      "abc",
    ];
    for (const value of hostile) {
      const asDirection = flattenMarkup(
        renderRipple(true, "#fff", 80, value as unknown as number, 360, 3, "fixed")
      );
      expect(asDirection).toContain("--fp-ripple-direction:0");
      expect(asDirection).not.toContain("background");
      expect(asDirection).not.toContain("onload");

      const asWidth = flattenMarkup(
        renderRipple(true, "#fff", 80, 0, value as unknown as number, 3, "fixed")
      );
      expect(asWidth).toContain("--fp-ripple-width:360");
      expect(asWidth).not.toContain("background");
      expect(asWidth).not.toContain("onload");
    }
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
      // No rule matches (hvac_action is "idle", not "heating"): falls to the
      // entity's own default icon, which since issue #206 is heat's own icon
      // rather than the bare climate fallback.
      expect(resolveItemIcon(climate, { state: "heat", attributes: { hvac_action: "idle" } })).toBe(
        entityDefaultIcon("climate.hall", undefined, true, "heat")
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

  // Miss this and the second panel is not frozen but *intermittent*: it only
  // catches up when some other watched entity happens to move.
  it("collects an opening's second leaf and its shutter's (issues #145, #159)", () => {
    const got = collectWatchedEntities({
      openings: [
        {
          id: "o",
          type: "window",
          x: 0,
          y: 0,
          entity: "binary_sensor.left",
          secondaryEntity: "binary_sensor.right",
          shutterEntity: "binary_sensor.shutter_left",
          shutterSecondaryEntity: "binary_sensor.shutter_right",
        },
      ],
    } as unknown as FloorplanCardConfig);
    expect([...got].sort()).toEqual([
      "binary_sensor.left",
      "binary_sensor.right",
      "binary_sensor.shutter_left",
      "binary_sensor.shutter_right",
    ]);
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

  it("a climate entity is active in any HVAC mode but off (issue #206)", () => {
    // Its state *is* the mode — "cool", "heat", … — never the literal "on"
    // the generic test looks for, so every one of these used to read as off.
    for (const mode of ["auto", "cool", "dry", "fan_only", "heat", "heat_cool"]) {
      expect(entityIsActive("climate.ac", mode), mode).toBe(true);
    }
    expect(entityIsActive("climate.ac", "off")).toBe(false);
  });

  it("a media player is active whenever it isn't off, not only while playing (issue #206)", () => {
    // A paused or idle player is still switched on, just not mid-playback.
    for (const s of ["on", "idle", "playing", "paused", "buffering"]) {
      expect(entityIsActive("media_player.tv", s), s).toBe(true);
    }
    expect(entityIsActive("media_player.tv", "off")).toBe(false);
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

  it("a climate entity in fan_only always spins, whatever iconAnimation says (issue #206 follow-up)", () => {
    // Auto: no other climate mode gets a default animation, but fan_only
    // does — its own fan is what's running.
    expect(resolveIconAnimation({ entity: "climate.ac" }, "fan_only")).toBe("spin");
    expect(resolveIconAnimation({ entity: "climate.ac" }, "cool")).toBeUndefined();
    // Forced pulse: every other active mode pulses, but fan_only still spins
    // — the fan_only spin overrides the config rather than the other way
    // round.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "pulse" }, "fan_only"),
    ).toBe("spin");
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "pulse" }, "cool"),
    ).toBe("pulse");
    // Forced spin: no conflict, still spins.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "fan_only"),
    ).toBe("spin");
    // none is a decision to show no animation at all, and wins over even
    // fan_only's own spin.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "none" }, "fan_only"),
    ).toBeUndefined();
    // Off never animates, fan_only override or not.
    expect(resolveIconAnimation({ entity: "climate.ac" }, "off")).toBeUndefined();
  });

  it("a climate entity animates only while hvac_action says it is working (issue #235)", () => {
    // The reported case: an AC set to "cool" that has reached its setpoint
    // reports state "cool" with hvac_action "idle". The mode is a setting,
    // not moving air, so a spin there is a claim the unit is not making.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "cool", {
        hvac_action: "idle",
      }),
    ).toBeUndefined();
    // Same unit a minute later, actually cooling: the spin is true again.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "cool", {
        hvac_action: "cooling",
      }),
    ).toBe("spin");
    // Every other working action counts the same way.
    for (const action of ["heating", "drying", "fan", "preheating", "defrosting"]) {
      expect(
        resolveIconAnimation({ entity: "climate.ac", iconAnimation: "pulse" }, "heat", {
          hvac_action: action,
        }),
      ).toBe("pulse");
    }
    // "off" as an action is the same story as idle: nothing is running.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "cool", {
        hvac_action: "off",
      }),
    ).toBeUndefined();
    // fan_only's own spin is gated too — a stopped fan is not spinning
    // whatever the mode says — but still plays while the fan runs.
    expect(
      resolveIconAnimation({ entity: "climate.ac" }, "fan_only", { hvac_action: "idle" }),
    ).toBeUndefined();
    expect(
      resolveIconAnimation({ entity: "climate.ac" }, "fan_only", { hvac_action: "fan" }),
    ).toBe("spin");
    // An integration that reports no hvac_action at all keeps animating:
    // the attribute is optional, and going quiet on those would be a second
    // regression to fix the first.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "cool", {
        current_temperature: 20,
      }),
    ).toBe("spin");
    expect(resolveIconAnimation({ entity: "climate.ac" }, "fan_only", {})).toBe("spin");
    // The gate is climate-only: a fan entity has no hvac_action to consult,
    // and an unrelated domain that happens to carry one is not a thermostat.
    expect(
      resolveIconAnimation({ entity: "fan.ceiling" }, "on", { hvac_action: "idle" }),
    ).toBe("spin");
  });

  it("a forced spin plays for a climate entity running in any mode (issue #206)", () => {
    // The reported bug exactly: an AC in "cool" with iconAnimation: "spin"
    // read as off (entityIsActive didn't know "cool" from "off") and never
    // animated at all.
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "cool"),
    ).toBe("spin");
    expect(
      resolveIconAnimation({ entity: "climate.ac", iconAnimation: "spin" }, "off"),
    ).toBeUndefined();
  });

  it("never animates an inactive entity — including forced spin/pulse", () => {
    expect(resolveIconAnimation({ entity: "fan.ceiling" }, "off")).toBeUndefined();
    expect(
      resolveIconAnimation({ entity: "light.a", iconAnimation: "spin" }, "off"),
    ).toBeUndefined();
    // "paused" is active (issue #206) — a paused player is switched on, just
    // not mid-playback — so "off" is what proves this rather than "paused".
    expect(
      resolveIconAnimation({ entity: "media_player.tv", iconAnimation: "pulse" }, "off"),
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

describe("isRippleEntity (issue #127)", () => {
  it("accepts the binary-sensor classes that mean something happened here", () => {
    // vibration joins the presence classes: a door sensor that feels a knock
    // marks a spot the same way a motion sensor does (issue #202).
    for (const dc of ["motion", "occupancy", "presence", "vibration"]) {
      expect(isRippleEntity("binary_sensor.hall", dc)).toBe(true);
    }
  });

  it("accepts trackers and people on their domain alone", () => {
    expect(isRippleEntity("device_tracker.phone", undefined)).toBe(true);
    expect(isRippleEntity("person.sam", undefined)).toBe(true);
  });

  it("rejects sensors that detect something else, and an unclassed one", () => {
    expect(isRippleEntity("binary_sensor.front_door", "door")).toBe(false);
    expect(isRippleEntity("binary_sensor.leak", "moisture")).toBe(false);
    // No class at all could be anything — guessing from the name would ring
    // doorbells and smoke alarms.
    expect(isRippleEntity("binary_sensor.presence", undefined)).toBe(false);
  });

  it("rejects other domains, whatever class they carry", () => {
    expect(isRippleEntity("light.a", "motion")).toBe(false);
    expect(isRippleEntity("sensor.motion", "motion")).toBe(false);
    expect(isRippleEntity(undefined, "motion")).toBe(false);
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
      itemBadgeLabel(climate(), {
        entity: "climate.home",
        kind: "sensor",
        attribute: "current_temperature",
        secondaryAttribute: "current_humidity",
      } as Parameters<typeof itemBadgeLabel>[1]),
    ).toBe("21.5 · 45");
  });

  it("secondaryAttribute applies to secondaryEntity when both are set", () => {
    expect(
      itemBadgeLabel(climate(), {
        entity: "climate.home",
        kind: "sensor",
        secondaryEntity: TEMP,
        secondaryAttribute: "unit_of_measurement",
      } as Parameters<typeof itemBadgeLabel>[1]),
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

describe("offlineStyleOf / itemIsOffline (#162)", () => {
  const light = { entity: "light.ceiling" };

  it("defaults to dimming, and takes every mode the card has a rule for", () => {
    expect(offlineStyleOf({})).toBe(DEFAULT_OFFLINE_STYLE);
    expect(offlineStyleOf({})).toBe("dim");
    for (const v of ["dim", "strike", "none"] as const) {
      expect(offlineStyleOf({ offlineStyle: v })).toBe(v);
    }
  });

  it("falls back to the default rather than to nothing on a junk value", () => {
    // Same trap as pressEffectOf above: the value becomes a class name.
    expect(offlineStyleOf({ offlineStyle: "faded" as never })).toBe("dim");
    expect(offlineStyleOf({ offlineStyle: "" as never })).toBe("dim");
    expect(offlineStyleOf({ offlineStyle: 0 as never })).toBe("dim");
    expect(offlineStyleOf({ offlineStyle: "none" })).toBe("none");
  });

  it("calls a dropped-out entity offline, however it dropped out", () => {
    expect(itemIsOffline(light, "unavailable")).toBe(true);
    expect(itemIsOffline(light, "unknown")).toBe(true);
    // Not in hass at all — renamed, deleted, or an integration that failed to
    // load. Today that draws an ordinary "off" badge for something gone.
    expect(itemIsOffline(light, undefined)).toBe(true);
  });

  it("leaves a device that is merely off alone", () => {
    for (const state of ["off", "on", "closed", "docked", "locked", "0", "idle"]) {
      expect({ state, offline: itemIsOffline(light, state) }).toEqual({ state, offline: false });
    }
  });

  it("an unbound device is not offline — there is nothing to be wrong", () => {
    // The plain markers issue #39 added: no entity, so no outage either.
    expect(itemIsOffline({}, undefined)).toBe(false);
    expect(itemIsOffline({ entity: "" }, undefined)).toBe(false);
    expect(itemIsOffline({ entity: "" }, "unavailable")).toBe(false);
  });

  it("agrees with the active test: an offline device is never active", () => {
    for (const state of ["unavailable", "unknown"]) {
      expect(entityIsActive(light.entity, state)).toBe(false);
      expect(itemIsOffline(light, state)).toBe(true);
    }
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
      // `source` is the reading's *index* in the pool since issue #180 — the
      // legacy pair is index 0, which is where it always sat.
      expect(badgeReading(plug(), { entity: "switch.plug", secondaryEntity: "sensor.plug_power" }))
        .toEqual({ text: "1.2kW", source: 0 });
      expect(badgeReading(twoSensors(), { entity: "sensor.a", secondaryEntity: "sensor.b" }))
        .toEqual({ text: "21°", source: "primary" });
      // …and a reading further down the pool reports its own index.
      expect(
        badgeReading(plug(), {
          entity: "switch.plug",
          readings: [{ entity: "sensor.nothing" }, { entity: "sensor.plug_power" }],
        }),
      ).toEqual({ text: "1.2kW", source: 1 });
    });

    it("takes the legacy 'secondary' and a modern index to the same place (#180)", () => {
      const item = { entity: "sensor.a", secondaryEntity: "sensor.b" } as const;
      expect(badgeReading(twoSensors(), { ...item, badgeEntity: "secondary" })).toEqual(
        badgeReading(twoSensors(), { ...item, badgeEntity: 0 }),
      );
      expect(badgeEntityIndex("secondary")).toBe(0);
      expect(badgeEntityIndex("primary")).toBe("primary");
      expect(badgeEntityIndex(2)).toBe(2);
      // Nothing chosen, and nonsense, both mean "work it out".
      expect(badgeEntityIndex(undefined)).toBeUndefined();
      expect(badgeEntityIndex(-1 as never)).toBeUndefined();
      expect(badgeEntityIndex(1.5 as never)).toBeUndefined();
      expect(badgeEntityIndex("third" as never)).toBeUndefined();
    });

    it("an index past the end shows the icon rather than another reading", () => {
      // Naming a reading that no longer exists must not slide quietly onto a
      // different sensor — the badge falls back to its glyph instead.
      expect(
        badgeReading(plug(), {
          entity: "switch.plug",
          readings: [{ entity: "sensor.plug_power" }],
          badgeEntity: 7,
        }),
      ).toBeUndefined();
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

describe("openingSash (issues #73 / double doors)", () => {
  it("defaults per type: a window opens with two sashes, a door with one leaf", () => {
    expect(defaultSash("window")).toBe("double");
    expect(defaultSash("door")).toBe("single");
    expect(openingSash({ type: "window" } as Opening)).toBe("double");
    expect(openingSash({ type: "door" } as Opening)).toBe("single");
  });

  it("honours an explicit sash on both types", () => {
    expect(openingSash({ type: "window", sash: "single" } as Opening)).toBe("single");
    // The whole point: a door with two leaves used to be undrawable, because
    // `sash` was read for windows only.
    expect(openingSash({ type: "door", sash: "double" } as Opening)).toBe("double");
  });

  it("only hinged openings have leaves — a slider or roller reports its default", () => {
    expect(openingSash({ type: "window", motion: "slide", sash: "single" } as Opening)).toBe(
      "double",
    );
    expect(openingSash({ type: "door", motion: "roll", sash: "double" } as Opening)).toBe("single");
  });
});

describe("where the light comes from", () => {
  const cfg = (extra = {}) =>
    ({ type: "t", width: 1000, height: 1000, ...extra }) as FloorplanCardConfig;
  const near = (v: number, want: number) => expect(v).toBeCloseTo(want, 6);

  it("reads a bearing as a compass direction on the canvas", () => {
    // North is up the canvas until the plan says otherwise.
    near(planDirection(0).x, 0);
    near(planDirection(0).y, -1);
    near(planDirection(90).x, 1); // east, to the right
    near(planDirection(90).y, 0);
    near(planDirection(180).y, 1); // south, down
  });

  it("turns every bearing with the plan's own north", () => {
    // A plan drawn with north to the right: east then points down the canvas.
    near(planDirection(0, 90).x, 1);
    near(planDirection(90, 90).y, 1);
    // The whole reason north exists: the same house traced sideways must be
    // lit from the same side of the *house*.
    near(planDirection(135, 0).x, planDirection(45, 90).x);
    near(planDirection(135, 0).y, planDirection(45, 90).y);
  });

  it("prefers a stated sun angle, then the live one, then a default", () => {
    expect(sunBearingOf(cfg({ sunBearing: 200 }), 10)).toBe(200);
    expect(sunBearingOf(cfg(), 10)).toBe(10);
    expect(sunBearingOf(cfg(), "10.5")).toBe(10.5);
    // A dead or absent sun.sun must not leave the plan lit from nowhere.
    expect(sunBearingOf(cfg(), undefined)).toBe(DEFAULT_SUN_BEARING);
    expect(sunBearingOf(cfg(), "unavailable")).toBe(DEFAULT_SUN_BEARING);
    // 0 is a real bearing (due north), not a missing one.
    expect(sunBearingOf(cfg({ sunBearing: 0 }), 99)).toBe(0);
  });

});

describe("sunlight through the openings", () => {
  const win = (extra: Partial<Opening> = {}) =>
    ({ id: "o", type: "window", x: 100, y: 100, length: 40, angle: 0, ...extra }) as Opening;
  // Light travelling straight down the canvas (sun in the north).
  const down = { x: 0, y: 1 };

  it("glass admits light whether it is open or shut; a door only when open", () => {
    // The reason this cannot reuse the lamp rule: that one asks whether there
    // is a hole, and a shut window is not a hole — it is still transparent.
    expect(openingAdmitsSun({ type: "window" }, 0)).toBe(true);
    expect(openingAdmitsSun({ type: "window" }, 1)).toBe(true);
    expect(openingAdmitsSun({ type: "door" }, 0)).toBe(false);
    expect(openingAdmitsSun({ type: "door" }, 0.4)).toBe(true);
  });

  it("admits a fraction of its gap, not a yes or a no", () => {
    // A door open a crack is not a door standing open. Read as a boolean it
    // was: both the wall gap and the beam were then taken at full width, so
    // the crack threw the patch of a doorway wide open.
    expect(openingSunFraction({ type: "door" }, 0.25)).toBeCloseTo(0.25);
    expect(openingSunFraction({ type: "door" }, 1)).toBe(1);
    expect(openingSunFraction({ type: "door" }, 0)).toBe(0);
    // Glass admits its whole gap whatever its sash is doing — that is the one
    // rule that ignores the amount rather than scaling by it.
    expect(openingSunFraction({ type: "window" }, 0)).toBe(1);
    expect(openingSunFraction({ type: "window" }, 0.3)).toBe(1);
    expect(openingSunFraction({ type: "door", glazed: true }, 0)).toBe(1);
    // An opaque window is scaled like any other opaque thing (a glass brick,
    // a hatch).
    expect(openingSunFraction({ type: "window", glazed: false }, 0.4)).toBeCloseTo(0.4);
    // A shutter all the way down beats both.
    expect(openingSunFraction({ type: "window" }, 1, 0)).toBe(0);
    expect(openingSunFraction({ type: "door" }, 1, 0)).toBe(0);
    // …and out-of-range input cannot widen a gap past its own opening.
    expect(openingSunFraction({ type: "door" }, 4)).toBe(1);
    expect(openingSunFraction({ type: "door" }, -2)).toBe(0);
  });

  it("counts the gap a sliding style clears, not the distance a leaf travels", () => {
    // The composition the card performs: openingClearFraction first (both
    // leaves, per-style travel), then the glazing and shutter rules on top.
    // Without the first half a door whose *second* panel was open read as
    // shut and let nothing in — the #145 bug, in the sunlight this time.
    const conv = {
      id: "o", type: "door", x: 0, y: 0, length: 200, angle: 0,
      motion: "slide", sliderStyle: "converging",
    } as Opening;
    const sun = (a: number, b?: number) => openingSunFraction(conv, openingClearFraction(conv, a, b));
    expect(sun(0, 0)).toBe(0);
    expect(sun(0, 1)).toBeGreaterThan(0); // only the second leaf open: still light
    expect(sun(1, 0)).toBeCloseTo(sun(0, 1)); // and the two leaves are worth the same
    expect(sun(1, 1)).toBeCloseTo(0.5); // both leaves stack in the middle: half the gap
    // A raw amount would have called that same door shut.
    expect(openingSunFraction(conv, 0)).toBe(0);
  });

  it("a shutter that is all the way down stops the light, whatever the glass says", () => {
    // What a shutter is for. A window behind a closed one is as dark as a wall.
    expect(openingAdmitsSun({ type: "window" }, 0, 0)).toBe(false);
    expect(openingAdmitsSun({ type: "door", glazed: true }, 1, 0)).toBe(false);
    // Any daylight at all gets through — a shutter half up is not a wall.
    expect(openingAdmitsSun({ type: "window" }, 0, 0.2)).toBe(true);
    expect(openingAdmitsSun({ type: "window" }, 0, 1)).toBe(true);
    // No shutter bound is not the same as one that is shut.
    expect(openingAdmitsSun({ type: "window" }, 0, undefined)).toBe(true);
    // …and an opaque door stays opaque behind an open shutter.
    expect(openingAdmitsSun({ type: "door" }, 0, 1)).toBe(false);
  });

  it("a glazed door is glass too — which is what a patio door is", () => {
    // Drawn as a door because that is how it swings, but a wall of glass all
    // the same. Left opaque it kept the sunniest side of a house dark.
    expect(openingIsGlazed({ type: "window" })).toBe(true);
    expect(openingIsGlazed({ type: "door" })).toBe(false);
    expect(openingIsGlazed({ type: "door", glazed: true })).toBe(true);
    expect(openingAdmitsSun({ type: "door", glazed: true }, 0)).toBe(true);
    // …and a window can be told it is not, for a glass-brick or a hatch.
    expect(openingIsGlazed({ type: "window", glazed: false })).toBe(false);
    expect(openingAdmitsSun({ type: "window", glazed: false }, 0)).toBe(false);
    expect(openingAdmitsSun({ type: "window", glazed: false }, 1)).toBe(true);
  });

  it("sends the light the opposite way from where the sun stands", () => {
    // A bearing says where the sun *is*. Reading it as the direction of travel
    // lights the house from precisely the wrong side — with the sun in the
    // south-west, the beams came in through the north-east windows.
    const sw = sunLightDirection({ sunBearing: 230 });
    expect(sw.x).toBeGreaterThan(0); // travelling east…
    expect(sw.y).toBeLessThan(0); // …and north: toward the north-east
    // Due south sun → light straight up the canvas.
    const south = sunLightDirection({ sunBearing: 180 });
    expect(south.x).toBeCloseTo(0);
    expect(south.y).toBeCloseTo(-1);
    // Always the far side of the compass from the sun itself.
    for (const b of [0, 45, 137, 300]) {
      const d = sunLightDirection({ sunBearing: b });
      const at = planDirection(b);
      expect(d.x).toBeCloseTo(-at.x);
      expect(d.y).toBeCloseTo(-at.y);
    }
  });

  it("turns the light with the plan's north, like every other bearing", () => {
    const plain = sunLightDirection({ sunBearing: 90 });
    const turned = sunLightDirection({ sunBearing: 0, north: 90 });
    expect(turned.x).toBeCloseTo(plain.x);
    expect(turned.y).toBeCloseTo(plain.y);
  });

  it("sweeps the opening's gap along the light, and only forwards", () => {
    const p = sunBeamPolygon(win(), down, 200);
    expect(p).toHaveLength(4);
    // The gap itself: 40 wide, centred on the opening, along its own angle.
    expect(p[0]).toEqual({ x: 80, y: 100 });
    expect(p[1]).toEqual({ x: 120, y: 100 });
    // …then 200 further along the light, never against it.
    expect(p[2]).toEqual({ x: 120, y: 300 });
    expect(p[3]).toEqual({ x: 80, y: 300 });
  });

  it("narrows the patch to the part of the gap that is actually clear", () => {
    const o = win();
    const full = sunBeamPolygon(o, down, 200);
    const ajar = sunBeamPolygon(o, down, 200, 0.25);
    // Same centre, a quarter of the width: the gap is 40, so 10 across.
    expect(ajar[1].x - ajar[0].x).toBeCloseTo((full[1].x - full[0].x) * 0.25);
    expect((ajar[0].x + ajar[1].x) / 2).toBeCloseTo((full[0].x + full[1].x) / 2);
    // It still reaches just as far — a crack is narrower, not shorter.
    expect(ajar[3].y - ajar[0].y).toBeCloseTo(full[3].y - full[0].y);
    // The default is the whole gap, so every existing caller is unchanged.
    expect(sunBeamPolygon(o, down, 200, 1)).toEqual(full);
    expect(sunBeamPolygon(o, down, 200)).toEqual(full);
  });

  it("turns the patch with the opening it comes through", () => {
    const p = sunBeamPolygon(win({ angle: 90 }), down, 100);
    // A wall running north-south: the gap now spans in y, not x.
    expect(p[0].x).toBeCloseTo(100);
    expect(p[0].y).toBeCloseTo(80);
    expect(p[1].y).toBeCloseTo(120);
  });

  it("casts a wall's shadow as that wall, moved along the light", () => {
    // Exact for parallel rays — which is why the beams can be cut by these
    // rather than traced ray by ray.
    const w = { id: "w", x1: 0, y1: 50, x2: 100, y2: 50 };
    const p = sunShadowPolygon(w, down, 300);
    expect(p[0]).toEqual({ x: 0, y: 50 });
    expect(p[1]).toEqual({ x: 100, y: 50 });
    expect(p[2]).toEqual({ x: 100, y: 350 });
    expect(p[3]).toEqual({ x: 0, y: 350 });
  });

  it("a beam and the shadow of the wall it pierces run the same way", () => {
    // They are the same sweep of different segments, so a wall standing in a
    // beam cuts it cleanly instead of leaving a sliver.
    const dir = planDirection(135); // from the north-west, going south-east
    const beam = sunBeamPolygon(win(), dir, 100);
    const shadow = sunShadowPolygon({ id: "w", x1: 0, y1: 0, x2: 10, y2: 0 }, dir, 100);
    const along = (p: { x: number; y: number }[]) => ({
      x: p[3].x - p[0].x,
      y: p[3].y - p[0].y,
    });
    expect(along(beam).x).toBeCloseTo(along(shadow).x);
    expect(along(beam).y).toBeCloseTo(along(shadow).y);
  });

  it("has no light at all once the sun is down", () => {
    // The azimuth says where the light comes from; only the elevation says
    // whether there is any. Without it the plan kept its beams all night,
    // aimed at a sun that had set hours ago.
    expect(sunlightStrength(-0.5)).toBe(0);
    expect(sunlightStrength(-30)).toBe(0);
    expect(sunlightStrength(0)).toBe(0);
  });

  it("fades in over the first degrees, rather than switching on", () => {
    expect(sunlightStrength(SUN_ELEVATION_FULL)).toBe(1);
    expect(sunlightStrength(60)).toBe(1);
    const low = sunlightStrength(2);
    const mid = sunlightStrength(6);
    expect(low).toBeGreaterThan(0);
    expect(low).toBeLessThan(mid);
    expect(mid).toBeLessThan(1);
  });

  it("fails bright: an unreadable sun leaves the plan lit, not stuck at night", () => {
    // Same trap sunBrightness documents — Number(null), Number("") and
    // Number(false) are all 0, and 0 here means "exactly at the horizon".
    expect(sunlightStrength(undefined)).toBe(1);
    expect(sunlightStrength(null)).toBe(1);
    expect(sunlightStrength("")).toBe(1);
    expect(sunlightStrength(false)).toBe(1);
    expect(sunlightStrength("unavailable")).toBe(1);
    // …but a real number in a string is a real reading.
    expect(sunlightStrength("-10")).toBe(0);
    expect(sunlightStrength("40")).toBe(1);
  });

  it("a pinned angle keeps its light on, whatever the sky is doing", () => {
    // Stating a bearing is a decision about the picture, not a reading of the
    // sky: it says where the light goes and, by saying so, that it stays.
    // Fading it out at dusk would half-follow a sun the plan already declined
    // to follow, and leave it dark all evening with nothing on screen to say why.
    expect(sunIsPinned({ sunBearing: 225 })).toBe(true);
    expect(sunIsPinned({})).toBe(false);
    expect(sunlightStrengthOf({ sunBearing: 225 }, -40)).toBe(1);
    // Due north is a real bearing, so it pins just as firmly as any other.
    expect(sunlightStrengthOf({ sunBearing: 0 }, -40)).toBe(1);
    // Following the real sun still follows it all the way down.
    expect(sunlightStrengthOf({}, -40)).toBe(0);
    expect(sunlightStrengthOf({}, 50)).toBe(1);
  });

  it("only the openings the sun actually shines on are sources (#177 / #178)", () => {
    // The rule the two reports share. Trace back along the light: anything
    // with a wall between it and the sky is standing behind something, and a
    // thing standing behind something is not a second sun.
    const north = { id: "n", x1: 0, y1: 0, x2: 400, y2: 0 };
    const mid = { id: "m", x1: 0, y1: 150, x2: 400, y2: 150 };
    const onNorth = win({ x: 200, y: 0 });
    const inside = win({ x: 200, y: 150 });
    expect(sunReachesOpening(onNorth, [north, mid], down)).toBe(true);
    expect(sunReachesOpening(inside, [north, mid], down)).toBe(false);
    // Its own wall never shades it — the ray starts on that wall's centreline.
    expect(sunReachesOpening(onNorth, [north], down)).toBe(true);
    // …but only its own. A wall meeting that one at a corner passes within a
    // wall's thickness of an opening set close to it, and exempting it by
    // distance alone let that opening answer "the sun reaches me" to a sun the
    // return wall stood squarely in front of — the leeward leak again, in the
    // one place the shortcut applied.
    const west = { id: "we", x1: 0, y1: 0, x2: 0, y2: 300 };
    const byCorner = win({ x: 6, y: 0, length: 12 });
    expect(sunReachesOpening(byCorner, [north, west], { x: 0.6, y: -0.8 })).toBe(false);
    // Turn the sun around and the same opening is lit again: the corner wall
    // blocks it or it doesn't, on the geometry rather than on how near it is.
    expect(sunReachesOpening(byCorner, [north, west], { x: 0.6, y: 0.8 })).toBe(true);
    // Turn the sun around and the two swap places, which is the whole point:
    // the far side of the house is the shaded side.
    const up = { x: 0, y: -1 };
    expect(sunReachesOpening(onNorth, [north, mid], up)).toBe(false);
    expect(sunReachesOpening(inside, [north, mid], up)).toBe(true);
  });

  it("judges that on the uncut walls, so a lined-up doorway is not a second sun", () => {
    // The distinction the fix turns on. Light *does* reach a door lined up
    // with a window, and it does go through — the beam carries on, because
    // that wall's shadow has the same gap cut in it. What it must not do is
    // re-emit at its own width: a 20-wide sliver came out of a 120-wide door
    // as a 120-wide flood (#178).
    const north = { id: "n", x1: 0, y1: 0, x2: 400, y2: 0 };
    const mid = { id: "m", x1: 0, y1: 150, x2: 400, y2: 150 };
    const window = win({ x: 200, y: 0, length: 20 });
    const door = win({ id: "d", type: "door", x: 200, y: 150, length: 120 });
    // The gap really is there once the doorway is open…
    const cut = wallsLightPassesThrough([north, mid], [window, door], () => 1);
    expect(cut.some((w) => w.id.startsWith("m#"))).toBe(true);
    // …and the door still is not a source.
    expect(sunReachesOpening(door, [north, mid], down)).toBe(false);
  });

  it("an opening can be switched out of the sunlight entirely (#177)", () => {
    // For the solid front door the plan draws open because nothing is bound to
    // it. Beats every other rule, including the glass a window is by default.
    expect(openingSunFraction({ type: "door", sunlight: false }, 1)).toBe(0);
    expect(openingSunFraction({ type: "window", sunlight: false }, 1)).toBe(0);
    expect(openingSunFraction({ type: "door", glazed: true, sunlight: false }, 1)).toBe(0);
    expect(openingAdmitsSun({ type: "door", sunlight: false }, 1)).toBe(false);
    // Absent and true both mean what they always meant, so nothing existing moves.
    expect(openingSunFraction({ type: "door", sunlight: true }, 1)).toBe(1);
    expect(openingSunFraction({ type: "door" }, 1)).toBe(1);
  });

  it("reaches across a fair part of the plan, but not forever", () => {
    expect(SUN_REACH).toBeGreaterThan(0);
    expect(SUN_REACH).toBeLessThanOrEqual(1);
  });

  it("stops well short of crossing the plan (issue #185)", () => {
    // The complaint was a stripe that ran the length of the house at the
    // brightness it started with. Half the plan's short side is the point at
    // which a patch stops reading as a patch and starts reading as a corridor.
    expect(SUN_REACH).toBeLessThan(0.5);
  });

  it("sweeps the gap straight along the light, at the gap's own width", () => {
    // No fan. An earlier attempt widened the beam as it travelled, to imitate
    // scattering; the wall segments either side of the gap cast shadows
    // exactly parallel to the beam, so the extra width was clipped away every
    // time. Softness comes from the falloff now, which nothing can clip.
    const o = win();
    const p = sunBeamPolygon(o, down, 200, 1);
    const width = (i: number, j: number) => Math.abs(p[j]!.x - p[i]!.x);
    expect(width(0, 1)).toBeCloseTo(width(3, 2));
    expect(width(0, 1)).toBeCloseTo(o.length);
  });

  it("shortens the patch as the sun climbs, and lengthens it at dusk", () => {
    // A patch of sun is as deep as the opening is tall over tan(elevation) —
    // which is why a midday sun does not lay a stripe across the house.
    expect(sunReachScale(SUN_REACH_REF)).toBeCloseTo(1);
    expect(sunReachScale(60)).toBeLessThan(1);
    expect(sunReachScale(15)).toBeGreaterThan(1);
    expect(sunReachScale(60)).toBeLessThan(sunReachScale(45));
    expect(sunReachScale(45)).toBeLessThan(sunReachScale(20));
  });

  it("clamps the reach scale at both ends", () => {
    // Near the horizon tan runs away and would throw a beam of unbounded
    // length; near the zenith it collapses and the patch would vanish at noon.
    expect(sunReachScale(0.2)).toBeLessThanOrEqual(1.9);
    expect(sunReachScale(89.9)).toBeGreaterThanOrEqual(0.45);
    for (const e of [0.1, 1, 5, 30, 60, 89, 90]) {
      expect(sunReachScale(e)).toBeGreaterThan(0);
      expect(Number.isFinite(sunReachScale(e))).toBe(true);
    }
  });

  it("falls back to the plain reach on an unreadable sun", () => {
    // Same allowlist and the same fail-ordinary rule as sunlightStrength.
    for (const dead of [undefined, null, "", false, "unavailable", NaN]) {
      expect(sunReachScale(dead)).toBe(1);
    }
    expect(sunReachScale("45")).toBeCloseTo(sunReachScale(45));
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

describe("the opening's own badge (issue #154 follow-up)", () => {
  const win = (extra: Partial<Opening> = {}) =>
    ({ id: "o", type: "window", x: 500, y: 100, length: 90, angle: 0, ...extra }) as Opening;
  const garage = (extra: Partial<Opening> = {}) =>
    ({
      id: "g",
      type: "door",
      motion: "roll",
      x: 500,
      y: 100,
      length: 140,
      angle: 0,
      ...extra,
    }) as Opening;

  it("is opt-in, unlike the shutter's — most symbols say it themselves", () => {
    expect(hasOpeningMark(garage({ entity: "cover.garage" }))).toBe(false);
    expect(hasOpeningMark(garage({ entity: "cover.garage", showIcon: true }))).toBe(true);
    // Nothing to badge without an entity, however loudly the config asks.
    expect(hasOpeningMark(garage({ showIcon: true }))).toBe(false);
  });

  it("sits on the far side of the wall from the shutter's, so the two never stack", () => {
    // The whole point of the placement: an opening drawing both badges puts
    // one on each face, at any angle and under any flipV.
    const both = win({ entity: "binary_sensor.win", shutterEntity: "cover.t", showIcon: true });
    expect(openingMarkPoint(both)).toEqual({ x: 500, y: 100 - SHUTTER_MARK_OFFSET });
    expect(shutterMarkPoint(both)).toEqual({ x: 500, y: 100 + SHUTTER_MARK_OFFSET });
    for (const o of [
      both,
      win({ ...both, flipV: true }),
      win({ ...both, angle: -90 }),
      win({ ...both, angle: 37, flipV: true }),
    ]) {
      const a = openingMarkPoint(o);
      const b = shutterMarkPoint(o);
      // Two badge-widths apart is the test that matters: they are circles.
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(SHUTTER_MARK_OFFSET * 2);
    }
  });

  it("pushes its pixel offset the same way its anchor went", () => {
    for (const o of [win(), win({ flipV: true }), win({ angle: -90 }), win({ angle: 37 })]) {
      const at = openingMarkPoint(o);
      const n = openingMarkNormal(o);
      expect(Math.sign(at.x - o.x) || 0).toBe(Math.sign(Number(n.x.toFixed(6))) || 0);
      expect(Math.sign(at.y - o.y) || 0).toBe(Math.sign(Number(n.y.toFixed(6))) || 0);
    }
    // …and away from the shutter's, in screen space as well as plan space.
    const n = openingMarkNormal(win());
    const s = shutterMarkNormal(win());
    expect(n.x).toBeCloseTo(-s.x);
    expect(n.y).toBeCloseTo(-s.y);
    // Rotating the plan turns both together (issue #33).
    expect(openingMarkNormal(win(), 90).x).toBeCloseTo(1);
  });

  it("shows the entity's own icon, state-aware, on the shutter badge's terms", () => {
    const g = { type: "door", entity: "cover.garage" } as Pick<Opening, "type" | "entity" | "icon">;
    const st = (state: string) => ({ state, attributes: { device_class: "garage" } });
    expect(openingMarkIcon(g, st("open"), true)).toBe("mdi:garage-open");
    expect(openingMarkIcon(g, st("closed"), false)).toBe("mdi:garage");
    // Override, registry, then the icon on the state — same order as always.
    expect(openingMarkIcon({ ...g, icon: "mdi:mine" }, st("open"), true, "mdi:reg")).toBe("mdi:mine");
    expect(openingMarkIcon(g, st("open"), true, "mdi:reg")).toBe("mdi:reg");
  });

  it("falls back to a door or a window when the entity declares no class", () => {
    // A bare contact has no pair of its own, and the symbol it decorates does.
    expect(openingMarkIcon({ type: "door", entity: "binary_sensor.d" }, undefined, true)).toBe(
      "mdi:door-open"
    );
    expect(openingMarkIcon({ type: "door", entity: "binary_sensor.d" }, undefined, false)).toBe(
      "mdi:door-closed"
    );
    expect(openingMarkIcon({ type: "window", entity: "binary_sensor.w" }, undefined, true)).toBe(
      "mdi:window-open"
    );
    expect(openingMarkIcon({ type: "window", entity: "binary_sensor.w" }, undefined, false)).toBe(
      "mdi:window-closed"
    );
  });

  it("refuses an icon string that isn't one, at every level", () => {
    const nasty = { state: "open", attributes: { icon: "mdi:x;background:url(//evil)" } };
    const o = { type: "window", entity: "cover.w", icon: "mdi:evil;}" } as Pick<
      Opening,
      "type" | "entity" | "icon"
    >;
    expect(openingMarkIcon(o, nasty, true, "mdi:y;}")).toBe("mdi:window-open");
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

/**
 * Review on #151: the openings loop took `entity` and `shutterEntity` and not
 * `secondaryEntity`, so a plan never re-rendered when only the *second* panel's
 * contact moved — the headline case of #145, silently not working.
 *
 * The failure was worse than a frozen panel: any other watched entity moving
 * dragged a render along with it and the panel caught up, so it looked
 * intermittent. Both halves are asserted below, because set membership alone
 * would not have caught it — `hassRenderInputsChanged` compares state objects
 * by identity, which is the thing that actually decides whether a render runs.
 */
describe("collectWatchedEntities includes a slider's second panel (issue #145)", () => {
  const twoPanelPlan = (secondaryEntity?: string) =>
    ({
      type: "t", width: 1000, height: 600,
      floors: [{ id: "f", name: "F", walls: [], items: [], texts: [], furniture: [], trackers: [],
        openings: [{ id: "o", type: "window", x: 0, y: 0, length: 200, angle: 0,
          motion: "slide", sliderStyle: "converging",
          entity: "binary_sensor.left", ...(secondaryEntity ? { secondaryEntity } : {}) }] }],
    }) as unknown as FloorplanCardConfig;

  it("watches both leaves' sensors", () => {
    const ids = collectWatchedEntities(twoPanelPlan("binary_sensor.right"));
    expect(ids.has("binary_sensor.left")).toBe(true);
    expect(ids.has("binary_sensor.right")).toBe(true);
  });

  it("adds nothing when the opening has only one sensor", () => {
    expect(collectWatchedEntities(twoPanelPlan()).size).toBe(1);
  });

  // The assertion that actually pins the bug: HA hands over a fresh state
  // object for what changed and carries the rest across by identity, so a
  // render only happens if the *second* sensor's id is in the watched set.
  it("re-renders when only the second panel's sensor changes", () => {
    const watched = collectWatchedEntities(twoPanelPlan("binary_sensor.right"));
    const left = { state: "off" };
    const prev = {
      states: { "binary_sensor.left": left, "binary_sensor.right": { state: "off" } },
    } as unknown as RenderHass;
    const next = {
      // Same object for the left sensor — nothing about it moved.
      states: { "binary_sensor.left": left, "binary_sensor.right": { state: "on" } },
    } as unknown as RenderHass;
    expect(hassRenderInputsChanged(prev, next, watched)).toBe(true);
  });

  it("still skips a tick where neither leaf moved", () => {
    const watched = collectWatchedEntities(twoPanelPlan("binary_sensor.right"));
    const states = { "binary_sensor.left": { state: "off" }, "binary_sensor.right": { state: "off" } };
    expect(
      hassRenderInputsChanged(
        { states } as unknown as RenderHass,
        { states } as unknown as RenderHass,
        watched
      )
    ).toBe(false);
  });
});

describe("collectWatchedEntities watches the sun the sunlight actually reads", () => {
  const plan = (extra: Record<string, unknown>) =>
    ({
      type: "t", width: 1000, height: 600,
      floors: [{ id: "f", name: "F", walls: [], items: [], texts: [], furniture: [],
        trackers: [], openings: [] }],
      ...extra,
    }) as unknown as FloorplanCardConfig;

  it("subscribes when the sunlight follows the real sun", () => {
    // The whole feature reads sun.sun — azimuth for the direction, elevation
    // for whether there is any light — and sunDimming is a separate opt-in,
    // so this is the ordinary case rather than an exotic one.
    expect(collectWatchedEntities(plan({ sunlight: true })).has("sun.sun")).toBe(true);
  });

  it("does not subscribe for a pinned bearing, which reads neither attribute", () => {
    // sunBearingOf short-circuits on the config and sunlightStrengthOf returns
    // 1, so there is nothing on sun.sun left to watch.
    expect(
      collectWatchedEntities(plan({ sunlight: true, sunBearing: 135 })).has("sun.sun")
    ).toBe(false);
    // …unless the dimming is also on, which reads the elevation regardless.
    expect(
      collectWatchedEntities(plan({ sunlight: true, sunBearing: 135, sunDimming: true })).has("sun.sun")
    ).toBe(true);
  });

  it("leaves a plan without sunlight exactly as it was", () => {
    expect(collectWatchedEntities(plan({})).has("sun.sun")).toBe(false);
    expect(collectWatchedEntities(plan({ sunDimming: true })).has("sun.sun")).toBe(true);
  });

  // The assertion that pins the bug, in the same shape as #145's above: HA
  // carries unchanged entities across by identity, so the beams only move if
  // sun.sun is in the watched set. Without it the plan is painted once and
  // then frozen at whatever the sun was doing when the card loaded.
  it("re-renders as the sun moves across the sky", () => {
    const watched = collectWatchedEntities(plan({ sunlight: true }));
    const lamp = { state: "on" };
    const morning = {
      states: {
        "sun.sun": { state: "above_horizon", attributes: { azimuth: 100, elevation: 30 } },
        "light.a": lamp,
      },
    } as unknown as RenderHass;
    const noon = {
      states: {
        // Same object for the lamp — only the sun moved.
        "sun.sun": { state: "above_horizon", attributes: { azimuth: 180, elevation: 60 } },
        "light.a": lamp,
      },
    } as unknown as RenderHass;
    expect(hassRenderInputsChanged(morning, noon, watched)).toBe(true);
    // And the picture really would have changed, so the re-render is earned.
    expect(sunLightDirection({ sunlight: true } as FloorplanCardConfig, 100)).not.toEqual(
      sunLightDirection({ sunlight: true } as FloorplanCardConfig, 180)
    );
  });
});

describe("a dead sun.sun falls back rather than pointing north", () => {
  const cfg = (extra = {}) =>
    ({ type: "t", width: 1000, height: 1000, ...extra }) as FloorplanCardConfig;
  // The elevation had this guard from the start; the azimuth did not, and its
  // failure is the quieter one: Number(null) is 0, 0 is due north, and a plan
  // lit from the wrong side looks entirely deliberate.
  it("takes the default bearing for anything that is not a reading", () => {
    for (const dead of [undefined, null, "", "   ", false, "unavailable", "unknown", NaN, {}]) {
      expect(sunBearingOf(cfg(), dead)).toBe(DEFAULT_SUN_BEARING);
    }
  });

  it("still takes a real reading, including the ones that look falsy", () => {
    expect(sunBearingOf(cfg(), 0)).toBe(0); // due north, an actual bearing
    expect(sunBearingOf(cfg(), "0")).toBe(0);
    expect(sunBearingOf(cfg(), 212.5)).toBe(212.5);
    expect(sunBearingOf(cfg(), "212.5")).toBe(212.5);
  });

  it("and the two attributes now fail the same way as each other", () => {
    for (const dead of [null, "", false, "unavailable"]) {
      expect(sunBearingOf(cfg(), dead)).toBe(DEFAULT_SUN_BEARING);
      expect(sunlightStrength(dead)).toBe(1);
    }
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

describe("rotation that follows the screen (issue #237)", () => {
  it("uses `rotation` for both orientations until an override says otherwise", () => {
    const c = { rotation: 270 } as FloorplanCardConfig;
    expect(resolvePlanRotation(c, true)).toBe(270);
    expect(resolvePlanRotation(c, false)).toBe(270);
  });

  it("takes the override for the orientation it names, and only that one", () => {
    const c = { rotation: 0, rotationPortrait: 270 } as FloorplanCardConfig;
    expect(resolvePlanRotation(c, true)).toBe(270);
    expect(resolvePlanRotation(c, false)).toBe(0); // landscape keeps the base
    const both = { rotation: 0, rotationPortrait: 270, rotationLandscape: 90 } as FloorplanCardConfig;
    expect(resolvePlanRotation(both, true)).toBe(270);
    expect(resolvePlanRotation(both, false)).toBe(90);
  });

  it("honours an override of 0 rather than reading it as unset", () => {
    // "0° on a portrait screen" is a real instruction on a plan that is
    // otherwise rotated — the case the reporter is in.
    const c = { rotation: 270, rotationPortrait: 0 } as FloorplanCardConfig;
    expect(resolvePlanRotation(c, true)).toBe(0);
    expect(resolvePlanRotation(c, false)).toBe(270);
  });

  it("stays on the base rotation when the orientation is unknown", () => {
    // No window to ask. Guessing would rotate the plan on a wrong guess.
    const c = { rotation: 90, rotationPortrait: 180 } as FloorplanCardConfig;
    expect(resolvePlanRotation(c, undefined)).toBe(90);
  });

  it("reads an empty YAML override as unset, not as 0° (review of #237)", () => {
    // `rotationPortrait:` with nothing after it parses to null, and the card's
    // numeric guard lets nullish through. Read as a value it normalizes to 0
    // and silently cancels the base rotation — the one thing an unset
    // override must never do.
    const c = { rotation: 270, rotationPortrait: null } as unknown as FloorplanCardConfig;
    expect(resolvePlanRotation(c, true)).toBe(270);
    expect(resolvePlanRotation(c, false)).toBe(270);
    const l = { rotation: 90, rotationLandscape: null } as unknown as FloorplanCardConfig;
    expect(resolvePlanRotation(l, false)).toBe(90);
    // An explicit 0 is still an explicit 0 — that distinction is the point.
    expect(resolvePlanRotation({ rotation: 270, rotationPortrait: 0 } as FloorplanCardConfig, true)).toBe(0);
  });

  it("normalizes an override the same way `rotation` is normalized", () => {
    expect(resolvePlanRotation({ rotationPortrait: 450 } as FloorplanCardConfig, true)).toBe(90);
    expect(resolvePlanRotation({ rotationPortrait: -90 } as FloorplanCardConfig, true)).toBe(270);
    expect(resolvePlanRotation({ rotationPortrait: 45 } as FloorplanCardConfig, true)).toBe(0);
  });

  it("a config with no rotation at all is unaffected, whatever the screen", () => {
    expect(resolvePlanRotation({} as FloorplanCardConfig, true)).toBe(0);
    expect(resolvePlanRotation({} as FloorplanCardConfig, false)).toBe(0);
    expect(resolvePlanRotation({} as FloorplanCardConfig, undefined)).toBe(0);
  });
});

describe("subscribing to the screen's orientation (review of #237)", () => {
  // MediaQueryList only became an EventTarget in Safari 14 / Chrome 39, and
  // the devices this feature is for — wall tablets, old phones — are the ones
  // most likely to predate that. Calling a missing method would throw out of
  // connectedCallback and take the card's whole render with it.
  const fn = () => {};

  it("uses the modern API when it is there, and unsubscribes through it", () => {
    const calls: string[] = [];
    const q = {
      addEventListener: (t: string) => calls.push(`add:${t}`),
      removeEventListener: (t: string) => calls.push(`remove:${t}`),
      // Present too, as on any current browser — and must not be the one used.
      addListener: () => calls.push("legacy-add"),
      removeListener: () => calls.push("legacy-remove"),
    };
    subscribeOrientation(q, fn)();
    expect(calls).toEqual(["add:change", "remove:change"]);
  });

  it("falls back to addListener where that is all there is", () => {
    const calls: string[] = [];
    const q = {
      addListener: () => calls.push("add"),
      removeListener: () => calls.push("remove"),
    };
    subscribeOrientation(q, fn)();
    expect(calls).toEqual(["add", "remove"]);
  });

  it("never crosses the two — a legacy listener is removed the legacy way", () => {
    // Crossing them leaves the listener attached to a card that is gone.
    const seen: string[] = [];
    const q = {
      addListener: () => seen.push("add"),
      removeListener: () => seen.push("remove"),
      removeEventListener: () => seen.push("WRONG"),
    };
    subscribeOrientation(q, fn)();
    expect(seen).not.toContain("WRONG");
  });

  it("subscribes to nothing, quietly, when neither API exists", () => {
    // The card reads the query before subscribing, so this case still renders
    // at the right rotation — it just stops following the device being turned.
    expect(() => subscribeOrientation({}, fn)()).not.toThrow();
  });

  it("hands the listener straight through, so it is the one removed", () => {
    let held: unknown;
    const q = {
      addEventListener: (_t: string, f: unknown) => { held = f; },
      removeEventListener: (_t: string, f: unknown) => { expect(f).toBe(held); },
    };
    subscribeOrientation(q, fn)();
    expect(held).toBe(fn);
  });
});

describe("a room's own zoom level (issue #222)", () => {
  // A 10x10 room in the middle of a 100x100 canvas: fits at the 4x cap, so
  // every difference below is the explicit scale rather than the fit.
  const room = [{ x: 45, y: 45 }, { x: 55, y: 45 }, { x: 55, y: 55 }, { x: 45, y: 55 }];

  it("uses the room's scale instead of the fit, and still centres it", () => {
    const t = areaZoomTransform(room, 100, 100, 0, undefined, undefined, 7);
    expect(t.scale).toBe(7);
    // Centre stays the centre — this sets how close, not where.
    expect(t.txPercent).toBeCloseTo(50 - 7 * 0.5 * 100);
    expect(t.tyPercent).toBeCloseTo(50 - 7 * 0.5 * 100);
  });

  it("can ask for less than the fit as well as more", () => {
    // The long-thin-room case in reverse: the fit is not always too far out.
    expect(areaZoomTransform(room, 100, 100, 0, undefined, undefined, 1.5).scale).toBe(1.5);
  });

  it("falls back to the fit when the room has no zoom of its own", () => {
    expect(areaZoomTransform(room, 100, 100, 0, undefined, undefined, undefined)).toEqual(
      areaZoomTransform(room, 100, 100, 0),
    );
  });

  it("resolves and clamps what a config may hold", () => {
    expect(resolveAreaZoom({ zoom: 6 })).toBe(6);
    expect(resolveAreaZoom({ zoom: 99 })).toBe(MAX_AREA_ZOOM);
    // Below 1 would zoom out past the whole plan; that is the zoom-out button.
    expect(resolveAreaZoom({ zoom: 0.2 })).toBe(1);
    // No zoom, and nonsense from a hand-edited config, both leave the fit be.
    expect(resolveAreaZoom({})).toBeUndefined();
    expect(resolveAreaZoom({ zoom: NaN })).toBeUndefined();
    expect(resolveAreaZoom({ zoom: Infinity })).toBeUndefined();
  });
});

describe("overlay size while zoomed (issue #222)", () => {
  it("holds the overlay at its full-plan size by default, as it always has", () => {
    expect(zoomedOverlayScale(4)).toBeCloseTo(0.25);
    expect(zoomedOverlayScale(4, DEFAULT_ZOOMED_OVERLAY_SCALE)).toBeCloseTo(0.25);
  });

  it("multiplies that counter-scale, so badges can grow when zoomed in", () => {
    expect(zoomedOverlayScale(4, 2)).toBeCloseTo(0.5); // twice full-plan size
    expect(zoomedOverlayScale(4, 0.5)).toBeCloseTo(0.125); // half of it
  });

  it("does nothing at full plan — the setting is about the zoomed view", () => {
    // Otherwise setting it would resize every plan the moment it was set.
    expect(zoomedOverlayScale(1, 2)).toBe(1);
    expect(zoomedOverlayScale(0.5, 2)).toBe(1);
  });

  it("ignores a value that would poison the custom property it lands in", () => {
    // --fp-inv-zoom:NaN invalidates the property, and .item's transform is
    // built from it — every badge would lose its centring, not just its size.
    expect(zoomedOverlayScale(4, NaN)).toBeCloseTo(0.25);
    expect(zoomedOverlayScale(4, 0)).toBeCloseTo(0.25);
    expect(zoomedOverlayScale(4, -2)).toBeCloseTo(0.25);
    expect(zoomedOverlayScale(NaN, 2)).toBe(1);
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
// Issue #145 meets #143: a two-panel slider has two sensors and its leaves do
// not travel the full width, so neither the amount nor the leaf count could be
// read off `entity` alone.
describe("a fixed opening and a partial sash, as gaps (issue #218)", () => {
  const win = (extra: Partial<Opening>) =>
    ({ id: "o", type: "window", x: 0, y: 0, length: 100, angle: 0, ...extra }) as Opening;

  it("a fixed opening is never a gap, whatever a sensor says", () => {
    const f = win({ motion: "fixed" });
    expect(openingClearFraction(f, 0)).toBe(0);
    expect(openingClearFraction(f, 1)).toBe(0);
    expect(openingClearSpan(f, 1)).toEqual([0.5, 0.5]);
  });

  it("but it is still glass, so light goes straight through it", () => {
    // The distinction the feature turns on: no *airflow* gap, full daylight.
    const f = win({ motion: "fixed" });
    expect(glowClearFraction(f, 0)).toBe(1);
    expect(openingSunFraction(f, openingClearFraction(f, 0))).toBe(1);
  });

  it("an opaque fixed panel is neither a gap nor a window", () => {
    const f = win({ motion: "fixed", glazed: false });
    expect(glowClearFraction(f, 1)).toBe(0);
    expect(openingSunFraction(f, openingClearFraction(f, 1))).toBe(0);
  });

  it("a half-width sash swung wide open clears half the opening", () => {
    const half = win({ sash: "single", sashSpan: 0.5 });
    expect(openingClearFraction(half, 1)).toBeCloseTo(0.5);
    expect(openingClearFraction(half, 0.5)).toBeCloseTo(0.25);
    expect(openingClearFraction(half, 0)).toBe(0);
  });

  it("and clears it at its own jamb, where the sash is — not in the middle", () => {
    const half = win({ sash: "single", sashSpan: 0.5 });
    expect(openingClearSpan(half, 1)).toEqual([0, 0.5]);
    // flipH hangs the sash on the other jamb, so the clear half moves with it.
    expect(openingClearSpan(win({ sash: "single", sashSpan: 0.5, flipH: true }), 1)).toEqual([
      0.5, 1,
    ]);
  });

  it("a full-width sash keeps the centred span every plan already lights by", () => {
    const full = win({ sash: "single" });
    expect(openingClearFraction(full, 1)).toBe(1);
    expect(openingClearSpan(full, 0.5)).toEqual([0.25, 0.75]);
  });

  it("clamps a nonsense span rather than drawing a sliver or an inside-out sash", () => {
    expect(openingSashSpan(win({ sash: "single", sashSpan: 0 }))).toBe(MIN_SASH_SPAN);
    expect(openingSashSpan(win({ sash: "single", sashSpan: -3 }))).toBe(MIN_SASH_SPAN);
    expect(openingSashSpan(win({ sash: "single", sashSpan: 4 }))).toBe(1);
    expect(openingSashSpan(win({ sash: "single", sashSpan: NaN }))).toBe(1);
  });

  it("is ignored where there is no leftover pane to describe", () => {
    // A double splits the frame between its leaves; a slider and a roll-up
    // have panel arithmetic of their own.
    expect(openingSashSpan(win({ sash: "double", sashSpan: 0.4 }))).toBe(1);
    expect(openingSashSpan(win({ motion: "slide", sashSpan: 0.4 }))).toBe(1);
    expect(openingSashSpan(win({ motion: "roll", sashSpan: 0.4 }))).toBe(1);
    expect(openingClearFraction(win({ sash: "double", sashSpan: 0.4 }), 1, 1)).toBe(1);
  });
});

describe("openingClearFraction (#145 / #143)", () => {
  const slider = (sliderStyle: string): Opening =>
    ({ id: "o", type: "window", motion: "slide", sliderStyle, x: 300, y: 300, length: 200, angle: 0 }) as Opening;

  it("counts both leaves, so the second panel alone opens a gap", () => {
    // The bug: a door whose only open leaf was the second one blocked light
    // outright, because the light asked `entity` and nothing else.
    for (const s of ["biparting", "biparting-bypass", "converging"]) {
      expect({ s, clear: openingClearFraction(slider(s), 0, 1) > 0 }).toEqual({ s, clear: true });
    }
  });

  it("matches how far each style's leaves actually travel", () => {
    // Measured against the drawn geometry: biparting sends its leaves into the
    // walls, the patio styles keep theirs inside the frame at a quarter each.
    const table = [
      ["biparting", 1, 1, 1],
      ["biparting", 1, 0, 0.5],
      ["biparting-bypass", 1, 1, 0.5],
      ["biparting-bypass", 1, 0, 0.25],
      ["converging", 1, 1, 0.5],
      ["converging", 1, 0, 0.25],
    ] as Array<[string, number, number, number]>;
    for (const [s, a1, a2, want] of table) {
      expect({ s, a1, a2, clear: openingClearFraction(slider(s), a1, a2) }).toEqual({
        s, a1, a2, clear: want,
      });
    }
  });

  it("never lets a patio slider through more light than it draws", () => {
    // The ceiling is the point: these two keep their leaves in the frame, so
    // reading `amount` alone would pass twice the light that is drawn.
    for (const s of ["biparting-bypass", "converging"]) {
      expect(openingClearFraction(slider(s), 1, 1)).toBeLessThanOrEqual(0.5);
    }
  });

  it("leaves every other opening exactly as it was", () => {
    const shut = 0;
    const open = 1;
    const half = 0.4;
    for (const o of [
      { id: "d", type: "door", x: 0, y: 0, length: 90, angle: 0 } as Opening,
      { id: "r", type: "window", motion: "roll", x: 0, y: 0, length: 90, angle: 0 } as Opening,
      slider("single"),
      slider("bypass"),
    ]) {
      for (const a of [shut, half, open]) {
        expect(openingClearFraction(o, a)).toBe(a);
      }
    }
    // …including a single-sensor biparting, where the mean of one amount is itself.
    expect(openingClearFraction(slider("biparting"), 0.6)).toBeCloseTo(0.6, 10);
  });

  it("clamps a junk reading rather than cutting a gap wider than the wall", () => {
    expect(openingClearFraction(slider("biparting"), 5, 5)).toBe(1);
    expect(openingClearFraction(slider("converging"), -3, -3)).toBe(0);
  });

  it("a hinged double clears half per open sash (issue #159)", () => {
    const casement = (extra: Partial<Opening> = {}) =>
      ({ id: "w", type: "window", x: 0, y: 0, length: 90, angle: 0, ...extra }) as Opening;
    // Each sash covers its own half, and clears it completely when open.
    expect(openingClearFraction(casement(), 1, 1)).toBe(1);
    expect(openingClearFraction(casement(), 1, 0)).toBe(0.5);
    expect(openingClearFraction(casement(), 0, 1)).toBe(0.5);
    expect(openingClearFraction(casement(), 0, 0)).toBe(0);
    // A double door reads the same way (issue #168).
    expect(openingClearFraction(casement({ type: "door", sash: "double" }), 1, 0)).toBe(0.5);
    // One sash means one amount, exactly as before.
    expect(openingClearFraction(casement({ sash: "single" }), 0.4, 1)).toBe(0.4);
    expect(openingClearFraction(casement({ type: "door" }), 0.4, 1)).toBe(0.4);
    // …as does a double with a single sensor: the mean of one amount is itself.
    expect(openingClearFraction(casement(), 0.6)).toBeCloseTo(0.6, 10);
  });
});

describe("glowClearFraction — glass admits a lamp's pool shut or open", () => {
  it("passes an opaque opening straight through to openingClearFraction", () => {
    expect(glowClearFraction({ type: "door" } as Opening, 0.25)).toBeCloseTo(0.25);
    expect(glowClearFraction({ type: "door" } as Opening, 1)).toBe(1);
    expect(glowClearFraction({ type: "door" } as Opening, 0)).toBe(0);
  });

  it("clears a window's whole gap whatever its sash is doing", () => {
    expect(glowClearFraction({ type: "window" } as Opening, 0)).toBe(1);
    expect(glowClearFraction({ type: "window" } as Opening, 0.3)).toBe(1);
    expect(glowClearFraction({ type: "window" } as Opening, 1)).toBe(1);
  });

  it("reads `glazed` exactly as openingSunFraction does — one field, one fact", () => {
    // A patio door marked glazed is a wall of glass to a lamp too, not just
    // to the sun: shut, its own light still gets through.
    expect(glowClearFraction({ type: "door", glazed: true } as Opening, 0)).toBe(1);
    // An opaque window — glass-brick, a hatch — marked glazed: false stays
    // opaque to a lamp same as it does to the sun: shut, it blocks.
    expect(glowClearFraction({ type: "window", glazed: false } as Opening, 0)).toBe(0);
    expect(glowClearFraction({ type: "window", glazed: false } as Opening, 0.4)).toBeCloseTo(0.4);
  });

  it("a roll-motion window is a blind standing in for the glass, not the glass itself", () => {
    // device_class "shutter"/"blind"/etc. auto-maps to type: "window",
    // motion: "roll" (openingFromDeviceClass) — reading `glazed`'s default
    // here would make the blind always-clear no matter how far down it is.
    const rollUp = { type: "window", motion: "roll" } as Opening;
    expect(glowClearFraction(rollUp, 0)).toBe(0);
    expect(glowClearFraction(rollUp, 0.6)).toBeCloseTo(0.6);
    expect(glowClearFraction(rollUp, 1)).toBe(1);
    // Categorical, regardless of `glazed` — motion is what says this is a
    // covering rather than a sash, and an explicit glazed: true on top of it
    // is the one case openingSunFraction itself doesn't need to consider,
    // so there is no existing convention this borrows from either way.
    expect(glowClearFraction({ ...rollUp, glazed: true }, 0)).toBe(0);
  });

  it("still respects a two-panel slider's travel for a non-glazed opening", () => {
    const converging = {
      id: "o", type: "door", motion: "slide", sliderStyle: "converging",
      x: 300, y: 300, length: 200, angle: 0,
    } as Opening;
    expect(glowClearFraction(converging, 1, 1)).toBe(openingClearFraction(converging, 1, 1));
  });

  it("a shutter rolled down blocks the pool whatever the glass says (issue #185)", () => {
    // A window's glass is not the whole story: the persiana in front of it can
    // still be shut, and shut wins.
    expect(glowClearFraction({ type: "window" } as Opening, 0, undefined, 0)).toBe(0);
    expect(glowClearFraction({ type: "window" } as Opening, 1, undefined, 0)).toBe(0);
    // Open, the window's own rule (always clear) still applies.
    expect(glowClearFraction({ type: "window" } as Opening, 0, undefined, 1)).toBe(1);
    // Only a fully-down shutter (0) blocks — a crack open is enough to defer
    // back to the window, same threshold openingSunFraction uses.
    expect(glowClearFraction({ type: "window" } as Opening, 0, undefined, 0.01)).toBe(1);
  });

  it("no shutter bound leaves an opening judged on itself alone", () => {
    expect(glowClearFraction({ type: "window" } as Opening, 0, undefined, undefined)).toBe(1);
    expect(glowClearFraction({ type: "door" } as Opening, 0.6, undefined, undefined)).toBeCloseTo(0.6);
  });
});

describe("openingClearSpan — where the gap is, not just how wide (#219)", () => {
  const dbl = (extra: Partial<Opening> = {}) =>
    ({ id: "d", type: "door", sash: "double", x: 500, y: 100, length: 100, angle: 0, ...extra }) as Opening;
  const width = ([a, b]: [number, number]) => b - a;

  it("puts a double door's gap in the half whose leaf is open", () => {
    // The report: a sensor per leaf, one leaf open, and the light came
    // through the middle — half of it through the leaf that was still shut.
    expect(openingClearSpan(dbl(), 1, 0)).toEqual([0, 0.5]);
    expect(openingClearSpan(dbl(), 0, 1)).toEqual([0.5, 1]);
    // Ajar, each leaf clears outward from the middle as it swings.
    expect(openingClearSpan(dbl(), 0.5, 0)).toEqual([0.25, 0.5]);
  });

  it("leaves a double door with both leaves alike exactly where it was", () => {
    // Which is why a single-sensor double door sees no change at all: the
    // span it produces *is* the centred one.
    for (const a of [0.25, 0.5, 1]) {
      const [s0, s1] = openingClearSpan(dbl(), a, a);
      expect(s0 + s1).toBeCloseTo(1, 10); // centred
      expect(width([s0, s1])).toBeCloseTo(a, 10);
    }
    expect(openingClearSpan(dbl(), 0.6)).toEqual(openingClearSpan(dbl(), 0.6, 0.6));
  });

  it("mirrors with flipH, because the leaves swap jambs with it", () => {
    expect(openingClearSpan(dbl({ flipH: true }), 1, 0)).toEqual([0.5, 1]);
    expect(openingClearSpan(dbl({ flipH: true }), 0, 1)).toEqual([0, 0.5]);
  });

  it("never disagrees with openingClearFraction about the amount", () => {
    // The two answer different halves of one question, so a span that was
    // wider or narrower than the fraction would leak light or lose it.
    const cases: Array<[Opening, number, number | undefined]> = [
      [dbl(), 1, 0],
      [dbl(), 0.3, 0.9],
      [dbl({ flipH: true }), 0.2, 1],
      [{ id: "s", type: "door", x: 0, y: 0, length: 90, angle: 0 } as Opening, 0.4, undefined],
      [{ id: "w", type: "window", x: 0, y: 0, length: 90, angle: 0 } as Opening, 0.7, undefined],
      [
        { id: "c", type: "door", motion: "slide", sliderStyle: "converging",
          x: 0, y: 0, length: 200, angle: 0 } as Opening,
        1, 1,
      ],
    ];
    for (const [o, a1, a2] of cases) {
      expect(width(openingClearSpan(o, a1, a2))).toBeCloseTo(openingClearFraction(o, a1, a2), 10);
    }
  });

  it("centres everything that is not a double door, as it always did", () => {
    const slider = { id: "s", type: "door", motion: "slide", x: 0, y: 0, length: 100, angle: 0 } as Opening;
    expect(openingClearSpan(slider, 0.5)).toEqual([0.25, 0.75]);
    const roll = { id: "r", type: "window", motion: "roll", x: 0, y: 0, length: 100, angle: 0 } as Opening;
    expect(openingClearSpan(roll, 0.4)).toEqual([0.3, 0.7]);
  });

  it("glowClearSpan keeps glass and a shut shutter as whole-opening answers", () => {
    const glass = dbl({ glazed: true });
    expect(glowClearSpan(glass, 1, 0)).toEqual([0, 1]); // all of it, leaves irrelevant
    expect(glowClearSpan(dbl(), 1, 0, 0)).toEqual([0, 0]); // shutter down: none of it
    // …and defers to the placed span otherwise.
    expect(glowClearSpan(dbl(), 1, 0)).toEqual([0, 0.5]);
  });
});

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

  it("cuts the gap where the span says, not always in the middle (#219)", () => {
    // The end-to-end shape of the fix: a 40-wide double door centred at 500 on
    // a horizontal wall, first leaf open. The clear half is 480..500, and that
    // is where the wall must be cut — centring it left 490..510, so a lamp
    // next door lit half of the leaf that was still shut.
    const walls = [wall(0, 100, 1000, 100)];
    const dbl = door({ sash: "double" } as Partial<Opening>);
    expect(spans(wallsLightPassesThrough(walls, [dbl], () => 0.5))).toEqual([
      [0, 490],
      [510, 1000],
    ]);
    expect(spans(wallsLightPassesThrough(walls, [dbl], (o) => openingClearSpan(o, 1, 0)))).toEqual([
      [0, 480],
      [500, 1000],
    ]);
    expect(spans(wallsLightPassesThrough(walls, [dbl], (o) => openingClearSpan(o, 0, 1)))).toEqual([
      [0, 500],
      [520, 1000],
    ]);
  });

  it("places the span against the wall's own direction, not the canvas's", () => {
    // A wall drawn right-to-left runs backwards under the same opening, so a
    // span read straight off would land mirrored — and only ever show up on a
    // door with unequal leaves, which is the one case this is for.
    const forward = [wall(0, 100, 1000, 100)];
    const backward = [wall(1000, 100, 0, 100, "wb")];
    const dbl = door({ sash: "double" } as Partial<Opening>);
    const cut = (walls: ReturnType<typeof wall>[]) =>
      spans(wallsLightPassesThrough(walls, [dbl], (o) => openingClearSpan(o, 1, 0)))
        .map(([a, b]) => [Math.min(a, b), Math.max(a, b)])
        .sort((p, q) => p[0]! - q[0]!);
    expect(cut(forward)).toEqual(cut(backward));
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

  it("a shut window still cuts a gap when fed glowClearFraction, unlike a shut door", () => {
    const walls = [wall(0, 100, 1000, 100)];
    const win = door({ id: "w", type: "window" } as Partial<Opening>);
    // Fed the plain amount (0, shut): today's door behaviour — wall stays whole.
    expect(wallsLightPassesThrough(walls, [win], () => 0)).toEqual(walls);
    // Fed through glowClearFraction: glass admits the pool regardless of sash.
    const out = wallsLightPassesThrough(walls, [win], (o) => glowClearFraction(o, 0));
    expect(spans(out)).toEqual([
      [0, 480],
      [520, 1000],
    ]);
    // A shut door, run through the same helper, still blocks — only glass is exempt.
    const doorOut = wallsLightPassesThrough(walls, [door()], (o) => glowClearFraction(o, 0));
    expect(doorOut).toEqual(walls);
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

describe("a lock drives a door (issue #176)", () => {
  const door = (extra: Partial<Opening> = {}) =>
    ({ id: "d", type: "door", x: 0, y: 0, length: 90, angle: 0, entity: "lock.front", ...extra }) as Opening;

  it("reads unlocked as open and locked as closed", () => {
    expect(resolveOpeningOpen(door(), "unlocked")).toBe(true);
    expect(resolveOpeningOpen(door(), "locked")).toBe(false);
  });

  it("takes the transient and latch states from the domain's own table", () => {
    // Exactly entityIsActive's lock set, so a door and a badge bound to the
    // same lock can never disagree about it.
    for (const state of ["unlocked", "unlocking", "open", "opening"]) {
      expect({ state, open: resolveOpeningOpen(door(), state) }).toEqual({ state, open: true });
      expect({ state, active: entityIsActive("lock.front", state) }).toEqual({ state, active: true });
    }
    // `locking` is on its way to shut, so it draws shut.
    expect(resolveOpeningOpen(door(), "locking")).toBe(false);
  });

  it("fails closed on no reliable reading, before invert can flip it", () => {
    // `jammed` belongs here rather than with the ordinary readings: the lock
    // tried to move and could not, so the bolt is neither thrown nor
    // withdrawn. Inverting it would draw a jammed front door wide open, which
    // is the one picture a jam must not paint.
    for (const state of ["unavailable", "unknown", "jammed"]) {
      expect({ state, open: resolveOpeningOpen(door(), state) }).toEqual({ state, open: false });
      expect({ state, inverted: resolveOpeningOpen(door({ invert: true }), state) }).toEqual({
        state,
        inverted: false,
      });
    }
  });

  it("only a lock's jam fails closed — no other domain reports one", () => {
    // A `sensor.jammed` reading the literal word keeps meaning whatever its
    // own domain says, and there `jammed` is simply not an open state, so
    // invert may flip it like any other.
    const contact = (extra = {}) =>
      ({ ...door({ ...extra }), entity: "binary_sensor.d" }) as Opening;
    expect(resolveOpeningOpen(contact(), "jammed")).toBe(false);
    expect(resolveOpeningOpen(contact({ invert: true }), "jammed")).toBe(true);
  });

  it("inverts for a lock wired the other way round", () => {
    expect(resolveOpeningOpen(door({ invert: true }), "locked")).toBe(true);
    expect(resolveOpeningOpen(door({ invert: true }), "unlocked")).toBe(false);
  });

  it("a jam is never active, and lets no light through", () => {
    expect(openingIsActive(door(), { state: "jammed" })).toBe(false);
    expect(openingIsActive(door({ invert: true }), { state: "jammed" })).toBe(false);
    expect(resolveOpeningAmount(door({ invert: true }), { state: "jammed" })).toBe(0);
  });

  it("drives the amount, the accent and the light like any other opening", () => {
    expect(resolveOpeningAmount(door(), { state: "unlocked" })).toBe(1);
    expect(resolveOpeningAmount(door(), { state: "locked" })).toBe(0);
    expect(openingIsActive(door(), { state: "unlocked" })).toBe(true);
    expect(openingIsActive(door(), { state: "locked" })).toBe(false);
    // A lock has no position to publish, so it stays binary.
    expect(
      resolveOpeningAmount(door(), { state: "unlocked", attributes: { current_position: 40 } }),
    ).toBeCloseTo(0.4);
  });

  it("leaves every other domain reading exactly as it did", () => {
    const contact = (state: string) =>
      resolveOpeningOpen({ ...door(), entity: "binary_sensor.d" } as Opening, state);
    expect(contact("on")).toBe(true);
    expect(contact("off")).toBe(false);
    // A contact that somehow reads "unlocked" is not a lock, and does not
    // silently become one.
    expect(contact("unlocked")).toBe(false);
    const cover = (state: string) =>
      resolveOpeningOpen({ ...door(), entity: "cover.d" } as Opening, state);
    for (const state of ["open", "opening", "closing"]) expect(cover(state)).toBe(true);
    expect(cover("closed")).toBe(false);
  });

  it("never toggles a lock on a tap — it opens its dialog", () => {
    // The accidental-hardware rule the shutter defaults already follow, and
    // unlocking a front door by brushing the plan is the worst version of it.
    expect(openingClickAction("lock.front", 0)).toBe("more-info");
    expect(openingClickAction("lock.front", 255)).toBe("more-info");
    expect(
      openingActionForGesture({ entity: "lock.front" }, "tap", () => 255)?.config.action,
    ).toBe("more-info");
  });
});

describe("actions on rooms (issue #181)", () => {
  const area = (extra: Partial<Area> = {}) =>
    ({ id: "a", points: [{ x: 0, y: 0 }], ...extra }) as Area;

  it("resolves only what is configured — tap is left to the zoom otherwise", () => {
    expect(areaActionForGesture(area(), "tap")).toBeUndefined();
    expect(areaActionForGesture(area(), "hold")).toBeUndefined();
    expect(areaActionForGesture(area(), "double_tap")).toBeUndefined();
  });

  it("takes the action's own entity, else the room's", () => {
    const a = area({ entity: "light.kitchen", tap_action: { action: "toggle" } });
    expect(areaActionForGesture(a, "tap")).toEqual({
      entity: "light.kitchen",
      config: { action: "toggle" },
    });
    // An action naming its own entity wins over the room's.
    const b = area({
      entity: "light.kitchen",
      hold_action: { action: "more-info", entity: "sensor.temp" },
    });
    expect(areaActionForGesture(b, "hold")?.entity).toBe("sensor.temp");
    // …and with no entity anywhere, only actions that need none do anything.
    expect(areaActionForGesture(area({ tap_action: { action: "navigate" } }), "tap")).toEqual({
      entity: undefined,
      config: { action: "navigate" },
    });
  });

  it("a room can zoom and act — the two live on different gestures", () => {
    const a = area({ entity: "light.k", hold_action: { action: "toggle" } });
    // Tap unset, so the card falls back to the zoom.
    expect(areaActionForGesture(a, "tap")).toBeUndefined();
    expect(areaActionForGesture(a, "hold")?.config).toEqual({ action: "toggle" });
  });

  it("knows whether a room does anything a plain zoom would not", () => {
    expect(areaHasActions(area())).toBe(false);
    // "none" is a real choice — it turns the zoom off — but it is not an action.
    expect(areaHasActions(area({ tap_action: { action: "none" } }))).toBe(false);
    expect(areaHasActions(area({ tap_action: { action: "toggle" } }))).toBe(true);
    expect(areaHasActions(area({ double_tap_action: { action: "more-info" } }))).toBe(true);
  });
});

describe("a reading can be bound without being printed", () => {
  const named = () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).friendly_name = "Living Temp";
    return h;
  };
  const item = (readings: ItemReading[], extra = {}) =>
    ({ entity: TEMP, kind: "sensor", readings, ...extra }) as Parameters<typeof itemBadgeLabel>[1];

  it("keeps a hidden reading out of the label", () => {
    expect(itemBadgeLabel(named(), item([{ entity: HUMIDITY }]))).toBe("17.9 °C · 49.3%");
    expect(itemBadgeLabel(named(), item([{ entity: HUMIDITY, showState: false }]))).toBe("17.9 °C");
  });

  it("treats unset and true alike — nothing changes for an existing plan", () => {
    for (const showState of [undefined, true] as const) {
      expect(itemBadgeLabel(named(), item([{ entity: HUMIDITY, showState }]))).toBe(
        "17.9 °C · 49.3%",
      );
    }
  });

  it("hides one without hiding the rest", () => {
    expect(
      itemBadgeLabel(
        named(),
        item([{ entity: HUMIDITY, showState: false }, { entity: TEMP }]),
      ),
    ).toBe("17.9 °C · 17.9 °C");
  });

  it("does NOT renumber the others — the badge's index must not move", () => {
    // The trap this exists to avoid: hide reading 0 and, if the badge indexed
    // only the visible ones, `badgeEntity: 1` would silently start reading a
    // different entity.
    const plug = fakeHass([
      { entity_id: "switch.plug", state: "on" },
      { entity_id: "sensor.power", state: "1200", unit: "W" },
      { entity_id: "sensor.lqi", state: "84" },
    ]);
    const withHidden = {
      entity: "switch.plug",
      readings: [{ entity: "sensor.power", showState: false }, { entity: "sensor.lqi" }],
      badgeEntity: 0 as const,
    };
    // Index 0 is still the power sensor, though it prints nothing.
    expect(badgeReading(plug, withHidden)?.source).toBe(0);
    expect(badgeReading(plug, withHidden)?.text).toBe("1.2kW");
    expect(itemReadings(withHidden)).toHaveLength(2);
    // …and index 1 is still the one it always was.
    expect(badgeReading(plug, { ...withHidden, badgeEntity: 1 })?.text).toBe("84");
  });

  it("a device labelled only by hidden readings draws no label", () => {
    // So the editor does not offer a label's size and position for a label
    // that is never on screen.
    expect(itemHasLabel({ kind: "light", readings: [{ entity: HUMIDITY }] })).toBe(true);
    expect(
      itemHasLabel({ kind: "light", readings: [{ entity: HUMIDITY, showState: false }] }),
    ).toBe(false);
    // One visible among hidden ones is still a label.
    expect(
      itemHasLabel({
        kind: "light",
        readings: [{ entity: HUMIDITY, showState: false }, { entity: TEMP }],
      }),
    ).toBe(true);
  });

  it("still watches a hidden reading's entity — the badge reads it live", () => {
    const got = collectWatchedEntities({
      items: [
        {
          id: "i",
          kind: "sensor",
          x: 0,
          y: 0,
          entity: TEMP,
          readings: [{ entity: HUMIDITY, showState: false }],
        },
      ],
    } as unknown as FloorplanCardConfig);
    expect([...got].sort()).toEqual([TEMP, HUMIDITY].sort());
  });
});

describe("stairs that change floor (issue #121)", () => {
  const floors = [{ id: "cellar" }, { id: "ground" }, { id: "loft" }];
  const stairs = (goToFloor?: "up" | "down") => ({ goToFloor }) as Pick<Furniture, "goToFloor">;

  it("reads the floor list bottom-to-top", () => {
    expect(furnitureFloorTarget(stairs("up"), floors, "ground")).toBe("loft");
    expect(furnitureFloorTarget(stairs("down"), floors, "ground")).toBe("cellar");
  });

  it("leads nowhere at the end of the list, so the card draws no button", () => {
    expect(furnitureFloorTarget(stairs("up"), floors, "loft")).toBeUndefined();
    expect(furnitureFloorTarget(stairs("down"), floors, "cellar")).toBeUndefined();
  });

  it("does not wrap — the loft is not above the cellar", () => {
    // A stair click that teleported you from the top of the building to the
    // bottom would be a bug report, not a feature.
    expect(furnitureFloorTarget(stairs("up"), floors, "loft")).not.toBe("cellar");
    expect(furnitureFloorTarget(stairs("down"), floors, "cellar")).not.toBe("loft");
  });

  it("is inert on ordinary furniture", () => {
    expect(furnitureFloorTarget(stairs(), floors, "ground")).toBeUndefined();
    expect(furnitureFloorTarget({ goToFloor: "sideways" } as never, floors, "ground")).toBeUndefined();
  });

  it("leads nowhere when the active floor is not in the list", () => {
    // A stale `_activeFloorId` must not resolve to floors[0] by accident.
    expect(furnitureFloorTarget(stairs("up"), floors, "gone")).toBeUndefined();
    expect(furnitureFloorTarget(stairs("up"), floors, undefined)).toBeUndefined();
    expect(furnitureFloorTarget(stairs("up"), [], "ground")).toBeUndefined();
  });

  it("works on a two-floor plan, which is the ordinary case", () => {
    const two = [{ id: "g" }, { id: "up" }];
    expect(furnitureFloorTarget(stairs("up"), two, "g")).toBe("up");
    expect(furnitureFloorTarget(stairs("down"), two, "up")).toBe("g");
    expect(furnitureFloorTarget(stairs("down"), two, "g")).toBeUndefined();
  });
});

describe("a text label can show an entity's value (issue #225)", () => {
  const label = (t: Partial<FloorText>) =>
    textLabel(livingArea(), { text: "", ...t } as FloorText);

  it("draws the words as typed when nothing is bound", () => {
    expect(label({ text: "Kitchen" })).toBe("Kitchen");
    // Every text drawn before this existed keeps working, empty included.
    expect(label({ text: "" })).toBe("");
  });

  it("always returns a string, even with no words stored at all", () => {
    // The editor stores an emptied optional text field as absent rather than
    // as "", so an unbound label can arrive with no `text` key — and callers
    // interpolate the result straight into markup.
    expect(textLabel(livingArea(), { entity: undefined } as FloorText)).toBe("");
    expect(textLabel(livingArea(), {} as FloorText)).toBe("");
    // …and with an entity bound, missing words just mean no prefix.
    expect(textLabel(livingArea(), { entity: TEMP } as FloorText)).toBe("17.9 °C");
  });

  it("draws the reading when an entity is bound and there are no words", () => {
    // HA's own formatter, so units and display precision come for free —
    // which is what the reporter's `| round(1)` template was reaching for.
    expect(label({ entity: TEMP })).toBe("17.9 °C");
  });

  it("uses the words as a prefix when both are given", () => {
    expect(label({ text: "Outside", entity: TEMP })).toBe("Outside 17.9 °C");
    // A space, not the " · " a device puts between its own readings: this is
    // one reading with a name, not a list.
    expect(label({ text: "Outside", entity: TEMP })).not.toContain("·");
  });

  it("reads an attribute instead of the state when asked", () => {
    const h = livingArea();
    (h.states[TEMP]!.attributes as Record<string, unknown>).battery = 84;
    expect(textLabel(h, { text: "", entity: TEMP, attribute: "battery" } as FloorText)).toBe("84");
    expect(textLabel(h, { text: "Batt", entity: TEMP, attribute: "battery" } as FloorText)).toBe(
      "Batt 84"
    );
  });

  it("says so when the entity is missing, rather than going blank", () => {
    expect(label({ entity: "sensor.gone" })).toBe("—");
    expect(label({ text: "PV", entity: "sensor.gone" })).toBe("PV —");
  });

  it("ignores an attribute with no entity to read it from", () => {
    expect(label({ text: "Hall", attribute: "battery" })).toBe("Hall");
  });

  it("is watched, or the number would freeze on the plan", () => {
    const got = collectWatchedEntities({
      texts: [
        { id: "t1", x: 0, y: 0, text: "PV", entity: TEMP },
        { id: "t2", x: 0, y: 0, text: "just words" },
      ],
    } as unknown as FloorplanCardConfig);
    expect([...got]).toEqual([TEMP]);
  });
});

describe("hide by condition (checkHideCondition)", () => {
  // Signature: (evalState, mode, stateMatch, operator, threshold, invert)

  describe("threshold mode", () => {
    it("hides when the comparison holds", () => {
      expect(checkHideCondition("25", "threshold", undefined, ">", 20, false)).toBe(true);
    });

    it("leaves the item alone when it does not", () => {
      expect(checkHideCondition("15", "threshold", undefined, ">", 20, false)).toBe(false);
    });

    it("honours every operator the editor offers", () => {
      const at = (op: string) => checkHideCondition("20", "threshold", undefined, op, 20, false);
      expect([at("<"), at("<="), at("=="), at("!="), at(">="), at(">")])
        .toEqual([false, true, true, false, true, false]);
    });

    it("inverts the result when asked", () => {
      expect(checkHideCondition("25", "threshold", undefined, ">", 20, true)).toBe(false);
    });

    // Fail-to-nothing guards. Each of these used to hide, or fall through to
    // state matching against an unrelated value.
    it("does nothing when no threshold is configured", () => {
      expect(checkHideCondition("25", "threshold", undefined, ">", undefined, false)).toBe(false);
    });

    it("does not invert a missing threshold into a hide", () => {
      expect(checkHideCondition("25", "threshold", undefined, ">", undefined, true)).toBe(false);
    });

    it("does nothing for a non-numeric state", () => {
      expect(checkHideCondition("heating", "threshold", undefined, ">", 20, false)).toBe(false);
      expect(checkHideCondition("unavailable", "threshold", undefined, "<", 31, false)).toBe(false);
    });

    it("does not guess at an operator it was never given", () => {
      // An editor that grows a new operator must teach this switch about it
      // rather than silently hiding devices as though it meant ">".
      expect(checkHideCondition("25", "threshold", undefined, "≥", 20, false)).toBe(false);
    });
  });

  describe("state mode", () => {
    it("matches case-insensitively", () => {
      expect(checkHideCondition("Playing", "state", "playing", "==", undefined, false)).toBe(true);
    });

    it("matches the same way matchStateRule does, whitespace and all", () => {
      // A hide rule and a colour rule must agree about " on " (render.ts:302).
      expect(checkHideCondition(" on ", "state", "on", "==", undefined, false)).toBe(true);
      expect(checkHideCondition("on", "state", " ON ", "==", undefined, false)).toBe(true);
    });

    it("supports !=", () => {
      expect(checkHideCondition("idle", "state", "heating", "!=", undefined, false)).toBe(true);
      expect(checkHideCondition("heating", "state", "heating", "!=", undefined, false)).toBe(false);
    });

    it("does nothing when no match string is configured", () => {
      // The editor seeds these fields with "". Without this guard, picking
      // "!=" before typing a match hides the device, because every state
      // differs from the empty string.
      expect(checkHideCondition("on", "state", "", "!=", undefined, false)).toBe(false);
      expect(checkHideCondition("on", "state", undefined, "!=", undefined, false)).toBe(false);
      expect(checkHideCondition("on", "state", "   ", "==", undefined, false)).toBe(false);
    });

    it("does not invert a missing match into a hide", () => {
      expect(checkHideCondition("on", "state", "", "!=", undefined, true)).toBe(false);
    });
  });

  describe("a sensor that does not answer", () => {
    it("hides when the outage is what was asked for", () => {
      // "Hide the badge while this sensor is dead" is a real rule, and the
      // one the feature's own screenshots demonstrate.
      expect(checkHideCondition("unavailable", "state", "unavailable", "==", undefined, false)).toBe(true);
      expect(checkHideCondition("unknown", "state", "unknown", "==", undefined, false)).toBe(true);
    });

    it("leaves the item on the plan when the outage was not asked for", () => {
      // "Hide unless the sensor says heating" must not become "hide" the day
      // that sensor is renamed — the device would vanish with nothing on
      // screen to explain it.
      expect(checkHideCondition("unavailable", "state", "heating", "==", undefined, false)).toBe(false);
      expect(checkHideCondition("unknown", "state", "heating", "!=", undefined, false)).toBe(false);
    });

    it("does not let invert turn an outage into a hide", () => {
      expect(checkHideCondition("unavailable", "state", "heating", "==", undefined, true)).toBe(false);
      expect(checkHideCondition("unavailable", "threshold", undefined, "<", 31, true)).toBe(false);
    });

    it("treats a missing or empty value as no answer at all", () => {
      expect(checkHideCondition(undefined, "state", "on", "==", undefined, false)).toBe(false);
      expect(checkHideCondition(undefined, "state", "on", "==", undefined, true)).toBe(false);
      expect(checkHideCondition("", "state", "on", "==", undefined, false)).toBe(false);
    });
  });
});

describe("hide by condition, through the card's own entry points", () => {
  const OUTSIDE = "sensor.outside_temperature";
  const RADIATOR = "climate.radiator";

  const hass = (states: Record<string, { state: string; attributes?: object }>) =>
    ({
      states: Object.fromEntries(
        Object.entries(states).map(([id, v]) => [
          id,
          { entity_id: id, state: v.state, attributes: v.attributes ?? {} },
        ]),
      ),
      formatEntityState: (s: { state: string }) => s.state,
    }) as unknown as RenderHass;

  it("hides the whole device on a threshold against another entity", () => {
    const h = hass({ [OUTSIDE]: { state: "25" }, [RADIATOR]: { state: "idle" } });
    const item = {
      entity: RADIATOR,
      enableHideByEntity: true,
      hideEntity: OUTSIDE,
      hideMode: "threshold",
      hideOperator: "<=",
      hideThreshold: 31,
    } as const;
    expect(itemHiddenWhenInactive(item, "idle", h)).toBe(true);
    expect(itemHiddenWhenInactive({ ...item, hideThreshold: 10 }, "idle", h)).toBe(false);
  });

  it("reads hideAttribute rather than the state when one is named", () => {
    const h = hass({ [OUTSIDE]: { state: "25", attributes: { humidity: 80 } } });
    expect(
      itemHiddenWhenInactive(
        {
          entity: OUTSIDE,
          enableHideByEntity: true,
          hideAttribute: "humidity",
          hideMode: "threshold",
          hideOperator: ">=",
          hideThreshold: 50,
        },
        "25",
        h,
      ),
    ).toBe(true);
  });

  it("hides the badge without touching the device", () => {
    const h = hass({ [OUTSIDE]: { state: "25" }, [RADIATOR]: { state: "idle" } });
    const item = {
      entity: RADIATOR,
      enableHideBadgeByEntity: true,
      hideBadgeEntity: OUTSIDE,
      hideBadgeMode: "threshold",
      hideBadgeOperator: "<=",
      hideBadgeThreshold: 31,
    } as const;
    expect(itemBadgeHidden(item, "idle", h)).toBe(true);
    // The gate is what turns it on: same config, flag off, badge stays.
    expect(itemBadgeHidden({ ...item, enableHideBadgeByEntity: false }, "idle", h)).toBe(false);
    // …and it says nothing about the device itself.
    expect(itemHiddenWhenInactive(item, "idle", h)).toBe(false);
  });

  it("hides the badge of a sensor that has gone unavailable", () => {
    const h = hass({ [OUTSIDE]: { state: "unavailable" } });
    expect(
      itemBadgeHidden(
        {
          entity: OUTSIDE,
          enableHideBadgeByEntity: true,
          hideBadgeMode: "state",
          hideBadgeMatch: "unavailable",
          hideBadgeOperator: "==",
        },
        "unavailable",
        h,
      ),
    ).toBe(true);
  });

  it("drops the state text while keeping the name", () => {
    const h = hass({ [RADIATOR]: { state: "idle" } });
    const item = {
      entity: RADIATOR,
      name: "Radiator",
      showName: true,
      showState: true,
      enableHideStateByEntity: true,
      hideStateMode: "state",
      hideStateMatch: "idle",
      hideStateOperator: "==",
    } as const;
    expect(itemBadgeLabel(h, item)).toBe("Radiator");
    expect(itemBadgeLabel(h, { ...item, hideStateMatch: "heating" })).toBe("Radiator · idle");
  });

  it("leaves the legacy hideWhenInactive path alone", () => {
    const h = hass({ "light.kitchen": { state: "on" } });
    expect(itemHiddenWhenInactive({ entity: "light.kitchen", hideWhenInactive: true }, "on", h)).toBe(false);
    expect(itemHiddenWhenInactive({ entity: "light.kitchen", hideWhenInactive: true }, "off", h)).toBe(true);
  });

  it("watches every entity a hide rule names (issue #82)", () => {
    const ids = collectWatchedEntities({
      items: [
        {
          id: "a",
          entity: RADIATOR,
          hideEntity: OUTSIDE,
          hideStateEntity: "sensor.a",
          hideBadgeEntity: "sensor.b",
        },
      ],
    } as unknown as FloorplanCardConfig);
    for (const id of [RADIATOR, OUTSIDE, "sensor.a", "sensor.b"]) expect(ids.has(id)).toBe(true);
  });
});
