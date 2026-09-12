/**
 * Renaming a named colour, in a real browser.
 *
 * The rename handler is DOM-shaped — it reads an `<input>` and, when it decides
 * not to change the config, has to put that input back itself, because Lit will
 * not re-render a field whose bound value did not change. That last part is
 * only observable with a real element, so it lives here rather than in the node
 * suite (issue #265).
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardEditor } from "./editor";
import type { FloorplanCardConfig } from "./types";

function config(): FloorplanCardConfig {
  return {
    type: "custom:easy-floorplan-card",
    width: 1000,
    height: 600,
    palette: [{ name: "Warm", color: "#ff8800" }],
    floors: [
      {
        id: "f1",
        name: "Floor 1",
        walls: [],
        openings: [],
        items: [],
        texts: [],
        furniture: [],
        trackers: [],
        areas: [{ id: "living", name: "Living", points: [], color: "var(--fp-color-warm)" }],
      },
    ],
  } as unknown as FloorplanCardConfig;
}

async function mountEditor() {
  const host = document.createElement("div");
  host.style.width = "900px";
  document.body.appendChild(host);
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as unknown as FloorplanCardEditor["hass"];
  ed.setConfig(config());
  host.appendChild(ed);
  await ed.updateComplete;

  const emitted: FloorplanCardConfig[] = [];
  ed.addEventListener("config-changed", (ev) => {
    emitted.push((ev as CustomEvent<{ config: FloorplanCardConfig }>).detail.config);
  });
  return { ed, host, emitted };
}

/**
 * The palette fields sit behind two collapses — the Project section, then the
 * "Named colors" group inside it — and neither is open on mount.
 */
async function openGroup(ed: FloorplanCardEditor, title: string): Promise<void> {
  const root = () => ed.shadowRoot!;
  const project = root().querySelector<HTMLButtonElement>("button.section-toggle");
  if (!project) throw new Error("Project section toggle not found — did the panel change?");
  if (project.getAttribute("aria-expanded") !== "true") {
    project.click();
    await ed.updateComplete;
  }
  const group = [...root().querySelectorAll<HTMLButtonElement>("button.cfg-group-title")]
    .find((b) => b.textContent?.trim().startsWith(title));
  if (!group) throw new Error(`'${title}' group not found — did the Project panel change?`);
  if (group.getAttribute("aria-expanded") !== "true") {
    group.click();
    await ed.updateComplete;
  }
}

async function openNamedColors(ed: FloorplanCardEditor): Promise<void> {
  const root = () => ed.shadowRoot!;
  if (root().querySelector("input.palette-name")) return;

  const project = root().querySelector<HTMLButtonElement>("button.section-toggle");
  if (!project) throw new Error("Project section toggle not found — did the panel change?");
  if (project.getAttribute("aria-expanded") !== "true") {
    project.click();
    await ed.updateComplete;
  }

  const group = [...root().querySelectorAll<HTMLButtonElement>("button.cfg-group-title")]
    .find((b) => b.textContent?.trim().startsWith("Named colors"));
  if (!group) throw new Error("'Named colors' group not found — did the Project panel change?");
  group.click();
  await ed.updateComplete;
}

function nameInput(ed: FloorplanCardEditor): HTMLInputElement {
  const found = ed.shadowRoot?.querySelector<HTMLInputElement>("input.palette-name");
  if (!found) throw new Error("palette name input not found — did the Project panel change?");
  return found;
}

