import type { FloorplanCardConfig } from "./types";

/**
 * HA's YAML 1.1 editor reads an unquoted y (or Y) key as boolean true (#312).
 * Catch it before card/editor geometry receives undefined and emits NaN.
 * Validate only known coordinate locations, never action data or custom symbols.
 */
export function validateYCoordinates(config: FloorplanCardConfig): void {
  const point = (value: unknown, path: string): void => {
    const p = value as Record<string, unknown> | null;
    if (p && typeof p.y === "number" && Number.isFinite(p.y)) return;
    const mistaken = p && (Object.prototype.hasOwnProperty.call(p, "true") ? "true" : Object.prototype.hasOwnProperty.call(p, "Y") ? "Y" : undefined);
    const hint = mistaken
      ? ` Replace the "${mistaken}" key with quoted lowercase 'y' in YAML (for example, 'y': 141).`
      : " In YAML, quote the lowercase key (for example, 'y': 141).";
    throw new Error(`Invalid configuration: ${path}.y must be a finite number.${hint}`);
  };
  const floor = (value: unknown, prefix: string): void => {
    if (!value || typeof value !== "object") return;
    const f = value as Record<string, unknown>;
    for (const key of ["openings", "items", "texts", "furniture", "trackers"]) {
      const list = f[key];
      if (Array.isArray(list)) list.forEach((p, i) => point(p, `${prefix}${key}[${i}]`));
    }
    if (Array.isArray(f.areas)) f.areas.forEach((area, i) => {
      if (Array.isArray(area?.points)) area.points.forEach((p: unknown, j: number) =>
        point(p, `${prefix}areas[${i}].points[${j}]`));
    });
  };
  // The floors model takes precedence over legacy flat arrays, as getFloors does.
  if (Array.isArray(config.floors) && config.floors.length) {
    config.floors.forEach((f, i) => floor(f, `floors[${i}].`));
  } else {
    floor(config, "");
  }
  // Incomplete switcher positions deliberately fall back to the default.
  // Only reject a YAML-corrupted key here; do not change that optional API.
  const switcher = config.floorSwitcher as Record<string, unknown> | undefined;
  if (switcher && (Object.prototype.hasOwnProperty.call(switcher, "true") ||
    Object.prototype.hasOwnProperty.call(switcher, "Y"))) point(switcher, "floorSwitcher");
}
