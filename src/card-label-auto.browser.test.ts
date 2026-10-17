/**
 * `labelPosition: auto` and `above` on the rendered card. Measured in a real
 * browser because the choice is made from real layout: the label's rendered
 * size and the badge's box, against walls mapped onto the overlay.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorItem, FloorplanCardConfig, LabelPosition, Wall } from "./types";

const hass = {
  states: {
    "sensor.battery": {
      entity_id: "sensor.battery",
      state: "23.8",
      attributes: { friendly_name: "House battery" },
    },
  },
  entities: {},
  formatEntityState: (st: { state: string }) => st.state,
} as unknown as FloorplanCard["hass"];

function device(id: string, x: number, y: number, extra: Partial<FloorItem> = {}): FloorItem {
  return {
    id, kind: "sensor", entity: "sensor.battery", x, y,
    name: "House battery", showName: true, showState: true,
    ...extra,
  } as FloorItem;
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

async function mount(items: FloorItem[], walls: Wall[] = [], extra: Partial<FloorplanCardConfig> = {}) {
  const host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "600px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    ...extra,
    floors: [{
      id: "f1", name: "Floor 1", walls, openings: [], texts: [], furniture: [], trackers: [], areas: [],
      items,
    }],
  } as FloorplanCardConfig);
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;
  // The measurement asks for one more render when a side moves.
  await card.updateComplete;
  await nextFrame();
  await card.updateComplete;

  const root = card.shadowRoot!;
  const item = (id: string) => root.querySelector<HTMLElement>(`.item[data-id="${id}"]`)!;
  const plan = () => root.querySelector<HTMLElement>(".plan")!.getBoundingClientRect();
  return {
    card,
    item,
    label: (id: string) => item(id).querySelector<HTMLElement>(".label")!,
    /** Label and badge boxes on screen. */
    boxes(id: string) {
      return {
        badge: item(id).getBoundingClientRect(),
        label: item(id).querySelector(".label")!.getBoundingClientRect(),
      };
    },
    /** A plan y in client pixels. */
    planY: (y: number) => plan().top + (y / 600) * plan().height,
    planX: (x: number) => plan().left + (x / 1000) * plan().width,
  };
}

const wall = (x1: number, y1: number, x2: number, y2: number): Wall => ({ id: `w${x1}${y1}`, x1, y1, x2, y2 });

describe("labelPosition: above, and the manual sides as before", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  for (const pos of ["below", "above", "left", "right"] as LabelPosition[]) {
    it(`${pos}: sits on that side of the badge`, async () => {
      const t = await mount([device("d", 500, 300, { labelPosition: pos })]);
      expect(t.label("d").classList.contains(`label-${pos}`)).toBe(true);
      const { badge, label } = t.boxes("d");
      const midX = (label.left + label.right) / 2 - (badge.left + badge.right) / 2;
      const midY = (label.top + label.bottom) / 2 - (badge.top + badge.bottom) / 2;
      if (pos === "below" || pos === "above") expect(midX).toBeCloseTo(0, 0);
      else expect(midY).toBeCloseTo(0, 0);
      if (pos === "below") expect(label.top).toBeCloseTo(badge.bottom + 2, 0);
      if (pos === "above") expect(label.bottom).toBeCloseTo(badge.top - 2, 0);
      if (pos === "right") expect(label.left).toBeCloseTo(badge.right + 4, 0);
      if (pos === "left") expect(label.right).toBeCloseTo(badge.left - 4, 0);
    });
  }

  it("above, label-only: keeps the empty badge footprint and hangs over it", async () => {
    const t = await mount([
      device("badged", 300, 300, { labelPosition: "above" }),
      device("bare", 600, 300, { labelPosition: "above", badgeContent: "none" }),
    ]);
    const a = t.boxes("badged");
    const b = t.boxes("bare");
    expect(t.item("bare").querySelector(".badge-space")).toBeTruthy();
    expect(b.label.bottom - b.badge.top).toBeCloseTo(a.label.bottom - a.badge.top, 1);
  });
});

