/**
 * Trace template — a PDF or image of an existing floor plan laid under the
 * editor canvas to draw walls over, then thrown away.
 *
 * It is the editor's tracing paper, not the floor's background image: nothing
 * here is ever written to the config, so the card never sees it and a saved
 * plan carries no trace of it. That is also why it can take a PDF, which the
 * card's `image` cannot — an architect's plan usually arrives as one, and
 * exporting a page to PNG first is exactly the chore this removes.
 *
 * The pure half of the feature lives here (placement, calibration, the SVG
 * transform) so it can be tested without a canvas; the editor owns the state
 * and the gestures.
 */

/** A template placed on the canvas, in canvas (virtual) units. */
export interface TraceTemplate {
  /** Object URL of the raster: the image itself, or a rendered PDF page. */
  src: string;
  /** File name, shown in the panel so you know which plan is underneath. */
  name: string;
  /** Raster size in pixels. */
  pw: number;
  ph: number;
  /** Canvas position of the raster's top-left corner, before rotation. */
  x: number;
  y: number;
  /** Canvas units per raster pixel. */
  scale: number;
  /** Degrees, clockwise, about the raster's centre. */
  rotation: number;
  opacity: number;
  visible: boolean;
  /** PDF only: the page shown (1-based) and how many the file has. */
  page?: number;
  pages?: number;
  /** PDF only: the file, kept so another page can be rendered from it. */
  file?: Blob;
}

export interface Point {
  x: number;
  y: number;
}

export const TRACE_DEFAULT_OPACITY = 0.5;

/**
 * Longest side a PDF page is rendered to. Large enough that a wall line on an
 * A1 plan survives zooming in to trace it, small enough to stay well inside
 * every browser's canvas limit (and a few tens of MB of memory at most).
 */
export const PDF_MAX_SIDE = 4096;

/**
 * Where a fresh template goes: fitted inside the canvas, proportions kept,
 * centred. Scaling it to the right size is the next step — calibration — so
 * this only has to put the whole plan in view.
 */
export function fitTrace(
  pw: number,
  ph: number,
  width: number,
  height: number
): Pick<TraceTemplate, "x" | "y" | "scale"> {
  if (!(pw > 0) || !(ph > 0)) return { x: 0, y: 0, scale: 1 };
  const scale = Math.min(width / pw, height / ph);
  return { x: (width - pw * scale) / 2, y: (height - ph * scale) / 2, scale };
}

/** The SVG transform that maps raster pixels onto the canvas. */
export function traceTransform(t: TraceTemplate): string {
  const cx = (t.pw * t.scale) / 2;
  const cy = (t.ph * t.scale) / 2;
  return `translate(${t.x} ${t.y}) rotate(${t.rotation || 0} ${cx} ${cy}) scale(${t.scale})`;
}

/** The template's footprint on the canvas: width and height in canvas units. */
export function traceSize(t: Pick<TraceTemplate, "pw" | "ph" | "scale">): {
  w: number;
  h: number;
} {
  return { w: t.pw * t.scale, h: t.ph * t.scale };
}

/**
 * Rescale the template by `factor` about the canvas point `anchor`, so the
 * part of the plan under the anchor stays exactly where it is. Rotation is
 * about the raster's centre, which moves with the scale — the position below
 * is what keeps the composite a pure scale about the anchor.
 */
export function scaleTraceAbout(
  t: TraceTemplate,
  factor: number,
  anchor: Point
): TraceTemplate {
  if (!(factor > 0) || !Number.isFinite(factor)) return t;
  return {
    ...t,
    scale: t.scale * factor,
    x: anchor.x + (t.x - anchor.x) * factor,
    y: anchor.y + (t.y - anchor.y) * factor,
  };
}

/**
 * Two points picked on the template, and what the distance between them
 * should measure on the canvas: rescale so it does, holding the first point
 * still. This is how a plan printed at any scale lines up with the grid — pick
 * both ends of a wall whose length you know and type it in.
 */
export function calibrateTrace(
  t: TraceTemplate,
  a: Point,
  b: Point,
  distance: number
): TraceTemplate {
  const measured = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(measured > 0) || !(distance > 0)) return t;
  return scaleTraceAbout(t, distance / measured, a);
}

