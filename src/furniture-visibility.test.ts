// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  collectConditionEntities,
  evaluateCondition,
  evaluateConditions,
  evaluateSunCondition,
  evaluateTimeCondition,
  isFurnitureVisible,
} from "./furniture-visibility";
import type { Furniture, RenderHass, VisibilityCondition } from "./types";

const mockHass = (states: Record<string, { state: string; attributes?: Record<string, unknown> }>, userId?: string): RenderHass =>
  ({
    states: Object.fromEntries(
      Object.entries(states).map(([id, s]) => [
        id,
        {
          entity_id: id,
          state: s.state,
          attributes: s.attributes ?? {},
          last_changed: "",
          last_updated: "",
          context: { id: "", parent_id: null, user_id: null },
        },
      ])
    ),
    user: userId ? { id: userId } : undefined,
  } as unknown as RenderHass);

describe("furniture-visibility", () => {
  describe("isFurnitureVisible", () => {
    it("returns true when visibility is undefined or empty", () => {
      const f: Furniture = { id: "furn-1", type: "sofa", x: 0, y: 0, w: 100, h: 50 };
      expect(isFurnitureVisible(f, undefined)).toBe(true);
      expect(isFurnitureVisible(f, mockHass({}))).toBe(true);
      expect(isFurnitureVisible({ ...f, visibility: [] }, mockHass({}))).toBe(true);
    });

    it("returns true when hass is undefined even if conditions exist", () => {
      const f: Furniture = {
        id: "furn-1",
        type: "car",
        x: 0,
        y: 0,
        w: 90,
        h: 180,
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      };
      expect(isFurnitureVisible(f, undefined)).toBe(true);
    });

    it("delegates to (window as any).checkConditionsMet if available", () => {
      const f: Furniture = {
        id: "furn-1",
        type: "car",
        x: 0,
        y: 0,
        w: 90,
        h: 180,
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      };
      const hass = mockHass({ "device_tracker.car": { state: "not_home" } });

      const spy = vi.fn().mockReturnValue(true);
      (window as unknown as { checkConditionsMet: unknown }).checkConditionsMet = spy;

      try {
        expect(isFurnitureVisible(f, hass)).toBe(true);
        expect(spy).toHaveBeenCalledWith(f.visibility, hass);
      } finally {
        delete (window as unknown as { checkConditionsMet?: unknown }).checkConditionsMet;
      }
    });

    it("falls back to pure evaluator if window.checkConditionsMet throws", () => {
      const f: Furniture = {
        id: "furn-1",
        type: "car",
        x: 0,
        y: 0,
        w: 90,
        h: 180,
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      };
      const hass = mockHass({ "device_tracker.car": { state: "not_home" } });

      (window as unknown as { checkConditionsMet: unknown }).checkConditionsMet = () => {
        throw new Error("Signature error");
      };

      try {
        expect(isFurnitureVisible(f, hass)).toBe(false);
      } finally {
        delete (window as unknown as { checkConditionsMet?: unknown }).checkConditionsMet;
      }
    });
  });

  describe("evaluateConditions", () => {
    it("evaluates multiple conditions with AND conjunction", () => {
      const conds: VisibilityCondition[] = [
        { condition: "state", entity: "device_tracker.car", state: "home" },
        { condition: "numeric_state", entity: "sensor.battery", above: 50 },
      ];
      expect(
        evaluateConditions(
          conds,
          mockHass({ "device_tracker.car": { state: "home" }, "sensor.battery": { state: "80" } })
        )
      ).toBe(true);

      expect(
        evaluateConditions(
          conds,
          mockHass({ "device_tracker.car": { state: "home" }, "sensor.battery": { state: "30" } })
        )
      ).toBe(false);
    });
  });

  describe("state condition", () => {
    it("evaluates string state equality", () => {
      const cond: VisibilityCondition = { condition: "state", entity: "device_tracker.car", state: "home" };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "not_home" } }))).toBe(false);
    });

    it("evaluates array state inclusion", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: ["home", "garage"],
      };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "garage" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "work" } }))).toBe(false);
    });

    it("evaluates state_not exclusion (string and array)", () => {
      const singleNot: VisibilityCondition = { condition: "state", entity: "lock.car", state_not: "locked" };
      expect(evaluateCondition(singleNot, mockHass({ "lock.car": { state: "unlocked" } }))).toBe(true);
      expect(evaluateCondition(singleNot, mockHass({ "lock.car": { state: "locked" } }))).toBe(false);

      const arrayNot: VisibilityCondition = {
        condition: "state",
        entity: "lock.car",
        state_not: ["locked", "jammed"],
      };
      expect(evaluateCondition(arrayNot, mockHass({ "lock.car": { state: "unlocked" } }))).toBe(true);
      expect(evaluateCondition(arrayNot, mockHass({ "lock.car": { state: "jammed" } }))).toBe(false);
    });

    it("evaluates entity attributes when attribute is specified", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "climate.living_room",
        attribute: "preset_mode",
        state: "boost",
      };
      expect(
        evaluateCondition(
          cond,
          mockHass({ "climate.living_room": { state: "heat", attributes: { preset_mode: "boost" } } })
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          cond,
          mockHass({ "climate.living_room": { state: "heat", attributes: { preset_mode: "eco" } } })
        )
      ).toBe(false);
    });

    it("fails open when entity is missing", () => {
      const cond: VisibilityCondition = { condition: "state", entity: "sensor.missing", state: "on" };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
    });

    it("fails open during outages (unavailable or unknown) unless explicitly tested", () => {
      const cond: VisibilityCondition = { condition: "state", entity: "device_tracker.car", state: "home" };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unavailable" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unknown" } }))).toBe(true);

      const explicitUnavailable: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: "unavailable",
      };
      expect(
        evaluateCondition(explicitUnavailable, mockHass({ "device_tracker.car": { state: "unavailable" } }))
      ).toBe(true);
      expect(
        evaluateCondition(explicitUnavailable, mockHass({ "device_tracker.car": { state: "home" } }))
      ).toBe(false);
    });
  });

  describe("numeric_state condition", () => {
    it("evaluates above threshold", () => {
      const cond: VisibilityCondition = { condition: "numeric_state", entity: "sensor.car_battery", above: 20 };
      expect(evaluateCondition(cond, mockHass({ "sensor.car_battery": { state: "25" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.car_battery": { state: "20" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.car_battery": { state: "15" } }))).toBe(false);
    });

    it("evaluates below threshold", () => {
      const cond: VisibilityCondition = { condition: "numeric_state", entity: "sensor.temperature", below: 22 };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "20.5" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "22" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "25" } }))).toBe(false);
    });

    it("evaluates both above and below range", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        above: 18,
        below: 24,
      };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "21" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "18" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "24" } }))).toBe(false);
    });

    it("evaluates numeric attributes", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "climate.thermostat",
        attribute: "current_temperature",
        above: 19,
      };
      expect(
        evaluateCondition(
          cond,
          mockHass({ "climate.thermostat": { state: "heat", attributes: { current_temperature: 20.5 } } })
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          cond,
          mockHass({ "climate.thermostat": { state: "heat", attributes: { current_temperature: 18 } } })
        )
      ).toBe(false);
    });

    it("evaluates string numeric thresholds", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        above: "18.5",
        below: "24",
      };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "20" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "18" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "25" } }))).toBe(false);
    });

    it("evaluates threshold referencing another entity", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.living_area_temperature",
        above: "input_number.target_min_temp",
      };
      const hass = mockHass({
        "sensor.living_area_temperature": { state: "21.5" },
        "input_number.target_min_temp": { state: "20.0" },
      });
      expect(evaluateCondition(cond, hass)).toBe(true);

      const coldHass = mockHass({
        "sensor.living_area_temperature": { state: "19.5" },
        "input_number.target_min_temp": { state: "20.0" },
      });
      expect(evaluateCondition(cond, coldHass)).toBe(false);
    });

    it("fails open on missing entity, unavailable, or non-numeric values", () => {
      const cond: VisibilityCondition = { condition: "numeric_state", entity: "sensor.battery", above: 50 };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.battery": { state: "unavailable" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.battery": { state: "not_a_number" } }))).toBe(true);
    });
  });

  describe("screen condition", () => {
    it("evaluates media queries against window.matchMedia", () => {
      const originalMatchMedia = window.matchMedia;
      try {
        window.matchMedia = vi.fn().mockImplementation((query: string) => ({
          matches: query.includes("min-width: 800px"),
        }));

        expect(evaluateCondition({ condition: "screen", media_query: "(min-width: 800px)" }, mockHass({}))).toBe(true);
        expect(evaluateCondition({ condition: "screen", media_query: "(max-width: 500px)" }, mockHass({}))).toBe(false);
      } finally {
        window.matchMedia = originalMatchMedia;
      }
    });
  });

  describe("user condition", () => {
    it("matches current hass user id", () => {
      const cond: VisibilityCondition = { condition: "user", users: ["user-admin", "user-guest"] };
      expect(evaluateCondition(cond, mockHass({}, "user-admin"))).toBe(true);
      expect(evaluateCondition(cond, mockHass({}, "user-guest"))).toBe(true);
      expect(evaluateCondition(cond, mockHass({}, "user-other"))).toBe(false);
      expect(evaluateCondition(cond, mockHass({}))).toBe(true); // Fail-open when user not set
    });
  });

  describe("logical group conditions (and, or, not)", () => {
    const hass = mockHass({
      "device_tracker.car": { state: "home" },
      "binary_sensor.garage_door": { state: "closed" },
      "sensor.car_battery": { state: "80" },
    });

    it("evaluates AND group", () => {
      const cond: VisibilityCondition = {
        condition: "and",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "home" },
          { condition: "state", entity: "binary_sensor.garage_door", state: "closed" },
        ],
      };
      expect(evaluateCondition(cond, hass)).toBe(true);

      const failingAnd: VisibilityCondition = {
        condition: "and",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "home" },
          { condition: "state", entity: "binary_sensor.garage_door", state: "open" },
        ],
      };
      expect(evaluateCondition(failingAnd, hass)).toBe(false);
    });

    it("evaluates OR group", () => {
      const cond: VisibilityCondition = {
        condition: "or",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "away" },
          { condition: "state", entity: "binary_sensor.garage_door", state: "closed" },
        ],
      };
      expect(evaluateCondition(cond, hass)).toBe(true);

      const failingOr: VisibilityCondition = {
        condition: "or",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "away" },
          { condition: "state", entity: "binary_sensor.garage_door", state: "open" },
        ],
      };
      expect(evaluateCondition(failingOr, hass)).toBe(false);
    });

    it("evaluates NOT group", () => {
      const passingNot: VisibilityCondition = {
        condition: "not",
        conditions: [{ condition: "state", entity: "device_tracker.car", state: "away" }],
      };
      expect(evaluateCondition(passingNot, hass)).toBe(true);

      const failingNot: VisibilityCondition = {
        condition: "not",
        conditions: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      };
      expect(evaluateCondition(failingNot, hass)).toBe(false);
    });

    it("evaluates complex nested composites", () => {
      const nested: VisibilityCondition = {
        condition: "and",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "home" },
          {
            condition: "or",
            conditions: [
              { condition: "numeric_state", entity: "sensor.car_battery", below: 50 },
              {
                condition: "not",
                conditions: [{ condition: "state", entity: "binary_sensor.garage_door", state: "open" }],
              },
            ],
          },
        ],
      };
      expect(evaluateCondition(nested, hass)).toBe(true);
    });
  });

  describe("collectConditionEntities", () => {
    it("returns empty array for empty or missing conditions", () => {
      expect(collectConditionEntities()).toEqual([]);
      expect(collectConditionEntities([])).toEqual([]);
    });

    it("extracts entities from flat conditions", () => {
      const conds: VisibilityCondition[] = [
        { condition: "state", entity: "device_tracker.car", state: "home" },
        { condition: "numeric_state", entity: "sensor.battery", above: 50 },
        { condition: "screen", media_query: "(min-width: 600px)" },
      ];
      expect(collectConditionEntities(conds)).toEqual(["device_tracker.car", "sensor.battery"]);
    });

    it("extracts entities from deeply nested and/or/not conditions", () => {
      const conds: VisibilityCondition[] = [
        {
          condition: "and",
          conditions: [
            { condition: "state", entity: "binary_sensor.door", state: "on" },
            {
              condition: "or",
              conditions: [
                { condition: "state", entity: "person.alice", state: "home" },
                {
                  condition: "not",
                  conditions: [{ condition: "numeric_state", entity: "sensor.temperature", below: 18 }],
                },
              ],
            },
          ],
        },
      ];
      expect(collectConditionEntities(conds)).toEqual([
        "binary_sensor.door",
        "person.alice",
        "sensor.temperature",
      ]);
    });

    it("extracts entities from target mappings and entity_id keys", () => {
      const conds: VisibilityCondition[] = [
        {
          condition: "garage_door.is_open",
          target: { entity_id: "cover.garage_door" },
          options: { behavior: "any", for: "00:00:00" },
        },
        {
          condition: "state",
          entity_id: ["light.living_room", "light.kitchen"],
          state: "on",
        },
        {
          condition: "numeric_state",
          entity_id: "sensor.living_area_temperature",
          above: "input_number.target_min_temp",
          below: "sensor.max_threshold",
        },
      ];
      expect(collectConditionEntities(conds)).toEqual([
        "cover.garage_door",
        "light.living_room",
        "light.kitchen",
        "sensor.living_area_temperature",
        "input_number.target_min_temp",
        "sensor.max_threshold",
      ]);
    });
  });

  describe("shorthand entity conditions (e.g. garage_door.is_open / garage_door.is_closed)", () => {
    it("evaluates garage_door.is_open and garage_door.is_closed on cover entities", () => {
      const openHass = mockHass({ "cover.garage_door": { state: "open" } });
      const closedHass = mockHass({ "cover.garage_door": { state: "closed" } });

      const isOpenCond: VisibilityCondition = {
        condition: "garage_door.is_open",
        target: { entity_id: "cover.garage_door" },
        options: { behavior: "any", for: "00:00:00" },
      };

      const isClosedCond: VisibilityCondition = {
        condition: "garage_door.is_closed",
        target: { entity_id: "cover.garage_door" },
        options: { behavior: "any", for: "00:00:00" },
      };

      // When garage door is open:
      expect(evaluateCondition(isOpenCond, openHass)).toBe(true);
      expect(evaluateCondition(isClosedCond, openHass)).toBe(false);

      // When garage door is closed:
      expect(evaluateCondition(isOpenCond, closedHass)).toBe(false);
      expect(evaluateCondition(isClosedCond, closedHass)).toBe(true);
    });

    it("evaluates door/window.is_open on binary_sensor entities (on = open, off = closed)", () => {
      const openHass = mockHass({ "binary_sensor.front_door": { state: "on" } });
      const closedHass = mockHass({ "binary_sensor.front_door": { state: "off" } });

      const isOpenCond: VisibilityCondition = {
        condition: "door.is_open",
        target: { entity_id: "binary_sensor.front_door" },
      };
      const isClosedCond: VisibilityCondition = {
        condition: "door.is_closed",
        target: { entity_id: "binary_sensor.front_door" },
      };

      expect(evaluateCondition(isOpenCond, openHass)).toBe(true);
      expect(evaluateCondition(isClosedCond, openHass)).toBe(false);

      expect(evaluateCondition(isOpenCond, closedHass)).toBe(false);
      expect(evaluateCondition(isClosedCond, closedHass)).toBe(true);
    });

    it("evaluates light.is_on and light.is_off", () => {
      const onHass = mockHass({ "light.kitchen": { state: "on" } });
      const offHass = mockHass({ "light.kitchen": { state: "off" } });

      expect(evaluateCondition({ condition: "light.is_on", target: { entity_id: "light.kitchen" } }, onHass)).toBe(true);
      expect(evaluateCondition({ condition: "light.is_on", target: { entity_id: "light.kitchen" } }, offHass)).toBe(false);
      expect(evaluateCondition({ condition: "light.is_off", target: { entity_id: "light.kitchen" } }, offHass)).toBe(true);
    });

    it("evaluates lock.is_locked and lock.is_unlocked", () => {
      const lockedHass = mockHass({ "lock.front_door": { state: "locked" } });
      const unlockedHass = mockHass({ "lock.front_door": { state: "unlocked" } });

      expect(evaluateCondition({ condition: "lock.is_locked", target: { entity_id: "lock.front_door" } }, lockedHass)).toBe(true);
      expect(evaluateCondition({ condition: "lock.is_locked", target: { entity_id: "lock.front_door" } }, unlockedHass)).toBe(false);
      expect(evaluateCondition({ condition: "lock.is_unlocked", target: { entity_id: "lock.front_door" } }, unlockedHass)).toBe(true);
    });

    it("supports device condition with type: is_open / is_closed", () => {
      const openHass = mockHass({ "cover.garage_door": { state: "open" } });
      const closedHass = mockHass({ "cover.garage_door": { state: "closed" } });

      const deviceOpen: VisibilityCondition = {
        condition: "device",
        type: "is_open",
        entity_id: "cover.garage_door",
      };
      const deviceClosed: VisibilityCondition = {
        condition: "device",
        type: "is_closed",
        entity_id: "cover.garage_door",
      };

      expect(evaluateCondition(deviceOpen, openHass)).toBe(true);
      expect(evaluateCondition(deviceOpen, closedHass)).toBe(false);
      expect(evaluateCondition(deviceClosed, closedHass)).toBe(true);
      expect(evaluateCondition(deviceClosed, openHass)).toBe(false);
    });

    describe("temperature.is_value and threshold options", () => {
      it("evaluates temperature.is_value with threshold type: below", () => {
        const warmHass = mockHass({
          "sensor.living_area_temperature": { state: "22", attributes: { unit_of_measurement: "°C" } },
        });
        const coldHass = mockHass({
          "sensor.living_area_temperature": { state: "18", attributes: { unit_of_measurement: "°C" } },
        });

        const belowCond: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.living_area_temperature" },
          options: {
            behavior: "any",
            for: { hours: 0, minutes: 0, seconds: 1 },
            threshold: {
              type: "below",
              value: {
                active_choice: "number",
                number: 20,
                unit_of_measurement: "°C",
              },
            },
          },
        };

        // When 18°C < 20°C: true (visible)
        expect(evaluateCondition(belowCond, coldHass)).toBe(true);
        // When 22°C >= 20°C: false (hidden)
        expect(evaluateCondition(belowCond, warmHass)).toBe(false);
      });

      it("evaluates temperature.is_value with threshold type: above", () => {
        const warmHass = mockHass({
          "sensor.living_area_temperature": { state: "22", attributes: { unit_of_measurement: "°C" } },
        });
        const coldHass = mockHass({
          "sensor.living_area_temperature": { state: "18", attributes: { unit_of_measurement: "°C" } },
        });

        const aboveCond: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.living_area_temperature" },
          options: {
            behavior: "any",
            threshold: {
              type: "above",
              value: {
                active_choice: "number",
                number: 20,
                unit_of_measurement: "°C",
              },
            },
          },
        };

        // When 22°C > 20°C: true (visible)
        expect(evaluateCondition(aboveCond, warmHass)).toBe(true);
        // When 18°C <= 20°C: false (hidden)
        expect(evaluateCondition(aboveCond, coldHass)).toBe(false);
      });

      it("handles temperature unit conversion between °C and °F", () => {
        // Sensor reports in Fahrenheit: 77°F = 25°C, 59°F = 15°C
        const warmFahrenheit = mockHass({
          "sensor.living_area_temperature": { state: "77", attributes: { unit_of_measurement: "°F" } },
        });
        const coldFahrenheit = mockHass({
          "sensor.living_area_temperature": { state: "59", attributes: { unit_of_measurement: "°F" } },
        });

        // Threshold configured in Celsius (20°C = 68°F)
        const aboveCond: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.living_area_temperature" },
          options: {
            threshold: {
              type: "above",
              value: {
                active_choice: "number",
                number: 20,
                unit_of_measurement: "°C",
              },
            },
          },
        };

        // 77°F (25°C) > 20°C (68°F) -> true
        expect(evaluateCondition(aboveCond, warmFahrenheit)).toBe(true);
        // 59°F (15°C) <= 20°C (68°F) -> false
        expect(evaluateCondition(aboveCond, coldFahrenheit)).toBe(false);
      });

      it("supports active_choice: entity referencing a helper threshold entity", () => {
        const hass = mockHass({
          "sensor.living_area_temperature": { state: "21", attributes: { unit_of_measurement: "°C" } },
          "input_number.target_limit": { state: "22", attributes: { unit_of_measurement: "°C" } },
        });

        const cond: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.living_area_temperature" },
          options: {
            threshold: {
              type: "below",
              value: {
                active_choice: "entity",
                entity: "input_number.target_limit",
              },
            },
          },
        };

        // 21 < 22 -> true
        expect(evaluateCondition(cond, hass)).toBe(true);

        // Update target limit to 20 -> 21 is not < 20 -> false
        const updatedHass = mockHass({
          "sensor.living_area_temperature": { state: "21", attributes: { unit_of_measurement: "°C" } },
          "input_number.target_limit": { state: "20", attributes: { unit_of_measurement: "°C" } },
        });
        expect(evaluateCondition(cond, updatedHass)).toBe(false);

        // Ensure both entities are collected for live subscription
        const entities = collectConditionEntities([cond]);
        expect(entities).toContain("sensor.living_area_temperature");
        expect(entities).toContain("input_number.target_limit");
      });

      it("supports in_range and outside_range threshold types", () => {
        const condInRange: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.temp" },
          options: {
            threshold: {
              type: "in_range",
              value_min: 18,
              value_max: 24,
            },
          },
        };

        expect(evaluateCondition(condInRange, mockHass({ "sensor.temp": { state: "21" } }))).toBe(true);
        expect(evaluateCondition(condInRange, mockHass({ "sensor.temp": { state: "17" } }))).toBe(false);
        expect(evaluateCondition(condInRange, mockHass({ "sensor.temp": { state: "25" } }))).toBe(false);

        const condOutside: VisibilityCondition = {
          condition: "temperature.is_value",
          target: { entity_id: "sensor.temp" },
          options: {
            threshold: {
              type: "outside_range",
              value_min: 18,
              value_max: 24,
            },
          },
        };

        expect(evaluateCondition(condOutside, mockHass({ "sensor.temp": { state: "15" } }))).toBe(true);
        expect(evaluateCondition(condOutside, mockHass({ "sensor.temp": { state: "26" } }))).toBe(true);
        expect(evaluateCondition(condOutside, mockHass({ "sensor.temp": { state: "21" } }))).toBe(false);
      });
    });

    describe("time condition", () => {
      it("evaluates after and before within same day", () => {
        const cond: VisibilityCondition = {
          condition: "time",
          after: "08:00:00",
          before: "17:00:00",
        };
        const hass = mockHass({});
        // 12:00:00 -> in range
        const midDay = new Date("2026-10-23T12:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, midDay)).toBe(true);

        // 07:30:00 -> too early
        const early = new Date("2026-10-23T07:30:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, early)).toBe(false);

        // 18:00:00 -> too late
        const late = new Date("2026-10-23T18:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, late)).toBe(false);
      });

      it("evaluates midnight-crossing time interval (e.g. 22:00 to 06:00)", () => {
        const cond: VisibilityCondition = {
          condition: "time",
          after: "22:00",
          before: "06:00",
        };
        const hass = mockHass({});
        // 23:30 -> night, matches
        const lateNight = new Date("2026-10-23T23:30:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, lateNight)).toBe(true);

        // 04:00 -> early morning, matches
        const earlyMorning = new Date("2026-10-23T04:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, earlyMorning)).toBe(true);

        // 14:00 -> day, does not match
        const day = new Date("2026-10-23T14:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, day)).toBe(false);
      });

      it("evaluates weekdays restriction", () => {
        const cond: VisibilityCondition = {
          condition: "time",
          weekdays: ["mon", "tue", "wed", "thu", "fri"],
        };
        const hass = mockHass({});
        // 2026-10-23 is a Friday
        const friday = new Date("2026-10-23T12:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, friday)).toBe(true);

        // 2026-10-24 is a Saturday
        const saturday = new Date("2026-10-24T12:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, saturday)).toBe(false);
      });

      it("resolves time from an entity ID reference", () => {
        const cond: VisibilityCondition = {
          condition: "time",
          after: "input_datetime.work_starts",
        };
        const hass = mockHass({
          "input_datetime.work_starts": { state: "09:00:00" },
        });
        const atTen = new Date("2026-10-23T10:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, atTen)).toBe(true);

        const atEight = new Date("2026-10-23T08:00:00");
        expect(evaluateTimeCondition(cond as Record<string, unknown>, hass, atEight)).toBe(false);
      });
    });

    describe("sun condition", () => {
      it("evaluates shorthand sun.is_above_horizon and sun.is_below_horizon", () => {
        const aboveCond: VisibilityCondition = {
          condition: "sun.is_above_horizon",
        };
        const belowCond: VisibilityCondition = {
          condition: "sun.is_below_horizon",
        };

        const dayHass = mockHass({ "sun.sun": { state: "above_horizon" } });
        const nightHass = mockHass({ "sun.sun": { state: "below_horizon" } });

        expect(evaluateCondition(aboveCond, dayHass)).toBe(true);
        expect(evaluateCondition(aboveCond, nightHass)).toBe(false);

        expect(evaluateCondition(belowCond, dayHass)).toBe(false);
        expect(evaluateCondition(belowCond, nightHass)).toBe(true);
      });

      it("evaluates standard sun condition with after: sunrise, before: sunset", () => {
        const dayCond: VisibilityCondition = {
          condition: "sun",
          after: "sunrise",
          before: "sunset",
        };
        const nightCond: VisibilityCondition = {
          condition: "sun",
          after: "sunset",
          before: "sunrise",
        };

        const dayHass = mockHass({ "sun.sun": { state: "above_horizon" } });
        const nightHass = mockHass({ "sun.sun": { state: "below_horizon" } });

        expect(evaluateCondition(dayCond, dayHass)).toBe(true);
        expect(evaluateCondition(dayCond, nightHass)).toBe(false);

        expect(evaluateCondition(nightCond, dayHass)).toBe(false);
        expect(evaluateCondition(nightCond, nightHass)).toBe(true);
      });

      it("evaluates sun condition with offset and timestamps", () => {
        const offsetCond = {
          condition: "sun",
          after: "sunrise",
          after_offset: "+01:00:00",
        };
        const hass = mockHass({
          "sun.sun": {
            state: "above_horizon",
            attributes: {
              next_rising: "2026-10-24T06:00:00Z",
              next_setting: "2026-10-23T18:00:00Z",
            },
          },
        });
        // Sunrise today was approx 06:00:00. Plus 1 hour offset -> 07:00:00.
        // At 08:00:00 -> after 07:00:00 -> matches
        const atEight = new Date("2026-10-23T08:00:00Z");
        expect(evaluateSunCondition(offsetCond, hass, atEight)).toBe(true);

        // At 06:30:00 -> before 07:00:00 -> does not match
        const atSixThirty = new Date("2026-10-23T06:30:00Z");
        expect(evaluateSunCondition(offsetCond, hass, atSixThirty)).toBe(false);
      });
    });

    describe("zone condition", () => {
      it("evaluates person in zone.home or zone.work", () => {
        const homeCond: VisibilityCondition = {
          condition: "zone",
          entity: "person.andrei",
          zone: "zone.home",
        };
        const workCond: VisibilityCondition = {
          condition: "zone",
          entity: "person.andrei",
          zone: "zone.work",
        };

        const atHomeHass = mockHass({
          "person.andrei": { state: "home", attributes: { in_zones: ["zone.home"] } },
          "zone.home": { state: "z", attributes: { friendly_name: "Home" } },
          "zone.work": { state: "z", attributes: { friendly_name: "Work" } },
        });

        const atWorkHass = mockHass({
          "person.andrei": { state: "work", attributes: { in_zones: ["zone.work"] } },
          "zone.home": { state: "z", attributes: { friendly_name: "Home" } },
          "zone.work": { state: "z", attributes: { friendly_name: "Work" } },
        });

        expect(evaluateCondition(homeCond, atHomeHass)).toBe(true);
        expect(evaluateCondition(workCond, atHomeHass)).toBe(false);

        expect(evaluateCondition(homeCond, atWorkHass)).toBe(false);
        expect(evaluateCondition(workCond, atWorkHass)).toBe(true);
      });

      it("evaluates not_in_zone state", () => {
        const cond: VisibilityCondition = {
          condition: "zone",
          entity: "person.andrei",
          zone: "zone.home",
          state: "not_in_zone",
        };

        const atHome = mockHass({ "person.andrei": { state: "home" } });
        const away = mockHass({ "person.andrei": { state: "not_home" } });

        expect(evaluateCondition(cond, atHome)).toBe(false);
        expect(evaluateCondition(cond, away)).toBe(true);
      });

      it("evaluates shorthand zone.in_zone with target.entity_id and options.zone (user car case)", () => {
        const cond: VisibilityCondition = {
          condition: "zone.in_zone",
          target: {
            entity_id: "device_tracker.byd_seal_u_dm_i_location",
          },
          options: {
            behavior: "any",
            zone: "zone.home",
          },
        };

        const carAway = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "not_home" },
          "zone.home": { state: "z", attributes: { friendly_name: "Home" } },
        });

        const carHome = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "home" },
          "zone.home": { state: "z", attributes: { friendly_name: "Home" } },
        });

        expect(evaluateCondition(cond, carAway)).toBe(false);
        expect(evaluateCondition(cond, carHome)).toBe(true);
      });

      it("evaluates shorthand zone.not_in_zone", () => {
        const cond: VisibilityCondition = {
          condition: "zone.not_in_zone",
          target: {
            entity_id: "device_tracker.byd_seal_u_dm_i_location",
          },
          options: {
            zone: "zone.home",
          },
        };

        const carAway = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "not_home" },
        });

        const carHome = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "home" },
        });

        expect(evaluateCondition(cond, carAway)).toBe(true);
        expect(evaluateCondition(cond, carHome)).toBe(false);
      });

      it("falls back to furniture entity when condition target/entity_id is omitted", () => {
        const f = {
          id: "car_1",
          type: "car_ev",
          x: 0,
          y: 0,
          w: 100,
          h: 200,
          entity: "device_tracker.byd_seal_u_dm_i_location",
          visibility: [
            {
              condition: "zone.in_zone",
              options: {
                zone: "zone.home",
              },
            },
          ],
        };

        const carAway = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "not_home" },
        });
        const carHome = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": { state: "home" },
        });

        expect(isFurnitureVisible(f, carAway)).toBe(false);
        expect(isFurnitureVisible(f, carHome)).toBe(true);
      });

      it("evaluates in_zones attribute and state (exact car location payload)", () => {
        const cond: VisibilityCondition = {
          condition: "zone.in_zone",
          target: {
            entity_id: "device_tracker.byd_seal_u_dm_i_location",
          },
          options: {
            zone: "zone.home",
          },
        };

        const homeHass = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": {
            state: "home",
            attributes: {
              in_zones: ["zone.home"],
              tracking_type: "position",
              source_type: "gps",
            },
          },
        });

        const awayHass = mockHass({
          "device_tracker.byd_seal_u_dm_i_location": {
            state: "not_home",
            attributes: {
              in_zones: [],
              tracking_type: "position",
              source_type: "gps",
            },
          },
        });

        expect(evaluateCondition(cond, homeHass)).toBe(true);
        expect(evaluateCondition(cond, awayHass)).toBe(false);
      });
    });

    describe("location condition", () => {
      it("evaluates away: true matching user's person", () => {
        const awayCond: VisibilityCondition = {
          condition: "location",
          away: true,
        };
        const hassAway = {
          ...mockHass({
            "person.alice": { state: "not_home", attributes: { user_id: "u123" } },
          }),
          user: { id: "u123" },
        };
        const hassHome = {
          ...mockHass({
            "person.alice": { state: "home", attributes: { user_id: "u123" } },
          }),
          user: { id: "u123" },
        };

        expect(evaluateCondition(awayCond, hassAway)).toBe(true);
        expect(evaluateCondition(awayCond, hassHome)).toBe(false);
      });

      it("evaluates locations list matching user's person", () => {
        const locCond: VisibilityCondition = {
          condition: "location",
          locations: ["home", "work"],
        };
        const hassHome = {
          ...mockHass({
            "person.alice": { state: "home", attributes: { user_id: "u123" } },
          }),
          user: { id: "u123" },
        };
        const hassGym = {
          ...mockHass({
            "person.alice": { state: "gym", attributes: { user_id: "u123" } },
          }),
          user: { id: "u123" },
        };

        expect(evaluateCondition(locCond, hassHome)).toBe(true);
        expect(evaluateCondition(locCond, hassGym)).toBe(false);
      });
    });

    describe("view_columns and template conditions", () => {
      it("view_columns condition fails open in floorplan card view", () => {
        const cond: VisibilityCondition = {
          condition: "view_columns",
          min: 2,
          max: 4,
        };
        expect(evaluateCondition(cond, mockHass({}))).toBe(true);
      });

      it("template condition fails open client-side", () => {
        const cond: VisibilityCondition = {
          condition: "template",
          value_template: "{{ is_state('sun.sun', 'above_horizon') }}",
        } as unknown as VisibilityCondition;
        expect(evaluateCondition(cond, mockHass({}))).toBe(true);
      });
    });

    describe("state condition with entity reference resolution", () => {
      it("resolves another entity's state when condition.state is an entity ID", () => {
        const cond: VisibilityCondition = {
          condition: "state",
          entity: "sensor.living_room_mode",
          state: "input_select.house_mode",
        };

        const matchingHass = mockHass({
          "sensor.living_room_mode": { state: "evening" },
          "input_select.house_mode": { state: "evening" },
        });

        const mismatchHass = mockHass({
          "sensor.living_room_mode": { state: "day" },
          "input_select.house_mode": { state: "evening" },
        });

        expect(evaluateCondition(cond, matchingHass)).toBe(true);
        expect(evaluateCondition(cond, mismatchHass)).toBe(false);
      });
    });

    describe("expanded domain shorthand actions", () => {
      it("evaluates motion.is_detected and motion.is_clear", () => {
        const detectedCond: VisibilityCondition = {
          condition: "motion.is_detected",
          target: { entity_id: "binary_sensor.living_room_motion" },
        };
        const clearCond: VisibilityCondition = {
          condition: "motion.is_clear",
          target: { entity_id: "binary_sensor.living_room_motion" },
        };

        const motionOn = mockHass({ "binary_sensor.living_room_motion": { state: "on" } });
        const motionOff = mockHass({ "binary_sensor.living_room_motion": { state: "off" } });

        expect(evaluateCondition(detectedCond, motionOn)).toBe(true);
        expect(evaluateCondition(detectedCond, motionOff)).toBe(false);

        expect(evaluateCondition(clearCond, motionOn)).toBe(false);
        expect(evaluateCondition(clearCond, motionOff)).toBe(true);
      });

      it("evaluates occupancy.is_occupied and occupancy.is_not_occupied", () => {
        const occCond: VisibilityCondition = {
          condition: "occupancy.is_occupied",
          entity: "binary_sensor.office_occupancy",
        };
        const notOccCond: VisibilityCondition = {
          condition: "occupancy.is_not_occupied",
          entity: "binary_sensor.office_occupancy",
        };

        const onHass = mockHass({ "binary_sensor.office_occupancy": { state: "on" } });
        const offHass = mockHass({ "binary_sensor.office_occupancy": { state: "off" } });

        expect(evaluateCondition(occCond, onHass)).toBe(true);
        expect(evaluateCondition(occCond, offHass)).toBe(false);

        expect(evaluateCondition(notOccCond, onHass)).toBe(false);
        expect(evaluateCondition(notOccCond, offHass)).toBe(true);
      });

      it("evaluates plug.is_plugged_in and plug.is_unplugged", () => {
        const pluggedCond: VisibilityCondition = {
          condition: "plug.is_plugged_in",
          entity: "binary_sensor.ev_plug",
        };
        const unpluggedCond: VisibilityCondition = {
          condition: "plug.is_unplugged",
          entity: "binary_sensor.ev_plug",
        };

        const onHass = mockHass({ "binary_sensor.ev_plug": { state: "on" } });
        const offHass = mockHass({ "binary_sensor.ev_plug": { state: "off" } });

        expect(evaluateCondition(pluggedCond, onHass)).toBe(true);
        expect(evaluateCondition(pluggedCond, offHass)).toBe(false);

        expect(evaluateCondition(unpluggedCond, onHass)).toBe(false);
        expect(evaluateCondition(unpluggedCond, offHass)).toBe(true);
      });

      it("evaluates media_player states (is_playing, is_paused, is_idle)", () => {
        const playingCond: VisibilityCondition = {
          condition: "media_player.is_playing",
          entity: "media_player.tv",
        };
        const pausedCond: VisibilityCondition = {
          condition: "media_player.is_paused",
          entity: "media_player.tv",
        };

        const playingHass = mockHass({ "media_player.tv": { state: "playing" } });
        const pausedHass = mockHass({ "media_player.tv": { state: "paused" } });

        expect(evaluateCondition(playingCond, playingHass)).toBe(true);
        expect(evaluateCondition(playingCond, pausedHass)).toBe(false);

        expect(evaluateCondition(pausedCond, playingHass)).toBe(false);
        expect(evaluateCondition(pausedCond, pausedHass)).toBe(true);
      });

      it("evaluates vacuum states (is_cleaning, is_docked)", () => {
        const cleanCond: VisibilityCondition = {
          condition: "vacuum.is_cleaning",
          entity: "vacuum.roborock",
        };
        const dockedCond: VisibilityCondition = {
          condition: "vacuum.is_docked",
          entity: "vacuum.roborock",
        };

        const cleanHass = mockHass({ "vacuum.roborock": { state: "cleaning" } });
        const dockHass = mockHass({ "vacuum.roborock": { state: "docked" } });

        expect(evaluateCondition(cleanCond, cleanHass)).toBe(true);
        expect(evaluateCondition(cleanCond, dockHass)).toBe(false);

        expect(evaluateCondition(dockedCond, cleanHass)).toBe(false);
        expect(evaluateCondition(dockedCond, dockHass)).toBe(true);
      });

      it("evaluates alarm_control_panel states (is_armed_home, is_disarmed)", () => {
        const armedCond: VisibilityCondition = {
          condition: "alarm_control_panel.is_armed_home",
          entity: "alarm_control_panel.home_alarm",
        };
        const disarmedCond: VisibilityCondition = {
          condition: "alarm_control_panel.is_disarmed",
          entity: "alarm_control_panel.home_alarm",
        };

        const armedHass = mockHass({ "alarm_control_panel.home_alarm": { state: "armed_home" } });
        const disarmedHass = mockHass({ "alarm_control_panel.home_alarm": { state: "disarmed" } });

        expect(evaluateCondition(armedCond, armedHass)).toBe(true);
        expect(evaluateCondition(armedCond, disarmedHass)).toBe(false);

        expect(evaluateCondition(disarmedCond, armedHass)).toBe(false);
        expect(evaluateCondition(disarmedCond, disarmedHass)).toBe(true);
      });
    });

    describe("collectConditionEntities comprehensive registration", () => {
      it("collects sun.sun for sun conditions", () => {
        const cond: VisibilityCondition = { condition: "sun" };
        expect(collectConditionEntities([cond])).toContain("sun.sun");
      });

      it("collects entities from time conditions", () => {
        const cond: VisibilityCondition = {
          condition: "time",
          after: "input_datetime.work_starts",
          before: "input_datetime.work_ends",
        };
        const ents = collectConditionEntities([cond]);
        expect(ents).toContain("input_datetime.work_starts");
        expect(ents).toContain("input_datetime.work_ends");
      });

      it("collects zone entity from zone condition", () => {
        const cond: VisibilityCondition = {
          condition: "zone",
          entity: "person.andrei",
          zone: "zone.work",
        };
        const ents = collectConditionEntities([cond]);
        expect(ents).toContain("person.andrei");
        expect(ents).toContain("zone.work");
      });

      it("collects state target entity references", () => {
        const cond: VisibilityCondition = {
          condition: "state",
          entity: "sensor.living_room_mode",
          state: "input_select.house_mode",
        };
        const ents = collectConditionEntities([cond]);
        expect(ents).toContain("sensor.living_room_mode");
        expect(ents).toContain("input_select.house_mode");
      });
    });
  });
});
