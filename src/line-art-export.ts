/** A standalone architectural drawing, built from config rather than the live DOM. */
import { nothing, render, svg } from "lit";
import { cssNumber } from "./css-safe";
import { rectAreaSideWalls } from "./editor-geometry";
import {
  areaLabelPoint, areaLabelSize, isRailing, openingDefaultOpen, planRotationTransform,
  RAILING_WEIGHT, renderFurniture, renderOpening, renderWallMask, rotatedCanvasSize,
  rotatePlanPoint, wallThickness, type OpeningStyle, type PlanRotation,
} from "./render";
import {
  elevationShift, furnitureSolid, FURNITURE_HEIGHT_FRACTION,
  normalizeProjection, normalizeWallHeight, planProjectionTransform, projectPlanPoint,
  projectedCanvasSize, renderIsoSolids, wallSolids, type DisplayFrame, type IsoSolid,
} from "./projection";
import { openingSolids } from "./projection-openings";
import { solidEdgeRenderer } from "./line-art";
import { symbolCatalog } from "./symbols";
import { DEFAULT_HEIGHT, DEFAULT_WIDTH, type Floor, type FloorplanCardConfig, type Opening } from "./types";

const INK = "#222222";
const PAPER = "#ffffff";

// Export a stable drawing convention: swing doors open, windows closed. Entity
// values, replay time, and an opening midway through an animation are irrelevant.
const openingStyle = (o: Opening): OpeningStyle => ({
  color: INK, accent: INK, open: openingDefaultOpen(o),
});

export interface LineArtExport {
  svg: string;
  filename: string;
}

