import { describe, it, expect } from "vitest";
import type { FurnitureType, ItemKind } from "./types";
import { FURNITURE_DEFAULT_SIZE } from "./types";
import {
  snapToWall,
  openingDefaultOpen,
  openingMotion,
  openingMirror,
  sliderStyleOf,
  openingFromDeviceClass,
  openingClickAction,
  resolveOpeningOpen,
  resolveOpeningAmount,
  kindFromEntity,
  defaultIcon,
  renderFurniture,
  sectionalPoints,
  SECTIONAL_CHAISE_FRACTION,
  SECTIONAL_SEAT_FRACTION,
  entityDefaultIcon,
  trackerSensorReading,
  openingInMotion,
  openingIsActive,
  entityStateText,
  itemStateText,
  itemBadgeLabel,
  itemLabelSize,
  hassRenderInputsChanged,
  collectWatchedEntities,
  isEntityOn,
  entityIsActive,
  resolveItemIcon,
  resolveIconAnimation,
  itemIconSize,
  normalizePlanRotation,
  rotatedCanvasSize,
  rotatePlanPoint,
  planRotationTransform,
} from "./render";
import type { FloorplanCardConfig, Opening, RenderHass } from "./types";

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
});

describe("sectionalPoints", () => {
  const w = 200;
  const h = 160;

  function area(pts: Array<[number, number]>): number {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];
      a += x1 * y2 - x2 * y1;
    }
    return Math.abs(a) / 2;
  }

  it("is an L: six corners, not a rectangle", () => {
    expect(sectionalPoints(w, h, "right")).toHaveLength(6);
  });

  it("fills the bounding box minus the notch", () => {
    const chaise = w * SECTIONAL_CHAISE_FRACTION;
    const seat = h * SECTIONAL_SEAT_FRACTION;
    const expected = w * h - (w - chaise) * (h - seat);
    expect(area(sectionalPoints(w, h, "right"))).toBeCloseTo(expected, 6);
  });

  it("puts the chaise on the right when hand is right", () => {
    const pts = sectionalPoints(w, h, "right");
    // the front edge (max y) should only be occupied on the right half
    const front = pts.filter(([, y]) => y === h / 2).map(([x]) => x);
    expect(Math.min(...front)).toBeGreaterThan(0);
    expect(Math.max(...front)).toBeCloseTo(w / 2, 6);
  });

  it("puts the chaise on the left when hand is left", () => {
    const pts = sectionalPoints(w, h, "left");
    const front = pts.filter(([, y]) => y === h / 2).map(([x]) => x);
    expect(Math.max(...front)).toBeLessThan(0);
    expect(Math.min(...front)).toBeCloseTo(-w / 2, 6);
  });

  it("left is right mirrored across x, not a different shape", () => {
    const r = sectionalPoints(w, h, "right");
    const l = sectionalPoints(w, h, "left");
    expect(area(l)).toBeCloseTo(area(r), 6);
    expect(l.map(([x, y]) => [-x, y])).toEqual(r);
  });

  it("defaults to right-handed", () => {
    expect(sectionalPoints(w, h)).toEqual(sectionalPoints(w, h, "right"));
  });

  it("stays inside its bounding box", () => {
    for (const hand of ["left", "right"] as const) {
      for (const [x, y] of sectionalPoints(w, h, hand)) {
        expect(Math.abs(x)).toBeLessThanOrEqual(w / 2 + 1e-9);
        expect(Math.abs(y)).toBeLessThanOrEqual(h / 2 + 1e-9);
      }
    }
  });
});

describe("every furniture type renders and has a default size", () => {
  const types: FurnitureType[] = [
    "table", "roundTable", "desk", "chair", "sofa", "bed", "wardrobe", "rug",
    "plant", "fridge", "stove", "sink", "toilet", "stairs", "tv",
    "washer", "dryer", "dishwasher", "waterHeater", "airHandler", "bathtub",
    "vanity", "sectional",
  ];

  it("has a default size for each", () => {
    for (const t of types) {
      const s = FURNITURE_DEFAULT_SIZE[t];
      expect(s, t).toBeTruthy();
      expect(s.w, t).toBeGreaterThan(0);
      expect(s.h, t).toBeGreaterThan(0);
    }
  });

  it("renders each without throwing", () => {
    for (const t of types) {
      const { w, h } = FURNITURE_DEFAULT_SIZE[t];
      expect(() => renderFurniture({ id: t, type: t, x: 0, y: 0, w, h }), t).not.toThrow();
    }
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