async function rename(ed: FloorplanCardEditor, to: string) {
  await openNamedColors(ed);
  const input = nameInput(ed);
  input.value = to;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await ed.updateComplete;
  return input;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("renaming a named colour", () => {
  it("stores the name trimmed, so the panel and the dropdowns agree", async () => {
    const t = await mountEditor();
    await rename(t.ed, "  Warm white  ");

    const last = t.emitted[t.emitted.length - 1];
    expect(last.palette?.[0].name).toBe("Warm white");
    // And the reference moved with it rather than being left behind.
    expect(last.floors?.[0].areas?.[0].color).toBe("var(--fp-color-warm-white)");
  });

  it("puts the field back when only whitespace changed", async () => {
    // `paletteSlug` trims, so this is the same colour and the config does not
    // change — which means Lit has no reason to re-render the input. Left
    // alone it would keep showing the spaces while the config holds none.
    const t = await mountEditor();
    const before = t.emitted.length;
    const input = await rename(t.ed, "   Warm   ");

    expect(input.value).toBe("Warm");
    expect(t.emitted.length).toBe(before);
  });

  it("still refuses a rename that would collide, whitespace or not", async () => {
    const t = await mountEditor();
    t.ed.setConfig({
      ...config(),
      palette: [
        { name: "Warm", color: "#ff8800" },
        { name: "Alert", color: "#e53935" },
      ],
    } as unknown as FloorplanCardConfig);
    await t.ed.updateComplete;
    await openNamedColors(t.ed);

    const input = nameInput(t.ed);
    input.value = "  Alert  ";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    // Refused and put back, rather than two names reducing to one property.
    expect(input.value).toBe("Warm");
  });
});

describe("the palette picker on a colour field", () => {
  /** Background, in Project → Look, carries a picker like every colour field. */
  async function picker(ed: FloorplanCardEditor): Promise<HTMLSelectElement> {
    await openGroup(ed, "Look");
    const found = ed.shadowRoot?.querySelector<HTMLSelectElement>("select.palette-pick");
    if (!found) throw new Error("palette picker not found — did the Look group change?");
    return found;
  }

  async function withBackground(color: string) {
    const t = await mountEditor();
    t.ed.setConfig({ ...config(), background: color } as unknown as FloorplanCardConfig);
    await t.ed.updateComplete;
    return t;
  }

  it("sits on the name a field references", async () => {
    const t = await withBackground("var(--fp-color-warm)");
    expect((await picker(t.ed)).value).toBe("warm");
  });

  it("reads as Custom when the name it references is gone", async () => {
    // A reference to a name the palette no longer has matches no <option>.
    // Treated as "on a name", the control disagrees with what it displays — and
    // with the plan, where a dangling reference is not a colour at all.
    const t = await withBackground("var(--fp-color-deleted)");
    const sel = await picker(t.ed);
    expect(sel.value).toBe("");
    // `value` alone would pass either way — with nothing marked selected the
    // browser falls back to the first option, which is Custom. What separates
    // "chose Custom" from "matched no option" is whether the markup says so.
    const custom = sel.querySelector<HTMLOptionElement>('option[value=""]')!;
    expect(custom.defaultSelected).toBe(true);
  });

  it("does not spend an undo step choosing Custom on a dangling reference", async () => {
    const t = await withBackground("var(--fp-color-deleted)");
    const sel = await picker(t.ed);
    const before = t.emitted.length;

    sel.value = "";
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    // There is nothing to resolve it to, so committing writes the same value.
    expect(t.emitted.length).toBe(before);
  });
});

describe("the invariant that nothing dangles", () => {
  async function withPalette(palette: unknown[], background = "var(--fp-color-warm)") {
    const t = await mountEditor();
    t.ed.setConfig({ ...config(), palette, background } as unknown as FloorplanCardConfig);
    await t.ed.updateComplete;
    await openNamedColors(t.ed);
    return t;
  }
  const rows = (ed: FloorplanCardEditor) => [
    ...(ed.shadowRoot?.querySelectorAll<HTMLInputElement>("input.palette-color") ?? []),
  ];
  const removeButtons = (ed: FloorplanCardEditor) => [
    ...(ed.shadowRoot?.querySelectorAll<HTMLButtonElement>(".palette-row button") ?? []),
  ];

  it("refuses a colour the card cannot use, instead of quietly unpublishing the name", async () => {
    // Clearing this field drops the entry from paletteEntries, so the property
    // stops being declared and every reference to it goes black — the same
    // damage a delete does, but with no rewrite, no error, and the row still
    // sitting there looking live.
    const t = await withPalette([{ name: "Warm", color: "#ff8800" }]);
    const before = t.emitted.length;
    const field = rows(t.ed)[0];

    field.value = "";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    expect(t.emitted.length).toBe(before);
    expect(field.value).toBe("#ff8800");
    expect(t.ed.shadowRoot?.textContent).toContain("needs a color");
  });

  it("refuses whitespace as readily as an empty field", async () => {
    // `cssColor` is a safety filter rather than a validity check — it lets any
    // bare identifier through on purpose, since the card cannot know every
    // colour keyword a theme or a future CSS level might use. So the set it
    // rejects, and the set that would silently unpublish a name, is the blank
    // one.
    const t = await withPalette([{ name: "Warm", color: "#ff8800" }]);
    const before = t.emitted.length;
    const field = rows(t.ed)[0];

    field.value = "   ";
    field.dispatchEvent(new Event("change", { bubbles: true }));
    await t.ed.updateComplete;

    expect(t.emitted.length).toBe(before);
    expect(field.value).toBe("#ff8800");
  });

  it("leaves references alone when a twin still declares the same name", async () => {
    // paletteEntries keeps the first of two entries sharing a slug. Deleting the
    // shadowed second one used to rewrite every reference to that slug —
    // references belonging to the survivor — freezing them at the deleted
    // entry's colour. The plan repaints wrong and a live link is severed.
    const t = await withPalette([
      { name: "Warm", color: "#ff8800" },
      { name: "warm", color: "#000000" },
    ]);
    const buttons = removeButtons(t.ed);
    expect(buttons.length).toBe(2);

    buttons[1].click();
    await t.ed.updateComplete;

    const last = t.emitted[t.emitted.length - 1];
    expect(last.palette).toHaveLength(1);
    // Still pointing at the surviving entry, not frozen at #000000.
    expect(last.background).toBe("var(--fp-color-warm)");
  });

  it("still freezes references when the name is genuinely gone", async () => {
    const t = await withPalette([{ name: "Warm", color: "#ff8800" }]);
    removeButtons(t.ed)[0].click();
    await t.ed.updateComplete;

    const last = t.emitted[t.emitted.length - 1];
    expect(last.background).toBe("#ff8800");
  });
});