/** Uses the card's full canvas and current rotation, never its transient zoom. */
export function createLineArtSvg(c: FloorplanCardConfig, floor: Floor, rot: PlanRotation): LineArtExport {
  const width = Math.max(1, cssNumber(c.width, DEFAULT_WIDTH));
  const height = Math.max(1, cssNumber(c.height, DEFAULT_HEIGHT));
  const walls = [...floor.walls, ...floor.areas.flatMap((a) => rectAreaSideWalls(a.id, a.points, a.sideWalls ?? {}))];
  const frame: DisplayFrame = {
    ...rotatedCanvasSize(width, height, rot),
    projection: normalizeProjection(c.view ?? c.projection),
    wallHeight: normalizeWallHeight(c.wallHeight),
    padding: 2 + walls.reduce((max, w) => Math.max(max, wallThickness(w.thickness)), 8),
  };
  const dims = projectedCanvasSize(frame);
  const standing = frame.projection === "iso" && frame.wallHeight > 0;
  const rotate = planRotationTransform(width, height, rot);
  const map = (x: number, y: number) => rotatePlanPoint(x, y, width, height, rot);
  const catalog = symbolCatalog(c.symbols);
  const drawFurniture = (f: Floor["furniture"][number]) => renderFurniture(f, INK, catalog);
  const solids: IsoSolid[] = [];
  if (standing) {
    solids.push(...wallSolids(walls.filter((w) => !w.divider).map((w) => {
      const a = map(w.x1, w.y1), b = map(w.x2, w.y2);
      return { ...w, x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        thickness: wallThickness(w.thickness) * (isRailing(w) ? RAILING_WEIGHT : 1) };
    }), floor.openings.map((o) => ({ ...o, ...map(o.x, o.y), angle: o.angle + rot })), frame.wallHeight, false));
    for (const o of floor.openings) solids.push(...openingSolids(o, openingStyle(o), map, frame.wallHeight));
    const h = frame.wallHeight * FURNITURE_HEIGHT_FRACTION;
    const lift = elevationShift(h, rot);
    for (const f of floor.furniture) solids.push(furnitureSolid(f, map, h, PAPER,
      svg`<g transform=${rotate || nothing}><g transform="translate(${lift.x} ${lift.y})">${drawFurniture(f)}</g></g>`));
  }
  const solidEdges = solidEdgeRenderer(solids, INK);
  const view = frame.projection === "iso" ? "3d" : "2d";
  const title = `${c.title ? `${c.title} — ` : ""}${floor.name} (${view.toUpperCase()})`;
  const margin = 20;
  const holder = document.createElement("div");
  render(svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-margin} ${-margin} ${dims.w + margin * 2} ${dims.h + margin * 2}"
      width=${Math.ceil(dims.w + margin * 2)} height=${Math.ceil(dims.h + margin * 2)} role="img" aria-labelledby="title description">
    <title id="title">${title}</title>
    <desc id="description">Floorplan line art. Full floor, with static opening positions. Canvas units; not a measured survey.</desc>
    <rect x=${-margin} y=${-margin} width=${dims.w + margin * 2} height=${dims.h + margin * 2} fill=${PAPER} />
    <g stroke-linejoin="round" stroke-linecap="round">
      <g transform=${planProjectionTransform(frame) || nothing}>
        <g transform=${rotate || nothing}>
          ${floor.areas.map((a) => svg`<polygon points=${a.points.map((p) => `${p.x},${p.y}`).join(" ")}
            fill=${PAPER} stroke=${INK} stroke-width="0.6" />`)}
          ${renderWallMask(floor.openings, width, height, "wall-gaps")}
          <g mask="url(#wall-gaps)">${walls.filter((w) => !standing || w.divider).map((w) => svg`
            <line x1=${w.x1} y1=${w.y1} x2=${w.x2} y2=${w.y2} stroke=${INK}
              stroke-width=${w.divider ? 1 : wallThickness(w.thickness) * (isRailing(w) ? RAILING_WEIGHT : 1)}
              stroke-dasharray=${w.divider ? "5 4" : nothing} />`)}</g>
          ${standing ? nothing : floor.openings.map((o) => renderOpening(o, openingStyle(o)))}
          ${standing ? nothing : floor.furniture.map(drawFurniture)}
        </g>
        ${standing ? renderIsoSolids(solids.filter((s) => s.kind !== "opening-hit"), (s, drawing) =>
          svg`<g>${drawing}${solidEdges(s)}</g>`) : nothing}
      </g>
      <g fill=${INK} font-family="sans-serif" text-anchor="middle" dominant-baseline="central">
        ${floor.areas.filter((a) => a.name && a.showName !== false).map((a) => {
          const at = areaLabelPoint(a.points), p = map(at.x, at.y);
          const label = projectPlanPoint(p.x, p.y, frame);
          return svg`<text x=${label.x} y=${label.y} font-size=${areaLabelSize(a.labelSize)}
            stroke=${PAPER} stroke-width="3" paint-order="stroke">${a.name}</text>`;
        })}
      </g>
    </g>
  </svg>`, holder);
  const drawing = holder.querySelector("svg")!;
  // Presentation attributes travel with the file: no HA stylesheet, theme,
  // custom element, entity hook or external asset is needed to open it.
  drawing.querySelectorAll(".fp-iso-shade").forEach((e) => e.remove());
  drawing.querySelectorAll(".fp-iso-face, .fp-iso-panel, .fp-iso-glass").forEach((e) => {
    e.setAttribute("fill", PAPER);
    if (!e.classList.contains("fp-iso-face")) {
      e.setAttribute("stroke", INK);
      e.setAttribute("stroke-width", "1");
    }
  });
  drawing.querySelectorAll(".fp-furniture [fill]").forEach((e) => {
    if (e.getAttribute("fill") !== "none" && e.getAttribute("stroke") !== "none") {
      e.setAttribute("fill", PAPER);
      e.removeAttribute("fill-opacity");
    }
  });
  for (const e of drawing.querySelectorAll<SVGElement>("*")) {
    for (const attr of [...e.attributes]) if (attr.name.startsWith("data-")) e.removeAttribute(attr.name);
    // The opening renderer animates through CSS. Freeze it as SVG transforms
    // for readers which support SVG attributes but not CSS transforms.
    if (e.style.transform) e.setAttribute("transform", e.style.transform.replace(/deg|px/g, "")
      .replace(/translateX\(([^)]+)\)/g, "translate($1 0)"));
    for (const prop of ["fill", "stroke", "stroke-dashoffset"]) {
      const value = e.style.getPropertyValue(prop);
      if (value) e.setAttribute(prop, value);
    }
    e.removeAttribute("style");
  }
  // Lit markers are runtime bookkeeping, not part of an exported document.
  const walker = document.createTreeWalker(drawing, NodeFilter.SHOW_COMMENT);
  const comments: Node[] = [];
  while (walker.nextNode()) comments.push(walker.currentNode);
  comments.forEach((n) => n.parentNode?.removeChild(n));
  const name = floor.name.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "floor";
  return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(drawing)}`,
    filename: `floorplan-${name}-${view}.svg` };
}

export function downloadLineArtSvg(c: FloorplanCardConfig, floor: Floor, rot: PlanRotation): void {
  const result = createLineArtSvg(c, floor, rot);
  const url = URL.createObjectURL(new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    // Give the browser time to consume the download before releasing its URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
