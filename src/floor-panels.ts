/**
 * Spatial Telemetry Callout Info-Panels (issue #234).
 * Pure, framework-agnostic helper functions for:
 * - Resolving live states, attributes, units and labels for telemetry panel metric rows
 * - Resolving 2D/3D plan anchor points for rooms, furniture, roofs, or fixed targets
 * - Finding the nearest room when a panel sits outside all areas
 * - Computing stepped orthogonal / dog-leg SVG leader line paths
 */

import type {
  Area,
  Floor,
  FloorInfoPanel,
  RenderHass,
} from "./types";
import { areaLabelPoint, pointInPolygon } from "./render";

/**
 * Resolved display state for a single panel metric row.
 */
export interface ResolvedPanelMetric {
  entity: string;
  label: string;
  state: string;
  value: string;
  unit: string;
  icon?: string;
  showIcon?: boolean;
  unavailable: boolean;
}

/**
 * Resolves live states, attributes, units and labels for a telemetry panel.
 */
export function resolvePanelMetrics(
  panel: FloorInfoPanel,
  hass: RenderHass | undefined
): ResolvedPanelMetric[] {
  if (!panel.metrics || !panel.metrics.length) return [];
  const states = hass?.states ?? {};

  // A row the editor has added but not yet given an entity is not a
  // metric; leave it out rather than show it as unavailable.
  return panel.metrics.filter((m) => !!m.entity).map((m) => {
    const st = states[m.entity];
    const attrs = st?.attributes ?? {};
    const unavailable = !st || st.state === "unavailable" || st.state === "unknown";

    const showLabels = panel.showLabels !== false;
    const label =
      !showLabels || m.label === ""
        ? ""
        : m.label !== undefined
          ? m.label
          : (attrs.friendly_name as string | undefined) ?? m.entity;

    const rawAttrUnit = (attrs.unit_of_measurement as string | undefined)?.trim();
    let unit = m.unit !== undefined ? m.unit.trim() : rawAttrUnit ?? "";

    const hideIcon =
      panel.showIcons === false ||
      m.showIcon === false ||
      m.icon === "none" ||
      m.icon === "" ||
      (m.icon as any) === false;
    const icon = hideIcon ? undefined : (m.icon ?? (attrs.icon as string | undefined));

    let valStr = "";
    if (unavailable) {
      valStr = st?.state ?? "unavailable";
      unit = "";
    } else if (m.attribute) {
      if (typeof hass?.formatEntityAttributeValue === "function" && st) {
        valStr = hass.formatEntityAttributeValue(st, m.attribute);
      } else {
        const attrVal = attrs[m.attribute];
        valStr = attrVal !== undefined && attrVal !== null ? String(attrVal) : "";
      }
    } else if (hass?.formatEntityState && st) {
      valStr = hass.formatEntityState(st);
    } else {
      valStr = st?.state ?? "";
    }

    const isNumericOrMeasured =
      Boolean(attrs.unit_of_measurement) ||
      m.unit !== undefined ||
      (typeof st?.state === "string" && st.state.trim() !== "" && !isNaN(Number(st.state)));

    if (!unavailable && isNumericOrMeasured && valStr) {
      // Check if valStr contains both a numeric prefix and a trailing unit
      const match = valStr.match(
        /^([+\-\u2212]?[0-9\s.,'’\u00A0\u202F]+?)\s*([^\d\s.,'’\u00A0\u202F].*)$/u
      );
      if (match && match[1]) {
        valStr = match[1].trim();
        // If the user didn't explicitly override unit, use the unit parsed from the formatted string
        if (m.unit === undefined && match[2]) {
          unit = match[2].trim();
        }
      } else if (unit) {
        // Fallback: if valStr ends with unit, strip it to prevent duplicate units
        const trimmedUnit = unit.trim();
        if (trimmedUnit && valStr.endsWith(trimmedUnit)) {
          valStr = valStr.slice(0, valStr.length - trimmedUnit.length).trim();
        }
      }
    }

    const ret: ResolvedPanelMetric = {
      entity: m.entity,
      label,
      state: st?.state ?? "unavailable",
      value: valStr,
      unit,
      icon,
      unavailable,
    };
    if (m.showIcon !== undefined || panel.showIcons !== undefined) {
      ret.showIcon = !hideIcon;
    }
    return ret;
  });
}

/**
 * Resolves the plan anchor point (x, y) that an info-panel connects to via its leader line.
 * Defaults to explicit anchor, area centroid for linked area, furniture center, or enclosing area.
 */
export function resolvePanelAnchor(
  panel: FloorInfoPanel,
  floor: Floor
): { x: number; y: number } | undefined {
  if (panel.anchor) {
    return { x: panel.anchor.x, y: panel.anchor.y };
  }
  if (panel.targetId) {
    const area = (floor.areas ?? []).find((a) => a.id === panel.targetId);
    if (area && area.points?.length) {
      return areaLabelPoint(area.points);
    }
    const furn = floor.furniture.find((f) => f.id === panel.targetId);
    if (furn) {
      return { x: furn.x, y: furn.y };
    }
    const roof = (floor.roofs ?? []).find((r) => r.id === panel.targetId);
    if (roof && roof.points?.length) {
      return areaLabelPoint(roof.points);
    }
  }
  if (panel.targetType === "roof") {
    const enclosing = (floor.roofs ?? []).find((r) => pointInPolygon(r.points, panel.x, panel.y));
    if (enclosing && enclosing.points?.length) {
      return areaLabelPoint(enclosing.points);
    }
    if ((floor.roofs ?? []).length > 0 && floor.roofs![0].points?.length) {
      return areaLabelPoint(floor.roofs![0].points);
    }
  }
  if (panel.targetType === "area") {
    const room = nearestPanelArea(panel, floor);
    if (room) return areaLabelPoint(room.points);
  }
  return undefined;
}

/**
 * The room an `area` panel with no `targetId` belongs to: the one it sits in,
 * or else the room whose label point is closest (what the editor offers as
 * "(None / nearest)").
 */
export function nearestPanelArea(panel: FloorInfoPanel, floor: Floor): Area | undefined {
  const rooms = (floor.areas ?? []).filter((a) => a.points?.length >= 3);
  const enclosing = rooms.find((a) => pointInPolygon(a.points, panel.x, panel.y));
  if (enclosing) return enclosing;
  let best: Area | undefined;
  let bestD = Infinity;
  for (const a of rooms) {
    const c = areaLabelPoint(a.points);
    const d = Math.hypot(c.x - panel.x, c.y - panel.y);
    if (d < bestD) {
      bestD = d;
      best = a;
    }
  }
  return best;
}

/**
 * Computes an angled orthogonal/dog-leg SVG path between an anchor point and an info-panel.
 */
export function computeLeaderLinePath(
  anchor: { x: number; y: number },
  panel: { x: number; y: number }
): string {
  const dx = panel.x - anchor.x;
  const dy = panel.y - anchor.y;
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) {
    return `M ${anchor.x} ${anchor.y} L ${panel.x} ${panel.y}`;
  }

  // Stepped shoulder towards panel, then straight segment to panel origin
  const signX = dx >= 0 ? 1 : -1;
  const signY = dy >= 0 ? 1 : -1;
  const elbowLen = Math.min(Math.abs(dy), Math.abs(dx) * 0.5, 30);
  const shoulderX = anchor.x + signX * elbowLen;
  const shoulderY = anchor.y + signY * elbowLen;

  return `M ${anchor.x} ${anchor.y} L ${shoulderX} ${shoulderY} L ${panel.x} ${panel.y}`;
}
