// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  collectConditionEntities,
  collectConditionMediaQueries,
  evaluateCondition,
  evaluateConditions,
  hasLocationConditions,
  hasTimeConditions,
  isEntityId,
  isFurnitureVisible,
  statesMatch,
} from "./furniture-visibility";
import type { FloorplanCardConfig, Furniture, HomeAssistant, VisibilityCondition } from "./types";

const mockHass = (
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>,
  userId?: string,
  entities?: Record<string, { entity_id: string; device_id?: string; [key: string]: unknown }>
): HomeAssistant =>
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
    entities: entities ?? {},
    user: userId ? { id: userId } : undefined,
  } as unknown as HomeAssistant);

describe("furniture-visibility", () => {
  describe("isEntityId", () => {
    it("recognizes valid entity IDs", () => {
      expect(isEntityId("sensor.temperature")).toBe(true);
      expect(isEntityId("device_tracker.car")).toBe(true);
      expect(isEntityId("cover.garage_door")).toBe(true);
      expect(isEntityId("light.living_room_1")).toBe(true);
    });

    it("rejects non-entity values", () => {
      expect(isEntityId("")).toBe(false);
      expect(isEntityId("temperature")).toBe(false);
      expect(isEntityId("20")).toBe(false);
      expect(isEntityId("sensor. temperature")).toBe(false);
      expect(isEntityId(123)).toBe(false);
      expect(isEntityId(null)).toBe(false);
      expect(isEntityId(undefined)).toBe(false);
    });
  });

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

    it("evaluates condition against hass and reflects visibility", () => {
      const f: Furniture = {
        id: "furn-1",
        type: "car",
        x: 0,
        y: 0,
        w: 90,
        h: 180,
        visibility: [{ condition: "state", entity: "device_tracker.car", state: "home" }],
      };
      const hassHome = mockHass({ "device_tracker.car": { state: "home" } });
      const hassAway = mockHass({ "device_tracker.car": { state: "not_home" } });

      expect(isFurnitureVisible(f, hassHome)).toBe(true);
      expect(isFurnitureVisible(f, hassAway)).toBe(false);
    });
  });

  describe("evaluateConditions", () => {
    it("evaluates all conditions with AND conjunction", () => {
      const conditions: VisibilityCondition[] = [
        { condition: "state", entity: "device_tracker.car", state: "home" },
        { condition: "state", entity: "lock.garage", state: "locked" },
      ];
      const hassBoth = mockHass({
        "device_tracker.car": { state: "home" },
        "lock.garage": { state: "locked" },
      });
      const hassOne = mockHass({
        "device_tracker.car": { state: "home" },
        "lock.garage": { state: "unlocked" },
      });
      expect(evaluateConditions(conditions, hassBoth)).toBe(true);
      expect(evaluateConditions(conditions, hassOne)).toBe(false);
    });
  });

  describe("state condition", () => {
    it("matches single state value", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: "home",
      };
      const hassHome = mockHass({ "device_tracker.car": { state: "home" } });
      const hassAway = mockHass({ "device_tracker.car": { state: "away" } });

      expect(evaluateCondition(cond, hassHome)).toBe(true);
      expect(evaluateCondition(cond, hassAway)).toBe(false);
    });

    it("matches array of state values", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: ["home", "work"],
      };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "work" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "school" } }))).toBe(false);
    });

    it("evaluates state_not correctly", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state_not: "away",
      };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "away" } }))).toBe(false);
    });

    it("evaluates entity attributes when attribute is specified", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "climate.thermostat",
        attribute: "preset_mode",
        state: "eco",
      };
      const hassEco = mockHass({
        "climate.thermostat": { state: "heat", attributes: { preset_mode: "eco" } },
      });
      const hassComfort = mockHass({
        "climate.thermostat": { state: "heat", attributes: { preset_mode: "comfort" } },
      });

      expect(evaluateCondition(cond, hassEco)).toBe(true);
      expect(evaluateCondition(cond, hassComfort)).toBe(false);
    });

    it("resolves target entity state when state references another entity ID", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "sensor.bedroom_mode",
        state: "input_select.house_mode",
      };
      const hassMatching = mockHass({
        "sensor.bedroom_mode": { state: "night" },
        "input_select.house_mode": { state: "night" },
      });
      const hassDifferent = mockHass({
        "sensor.bedroom_mode": { state: "day" },
        "input_select.house_mode": { state: "night" },
      });

      expect(evaluateCondition(cond, hassMatching)).toBe(true);
      expect(evaluateCondition(cond, hassDifferent)).toBe(false);
    });

    it("supports entity_id alias for entity", () => {
      const cond = {
        condition: "state",
        entity_id: "light.living_room",
        state: "on",
      };
      expect(evaluateCondition(cond, mockHass({ "light.living_room": { state: "on" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "light.living_room": { state: "off" } }))).toBe(false);
    });

    it("fails closed when entity and entity_id are omitted or empty", () => {
      const condEmpty = { condition: "state", entity: "", state: "on" };
      const condMissing = { condition: "state", state: "on" };
      expect(evaluateCondition(condEmpty as VisibilityCondition, mockHass({ "light.desk": { state: "on" } }))).toBe(false);
      expect(evaluateCondition(condMissing as VisibilityCondition, mockHass({ "light.desk": { state: "on" } }))).toBe(false);
    });

    it("matches exact states across covers and binary sensors", () => {
      const coverClosed = mockHass({ "cover.garage_door": { state: "closed" } });
      const coverOpen = mockHass({ "cover.garage_door": { state: "open" } });
      const coverClosing = mockHass({ "cover.garage_door": { state: "closing" } });

      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "closed" } as VisibilityCondition,
          coverClosed
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "closed" } as VisibilityCondition,
          coverOpen
        )
      ).toBe(false);
      // 'closing' does NOT match 'closed'
      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "closed" } as VisibilityCondition,
          coverClosing
        )
      ).toBe(false);

      // 'off' does NOT match cover's 'closed'
      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "off" } as VisibilityCondition,
          coverClosed
        )
      ).toBe(false);

      const sensorOff = mockHass({ "binary_sensor.garage_door": { state: "off" } });
      const sensorOn = mockHass({ "binary_sensor.garage_door": { state: "on" } });

      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "off" } as VisibilityCondition,
          sensorOff
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "on" } as VisibilityCondition,
          sensorOn
        )
      ).toBe(true);
      // 'closed' does NOT match binary_sensor's 'off'
      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "closed" } as VisibilityCondition,
          sensorOff
        )
      ).toBe(false);
    });

    it("handles case-insensitivity", () => {
      const hassOn = mockHass({ "switch.relay": { state: "on" } });
      const hassOff = mockHass({ "switch.relay": { state: "off" } });

      expect(
        evaluateCondition(
          { condition: "state", entity: "switch.relay", state: "ON" } as VisibilityCondition,
          hassOn
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "switch.relay", state: "OFF" } as VisibilityCondition,
          hassOff
        )
      ).toBe(true);
    });
  });

  describe("statesMatch", () => {
    it("matches exact values", () => {
      expect(statesMatch("home", "home")).toBe(true);
      expect(statesMatch("heat", "heat")).toBe(true);
      expect(statesMatch("auto", "auto")).toBe(true);
      expect(statesMatch("home", "away")).toBe(false);
    });

    it("matches case-insensitively", () => {
      expect(statesMatch("Open", "open")).toBe(true);
      expect(statesMatch("CLOSED", "closed")).toBe(true);
      expect(statesMatch("Home", "home")).toBe(true);
    });

    it("does not alias closed/closing, on/unlocked or open/opening", () => {
      expect(statesMatch("closed", "off")).toBe(false);
      expect(statesMatch("closing", "closed")).toBe(false);
      expect(statesMatch("locked", "closed")).toBe(false);
      expect(statesMatch("unlocked", "on")).toBe(false);
      expect(statesMatch("opening", "open")).toBe(false);
      expect(statesMatch("open", "on")).toBe(false);
      expect(statesMatch("away", "not_home")).toBe(false);
    });

    it("matches numeric equivalence", () => {
      expect(statesMatch(20, "20")).toBe(true);
      expect(statesMatch("20.0", 20)).toBe(true);
      expect(statesMatch(0, "0")).toBe(true);
      expect(statesMatch(20, "25")).toBe(false);
    });
  });

  describe("numeric_state condition", () => {
    it("fails closed when entity is omitted or empty in numeric_state", () => {
      const condEmpty = { condition: "numeric_state", entity: "", above: 20 };
      const condMissing = { condition: "numeric_state", above: 20 };
      expect(evaluateCondition(condEmpty as VisibilityCondition, mockHass({}))).toBe(false);
      expect(evaluateCondition(condMissing as VisibilityCondition, mockHass({}))).toBe(false);
    });
    it("evaluates above threshold", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        above: 20,
      };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "21.5" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "20.0" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "19.5" } }))).toBe(false);
    });

    it("evaluates below threshold", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        below: 15,
      };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "14.9" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "15.0" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "16.2" } }))).toBe(false);
    });

    it("evaluates range (above AND below)", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        above: 18,
        below: 24,
      };
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "21" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "18" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "24" } }))).toBe(false);
      expect(evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "12" } }))).toBe(false);
    });

    it("resolves helper entity thresholds for above/below", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "sensor.temperature",
        above: "input_number.comfort_min",
      };
      const hass = mockHass({
        "sensor.temperature": { state: "22" },
        "input_number.comfort_min": { state: "20" },
      });
      expect(evaluateCondition(cond, hass)).toBe(true);

      const hassCold = mockHass({
        "sensor.temperature": { state: "19" },
        "input_number.comfort_min": { state: "20" },
      });
      expect(evaluateCondition(cond, hassCold)).toBe(false);
    });

    it("evaluates attribute numeric values", () => {
      const cond: VisibilityCondition = {
        condition: "numeric_state",
        entity: "cover.garage_door",
        attribute: "current_position",
        above: 50,
      };
      const hassOpen = mockHass({
        "cover.garage_door": { state: "open", attributes: { current_position: 80 } },
      });
      const hassAjar = mockHass({
        "cover.garage_door": { state: "open", attributes: { current_position: 30 } },
      });

      expect(evaluateCondition(cond, hassOpen)).toBe(true);
      expect(evaluateCondition(cond, hassAjar)).toBe(false);
    });
  });

  describe("screen condition", () => {
    it("evaluates window.matchMedia queries", () => {
      const cond: VisibilityCondition = {
        condition: "screen",
        media_query: "(min-width: 800px)",
      };
      // jsdom default matches false or mock
      const res = evaluateCondition(cond, mockHass({}));
      expect(typeof res).toBe("boolean");
    });

    it("fails open if media query is empty", () => {
      const cond: VisibilityCondition = {
        condition: "screen",
        media_query: "",
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
    });
  });

  describe("user condition", () => {
    it("matches when current user is in users list", () => {
      const cond: VisibilityCondition = {
        condition: "user",
        users: ["user_alice", "user_bob"],
      };
      expect(evaluateCondition(cond, mockHass({}, "user_alice"))).toBe(true);
      expect(evaluateCondition(cond, mockHass({}, "user_bob"))).toBe(true);
      expect(evaluateCondition(cond, mockHass({}, "user_charlie"))).toBe(false);
    });

    it("fails open when user context is absent from hass", () => {
      const cond: VisibilityCondition = {
        condition: "user",
        users: ["user_alice"],
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
    });
  });

  describe("logical conditions (and, or, not)", () => {
    it("evaluates 'and' condition requiring all to pass", () => {
      const cond: VisibilityCondition = {
        condition: "and",
        conditions: [
          { condition: "state", entity: "device_tracker.car", state: "home" },
          { condition: "state", entity: "cover.garage_door", state: "closed" },
        ],
      };
      expect(
        evaluateCondition(
          cond,
          mockHass({
            "device_tracker.car": { state: "home" },
            "cover.garage_door": { state: "closed" },
          })
        )
      ).toBe(true);

      expect(
        evaluateCondition(
          cond,
          mockHass({
            "device_tracker.car": { state: "home" },
            "cover.garage_door": { state: "open" },
          })
        )
      ).toBe(false);
    });

    it("evaluates 'or' condition requiring at least one to pass", () => {
      const cond: VisibilityCondition = {
        condition: "or",
        conditions: [
          { condition: "state", entity: "device_tracker.car1", state: "home" },
          { condition: "state", entity: "device_tracker.car2", state: "home" },
        ],
      };
      expect(
        evaluateCondition(
          cond,
          mockHass({
            "device_tracker.car1": { state: "home" },
            "device_tracker.car2": { state: "away" },
          })
        )
      ).toBe(true);

      expect(
        evaluateCondition(
          cond,
          mockHass({
            "device_tracker.car1": { state: "away" },
            "device_tracker.car2": { state: "away" },
          })
        )
      ).toBe(false);
    });

    it("evaluates 'not' condition inverting normal results", () => {
      const cond: VisibilityCondition = {
        condition: "not",
        conditions: [{ condition: "state", entity: "device_tracker.car", state: "away" }],
      };
      // Car is home -> inner condition is false -> not false = true
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))
      ).toBe(true);

      // Car is away -> inner condition is true -> not true = false
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "away" } }))
      ).toBe(false);
    });
  });

  describe("fail-open outage protection (PR #399 Review Item 4)", () => {
    it("fails open (passes) when an entity is missing from hass", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: "home",
      };
      // Empty hass, entity does not exist
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
    });

    it("fails open (passes) when an entity is unavailable or unknown", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: "home",
      };
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unavailable" } }))
      ).toBe(true);
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unknown" } }))
      ).toBe(true);
    });

    it("evaluates accurately when explicitly checking for unavailable or unknown", () => {
      const cond: VisibilityCondition = {
        condition: "state",
        entity: "device_tracker.car",
        state: "unavailable",
      };
      // State is unavailable -> condition met
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unavailable" } }))
      ).toBe(true);

      // State is home -> condition not met
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "home" } }))
      ).toBe(false);
    });

    it("under 'not', unavailable entity fails open and keeps the piece visible", () => {
      const cond: VisibilityCondition = {
        condition: "not",
        conditions: [
          {
            condition: "state",
            entity: "device_tracker.car",
            state: "away",
          },
        ],
      };

      // When car is unavailable during HA restart, fail-open MUST NOT flip to false and hide the car!
      // It must remain visible (true).
      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unavailable" } }))
      ).toBe(true);

      expect(
        evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unknown" } }))
      ).toBe(true);

      // Missing entity also fails open under not
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
    });

    it("under 'not', an explicit check for unavailable hides the piece if unavailable", () => {
      const cond: VisibilityCondition = {
        condition: "not",
        conditions: [
          {
            condition: "state",
            entity: "sensor.temperature",
            state: "unavailable",
          },
        ],
      };

      // Explicitly testing for unavailable:
      // When unavailable: inner condition is true, not inverts it to false (hide the piece)
      expect(
        evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "unavailable" } }))
      ).toBe(false);

      // When healthy (e.g. 21°C): inner condition is false, not inverts to true (show the piece)
      expect(
        evaluateCondition(cond, mockHass({ "sensor.temperature": { state: "21" } }))
      ).toBe(true);
    });
  });

  describe("collectConditionEntities", () => {
    it("collects primary entities from conditions", () => {
      const conditions: VisibilityCondition[] = [
        { condition: "state", entity: "device_tracker.car", state: "home" },
        { condition: "numeric_state", entity: "sensor.temperature", below: 20 },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("device_tracker.car");
      expect(entities).toContain("sensor.temperature");
    });

    it("collects helper entities used as numeric thresholds", () => {
      const conditions: VisibilityCondition[] = [
        {
          condition: "numeric_state",
          entity: "sensor.outdoor_temp",
          above: "input_number.threshold_min",
          below: "input_number.threshold_max",
        },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("sensor.outdoor_temp");
      expect(entities).toContain("input_number.threshold_min");
      expect(entities).toContain("input_number.threshold_max");
    });

    it("recursively collects entities from nested and/or/not groups", () => {
      const conditions: VisibilityCondition[] = [
        {
          condition: "or",
          conditions: [
            {
              condition: "and",
              conditions: [
                { condition: "state", entity: "binary_sensor.presence_1", state: "on" },
                { condition: "state", entity: "binary_sensor.presence_2", state: "on" },
              ],
            },
            {
              condition: "not",
              conditions: [{ condition: "state", entity: "alarm_control_panel.home", state: "armed_away" }],
            },
          ],
        },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("binary_sensor.presence_1");
      expect(entities).toContain("binary_sensor.presence_2");
      expect(entities).toContain("alarm_control_panel.home");
    });

    it("collects subject entity IDs from conditions", () => {
      const conditions: VisibilityCondition[] = [
        { condition: "state", entity: "device_tracker.car", state: "home" },
        { condition: "state", entity_id: "cover.garage_door", state: "closed" },
        { condition: "numeric_state", entity: "sensor.living_room_temp", above: 20 },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("device_tracker.car");
      expect(entities).toContain("cover.garage_door");
      expect(entities).toContain("sensor.living_room_temp");
    });

    it("ignores conditions without valid entity", () => {
      const conditions = [
        { condition: "screen", media_query: "(min-width: 800px)" },
        { condition: "user", users: ["admin"] },
        { condition: "unsupported" },
      ] as unknown as VisibilityCondition[];
      const entities = collectConditionEntities(conditions);
      expect(entities).toEqual([]);
    });

    it("collects target zone entities from location conditions", () => {
      const conditions: VisibilityCondition[] = [
        {
          condition: "location",
          target: { entity_id: "zone.home" },
        },
        {
          condition: "location",
          target: { entity_id: ["zone.work", "zone.school"] },
        },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("zone.home");
      expect(entities).toContain("zone.work");
      expect(entities).toContain("zone.school");
    });
  });

  describe("time condition", () => {
    it("matches time range within the same day", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2025, 0, 15, 14, 30, 0)); // 14:30

      const cond: VisibilityCondition = {
        condition: "time",
        after: "10:00:00",
        before: "18:00:00",
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);

      const condBefore: VisibilityCondition = {
        condition: "time",
        after: "15:00:00",
      };
      expect(evaluateCondition(condBefore, mockHass({}))).toBe(false);

      const condAfter: VisibilityCondition = {
        condition: "time",
        before: "14:00:00",
      };
      expect(evaluateCondition(condAfter, mockHass({}))).toBe(false);

      vi.useRealTimers();
    });

    it("supports midnight-crossing intervals", () => {
      vi.useFakeTimers();
      // 23:30 (should match 22:00 -> 06:00)
      vi.setSystemTime(new Date(2025, 0, 15, 23, 30, 0));
      const condNight: VisibilityCondition = {
        condition: "time",
        after: "22:00:00",
        before: "06:00:00",
      };
      expect(evaluateCondition(condNight, mockHass({}))).toBe(true);

      // 03:00 (should match 22:00 -> 06:00)
      vi.setSystemTime(new Date(2025, 0, 15, 3, 0, 0));
      expect(evaluateCondition(condNight, mockHass({}))).toBe(true);

      // 12:00 (should NOT match 22:00 -> 06:00)
      vi.setSystemTime(new Date(2025, 0, 15, 12, 0, 0));
      expect(evaluateCondition(condNight, mockHass({}))).toBe(false);

      vi.useRealTimers();
    });

    it("evaluates weekday restrictions", () => {
      vi.useFakeTimers();
      // 2025-01-15 is a Wednesday ("wed")
      vi.setSystemTime(new Date(2025, 0, 15, 12, 0, 0));

      const matchWeekday: VisibilityCondition = {
        condition: "time",
        weekdays: ["mon", "wed", "fri"],
      };
      expect(evaluateCondition(matchWeekday, mockHass({}))).toBe(true);

      const nonMatchWeekday: VisibilityCondition = {
        condition: "time",
        weekdays: ["sat", "sun"],
      };
      expect(evaluateCondition(nonMatchWeekday, mockHass({}))).toBe(false);

      vi.useRealTimers();
    });

    it("detects time conditions in config with hasTimeConditions", () => {
      const configWithTime: FloorplanCardConfig = {
        type: "custom:easy-floorplan-card",
        floors: [
          {
            id: "f1",
            furniture: [
              {
                id: "lamp",
                type: "lamp",
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                visibility: [{ condition: "time", after: "18:00:00" }],
              },
            ],
          },
        ],
      } as unknown as FloorplanCardConfig;

      expect(hasTimeConditions(configWithTime)).toBe(true);

      const configWithoutTime: FloorplanCardConfig = {
        type: "custom:easy-floorplan-card",
        floors: [
          {
            id: "f1",
            furniture: [{ id: "lamp", type: "lamp", x: 0, y: 0, w: 10, h: 10 }],
          },
        ],
      } as unknown as FloorplanCardConfig;

      expect(hasTimeConditions(configWithoutTime)).toBe(false);
    });
  });

  describe("location condition", () => {
    const userHass = (personState: string, inZones?: string[]) =>
      mockHass(
        {
          "person.john": {
            state: personState,
            attributes: { user_id: "user_123", in_zones: inZones ?? [] },
          },
          "zone.home": {
            state: "0",
            attributes: { friendly_name: "Home" },
          },
          "zone.work": {
            state: "0",
            attributes: { friendly_name: "Work" },
          },
        },
        "user_123"
      );

    it("evaluates away condition", () => {
      const cond: VisibilityCondition = { condition: "location", away: true };
      expect(evaluateCondition(cond, userHass("not_home"))).toBe(true);
      expect(evaluateCondition(cond, userHass("Home"))).toBe(false);
    });

    it("evaluates locations list condition", () => {
      const cond: VisibilityCondition = { condition: "location", locations: ["Home", "Work"] };
      expect(evaluateCondition(cond, userHass("Home"))).toBe(true);
      expect(evaluateCondition(cond, userHass("Work"))).toBe(true);
      expect(evaluateCondition(cond, userHass("not_home"))).toBe(false);
    });

    it("evaluates target zone condition", () => {
      const cond: VisibilityCondition = {
        condition: "location",
        target: { entity_id: "zone.home" },
      };
      expect(evaluateCondition(cond, userHass("Home"))).toBe(true);
      expect(evaluateCondition(cond, userHass("Work"))).toBe(false);
      expect(evaluateCondition(cond, userHass("not_home"))).toBe(false);
    });

    it("passes if any of locations, away, or target zones match", () => {
      // PR #399 review: HA's location condition passes if any of locations, away or target zones match
      const cond: VisibilityCondition = {
        condition: "location",
        locations: ["Home"],
        away: true,
      };
      // When at home: locations matches -> true
      expect(evaluateCondition(cond, userHass("Home"))).toBe(true);
      // When away: away matches -> true
      expect(evaluateCondition(cond, userHass("not_home"))).toBe(true);
      // When at work: neither matches -> false
      expect(evaluateCondition(cond, userHass("Work"))).toBe(false);
    });

    it("evaluates combination of target zones and away", () => {
      const cond: VisibilityCondition = {
        condition: "location",
        target: { entity_id: "zone.work" },
        away: true,
      };
      // When at work: target zone matches -> true
      expect(evaluateCondition(cond, userHass("Work", ["zone.work"]))).toBe(true);
      // When away (not_home): away matches -> true
      expect(evaluateCondition(cond, userHass("not_home"))).toBe(true);
      // When at home: neither matches -> false
      expect(evaluateCondition(cond, userHass("Home", ["zone.home"]))).toBe(false);
    });

    it("fails when location condition has no matching criteria or is empty", () => {
      const emptyCond = { condition: "location" } as unknown as VisibilityCondition;
      expect(evaluateCondition(emptyCond, userHass("Home"))).toBe(false);
    });

    it("fails open during outages (unavailable / unknown / empty states)", () => {
      const cond: VisibilityCondition = { condition: "location", away: true };
      expect(evaluateCondition(cond, userHass("unavailable"))).toBe(true);
      expect(evaluateCondition(cond, userHass("unknown"))).toBe(true);
      expect(evaluateCondition(cond, mockHass({}, "user_123"))).toBe(true);
    });

    it("detects location conditions in config with hasLocationConditions", () => {
      const configWithLocation: FloorplanCardConfig = {
        type: "custom:easy-floorplan-card",
        floors: [
          {
            id: "f1",
            furniture: [
              {
                id: "car",
                type: "car",
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                visibility: [{ condition: "location", away: true }],
              },
            ],
          },
        ],
      } as unknown as FloorplanCardConfig;

      expect(hasLocationConditions(configWithLocation)).toBe(true);
    });
  });

  describe("unsupported condition types fail closed", () => {
    it("fails closed for automation, template, and unsupported condition types", () => {
      const unsupported = [
        { condition: "sun", after: "sunset" },
        { condition: "sun.is_ascending" },
        { condition: "sun.is_descending" },
        { condition: "sun.is_above_horizon" },
        { condition: "sun.is_below_horizon" },
        { condition: "garage_door.is_open" },
        { condition: "area", area: "living_room" },
        { condition: "template", value_template: "{{ true }}" },
        { condition: "device", device_id: "dev1", type: "is_on" },
        { condition: "zone", entity: "device_tracker.car", zone: "zone.home" },
      ];
      for (const cond of unsupported) {
        expect(evaluateCondition(cond as unknown as VisibilityCondition, mockHass({}))).toBe(false);
      }
    });
  });

  describe("collectConditionMediaQueries", () => {
    it("extracts unique media query strings from card config", () => {
      const config: FloorplanCardConfig = {
        type: "custom:easy-floorplan-card",
        floors: [
          {
            id: "f1",
            furniture: [
              {
                id: "desk",
                type: "desk",
                x: 0,
                y: 0,
                w: 10,
                h: 10,
                visibility: [
                  { condition: "screen", media_query: "(min-width: 768px)" },
                  { condition: "screen", media_query: "(min-width: 768px)" },
                  { condition: "screen", media_query: "(max-width: 1200px)" },
                ],
              },
            ],
          },
        ],
      } as unknown as FloorplanCardConfig;

      const queries = collectConditionMediaQueries(config);
      expect(queries).toHaveLength(2);
      expect(queries).toContain("(min-width: 768px)");
      expect(queries).toContain("(max-width: 1200px)");
    });

    it("extracts media queries from single-floor plans without config.floors", () => {
      const config = {
        type: "custom:easy-floorplan-card",
        furniture: [
          {
            id: "car",
            type: "car",
            x: 0,
            y: 0,
            w: 10,
            h: 10,
            visibility: [{ condition: "screen", media_query: "(min-width: 1024px)" }],
          },
        ],
      } as unknown as FloorplanCardConfig;

      const queries = collectConditionMediaQueries(config);
      expect(queries).toEqual(["(min-width: 1024px)"]);
    });
  });
});
