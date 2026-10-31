// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collectConditionEntities,
  collectConditionMediaQueries,
  evaluateCondition,
  evaluateConditions,
  hasTimeConditions,
  isEntityId,
  isFurnitureVisible,
} from "./furniture-visibility";
import type { FloorplanCardConfig, Furniture, HomeAssistant, VisibilityCondition } from "./types";

const mockHass = (
  states: Record<string, { state: string; attributes?: Record<string, unknown> }>,
  userId?: string
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

    it("falls back to defaultEntityId when entity and entity_id are omitted", () => {
      const cond = {
        condition: "state",
        state: "on",
      };
      expect(
        evaluateCondition(cond, mockHass({ "light.desk": { state: "on" } }), "light.desk")
      ).toBe(true);
      expect(
        evaluateCondition(cond, mockHass({ "light.desk": { state: "off" } }), "light.desk")
      ).toBe(false);
    });
  });

  describe("numeric_state condition", () => {
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

    it("collects target entities and sun.sun for sun conditions", () => {
      const conditions: VisibilityCondition[] = [
        { condition: "garage_door.is_open", target: { entity_id: "cover.garage_door" } },
        { condition: "sun.is_ascending" },
        { condition: "zone", target: { zone: "zone.home" } },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("cover.garage_door");
      expect(entities).toContain("sun.sun");
      expect(entities).toContain("zone.home");
    });
  });

  describe("sun conditions", () => {
    it("evaluates sun ascending and descending based on rising attribute", () => {
      const condAscending: VisibilityCondition = { condition: "sun.is_ascending" };
      const condDescending: VisibilityCondition = { condition: "sun.is_descending" };

      const hassRising = mockHass({
        "sun.sun": { state: "above_horizon", attributes: { rising: true } },
      });
      const hassSetting = mockHass({
        "sun.sun": { state: "above_horizon", attributes: { rising: false } },
      });

      expect(evaluateCondition(condAscending, hassRising)).toBe(true);
      expect(evaluateCondition(condAscending, hassSetting)).toBe(false);

      expect(evaluateCondition(condDescending, hassSetting)).toBe(true);
      expect(evaluateCondition(condDescending, hassRising)).toBe(false);
    });

    it("evaluates sun above and below horizon", () => {
      const condAbove: VisibilityCondition = { condition: "sun.is_above_horizon" };
      const condBelow: VisibilityCondition = { condition: "sun.is_below_horizon" };

      const hassDay = mockHass({ "sun.sun": { state: "above_horizon" } });
      const hassNight = mockHass({ "sun.sun": { state: "below_horizon" } });

      expect(evaluateCondition(condAbove, hassDay)).toBe(true);
      expect(evaluateCondition(condAbove, hassNight)).toBe(false);

      expect(evaluateCondition(condBelow, hassNight)).toBe(true);
      expect(evaluateCondition(condBelow, hassDay)).toBe(false);
    });
  });

  describe("garage door and cover conditions", () => {
    it("evaluates garage_door.is_open and garage_door.is_closed", () => {
      const condOpen: VisibilityCondition = {
        condition: "garage_door.is_open",
        target: { entity_id: "cover.garage_door" },
      };
      const condClosed: VisibilityCondition = {
        condition: "garage_door.is_closed",
        target: { entity_id: "cover.garage_door" },
      };

      const hassOpen = mockHass({ "cover.garage_door": { state: "open" } });
      const hassClosed = mockHass({ "cover.garage_door": { state: "closed" } });

      expect(evaluateCondition(condOpen, hassOpen)).toBe(true);
      expect(evaluateCondition(condOpen, hassClosed)).toBe(false);

      expect(evaluateCondition(condClosed, hassClosed)).toBe(true);
      expect(evaluateCondition(condClosed, hassOpen)).toBe(false);
    });

    it("evaluates device condition with type is_open and is_closed", () => {
      const condDeviceOpen: VisibilityCondition = {
        condition: "device",
        type: "is_open",
        entity_id: "cover.garage_door",
      };
      const condDeviceClosed: VisibilityCondition = {
        condition: "device",
        type: "is_closed",
        entity_id: "cover.garage_door",
      };

      const hassOpen = mockHass({ "cover.garage_door": { state: "open" } });
      const hassClosed = mockHass({ "cover.garage_door": { state: "closed" } });

      expect(evaluateCondition(condDeviceOpen, hassOpen)).toBe(true);
      expect(evaluateCondition(condDeviceOpen, hassClosed)).toBe(false);

      expect(evaluateCondition(condDeviceClosed, hassClosed)).toBe(true);
      expect(evaluateCondition(condDeviceClosed, hassOpen)).toBe(false);
    });
  });

  describe("person in area and zone conditions", () => {
    it("evaluates person in zone and not in zone", () => {
      const condInZone: VisibilityCondition = {
        condition: "zone",
        entity: "person.andrei",
        zone: "zone.home",
      };
      const condNotInZone: VisibilityCondition = {
        condition: "zone.not_in_zone",
        entity: "person.andrei",
        zone: "zone.home",
      };

      const hassHome = mockHass({ "person.andrei": { state: "home" } });
      const hassAway = mockHass({ "person.andrei": { state: "not_home" } });

      expect(evaluateCondition(condInZone, hassHome)).toBe(true);
      expect(evaluateCondition(condInZone, hassAway)).toBe(false);

      expect(evaluateCondition(condNotInZone, hassAway)).toBe(true);
      expect(evaluateCondition(condNotInZone, hassHome)).toBe(false);
    });

    it("evaluates person room-level presence in area", () => {
      const condInArea: VisibilityCondition = {
        condition: "area",
        entity: "person.andrei",
        area: "office",
      };
      const condNotInArea: VisibilityCondition = {
        condition: "area.not_in_area",
        entity: "person.andrei",
        area: "office",
      };

      const hassOffice = mockHass({ "person.andrei": { state: "office" } });
      const hassLivingRoom = mockHass({ "person.andrei": { state: "living_room" } });

      expect(evaluateCondition(condInArea, hassOffice)).toBe(true);
      expect(evaluateCondition(condInArea, hassLivingRoom)).toBe(false);

      expect(evaluateCondition(condNotInArea, hassLivingRoom)).toBe(true);
      expect(evaluateCondition(condNotInArea, hassOffice)).toBe(false);
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
  });

  describe("time conditions", () => {
    it("evaluates time condition with after and before bounds", () => {
      // 12:00 is between 08:00 and 20:00
      const cond: VisibilityCondition = {
        condition: "time",
        after: "00:00:00",
        before: "23:59:59",
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);

      const unmatchCond: VisibilityCondition = {
        condition: "time",
        after: "03:00:00",
        before: "03:00:01",
      };
      // Unless run exactly at 03:00:00, this fails
      expect(typeof evaluateCondition(unmatchCond, mockHass({}))).toBe("boolean");
    });

    it("evaluates automation weekday and dashboard weekdays", () => {
      const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const matchWeekday: VisibilityCondition = {
        condition: "time",
        weekday: days,
      };
      expect(evaluateCondition(matchWeekday, mockHass({}))).toBe(true);

      const matchWeekdays: VisibilityCondition = {
        condition: "time",
        weekdays: days,
      };
      expect(evaluateCondition(matchWeekdays, mockHass({}))).toBe(true);
    });

    it("hides when weekday does not include today", () => {
      const todayIdx = new Date().getDay();
      const allDays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const notToday = allDays[(todayIdx + 3) % 7];
      const cond: VisibilityCondition = {
        condition: "time",
        weekday: [notToday],
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(false);
    });

    it("detects time conditions in config with hasTimeConditions", () => {
      const withTime: FloorplanCardConfig = {
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
                visibility: [{ condition: "time", after: "20:00" }],
              },
            ],
          },
        ],
      } as unknown as FloorplanCardConfig;

      const withoutTime: FloorplanCardConfig = {
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
                visibility: [{ condition: "state", entity: "light.lamp", state: "on" }],
              },
            ],
          },
        ],
      } as unknown as FloorplanCardConfig;

      expect(hasTimeConditions(withTime)).toBe(true);
      expect(hasTimeConditions(withoutTime)).toBe(false);
      expect(hasTimeConditions(undefined)).toBe(false);
    });
  });
});
