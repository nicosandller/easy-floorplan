import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig, Floor, FloorItem, Opening } from "./types";
import type { SelKind } from "./editor-geometry";
import {
  type FormSpec, openingForm, furnitureForm, areaForm, areaNameForm, trackerForm,
  itemEntityForm, itemIdentityForm, itemShowStateForm, itemLabelForm, itemBadgeForm,
  itemEffectsForm, itemBehaviourForm, itemGroup7aForm, projectForm, projectDisplayForm,
  projectSkinForm, projectDeadSpaceForm, projectSunForm, projectReliefForm,
  projectReplayForm, projectPressForm, floorImageForm,
} from "./editor-forms";

const config = (): FloorplanCardConfig => ({
  type: "custom:easy-floorplan-card", width: 1000, height: 720,
  floors: [{ id: "ground", name: "Ground", walls: [], openings: [], furniture: [],
    items: [], texts: [], trackers: [], areas: [] }],
});

async function mount(c: FloorplanCardConfig, kind?: SelKind) {
  const editor = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  editor.style.width = "1300px";
  editor.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  editor.setConfig(c);
  document.body.append(editor);
  if (kind) (editor as unknown as { _selection: unknown[] })._selection = [{ kind, id: "target" }];
  await editor.updateComplete;
  return editor;
}

/** Compare the rendered destinations with the existing schemas, including conditional fields. */
async function expectEveryFieldOnce(editor: FloorplanCardEditor, specs: (FormSpec | undefined)[], project = false) {
  const root = editor.shadowRoot!;
  const picker = root.querySelector<HTMLElement>(`[role="tablist"][aria-label="${project ? "Project" : "Object"} settings"]`)!;
  expect(picker).not.toBeNull();
  const found = new Set<string>();
  for (const option of picker.querySelectorAll<HTMLButtonElement>("button")) {
    option.click();
    await editor.updateComplete;
    expect(root.querySelector("button.cfg-group-title")).toBeNull();
    for (const field of root.querySelectorAll<HTMLElement>('[id^="field-"]')) {
      expect(found.has(field.id), `${field.id} repeated in ${option.textContent}`).toBe(false);
      found.add(field.id);
    }
    if (option.dataset.page === "actions") {
      const hasActions = specs.some((spec) => spec?.fields.some((field) => "ui_action" in field.selector));
      expect(root.querySelectorAll(hasActions ? ".action-editor-note" : ".unbound-actions")).toHaveLength(1);
    }
  }
  const expected = specs.flatMap((spec) => spec?.fields ?? [])
    .filter((field) => !("ui_action" in field.selector)).map((field) => `field-${field.name}`);
  expect(found).toEqual(new Set(expected));
}

afterEach(() => { document.body.innerHTML = ""; });

describe("direct inspector categories", () => {
  it.each([
    { type: "door", motion: "swing" },
    { type: "window", motion: "swing", entity: "binary_sensor.window", shutterEntity: "cover.shutter", showIcon: true, showShutterIcon: true },
    { type: "window", motion: "slide" },
    { type: "skylight", entity: "binary_sensor.roof" },
    { type: "passage" },
  ] as const)("keeps all $type/$motion settings reachable", async (variant) => {
    const c = config();
    const opening: Opening = { id: "target", x: 200, y: 200, length: 100, angle: 0, ...variant };
    c.floors![0].openings = [opening];
    const editor = await mount(c, "opening");
    await expectEveryFieldOnce(editor, [openingForm(opening)]);
  });

  it.each(["sofa", "stairs", "sectional"])("keeps all %s settings reachable without repeated dimensions", async (type) => {
    const c = config();
    const furniture = { id: "target", type, x: 200, y: 200, w: 100, h: 100, entity: "sensor.test" };
    c.floors![0].furniture = [furniture];
    const editor = await mount(c, "furniture");
    await expectEveryFieldOnce(editor, [furnitureForm(furniture)]);
  });

  it("keeps room sensor, appearance and zoom controls reachable", async () => {
    const c = config();
    const area = { id: "target", name: "Room", entity: "sensor.test", zoom: 2,
      points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 0, y: 400 }] };
    c.floors![0].areas = [area];
    const editor = await mount(c, "area");
    await expectEveryFieldOnce(editor, [areaNameForm(area), areaForm(area)]);
  });

  it("keeps tracker geometry and marker controls reachable", async () => {
    const c = config();
    const tracker = { id: "target", x: 200, y: 200, w: 100, h: 100 };
    c.floors![0].trackers = [tracker];
    const editor = await mount(c, "tracker");
    await expectEveryFieldOnce(editor, [trackerForm(tracker)]);
  });

  it("keeps device readings, effects, actions and conditional visibility reachable", async () => {
    const c = config();
    const item: FloorItem = { id: "target", kind: "light", entity: "light.test", x: 200, y: 200,
      showName: true, showState: true, glow: true, enableHideByEntity: true };
    c.floors![0].items = [item];
    const editor = await mount(c, "item");
    await expectEveryFieldOnce(editor, [itemEntityForm(item), itemIdentityForm(item), itemShowStateForm(item),
      itemLabelForm(item), itemBadgeForm(item), itemEffectsForm(item), itemBehaviourForm(item), itemGroup7aForm(item)]);
  });

  it.each([false, true])("keeps project settings reachable with conditional options enabled: %s", async (enabled) => {
    const c = config();
    c.sunlight = enabled;
    c.sunDimming = enabled;
    c.view = enabled ? "3d" : "2d";
    if (enabled) c.floors![0].image = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
    const editor = await mount(c);
    editor.shadowRoot!.querySelector<HTMLButtonElement>("#project-tab")!.click();
    await editor.updateComplete;
    await expectEveryFieldOnce(editor, [projectForm(c), projectDisplayForm(c), projectSkinForm(c),
      projectDeadSpaceForm(c), projectSunForm(c), projectReliefForm(c), projectReplayForm(c),
      projectPressForm(c), floorImageForm(c.floors![0] as Floor)], true);
  });
});