/** Set the template's canvas width, keeping its centre where it is. */
export function resizeTraceWidth(t: TraceTemplate, width: number): TraceTemplate {
  const { w, h } = traceSize(t);
  if (!(width > 0) || !(w > 0)) return t;
  return scaleTraceAbout(t, width / w, { x: t.x + w / 2, y: t.y + h / 2 });
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

/**
 * pdf.js, fetched on first use rather than bundled. Only the rare editor
 * session that drops a PDF pays for it; the card itself — loaded on every
 * dashboard view — stays exactly the size it was. Pinned, so the code that
 * runs is the code this was tested with.
 */
export const PDFJS_VERSION = "4.10.38";
const PDFJS_BASE = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`;

/** The few pieces of the pdf.js API this uses. */
interface PdfViewport {
  width: number;
  height: number;
}
interface PdfPage {
  getViewport(o: { scale: number }): PdfViewport;
  render(o: {
    canvasContext: CanvasRenderingContext2D;
    viewport: PdfViewport;
    background?: string;
  }): { promise: Promise<void> };
  cleanup?(): void;
}
interface PdfDocument {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}
interface PdfJs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(src: { data: Uint8Array }): { promise: Promise<PdfDocument> };
}

let pdfjs: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import(/* @vite-ignore */ `${PDFJS_BASE}pdf.min.mjs`).then(
    (m: PdfJs) => {
      m.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
      return m;
    },
    (err: unknown) => {
      // Let the next attempt try again (the network may be back).
      pdfjs = null;
      throw new Error(
        "Could not load the PDF reader (it is fetched from cdn.jsdelivr.net " +
          "on first use). Check the connection, or export the page as PNG/JPG " +
          `and load that instead. (${err instanceof Error ? err.message : String(err)})`
      );
    }
  );
  return pdfjs;
}

/** True for a PDF, by type or — for browsers that leave `type` blank — by name. */
export function isPdf(file: { type: string; name: string }): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** The render scale that brings a page's longest side to `PDF_MAX_SIDE` px. */
export function pdfRenderScale(width: number, height: number): number {
  const side = Math.max(width, height);
  return side > 0 ? PDF_MAX_SIDE / side : 1;
}

export interface LoadedRaster {
  src: string;
  pw: number;
  ph: number;
  page?: number;
  pages?: number;
}

/** Render one page of a PDF to a PNG object URL. */
export async function renderPdfPage(file: Blob, page = 1): Promise<LoadedRaster> {
  const lib = await loadPdfJs();
  const doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  try {
    const n = Math.min(Math.max(1, Math.round(page)), doc.numPages);
    const p = await doc.getPage(n);
    const base = p.getViewport({ scale: 1 });
    const viewport = p.getViewport({ scale: pdfRenderScale(base.width, base.height) });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser cannot draw the PDF (no 2D canvas).");
    // White paper, so a plan with a transparent page doesn't vanish on a dark skin.
    await p.render({ canvasContext: ctx, viewport, background: "#ffffff" }).promise;
    p.cleanup?.();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("Could not rasterise the PDF page.");
    return {
      src: URL.createObjectURL(blob),
      pw: canvas.width,
      ph: canvas.height,
      page: n,
      pages: doc.numPages,
    };
  } finally {
    void doc.destroy();
  }
}

/** Load an image file and read its pixel size. */
export async function loadImage(file: Blob): Promise<LoadedRaster> {
  const src = URL.createObjectURL(file);
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(src);
    throw new Error("That file is not an image this browser can read. Use a PDF, PNG, JPG or SVG.");
  }
  // An SVG without width/height decodes at 0×0 in some browsers; give it a size.
  return { src, pw: img.naturalWidth || 1000, ph: img.naturalHeight || 1000 };
}

/** Turn a picked file into a raster: PDFs through pdf.js, anything else as an image. */
export function loadTraceFile(file: File): Promise<LoadedRaster> {
  return isPdf(file) ? renderPdfPage(file, 1) : loadImage(file);
}
