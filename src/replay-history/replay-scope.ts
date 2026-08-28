import type { FloorplanCardConfig } from "../types";
import { getFloors } from "../types";
import { itemReadings } from "../render";

export class ReplayScopeService {
  public static currentFloorEntityIds(config: FloorplanCardConfig | undefined, activeFloorId?: string): string[] {
    const floors = config ? getFloors(config) : [];
    const activeFloor = floors.find((floor) => floor.id === activeFloorId) ?? floors[0];
    if (!activeFloor) return [];

    const ids = new Set<string>();
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
