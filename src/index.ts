import { FloorplanCard } from "./floorplan-card";
import "./editor";

export { FloorplanCard };

// Register the card in Home Assistant's "Add card" picker.
const w = window as unknown as { customCards?: unknown[] };
w.customCards = w.customCards || [];
w.customCards.push({
  type: "easy-floorplan-card",
  name: "Easy Floorplan",
  description:
    "Draw a floorplan with walls, doors, windows, furniture and text, then place device/light controls with a visual editor.",
  preview: false,
  documentationURL: "https://github.com/nicosandller/easy-floorplan",
});

// eslint-disable-next-line no-console
console.info("%c EASY-FLOORPLAN %c 0.2.0 ", "background:#03a9f4;color:#fff", "color:#03a9f4");
