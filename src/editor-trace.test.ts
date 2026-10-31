import { describe, it, expect } from "vitest";
import {
  PDF_MAX_SIDE,
  calibrateTrace,
  fitTrace,
  isPdf,
  pdfRenderScale,
  resizeTraceWidth,
  scaleTraceAbout,
  traceSize,
  traceTransform,
  type Point,
  type TraceTemplate,
} from "./editor-trace";

const make = (over: Partial<TraceTemplate> = {}): TraceTemplate => ({
  src: "blob:x",
  name: "plan.pdf",
  pw: 2000,
  ph: 1000,
  x: 0,
  y: 0,
  scale: 0.5,
  rotation: 0,
  opacity: 0.5,
  visible: true,
  ...over,
});

/** Where raster pixel `q` lands on the canvas — the transform, done by hand. */
const toCanvas = (t: TraceTemplate, q: Point): Point => {
  const cx = (t.pw * t.scale) / 2;
  const cy = (t.ph * t.scale) / 2;
  const rad = (t.rotation * Math.PI) / 180;
  const px = q.x * t.scale - cx;
  const py = q.y * t.scale - cy;
  return {
    x: t.x + cx + px * Math.cos(rad) - py * Math.sin(rad),
    y: t.y + cy + px * Math.sin(rad) + py * Math.cos(rad),
  };
};

describe("fitTrace", () => {
  it("fits a wide plan to the canvas width, centred vertically", () => {
    expect(fitTrace(2000, 1000, 1000, 1000)).toEqual({ x: 0, y: 250, scale: 0.5 });
  });

  it("fits a tall plan to the canvas height, centred horizontally", () => {
    expect(fitTrace(1000, 2000, 1000, 600)).toEqual({ x: 350, y: 0, scale: 0.3 });
  });

  it("survives a zero-size raster", () => {
    expect(fitTrace(0, 0, 1000, 600)).toEqual({ x: 0, y: 0, scale: 1 });
  });
});

describe("traceTransform", () => {
  it("translates, rotates about the centre, then scales", () => {
    expect(traceTransform(make({ x: 10, y: 20, rotation: 90 }))).toBe(
      "translate(10 20) rotate(90 500 250) scale(0.5)"
    );
  });
});

describe("scaleTraceAbout", () => {
  it("keeps the anchor still", () => {
    const t = make({ x: 40, y: 30 });
    const anchorPx = { x: 600, y: 200 };
    const anchor = toCanvas(t, anchorPx);
    const next = scaleTraceAbout(t, 2.5, anchor);
    expect(next.scale).toBeCloseTo(1.25);
    const after = toCanvas(next, anchorPx);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it("keeps the anchor still on a rotated template too", () => {
    const t = make({ x: 40, y: 30, rotation: 33 });
    const anchorPx = { x: 1500, y: 800 };
    const anchor = toCanvas(t, anchorPx);
    const after = toCanvas(scaleTraceAbout(t, 0.4, anchor), anchorPx);
    expect(after.x).toBeCloseTo(anchor.x);
    expect(after.y).toBeCloseTo(anchor.y);
  });

  it("ignores a factor that is not a positive number", () => {
    const t = make();
    expect(scaleTraceAbout(t, 0, { x: 0, y: 0 })).toBe(t);
    expect(scaleTraceAbout(t, -1, { x: 0, y: 0 })).toBe(t);
    expect(scaleTraceAbout(t, NaN, { x: 0, y: 0 })).toBe(t);
    expect(scaleTraceAbout(t, Infinity, { x: 0, y: 0 })).toBe(t);
  });
});

describe("calibrateTrace", () => {
  it("makes the picked span measure the given distance, holding A", () => {
    const t = make({ x: 100, y: 50, rotation: 12 });
    // Two pixels on the plan, a known length apart.
    const aPx = { x: 200, y: 300 };
    const bPx = { x: 1200, y: 300 };
    const a = toCanvas(t, aPx);
    const b = toCanvas(t, bPx);
    const next = calibrateTrace(t, a, b, 820);
    const a2 = toCanvas(next, aPx);
    const b2 = toCanvas(next, bPx);
    expect(Math.hypot(b2.x - a2.x, b2.y - a2.y)).toBeCloseTo(820);
    expect(a2.x).toBeCloseTo(a.x);
    expect(a2.y).toBeCloseTo(a.y);
  });

  it("leaves the template alone for a zero span or a non-positive distance", () => {
    const t = make();
    expect(calibrateTrace(t, { x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toBe(t);
    expect(calibrateTrace(t, { x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBe(t);
  });
});

describe("resizeTraceWidth", () => {
  it("sets the canvas width and keeps the centre", () => {
    const t = make({ x: 100, y: 100 });
    const before = traceSize(t);
    const next = resizeTraceWidth(t, 1500);
    const after = traceSize(next);
    expect(after.w).toBeCloseTo(1500);
    expect(after.h / after.w).toBeCloseTo(before.h / before.w);
    expect(next.x + after.w / 2).toBeCloseTo(t.x + before.w / 2);
    expect(next.y + after.h / 2).toBeCloseTo(t.y + before.h / 2);
  });
});

describe("isPdf", () => {
  it("goes by the type, or by the name when the type is blank", () => {
    expect(isPdf({ type: "application/pdf", name: "x" })).toBe(true);
    expect(isPdf({ type: "", name: "Grundriss EG.PDF" })).toBe(true);
    expect(isPdf({ type: "image/png", name: "plan.png" })).toBe(false);
  });
});

describe("pdfRenderScale", () => {
  it("brings the longest side to PDF_MAX_SIDE", () => {
    // A4 landscape in PDF points.
    expect(842 * pdfRenderScale(842, 595)).toBeCloseTo(PDF_MAX_SIDE);
    expect(1191 * pdfRenderScale(842, 1191)).toBeCloseTo(PDF_MAX_SIDE);
  });
});
