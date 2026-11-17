import { describe, it, expect, vi } from "vitest";
import {
  applyCardConfig,
  findCardEditDialog,
  isNewCard,
  APPLY_NEW_CARD,
  APPLY_UNAVAILABLE,
  type AncestorNode,
  type CardEditDialog,
} from "./editor-save";

/** A stand-in for HA's edit dialog, with the internals Apply reaches for. */
const makeDialog = (over: Partial<CardEditDialog> = {}): CardEditDialog & {
  saved: unknown[];
} => {
  const saved: unknown[] = [];
  return {
    saved,
    _cardConfig: { type: "custom:easy-floorplan-card", floors: [] },
    _params: {
      saveCardConfig: (config: unknown) => {
        saved.push(config);
      },
    },
    ...over,
  };
};

/** Chain `nodes` child-to-parent, shadow roots included (`{ host }` hops). */
const chain = (...nodes: AncestorNode[]): AncestorNode => {
  for (let i = 0; i < nodes.length - 1; i++) {
    const node = nodes[i] as { parentNode?: AncestorNode; host?: AncestorNode };
    if ("host" in node) node.host = nodes[i + 1];
    else node.parentNode = nodes[i + 1];
  }
  return nodes[0];
};

describe("findCardEditDialog", () => {
  it("walks out of shadow roots to the dialog", () => {
    const dialog = makeDialog();
    const editor = {};
    chain(editor, { host: null }, {}, { host: null }, dialog);
    expect(findCardEditDialog(editor)).toBe(dialog);
  });

  it("stops at the nearest dialog", () => {
    const inner = makeDialog();
    const outer = makeDialog();
    const editor = {};
    chain(editor, inner, outer);
    expect(findCardEditDialog(editor)).toBe(inner);
  });

  it("ignores ancestors whose saveCardConfig isn't callable", () => {
    // An older dialog: params, but no hook — as good as no dialog at all.
    const legacy = { _params: { path: [0], cardIndex: 1 } };
    const editor = {};
    chain(editor, legacy as AncestorNode);
    expect(findCardEditDialog(editor)).toBeNull();
  });

  it("returns null for a detached editor", () => {
    expect(findCardEditDialog({})).toBeNull();
    expect(findCardEditDialog(null)).toBeNull();
  });

  it("gives up rather than looping on a cyclic chain", () => {
    const a: { parentNode?: AncestorNode } = {};
    const b: { parentNode?: AncestorNode } = {};
    a.parentNode = b;
    b.parentNode = a;
    expect(findCardEditDialog(a)).toBeNull();
  });
});

describe("isNewCard", () => {
  it("is true while the dialog is still adding the card", () => {
    const dialog = makeDialog({ _params: { saveCardConfig: () => {}, isNew: true } });
    expect(isNewCard(chain({}, { host: null }, dialog))).toBe(true);
  });

  it("is false for a card already on the dashboard", () => {
    expect(isNewCard(chain({}, { host: null }, makeDialog()))).toBe(false);
    const saved = makeDialog({ _params: { saveCardConfig: () => {}, isNew: false } });
    expect(isNewCard(chain({}, saved))).toBe(false);
  });

  it("is false with no dialog to ask, leaving the click to explain", () => {
    expect(isNewCard({})).toBe(false);
    expect(isNewCard(null)).toBe(false);
  });
});

describe("applyCardConfig", () => {
  it("saves the config the dialog holds", async () => {
    const dialog = makeDialog();
    const editor = chain({}, { host: null }, dialog);
    await expect(applyCardConfig(editor)).resolves.toEqual({ ok: true });
    expect(dialog.saved).toEqual([dialog._cardConfig]);
  });

  it("saves the whole stack when the floorplan is nested in one", async () => {
    // What the view must be handed back is the outer card, not ours.
    const stack = { type: "vertical-stack", cards: [{ type: "custom:easy-floorplan-card" }] };
    const dialog = makeDialog({ _cardConfig: stack });
    await expect(applyCardConfig(chain({}, dialog))).resolves.toEqual({ ok: true });
    expect(dialog.saved).toEqual([stack]);
  });

  it("waits for an async save", async () => {
    let resolveSave: () => void = () => {};
    const done = new Promise<void>((r) => {
      resolveSave = r;
    });
    const dialog = makeDialog({ _params: { saveCardConfig: () => done } });
    let settled = false;
    const applying = applyCardConfig(chain({}, dialog)).then((r) => {
      settled = true;
      return r;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveSave();
    await expect(applying).resolves.toEqual({ ok: true });
  });

  it("reports a failed dashboard write instead of claiming a save", async () => {
    const dialog = makeDialog({
      _params: {
        saveCardConfig: () => Promise.reject(new Error("Config not found")),
      },
      _markDirtyStateClean: vi.fn(),
    });
    const result = await applyCardConfig(chain({}, dialog));
    expect(result).toEqual({ ok: false, error: "Could not save — Config not found" });
    // A failed save leaves unsaved changes: closing must still warn.
    expect(dialog._markDirtyStateClean).not.toHaveBeenCalled();
  });

  it("clears the dialog's dirty state so closing doesn't warn", async () => {
    const dialog = makeDialog({ _markDirtyStateClean: vi.fn() });
    await applyCardConfig(chain({}, dialog));
    expect(dialog._markDirtyStateClean).toHaveBeenCalledTimes(1);
  });

  it("falls back to the older dirty flag", async () => {
    const dialog = makeDialog({ _dirty: true });
    await applyCardConfig(chain({}, dialog));
    expect(dialog._dirty).toBe(false);
  });

  it("refuses while the card is new, which would add a second copy", async () => {
    const dialog = makeDialog({
      _params: { saveCardConfig: () => {}, isNew: true },
    });
    await expect(applyCardConfig(chain({}, dialog))).resolves.toEqual({
      ok: false,
      error: APPLY_NEW_CARD,
    });
    expect(dialog.saved).toEqual([]);
  });

  it("reports unavailable when there is no dialog to save through", async () => {
    await expect(applyCardConfig({})).resolves.toEqual({
      ok: false,
      error: APPLY_UNAVAILABLE,
    });
  });

  it("reports unavailable rather than saving a config the dialog hasn't got", async () => {
    const dialog = makeDialog({ _cardConfig: undefined });
    await expect(applyCardConfig(chain({}, dialog))).resolves.toEqual({
      ok: false,
      error: APPLY_UNAVAILABLE,
    });
    expect(dialog.saved).toEqual([]);
  });
});
