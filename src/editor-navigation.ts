import type { SelKind } from "./editor-geometry";

export interface InspectorPage {
  id: string;
  label: string;
  hint?: string;
  groups: readonly string[];
}

// These are destinations, not disclosures. Each group belongs to one page;
// the editor renders only that page, so changing category never adds nesting.
export const PROJECT_PAGES: readonly InspectorPage[] = [
  { id: "plan", label: "Plan", hint: "Canvas, floors and background image", groups: ["Project", "Floor image", "Floor switcher"] },
  { id: "colors", label: "Style", hint: "Colors, theme and named colors", groups: ["Look", "Named colors"] },
  { id: "view", label: "View", hint: "Display, scale and 3D", groups: ["Display"] },
  { id: "lighting", label: "Lighting", groups: ["Sunlight", "Night dimming"] },
  { id: "devices", label: "Devices", hint: "Device behavior", groups: ["Devices"] },
  { id: "symbols", label: "Symbols", hint: "Symbol library", groups: ["Symbols"] },
];

const properties: InspectorPage = { id: "properties", label: "Properties", groups: [] };
const actions: InspectorPage = { id: "actions", label: "Actions", groups: ["Behavior"] };

export const SELECTION_PAGES: Record<SelKind, readonly InspectorPage[]> = {
  furniture: [properties, { id: "sensor", label: "Sensors", hint: "Sensor and state colors", groups: ["What it reads", "Color"] }, actions],
  opening: [
    properties,
    { id: "sensors", label: "Sensors", hint: "Sensors and shutter", groups: ["What it reads", "Shutter"] },
    { id: "appearance", label: "Style", hint: "Style and sunlight", groups: ["Badge", "Color", "Sunlight"] },
    actions,
  ],
  item: [
    properties,
    { id: "readings", label: "Readings", groups: ["What it reads"] },
    { id: "appearance", label: "Style", hint: "Labels, badges, colors and effects", groups: ["Label", "Badge", "Color", "Effects"] },
    actions,
    { id: "visibility", label: "Visibility", groups: ["Visibility"] },
  ],
  area: [properties, { id: "sensor", label: "Sensors", hint: "Sensors and room devices", groups: ["What it reads", "Color", "Home Assistant area"] }, actions],
  tracker: [
    properties,
    { id: "sensors", label: "Sensors", groups: ["Sensors"] },
    { id: "marker", label: "Marker", groups: ["Marker"] },
  ],
  text: [properties],
  wall: [properties],
};