describe("labelPosition: auto", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("moves a label off a wall it would cover below", async () => {
    // Badge 34 tall centred on y=300, so a below label starts at y≈319: the
    // wall at 325 runs straight through it.
    const walls = [wall(0, 325, 1000, 325)];
    const fixed = await mount([device("d", 500, 300)], walls);
    const below = fixed.boxes("d").label;
    const wallY = fixed.planY(325);
    expect(below.top).toBeLessThan(wallY);
    expect(below.bottom).toBeGreaterThan(wallY);
    document.body.innerHTML = "";

    const t = await mount([device("d", 500, 300, { labelPosition: "auto" })], walls);
    expect(t.label("d").classList.contains("label-below")).toBe(false);
    const { label } = t.boxes("d");
    // Clear of the wall's band (8 thick, so 4 either side of its line).
    const half = ((t.planY(4) - t.planY(0)));
    expect(label.bottom <= t.planY(325) - half || label.top >= t.planY(325) + half).toBe(true);
    // The first clear side in order: right.
    expect(t.label("d").classList.contains("label-right")).toBe(true);
  });

  it("stays below where below is clear, so nothing changes on an open plan", async () => {
    const t = await mount([device("d", 500, 300, { labelPosition: "auto" })]);
    expect(t.label("d").classList.contains("label-below")).toBe(true);
    const { badge, label } = t.boxes("d");
    expect(label.top).toBeCloseTo(badge.bottom + 2, 0);
  });

  it("avoids another device's badge", async () => {
    // A second badge right under the first, and one to its right.
    const t = await mount([
      device("d", 500, 300, { labelPosition: "auto" }),
      device("under", 500, 345, { showName: false, showState: false }),
      device("beside", 560, 300, { showName: false, showState: false }),
    ]);
    expect(t.label("d").classList.contains("label-left")).toBe(true);
  });

  it("avoids a wall on a rotated plan, measured where the wall is drawn", async () => {
    // A wall 30 units under the device. Whichever way the plan is turned the
    // card must find where that wall is drawn — under, beside or over the
    // badge — and keep the label off it.
    const walls = [wall(0, 330, 1000, 330)];
    const flat = await mount([device("d", 500, 300, { labelPosition: "auto" })], walls);
    expect(flat.label("d").classList.contains("label-below")).toBe(false);
    document.body.innerHTML = "";
    for (const rotation of [90, 180, 270]) {
      const t = await mount([device("d", 500, 300, { labelPosition: "auto" })], walls, { rotation });
      const line = t.card.shadowRoot!.querySelector("line.wall")!.getBoundingClientRect();
      const { label } = t.boxes("d");
      const overlaps = label.left < line.right && label.right > line.left && label.top < line.bottom && label.bottom > line.top;
      expect(overlaps, `rotation ${rotation}`).toBe(false);
      // Half a turn puts the wall over the badge, so below is clear again —
      // which only a wall mapped through the rotation can know.
      if (rotation === 180) expect(t.label("d").classList.contains("label-below")).toBe(true);
      document.body.innerHTML = "";
    }
  });

  it("does not move again when a reading changes but the label keeps its length", async () => {
    const walls = [wall(0, 325, 1000, 325)];
    const t = await mount([device("d", 500, 300, { labelPosition: "auto" })], walls);
    expect(t.label("d").classList.contains("label-right")).toBe(true);
    t.card.hass = {
      ...hass,
      states: { "sensor.battery": { ...hass!.states["sensor.battery"], state: "23.9" } },
    } as typeof hass;
    await t.card.updateComplete;
    await nextFrame();
    expect(t.label("d").classList.contains("label-right")).toBe(true);
  });

  it("falls back to below in the 3D view", async () => {
    const walls = [wall(0, 325, 1000, 325)];
    const t = await mount([device("d", 500, 300, { labelPosition: "auto" })], walls, { view: "3d" } as Partial<FloorplanCardConfig>);
    expect(t.label("d").classList.contains("label-below")).toBe(true);
  });

  it("a label-only device's below stays centred on its point", async () => {
    const t = await mount([device("bare", 500, 300, { labelPosition: "auto", badgeContent: "none" })]);
    const el = t.item("bare");
    const l = el.querySelector(".label")!.getBoundingClientRect();
    const plane = (el.offsetParent as HTMLElement).getBoundingClientRect();
    const ax = plane.left + (parseFloat(el.style.left) / 100) * plane.width;
    const ay = plane.top + (parseFloat(el.style.top) / 100) * plane.height;
    expect((l.left + l.right) / 2 - ax).toBeCloseTo(0, 0);
    expect((l.top + l.bottom) / 2 - ay).toBeCloseTo(0, 0);
  });
});

describe("labelPosition: auto on the editor canvas", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the side its own measurement picks, and above as above", async () => {
    await import("./editor");
    const host = document.createElement("div");
    host.style.width = "1000px";
    document.body.appendChild(host);
    const ed = document.createElement("easy-floorplan-card-editor") as HTMLElement & {
      hass: unknown; setConfig(c: FloorplanCardConfig): void; updateComplete: Promise<boolean>;
    };
    ed.hass = hass;
    ed.setConfig({
      type: "custom:easy-floorplan-card",
      width: 1000,
      height: 600,
      floors: [{
        id: "f1", name: "Floor 1", walls: [wall(0, 330, 1000, 330)], openings: [], texts: [], furniture: [], trackers: [], areas: [],
        items: [
          device("d", 500, 300, { labelPosition: "auto" }),
          device("up", 200, 150, { labelPosition: "above" }),
        ],
      }],
    } as FloorplanCardConfig);
    host.appendChild(ed);
    await ed.updateComplete;
    await ed.updateComplete;
    await nextFrame();
    await ed.updateComplete;
    const labels = [...ed.shadowRoot!.querySelectorAll<HTMLElement>(".edit-item .ilabel")];
    expect(labels.length).toBe(2);
    const [auto, up] = labels;
    expect(auto.classList.contains("ilabel-below")).toBe(false);
    expect(up.classList.contains("ilabel-above")).toBe(true);
    const badge = up.parentElement!.getBoundingClientRect();
    expect(up.getBoundingClientRect().bottom).toBeLessThanOrEqual(badge.top);
  });
});
