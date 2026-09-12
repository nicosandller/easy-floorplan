import type { HistoryEventInput } from "./history-service";

/**
 * Thin a history window down to what a replay can actually draw.
 *
 * A busy plan produces far more events than either the timeline or the eye can
 * use: two hours of the demo's tracker sensors alone is ~2,700 points, and the
 * timeline spends its whole frame budget building markers nobody can
 * distinguish at 4px apart.
 *
 * The thinning is deliberately asymmetric, because the two kinds of history
 * here carry very different amounts of information per event:
 *
 * - **Discrete states** — a light turning on, a door opening, a cover reaching
 *   `closed` — are kept in full. Every one is a distinct thing that happened,
 *   they are already sparse, and dropping one makes the replay wrong rather
 *   than coarse.
 * - **Numeric drift** — a temperature wandering from 20.1 to 20.2 — is kept
 *   only when it moves by at least one step of the entity's own observed
 *   range. The shape of the curve survives; the sampling noise does not.
 *
 * Local extrema are always kept, so thinning cannot flatten a spike: the
 * hottest point of the day stays the hottest point of the day.
 */
export interface DownsampleOptions {
  /**
   * How many levels a numeric entity's range is divided into. A value moving
   * less than one level since the last kept point is dropped. Lower is
   * coarser; `0` or undefined disables thinning entirely.
   */
  numericSteps?: number;
  /**
   * Never drop more than this much wall-clock time in a row, even if the value
   * is flat, so a long-idle sensor still has points to seek to.
   */
  maxGapMs?: number;
}

const DEFAULT_MAX_GAP_MS = 60_000;

/**
 * States that mean "the sensor did not answer" rather than a value. They are
 * kept whatever the resolution: an outage is a discrete thing that happened,
 * and on a flaky sensor it is usually the most interesting thing on the lane.
 */
const OUTAGE_STATES = new Set(["unavailable", "unknown"]);

function isOutage(value: string): boolean {
  return OUTAGE_STATES.has(value);
}

