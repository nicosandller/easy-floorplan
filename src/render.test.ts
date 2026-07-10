import { describe, it, expect } from "vitest";
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
  entityDefaultIcon,
  trackerSensorReading,
  openingInMotion,
  openingIsActive,
  entityStateText,
  itemStateText,
  hassRenderInputsChanged,
} from "./render";
import type { Opening, RenderHass } from "./types";

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
  it("maps door-like device classes to a door, sliding for rollers", () => {
    expect(openingFromDeviceClass("door")).toEqual({ type: "door", motion: undefined });
    expect(openingFromDeviceClass("garage")).toEqual({ type: "door", motion: "slide" });
    expect(openingFromDeviceClass("gate")).toEqual({ type: "door", motion: undefined });
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
  it("falls back to generic for unknown domains", () => {
    expect(kindFromEntity("media_player.tv")).toBe("generic");
    expect(kindFromEntity("weird")).toBe("generic");
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
