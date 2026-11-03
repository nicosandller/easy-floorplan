// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  collectConditionEntities,
  collectConditionMediaQueries,
  evaluateCondition,
  evaluateConditions,
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

    it("matches open and closed aliases across covers and binary sensors", () => {
      // Cover entity with 'closed' state matches state: 'closed' and state: 'off'
      const coverClosed = mockHass({ "cover.garage_door": { state: "closed" } });
      const coverOpen = mockHass({ "cover.garage_door": { state: "open" } });

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

      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "off" } as VisibilityCondition,
          coverClosed
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "cover.garage_door", state: "on" } as VisibilityCondition,
          coverOpen
        )
      ).toBe(true);

      // Binary sensor with 'off' state matches state: 'closed' and state: 'off'
      const sensorOff = mockHass({ "binary_sensor.garage_door": { state: "off" } });
      const sensorOn = mockHass({ "binary_sensor.garage_door": { state: "on" } });

      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "closed" } as VisibilityCondition,
          sensorOff
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "closed" } as VisibilityCondition,
          sensorOn
        )
      ).toBe(false);

      expect(
        evaluateCondition(
          { condition: "state", entity: "binary_sensor.garage_door", state: "open" } as VisibilityCondition,
          sensorOn
        )
      ).toBe(true);
    });

    it("handles boolean coercion and case-insensitivity", () => {
      const hassOn = mockHass({ "switch.relay": { state: "on" } });
      const hassOff = mockHass({ "switch.relay": { state: "off" } });

      expect(
        evaluateCondition(
          { condition: "state", entity: "switch.relay", state: true } as unknown as VisibilityCondition,
          hassOn
        )
      ).toBe(true);
      expect(
        evaluateCondition(
          { condition: "state", entity: "switch.relay", state: false } as unknown as VisibilityCondition,
          hassOff
        )
      ).toBe(true);

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

    it("matches open / on / unlocked / true / 1 aliases", () => {
      expect(statesMatch("open", "on")).toBe(true);
      expect(statesMatch("opened", "open")).toBe(true);
      expect(statesMatch("unlocked", "open")).toBe(true);
      expect(statesMatch(true, "on")).toBe(true);
      expect(statesMatch("1", "on")).toBe(true);
    });

    it("matches closed / off / locked / false / 0 aliases", () => {
      expect(statesMatch("closed", "off")).toBe(true);
      expect(statesMatch("closing", "closed")).toBe(true);
      expect(statesMatch("locked", "closed")).toBe(true);
      expect(statesMatch(false, "off")).toBe(true);
      expect(statesMatch("0", "off")).toBe(true);
    });

    it("matches away / not_home aliases", () => {
      expect(statesMatch("away", "not_home")).toBe(true);
      expect(statesMatch("not_home", "away")).toBe(true);
    });

    it("matches numeric equivalence", () => {
      expect(statesMatch(20, "20")).toBe(true);
      expect(statesMatch("20.0", 20)).toBe(true);
      expect(statesMatch(0, "0")).toBe(true);
      expect(statesMatch(20, "25")).toBe(false);
    });
  });

  describe("device condition", () => {
    it("evaluates is_closed and is_open for garage door / cover", () => {
      const condClosed: VisibilityCondition = {
        condition: "device",
        domain: "cover",
        device_id: "dev-garage",
        entity_id: "cover.garage_door",
        type: "is_closed",
      };
      const condOpen: VisibilityCondition = {
        condition: "device",
        domain: "cover",
        device_id: "dev-garage",
        entity_id: "cover.garage_door",
        type: "is_open",
      };

      const hassClosed = mockHass({ "cover.garage_door": { state: "closed" } });
      const hassOpen = mockHass({ "cover.garage_door": { state: "open" } });

      expect(evaluateCondition(condClosed, hassClosed)).toBe(true);
      expect(evaluateCondition(condClosed, hassOpen)).toBe(false);

      expect(evaluateCondition(condOpen, hassOpen)).toBe(true);
      expect(evaluateCondition(condOpen, hassClosed)).toBe(false);
    });

    it("resolves entity via hass.entities when entity_id is not in condition", () => {
      const cond: VisibilityCondition = {
        condition: "device",
        device_id: "dev-garage-123",
        type: "is_closed",
      };
      const hass = mockHass(
        { "cover.garage_door": { state: "closed" } },
        undefined,
        { "cover.garage_door": { entity_id: "cover.garage_door", device_id: "dev-garage-123" } }
      );

      expect(evaluateCondition(cond, hass)).toBe(true);
    });

    it("evaluates motion and occupancy types", () => {
      const condMotion: VisibilityCondition = {
        condition: "device",
        entity_id: "binary_sensor.driveway_motion",
        type: "is_motion",
      };
      const condNoMotion: VisibilityCondition = {
        condition: "device",
        entity_id: "binary_sensor.driveway_motion",
        type: "is_no_motion",
      };

      const hassActive = mockHass({ "binary_sensor.driveway_motion": { state: "on" } });
      const hassClear = mockHass({ "binary_sensor.driveway_motion": { state: "off" } });

      expect(evaluateCondition(condMotion, hassActive)).toBe(true);
      expect(evaluateCondition(condMotion, hassClear)).toBe(false);

      expect(evaluateCondition(condNoMotion, hassClear)).toBe(true);
      expect(evaluateCondition(condNoMotion, hassActive)).toBe(false);
    });

    it("fails open during outage when device entity is unavailable or unknown", () => {
      const cond: VisibilityCondition = {
        condition: "device",
        entity_id: "cover.garage_door",
        type: "is_closed",
      };
      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "unavailable" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "unknown" } }))).toBe(true);
    });

    it("resolves entity registry UUID from hass.entities", () => {
      const cond: VisibilityCondition = {
        condition: "device",
        entity_id: "uuid-garage-door-entry",
        type: "is_closed",
      };
      const hass = mockHass(
        { "cover.garage_door": { state: "closed" } },
        undefined,
        {
          "cover.garage_door": {
            entity_id: "cover.garage_door",
            id: "uuid-garage-door-entry",
          },
        }
      );
      expect(evaluateCondition(cond, hass)).toBe(true);

      const hassOpen = mockHass(
        { "cover.garage_door": { state: "open" } },
        undefined,
        {
          "cover.garage_door": {
            entity_id: "cover.garage_door",
            id: "uuid-garage-door-entry",
          },
        }
      );
      expect(evaluateCondition(cond, hassOpen)).toBe(false);
    });
  });

  describe("purpose-specific domain conditions (HA 2024.8+)", () => {
    it("evaluates cover.is_closed and cover.is_open with entity_id", () => {
      const condClosed: VisibilityCondition = {
        condition: "cover.is_closed",
        entity_id: "cover.garage_door",
      };
      const condOpen: VisibilityCondition = {
        condition: "cover.is_open",
        entity_id: "cover.garage_door",
      };

      const hassClosed = mockHass({ "cover.garage_door": { state: "closed" } });
      const hassOpen = mockHass({ "cover.garage_door": { state: "open" } });

      expect(evaluateCondition(condClosed, hassClosed)).toBe(true);
      expect(evaluateCondition(condClosed, hassOpen)).toBe(false);

      expect(evaluateCondition(condOpen, hassOpen)).toBe(true);
      expect(evaluateCondition(condOpen, hassClosed)).toBe(false);
    });

    it("evaluates cover.is_closed with target.entity_id", () => {
      const cond: VisibilityCondition = {
        condition: "cover.is_closed",
        target: { entity_id: "cover.garage_door" },
      } as unknown as VisibilityCondition;

      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "closed" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "open" } }))).toBe(false);
    });

    it("evaluates light.is_on and light.is_off", () => {
      const condOn: VisibilityCondition = {
        condition: "light.is_on",
        entity_id: "light.garage",
      };
      const condOff: VisibilityCondition = {
        condition: "light.is_off",
        entity_id: "light.garage",
      };

      expect(evaluateCondition(condOn, mockHass({ "light.garage": { state: "on" } }))).toBe(true);
      expect(evaluateCondition(condOn, mockHass({ "light.garage": { state: "off" } }))).toBe(false);

      expect(evaluateCondition(condOff, mockHass({ "light.garage": { state: "off" } }))).toBe(true);
      expect(evaluateCondition(condOff, mockHass({ "light.garage": { state: "on" } }))).toBe(false);
    });

    it("evaluates lock.is_locked and lock.is_unlocked", () => {
      const condLocked: VisibilityCondition = {
        condition: "lock.is_locked",
        entity_id: "lock.front_door",
      };
      const condUnlocked: VisibilityCondition = {
        condition: "lock.is_unlocked",
        entity_id: "lock.front_door",
      };

      expect(evaluateCondition(condLocked, mockHass({ "lock.front_door": { state: "locked" } }))).toBe(true);
      expect(evaluateCondition(condLocked, mockHass({ "lock.front_door": { state: "unlocked" } }))).toBe(false);

      expect(evaluateCondition(condUnlocked, mockHass({ "lock.front_door": { state: "unlocked" } }))).toBe(true);
      expect(evaluateCondition(condUnlocked, mockHass({ "lock.front_door": { state: "locked" } }))).toBe(false);
    });

    it("evaluates climate.is_hvac_mode", () => {
      const cond: VisibilityCondition = {
        condition: "climate.is_hvac_mode",
        entity_id: "climate.living_room",
        hvac_mode: "heat",
      } as unknown as VisibilityCondition;

      expect(evaluateCondition(cond, mockHass({ "climate.living_room": { state: "heat" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "climate.living_room": { state: "cool" } }))).toBe(false);
    });

    it("resolves entity registry UUID for purpose-specific conditions", () => {
      const cond: VisibilityCondition = {
        condition: "cover.is_closed",
        entity_id: "uuid-garage-door-entry",
      };
      const hass = mockHass(
        { "cover.garage_door": { state: "closed" } },
        undefined,
        {
          "cover.garage_door": {
            entity_id: "cover.garage_door",
            id: "uuid-garage-door-entry",
          },
        }
      );
      expect(evaluateCondition(cond, hass)).toBe(true);
    });

    it("fails open during outage when entity is missing, unavailable, or unknown", () => {
      const cond: VisibilityCondition = {
        condition: "cover.is_closed",
        entity_id: "cover.garage_door",
      };
      expect(evaluateCondition(cond, mockHass({}))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "unavailable" } }))).toBe(true);
      expect(evaluateCondition(cond, mockHass({ "cover.garage_door": { state: "unknown" } }))).toBe(true);
    });
  });

  describe("zone condition", () => {
    it("evaluates entity state 'home' against zone.home", () => {
      const cond: VisibilityCondition = {
        condition: "zone",
        entity: "device_tracker.car",
        zone: "zone.home",
      };
      const hassHome = mockHass({ "device_tracker.car": { state: "home" } });
      const hassAway = mockHass({ "device_tracker.car": { state: "not_home" } });

      expect(evaluateCondition(cond, hassHome)).toBe(true);
      expect(evaluateCondition(cond, hassAway)).toBe(false);
    });

    it("evaluates in_zones attribute", () => {
      const cond: VisibilityCondition = {
        condition: "zone",
        entity: "device_tracker.car",
        zone: "zone.work",
      };
      const hassInZone = mockHass({
        "device_tracker.car": { state: "away", attributes: { in_zones: ["zone.work", "zone.downtown"] } },
      });
      const hassOther = mockHass({
        "device_tracker.car": { state: "away", attributes: { in_zones: ["zone.school"] } },
      });

      expect(evaluateCondition(cond, hassInZone)).toBe(true);
      expect(evaluateCondition(cond, hassOther)).toBe(false);
    });

    it("supports zone.in_zone and zone.not_in_zone condition types", () => {
      const condIn: VisibilityCondition = {
        condition: "zone.in_zone",
        entity: "device_tracker.car",
        zone: "zone.home",
      };
      const condNotIn: VisibilityCondition = {
        condition: "zone.not_in_zone",
        entity: "device_tracker.car",
        zone: "zone.home",
      };

      const hassHome = mockHass({ "device_tracker.car": { state: "home" } });
      const hassAway = mockHass({ "device_tracker.car": { state: "not_home" } });

      expect(evaluateCondition(condIn, hassHome)).toBe(true);
      expect(evaluateCondition(condIn, hassAway)).toBe(false);

      expect(evaluateCondition(condNotIn, hassAway)).toBe(true);
      expect(evaluateCondition(condNotIn, hassHome)).toBe(false);
    });

    it("fails open during outage when tracker entity is unavailable", () => {
      const cond: VisibilityCondition = {
        condition: "zone",
        entity: "device_tracker.car",
        zone: "zone.home",
      };
      expect(evaluateCondition(cond, mockHass({ "device_tracker.car": { state: "unavailable" } }))).toBe(true);
    });
  });

  describe("time condition", () => {
    it("evaluates before and after time constraints", () => {
      const condAlways: VisibilityCondition = {
        condition: "time",
        after: "00:00:00",
        before: "23:59:59",
      };
      expect(evaluateCondition(condAlways, mockHass({}))).toBe(true);

      const condImpossible: VisibilityCondition = {
        condition: "time",
        after: "12:00:00",
        before: "12:00:00",
      };
      expect(evaluateCondition(condImpossible, mockHass({}))).toBe(false);
    });

    it("evaluates weekday constraints", () => {
      const allDays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      const condAllDays: VisibilityCondition = {
        condition: "time",
        weekday: allDays,
      };
      expect(evaluateCondition(condAllDays, mockHass({}))).toBe(true);

      const condNoDays: VisibilityCondition = {
        condition: "time",
        weekday: [],
      };
      expect(evaluateCondition(condNoDays, mockHass({}))).toBe(false);
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

    it("collects zone entities and device entities", () => {
      const conditions: VisibilityCondition[] = [
        { condition: "zone", entity: "device_tracker.car", zone: "zone.home" },
        { condition: "zone", entity: "device_tracker.bike", zones: ["work", "zone.school"] },
        { condition: "device", entity_id: "cover.garage_door", type: "is_closed" },
      ];
      const entities = collectConditionEntities(conditions);
      expect(entities).toContain("device_tracker.car");
      expect(entities).toContain("zone.home");
      expect(entities).toContain("device_tracker.bike");
      expect(entities).toContain("zone.work");
      expect(entities).toContain("zone.school");
      expect(entities).toContain("cover.garage_door");
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
  });
});
