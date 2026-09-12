// @vitest-environment jsdom
/**
 * The undo stack survives card-mod (issue #257).
 *
 * card-mod patches the card editor from the outside, and the patch is the
 * whole bug. Reproduced here from its own source rather than described, so
 * this test fails for the reason the user's dashboard did:
 *
 *   setConfig(_orig, config) {
 *     const newConfig = JSON.parse(JSON.stringify(config));   // identity gone
 *     this._cardModData = { card: newConfig.card_mod };
 *     delete newConfig.card_mod;                              // stripped going in
 *     _orig(newConfig);
 *   }
 *   _handleUIConfigChanged(_orig, ev) {
 *     ev.detail.config.card_mod = cmData.card;                // added coming out
 *     _orig(ev);
 *   }
 *
 * The clone means the editor can never recognise the echo by identity, and the
 * write on the way out lands on the object the editor kept as `_lastEmitted` —
 * so the config it compared against was one it had never emitted.
 */
import { afterEach, describe, expect, it } from "vitest";
import "./editor";
import type { FloorplanCardConfig } from "./types";

const CARD_MOD = { style: "ha-card {\n  max-height: 1000px;\n}\n" };

const plan = (over: Record<string, unknown> = {}): FloorplanCardConfig => ({
  type: "custom:easy-floorplan-card",
  width: 1080,
  height: 1480,
  grid: 7,
  floors: [{
    id: "f1", name: "F1",
    walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [],
  }],
  ...over,
} as FloorplanCardConfig);

/**
 * The dialog around the editor: hands a config in, catches what comes out,
 * hands that back. `mod` puts card-mod in the middle of both halves.
 */
function dashboard(config: FloorplanCardConfig, mod: boolean) {
  const editor = document.createElement("easy-floorplan-card-editor") as any;
  document.body.appendChild(editor);

  // card-mod's `_cardModData`: created by its setConfig wrapper, and what its
  // config-changed handler tests before writing. Note it tests the *record*,
  // not the value in it -- so once a config has been through, it writes
  // `card_mod` back unconditionally, `undefined` included.
  let cardModData: { card: unknown } | undefined;
  const setConfig = (c: any) => {
    if (!mod) return editor.setConfig(c);
    const clone = JSON.parse(JSON.stringify(c));
    cardModData = { card: clone.card_mod };
    delete clone.card_mod;
    editor.setConfig(clone);
  };

  let held: any;
  editor.addEventListener("config-changed", (ev: any) => {
    if (mod && cardModData) ev.detail.config.card_mod = cardModData.card;
    held = ev.detail.config;
  });

  setConfig(config);
  return {
    editor,
    /** One discrete edit, then HA echoing the result back down. */
    editThenEcho: (patch: Record<string, unknown>) => {
      editor._commit({ ...editor._config, ...patch });
      setConfig(held);
    },
    undoDepth: () => editor._history.length,
  };
}

describe("undo with card-mod installed (issue #257)", () => {
  // The editor binds window-level listeners in connectedCallback, so an editor
  // left mounted keeps listening across the tests that follow it.
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps one undo step per edit", () => {
    const d = dashboard(plan({ card_mod: CARD_MOD }), true);
    d.editThenEcho({ width: 1200 });
    expect(d.undoDepth()).toBe(1);
    d.editThenEcho({ width: 1300 });
    expect(d.undoDepth()).toBe(2);
  });

  it("undo actually walks back, rather than sitting greyed out", () => {
    const d = dashboard(plan({ card_mod: CARD_MOD }), true);
    d.editThenEcho({ width: 1200 });
    d.editor._undo();
    expect(d.editor._config.width).toBe(1080);
  });

  it("behaves the same without card-mod, which always worked", () => {
    const d = dashboard(plan(), false);
    d.editThenEcho({ width: 1200 });
    expect(d.undoDepth()).toBe(1);
  });

  it("still drops the stack for a genuine external edit", () => {
    // The guard's actual job: a YAML-tab change that is not our echo must not
    // be revertible by a snapshot taken before it.
    const d = dashboard(plan({ card_mod: CARD_MOD }), true);
    d.editThenEcho({ width: 1200 });
    expect(d.undoDepth()).toBe(1);

    const external = { ...plan({ card_mod: CARD_MOD }), width: 999, grid: 12 };
    const clone = JSON.parse(JSON.stringify(external));
    delete (clone as any).card_mod;
    d.editor.setConfig(clone);
    expect(d.undoDepth()).toBe(0);
  });
});
