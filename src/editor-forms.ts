/**
 * Schema-driven form definitions for the editor: one `FormSpec` per element
 * kind, rendered either through HA's `<ha-form>` (native selectors) or the
 * editor's plain-input fallback. Everything here is pure and unit-tested;
 * the editor owns rendering, history routing, and hass-dependent side
 * effects (device-class inference, grid/snap rescale).
 */

/** One ha-form schema item, extended with our label/helper (read by computeLabel). */
export interface FormField {
  name: string;
  label: string;
  helper?: string;
  required?: boolean;
  selector: Record<string, unknown>;
}

/** Continuous controls (typing, sliders) — routed through the burst-history path. */
export function isLiveField(f: FormField): boolean {
  return "text" in f.selector || "number" in f.selector;
}

/** The changed schema keys from ha-form's full-object value-changed payload. */
export function diffFormValue(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
  fields: readonly FormField[]
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of fields) {
    if (next[f.name] !== prev[f.name]) patch[f.name] = next[f.name];
  }
  return patch;
}

/**
 * Per-field cleanup between the form and the config: empty optional strings
 * become undefined; invalid required numbers are dropped (keep the old
 * value); numbers clamp to the selector range; angle wraps to 0..360.
 */
export function normalizeFormPatch(
  patch: Record<string, unknown>,
  fields: readonly FormField[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (!(field.name in patch)) continue;
    let v = patch[field.name];
    if ("text" in field.selector || "icon" in field.selector || "entity" in field.selector) {
      if (v === "" || v == null) v = field.required ? "" : undefined;
    } else if ("number" in field.selector) {
      const n = typeof v === "string" && v !== "" ? Number(v) : (v as number | undefined);
      if (typeof n !== "number" || !Number.isFinite(n)) {
        if (field.required) continue;
        v = undefined;
      } else {
        const sel = field.selector.number as { min?: number; max?: number };
        let num = field.name === "angle" ? ((n % 360) + 360) % 360 : n;
        if (sel.min !== undefined && num < sel.min) num = sel.min;
        if (sel.max !== undefined && num > sel.max) num = sel.max;
        v = num;
      }
    } else if ("boolean" in field.selector) {
      v = !!v;
    }
    out[field.name] = v;
  }
  return out;
}
