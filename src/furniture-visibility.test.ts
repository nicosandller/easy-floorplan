// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  collectConditionEntities,
  evaluateCondition,
  evaluateConditions,
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
      ];
      expect(collectConditionEntities(conds)).toEqual([
        "cover.garage_door",
        "light.living_room",
        "light.kitchen",
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
  });
});
