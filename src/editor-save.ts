/**
 * "Apply" — write the card to the dashboard without closing the editor
 * (issue #198).
 *
 * Home Assistant's Save closes the edit dialog. The preview beside the editor
 * is a fraction of the size of the real card, so it can't settle where an icon
 * actually lands on the plan; checking that meant saving, losing the editor,
 * looking at the dashboard, then reopening and expanding it again for the next
 * nudge. Apply does what Save does, minus the close.
 *
 * There is no public API for that, so this reaches into the dialog HA opened
 * around us: `hui-dialog-edit-card` keeps the params it was shown with —
 * including `saveCardConfig`, the callback that writes the card back into the
 * view — plus the config it currently holds. Those are internals, so nothing
 * here assumes they exist: every hop is duck-typed and a miss becomes a "use
 * Save" message rather than an exception. HA has had this shape since 2025.3;
 * before that the dialog built the new dashboard config itself, and the button
 * degrades to that message.
 *
 * The config that gets saved is the *dialog's*, never our own. A floorplan
 * nested in a vertical-stack is edited through the stack's editor, and what
 * the view must be handed back is the whole stack — our own config would
 * replace the stack with the bare floorplan.
 */

/**
 * A node in the composed ancestor chain: an element (`parentNode`) or a shadow
 * root (`host`). Structural rather than `Node`, so the walk is testable
 * without a DOM.
 */
export interface AncestorNode {
  readonly parentNode?: AncestorNode | null;
  readonly host?: AncestorNode | null;
}

/** The parts of `hui-dialog-edit-card` Apply uses. All internals, all optional. */
export interface CardEditDialog extends AncestorNode {
  _params?: {
    /** Writes the card back into the view (and saves the dashboard). */
    saveCardConfig?: (config: unknown) => unknown;
    /** True while the card is still being added — see `applyCardConfig`. */
    isNew?: boolean;
  };
  /** The card config the dialog holds right now, ours included. */
  _cardConfig?: unknown;
  /** Current HA: re-baselines the dirty tracking after a save. */
  _markDirtyStateClean?: () => void;
  /** Older HA: the same thing as a plain flag. */
  _dirty?: boolean;
}

export type ApplyResult = { ok: true } | { ok: false; error: string };

/** Shown when the dialog above us isn't one we know how to save through. */
export const APPLY_UNAVAILABLE =
  "Apply needs Home Assistant's card editor — use Save instead.";

/**
 * Shown while the card is new. The dialog's callback *adds* a card until the
 * first save, so applying twice would leave two floorplans on the dashboard.
 */
export const APPLY_NEW_CARD =
  "Save this card once first — it isn't on the dashboard yet.";

/** A cycle in the chain (or a pathological one) must not hang the click. */
const MAX_DEPTH = 200;

/** The nearest ancestor that can save the card, or null. */
export function findCardEditDialog(
  start: AncestorNode | null | undefined
): CardEditDialog | null {
  let node: AncestorNode | null | undefined = start;
  for (let depth = 0; node && depth < MAX_DEPTH; depth++) {
    const dialog = node as CardEditDialog;
    if (typeof dialog._params?.saveCardConfig === "function") return dialog;
    // A shadow root has no parent; step through its host instead.
    node = node.parentNode ?? node.host ?? null;
  }
  return null;
}

/**
 * Whether the card is still being added (issue #429), so Apply can be disabled
 * before it is pressed rather than fail when it is. The same `isNew` test
 * `applyCardConfig` makes on the click, which stays as the fallback.
 *
 * Readable as soon as the editor sits in the dialog; HA's Save closes the
 * dialog, so the card is only ever seen as saved by the next editor it opens.
 */
export function isNewCard(start: AncestorNode | null | undefined): boolean {
  return findCardEditDialog(start)?._params?.isNew === true;
}

/**
 * Save whatever the surrounding edit dialog currently holds, leaving it open.
 *
 * `start` is the editor element: the dialog is found by walking out through
 * the shadow roots between us. Failures are returned, not thrown — the button
 * reports them in place and HA's own Save still works.
 */
export async function applyCardConfig(
  start: AncestorNode | null | undefined
): Promise<ApplyResult> {
  const dialog = findCardEditDialog(start);
  if (!dialog) return { ok: false, error: APPLY_UNAVAILABLE };
  if (dialog._params?.isNew) return { ok: false, error: APPLY_NEW_CARD };
  const config = dialog._cardConfig;
  if (!config || typeof config !== "object") {
    return { ok: false, error: APPLY_UNAVAILABLE };
  }
  try {
    // The callback is async in every HA that has it; await it so a failed
    // dashboard write is reported instead of read as a save.
    await dialog._params!.saveCardConfig!(config);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save — ${message}` };
  }
  // What the dialog holds is now what's on the dashboard, so closing it must
  // not warn about unsaved changes.
  if (typeof dialog._markDirtyStateClean === "function") {
    dialog._markDirtyStateClean();
  } else if (typeof dialog._dirty === "boolean") {
    dialog._dirty = false;
  }
  return { ok: true };
}
