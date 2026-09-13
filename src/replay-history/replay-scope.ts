import type { FloorplanCardConfig } from "../types";
import { getFloors } from "../types";
import { itemReadings } from "../render";

export class ReplayScopeService {
  public static currentFloorEntityIds(config: FloorplanCardConfig | undefined, activeFloorId?: string): string[] {
    const floors = config ? getFloors(config) : [];
    const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0];
    if (!activeFloor) return [];

    const ids = new Set<string>();
    // Ambient daylight is the one light layer whose input is not on the floor:
    // it reads `sun.sun`'s elevation and nothing else. Left out of the scope,
    // history is never fetched for it, HistoryStateProvider falls back to the
    // live entity, and a plan scrubbed back to yesterday afternoon is washed in
    // tonight's darkness while every opening around it replays correctly. The
    // direct-sun layers read the same entity and have the same gap; widening
    // the scope for them is a change to their own behaviour and belongs with
    // them, so this stays scoped to the layer that claims to be replay-aware.
    if (config?.ambientDaylight) ids.add("sun.sun");
    for (const opening of activeFloor.openings) {
      if (opening.entity) ids.add(opening.entity);
      if (opening.secondaryEntity) ids.add(opening.secondaryEntity);
      if (opening.shutterEntity) ids.add(opening.shutterEntity);
      if (opening.shutterSecondaryEntity) ids.add(opening.shutterSecondaryEntity);
    }
    for (const item of activeFloor.items) {
      if (item.entity) ids.add(item.entity);
      for (const reading of itemReadings(item)) {
        if (reading.entity) ids.add(reading.entity);
      }
    }
    for (const furniture of activeFloor.furniture) {
      if (furniture.entity) ids.add(furniture.entity);
    }
    for (const area of activeFloor.areas) {
      if (area.entity) ids.add(area.entity);
    }
    for (const tracker of activeFloor.trackers) {
      for (const sensor of [tracker.xSensor, tracker.ySensor]) {
        if (sensor?.entity) ids.add(sensor.entity);
        if (sensor?.presence?.entity) ids.add(sensor.presence.entity);
      }
    }
    return Array.from(ids).sort();
  }

  public static scopeKey(config: FloorplanCardConfig | undefined, activeFloorId?: string): string {
    const watched = ReplayScopeService.currentFloorEntityIds(config, activeFloorId);
    return watched.length ? watched.join("|") : "none";
  }
}
