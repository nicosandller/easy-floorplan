/**
 * Shared implementation behind the three near-identical debug loggers that
 * used to live in area-tools.ts, area-push-tools.ts and editor.ts (PR #374
 * review): same flag/max-chars/repeat-summary/compact/serialize shape, only
 * the prefix, allow-list and a couple of numbers differed. One copy means one
 * place to flip logging off, not three.
 */
export interface DebugLoggerOptions {
  /** Master on/off switch. Read once at `createDebugLogger` call time. */
  enabled: boolean;
  /** Serialized payloads longer than this are truncated with a "...N chars" note. */
  maxChars: number;
  /** After this many consecutive identical payloads for a label, collapse to a "repeated Nx" line instead of logging the payload again. */
  repeatSummaryEvery: number;
  /** Only labels starting with one of these prefixes are ever logged. */
  labelAllow: readonly string[];
  /** Keys replaced with `"[omitted]"` wherever they appear, regardless of type. */
  omitKeys?: readonly string[];
  /** Keys summarized as `"Array(n)"` when their value is an array, `"[omitted]"` otherwise. */
  arrayLengthKeys?: readonly string[];
  /** Extra gate evaluated after `labelAllow`, e.g. to sample a noisy per-frame label instead of logging every call. */
  shouldLog?: (label: string) => boolean;
}

export type DebugLogger = (label: string, value: unknown) => void;

export function createDebugLogger(prefix: string, options: DebugLoggerOptions): DebugLogger {
  const omitKeys = new Set(options.omitKeys ?? []);
  const arrayLengthKeys = new Set(options.arrayLengthKeys ?? []);
  const logState = new Map<string, { text: string; count: number }>();

  const allowed = (label: string): boolean => options.labelAllow.some((p) => label.startsWith(p));

  function compact(value: unknown, depth = 0): unknown {
    if (value == null) return value;
    if (typeof value === "bigint") return String(value);
    if (typeof value !== "object") return value;
    if (value instanceof Set) return `Set(${value.size})`;
    if (value instanceof Map) return `Map(${value.size})`;
    if (Array.isArray(value)) {
      if (depth >= 2) return `Array(${value.length})`;
      const sample = value.slice(0, 6).map((item) => compact(item, depth + 1));
      if (value.length > 6) sample.push(`...(+${value.length - 6})`);
      return sample;
    }
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(input)) {
      if (omitKeys.has(key)) {
        out[key] = "[omitted]";
        continue;
      }
      if (arrayLengthKeys.has(key)) {
        out[key] = Array.isArray(raw) ? `Array(${raw.length})` : "[omitted]";
        continue;
      }
      out[key] = depth >= 2 ? "[nested]" : compact(raw, depth + 1);
    }
    return out;
  }

  const serialize = (value: unknown): string => {
    const compacted = compact(value);
    const text = JSON.stringify(compacted, null, 0);
    if (!text) return String(compacted);
    if (text.length <= options.maxChars) return text;
    return `${text.slice(0, options.maxChars)}... [truncated ${text.length - options.maxChars} chars]`;
  };

  return (label: string, value: unknown): void => {
    if (!options.enabled) return;
    if (!allowed(label)) return;
    if (options.shouldLog && !options.shouldLog(label)) return;
    const text = serialize(value);
    const prev = logState.get(label);
    if (prev && prev.text === text) {
      prev.count += 1;
      if (prev.count % options.repeatSummaryEvery === 0) {
        console.log(`[easy-floorplan:${prefix}] ${label} (same payload repeated ${prev.count}x)`);
      }
      return;
    }
    if (prev && prev.count > 1) {
      console.log(`[easy-floorplan:${prefix}] ${label} (same payload repeated ${prev.count}x)`);
    }
    logState.set(label, { text, count: 1 });
    console.log(`[easy-floorplan:${prefix}] ${label}`, text);
  };
}
