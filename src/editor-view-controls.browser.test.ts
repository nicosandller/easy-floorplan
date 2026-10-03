/** Exercise the editor's real change/save/reload path, using its outside-HA fields. */
import { afterEach, expect, it } from "vitest";
import "./editor";
import "./floorplan-card";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCard } from "./floorplan-card";
import { emptyConfig, getFloors, type FloorplanCardConfig } from "./types";

afterEach(() => document.body.replaceChildren());

it("saves live appearance and optional controls from Project → Display and restores them on reload", async () => {
  const original = emptyConfig("custom:easy-floorplan-card");
  original.floors = getFloors(original);
  original.floors[0].walls = [{ id: "wall", x1: 50, y1: 50, x2: 400, y2: 50 }];
  const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  editor.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  editor.setConfig(original);
  document.body.append(editor);
  await editor.updateComplete;
  const state = editor as unknown as { _projectOpen: boolean; _openGroups: Set<string> };
  state._projectOpen = true;
  state._openGroups = new Set(["Display"]);
  editor.requestUpdate();
  await editor.updateComplete;
  const root = editor.shadowRoot!;
  const field = (label: string) => [...root.querySelectorAll(".row")]
    .find(row => row.querySelector("label")?.textContent === label)!
    .querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
  let saved = original;
  editor.addEventListener("config-changed", event => {
    saved = (event as CustomEvent<{ config: FloorplanCardConfig }>).detail.config;
    // HA feeds each accepted change back to the editor.
    editor.setConfig(saved);
  });
  const change = async (label: string, value: string | boolean) => {
    const input = field(label);
    if (typeof value === "boolean") (input as HTMLInputElement).checked = value;
    else input.value = value;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await editor.updateComplete;
  };
  await change("Appearance", "line-art");
  await change("Show view controls", true);
  await change("Allow SVG download", true);
  await change("View", "3d");
  expect(saved.appearance).toBe("line-art");
  expect(saved.showViewControls).toBe(true);
  expect(saved.showExport).toBe(true);
  expect(saved.view).toBe("3d");
  expect(saved.floors).toEqual(original.floors);

  const reloaded = JSON.parse(JSON.stringify(saved)) as FloorplanCardConfig;
  editor.setConfig(reloaded);
  await editor.updateComplete;
  expect(field("Appearance").value).toBe("line-art");
  expect((field("Show view controls") as HTMLInputElement).checked).toBe(true);
  const card = document.createElement("easy-floorplan-card") as FloorplanCard;
  card.setConfig(reloaded);
  document.body.append(card);
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector('.view-controls button[aria-label="3D isometric"]')!.getAttribute("aria-pressed")).toBe("true");
  expect(card.shadowRoot!.querySelector(".plan.line-art")).not.toBeNull();
  expect(card.shadowRoot!.querySelector('button[aria-label="Download SVG"]')).not.toBeNull();

  await change("Allow SVG download", false);
  card.setConfig(saved);
  await card.updateComplete;
  expect(card.shadowRoot!.querySelector(".view-controls")).not.toBeNull();
  expect(card.shadowRoot!.querySelector('button[aria-label="Download SVG"]')).toBeNull();
});
