/**
 * Where a label-only device's label lands on the rendered card (issue #308).
 *
 * "Badge shows: nothing" used to put the label back in flow and centre it on
 * (x, y) whatever `labelPosition` said — and the side rule's translateY still
 * reached it, so a left or right label also rode half its height above the
 * point. The editor drew it beside the ghost badge the whole time, so the
 * plan you arranged was not the plan you got. Measured in a real browser,
 * since the bug was layout and nothing else.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./floorplan-card";
import type { FloorplanCard } from "./floorplan-card";
import type { FloorItem, FloorplanCardConfig, LabelPosition } from "./types";

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

function device(id: string, x: number, y: number, extra: Partial<FloorItem>): FloorItem {
  return {
    id, kind: "sensor", entity: "sensor.battery", x, y,
    name: "House battery", showName: true, showState: true,
    ...extra,
  } as FloorItem;
}

async function mount(items: FloorItem[]) {
  const host = document.createElement("div");
  host.style.width = "1000px";
  host.style.height = "600px";
  document.body.appendChild(host);

  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig({
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    floors: [{
      id: "f1", name: "Floor 1", walls: [], openings: [], texts: [], furniture: [], trackers: [], areas: [],
      items,
    }],
  } as FloorplanCardConfig);
  card.hass = hass;
  host.appendChild(card);
  await card.updateComplete;

  const root = card.shadowRoot!;
  const item = (id: string) => root.querySelector<HTMLElement>(`.item[data-id="${id}"]`)!;
  return {
    item,
    /** The label's box relative to the device's own (x, y) on screen. */
    labelFromAnchor(id: string) {
      const el = item(id);
      const plane = (el.offsetParent as HTMLElement).getBoundingClientRect();
      const ax = plane.left + (parseFloat(el.style.left) / 100) * plane.width;
      const ay = plane.top + (parseFloat(el.style.top) / 100) * plane.height;
      const l = el.querySelector(".label")!.getBoundingClientRect();
      return { left: l.left - ax, right: l.right - ax, midX: (l.left + l.right) / 2 - ax, midY: (l.top + l.bottom) / 2 - ay };
    },
  };
}

describe("a label-only device keeps its label position (issue #308)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  for (const labelPosition of ["left", "right"] as LabelPosition[]) {
    for (const size of [undefined, 48]) {
      it(`${labelPosition}: lands where it would beside a badge${size ? ` (size ${size})` : ""}`, async () => {
        const t = await mount([
          device("badged", 300, 200, { labelPosition, size }),
          device("bare", 300, 400, { labelPosition, size, badgeContent: "none" }),
        ]);
        const badged = t.labelFromAnchor("badged");
        const bare = t.labelFromAnchor("bare");
        expect(bare.left).toBeCloseTo(badged.left, 1);
        expect(bare.right).toBeCloseTo(badged.right, 1);
        expect(bare.midY).toBeCloseTo(0, 0);
        // …and so grows one way only, away from the point.
        if (labelPosition === "left") expect(bare.right).toBeLessThan(0);
        else expect(bare.left).toBeGreaterThan(0);
      });
    }
  }

  it("below: still centres on the point, as label-only devices always have", async () => {
    const t = await mount([device("bare", 500, 300, { badgeContent: "none" })]);
    const bare = t.labelFromAnchor("bare");
    expect(bare.midX).toBeCloseTo(0, 0);
    expect(bare.midY).toBeCloseTo(0, 0);
  });

  it("holds the badge's place without drawing one or taking taps", async () => {
    const t = await mount([device("bare", 500, 300, { labelPosition: "left", badgeContent: "none" })]);
    expect(t.item("bare").querySelector(".badge")).toBeNull();
    const space = t.item("bare").querySelector<HTMLElement>(".badge-space")!;
    expect(space).toBeTruthy();
    expect(getComputedStyle(space).pointerEvents).toBe("none");
  });

  it("leaves no placeholder when there is no label to place", async () => {
    const t = await mount([
      device("bare", 500, 300, { labelPosition: "left", badgeContent: "none", showName: false, showState: false }),
    ]);
    expect(t.item("bare")?.querySelector(".badge-space") ?? null).toBeNull();
  });
});