function numeric(value: string): number | undefined {
  if (value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Whether this entity's series is numeric drift rather than discrete states.
 * Judged from the events themselves rather than the entity id, because a
 * `sensor.` can be either and an `input_number.` is always the former.
 *
 * Outages do not disqualify a series. A sensor that drops out is still a
 * numeric sensor, and treating it as discrete because of one `unavailable`
 * exempts it from every kind of thinning — which is how the demo's flaky
 * sensor, the one entity most likely to be noisy, ended up as the only lane
 * still drawing all of its points.
 *
 * The whole series is scanned rather than a prefix: a sensor whose outage
 * happens to fall in the first few events is exactly the case this needs to
 * get right.
 */
function isNumericSeries(events: HistoryEventInput[]): boolean {
  let numericSeen = 0;
  for (const e of events) {
    if (isOutage(e.newState)) continue;
    if (numeric(e.newState) === undefined) return false;
    numericSeen++;
  }
  return numericSeen > 0;
}

function thinNumeric(
  events: HistoryEventInput[],
  steps: number,
  maxGapMs: number,
): HistoryEventInput[] {
  const values = events.map((e) => numeric(e.newState));
  const readings = values.filter((v): v is number => v !== undefined);
  if (!readings.length) return events;
  const deadband = (Math.max(...readings) - Math.min(...readings)) / steps;
  // A series that never moves has no shape to preserve: first and last is all
  // the information there is — but only if nothing ever went wrong in between,
  // because an outage is not a value it failed to move away from.
  if (!(deadband > 0) && !events.some((e) => isOutage(e.newState))) {
    return events.length ? [events[0], events[events.length - 1]] : [];
  }

  const kept: HistoryEventInput[] = [events[0]];
  let lastKept: number | undefined = values[0];
  let lastTime = events[0].timestamp;

  for (let i = 1; i < events.length - 1; i++) {
    const v = values[i];
    // Going out, and coming back, are both events in their own right.
    if (v === undefined) {
      kept.push(events[i]);
      lastKept = undefined;
      lastTime = events[i].timestamp;
      continue;
    }
    // The first reading after an outage is always kept: there is no previous
    // value to have drifted from, and it is what ends the gap.
    if (lastKept === undefined) {
      kept.push(events[i]);
      lastKept = v;
      lastTime = events[i].timestamp;
      continue;
    }
    const prev = values[i - 1];
    const next = values[i + 1];
    // A local extremum is the one point that must not be smoothed away, or a
    // thinned spike reads as a plateau. Undefined neighbours are an outage
    // rather than a turning point, so they do not make one.
    const extremum =
      prev !== undefined && next !== undefined &&
      ((v > prev && v >= next) || (v < prev && v <= next));
    if (
      Math.abs(v - lastKept) >= deadband ||
      (extremum && Math.abs(v - lastKept) >= deadband / 2) ||
      events[i].timestamp - lastTime >= maxGapMs
    ) {
      kept.push(events[i]);
      lastKept = v;
      lastTime = events[i].timestamp;
    }
  }
  if (events.length > 1) kept.push(events[events.length - 1]);
  return kept;
}

/** Thin one entity's series. Exported for tests. */
export function downsampleSeries(
  events: HistoryEventInput[],
  options: DownsampleOptions = {},
): HistoryEventInput[] {
  const steps = options.numericSteps ?? 0;
  if (!(steps > 0) || events.length < 3) return events;
  if (!isNumericSeries(events)) return events;
  return thinNumeric(events, steps, options.maxGapMs ?? DEFAULT_MAX_GAP_MS);
}

/**
 * Thin a whole window, per entity, preserving the original chronological order
 * of what survives.
 */
export function downsampleHistory(
  events: HistoryEventInput[],
  options: DownsampleOptions = {},
): HistoryEventInput[] {
  if (!(options.numericSteps ?? 0) || events.length === 0) return events;

  const byEntity = new Map<string, HistoryEventInput[]>();
  for (const event of events) {
    const bucket = byEntity.get(event.entityId);
    if (bucket) bucket.push(event);
    else byEntity.set(event.entityId, [event]);
  }

  const keep = new Set<HistoryEventInput>();
  for (const series of byEntity.values()) {
    for (const event of downsampleSeries(series, options)) keep.add(event);
  }
  return events.filter((event) => keep.has(event));
}

/**
 * Thin a series down to what a lane can actually show, keeping the biggest
 * moves.
 *
 * This is a *display* concern and deliberately separate from
 * {@link downsampleHistory}, which changes the data replay reads. A sensor
 * that genuinely swings across its whole range — the demo's distance trackers
 * do, several times a minute — survives deadband thinning almost intact,
 * because every one of those points really is a large move. It still cannot be
 * drawn: a lane around 1800px wide fits about 225 markers before they touch,
 * and past that the lane is a solid bar that says nothing.
 *
 * So the lane gets a budget instead of a threshold, and spends it on the
 * largest changes. Replay still steps through every value it loaded; you just
 * stop seeing a marker for each one.
 *
 * Discrete series are returned untouched at any budget — there is no such
 * thing as a "small" change between `on` and `off`, so there is no honest way
 * to rank them.
 */
export function thinForDisplay(events: HistoryEventInput[], maxMarkers: number): HistoryEventInput[] {
  if (!(maxMarkers > 2) || events.length <= maxMarkers) return events;
  if (!isNumericSeries(events)) return events;

  const values = events.map((e) => numeric(e.newState));
  const keep = new Set<number>([0, events.length - 1]);

  // Outages are kept before anything competes for the budget. On a flaky
  // sensor the drop-outs are the story, and they are the points a reader most
  // wants to be able to click.
  for (let i = 0; i < events.length; i++) {
    if (values[i] === undefined) keep.add(i);
  }

  // Then rank the remaining interior points by how far each moved from the
  // previous reading, and spend what is left of the budget on the biggest.
  const ranked: { i: number; delta: number }[] = [];
  let previous: number | undefined;
  for (let i = 0; i < events.length; i++) {
    const v = values[i];
    if (v === undefined) {
      previous = undefined;
      continue;
    }
    if (i > 0 && i < events.length - 1 && previous !== undefined) {
      ranked.push({ i, delta: Math.abs(v - previous) });
    }
    previous = v;
  }
  ranked.sort((a, b) => b.delta - a.delta);
  for (const { i } of ranked) {
    if (keep.size >= maxMarkers) break;
    keep.add(i);
  }
  return events.filter((_, i) => keep.has(i));
}
