import { afterEach, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorplanCardConfig } from "./types";
import { rotatePlanPoint, type PlanRotation } from "./render";
import reporter from "../docker/fixtures/issue-321.json";

afterEach(() => { document.body.innerHTML = ""; });
async function mount(config: FloorplanCardConfig) {
  const card = document.createElement("easy-floorplan-card");
  card.style.display = "block";
  card.style.width = "600px";
  card.setConfig(config);
  card.hass = { states: { "binary_sensor.window": { state: "off", attributes: {} } }, entities: {} } as unknown as FloorplanCard["hass"];
  document.body.append(card);
  await card.updateComplete;
  return card;
}

/** Last painted face at an elevated plan point, using Chromium's SVG fill
 * test and the actual DOM painter order (wall faces ignore pointer events). */
function frontAt(card: FloorplanCard, x: number, y: number): string | undefined {
  const layer = card.shadowRoot!.querySelector<SVGGElement>(".fp-iso")!;
  const screen = new DOMPoint(x, y).matrixTransform(layer.getScreenCTM()!);
  let id: string | undefined;
  for (const face of card.shadowRoot!.querySelectorAll<SVGPolygonElement>(".fp-iso-face, .fp-iso-panel")) {
    if (face.isPointInFill(screen.matrixTransform(face.getScreenCTM()!.inverse()))) {
      id = (face.closest(".fp-iso-solid") ?? face).getAttribute("data-id") ?? undefined;
    }
  }
  return id;
}

for (const rotation of [0, 90, 180, 270] as PlanRotation[]) it.each(["fixed", "swing"] as const)(`rotation ${rotation}: paints the %s pane over both halves of its sill`, async motion => {
  const card = await mount({
    type: "custom:easy-floorplan-card", width: 400, height: 300, view: "3d", wallHeight: 100, rotation,
    walls: [{ id: "wall", x1: 0, y1: 200, x2: 320, y2: 200 }],
    openings: [{ id: "window", type: "window", x: 160, y: 200, length: 160, angle: 0,
      motion, sash: "double", entity: "binary_sensor.window" }],
    areas: [], furniture: [], items: [], texts: [], trackers: [],
  });
  // At z=36, the glass lies just above the sill at z=35. Its near half used
  // to disappear because later sill chunks had a greater midpoint depth.
  for (const x of [110, 150, 190, 230]) {
    const p = rotatePlanPoint(x, 200, 400, 300, rotation);
    expect(frontAt(card, p.x - 36, p.y - 36)).toBe("window");
  }
});

it("keeps the reporter's bathtub behind the partition's front face", async () => {
  const card = await mount(reporter as unknown as FloorplanCardConfig);
  // Front of the x=480 partition: x=484, y=690, z=55. The same projected
  // point is on the bathtub's top at x=469, y=675, z=40.
  expect(frontAt(card, 484 - 55, 690 - 55)).toBe("wall_jcoiyu3");
});
