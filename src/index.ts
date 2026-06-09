import { FloorplanCard } from "./floorplan-card";
import "./editor";
import { version } from "../package.json";

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
console.info(
  `%c EASY-FLOORPLAN %c ${version} `,
  "background:#03a9f4;color:#fff",
  "color:#03a9f4"
);
