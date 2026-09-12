import { describe, it, expect } from "vitest";
import {
  openingClearFraction,
  openingHasTwoLeaves,
  renderOpening,
  renderSunlight,
  SUN_REACH,
  SUN_ACROSS,
} from "./render";
import type { OpeningStyle } from "./render";
import type { Opening, Wall } from "./types";
import { nothing } from "lit";

/**
 * Serialize a Lit SVGTemplateResult (and its nested templates/arrays) back into
 * markup so we can assert on the structural invariants of renderOpening — the
 * scale wrapper, swing angle, slider panels and partial-open transforms — which
 * are otherwise only exercised in a browser.
 */
function serialize(node: unknown): string {
  if (node == null || node === false) return "";
  if (Array.isArray(node)) return node.map(serialize).join("");
  if (typeof node === "object" && "strings" in (node as Record<string, unknown>)) {
    const { strings, values } = node as { strings: string[]; values: unknown[] };
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += serialize(values[i]) + strings[i + 1];
    return out;
  }
  return String(node);
}

const base = { id: "x", x: 100, y: 60, length: 90, angle: 0 } as const;
const svgOf = (o: Partial<Opening>, style: Partial<OpeningStyle> = {}) =>
  serialize(renderOpening({ ...base, ...o } as Opening, { color: "#000", ...style }));

describe("renderSunlight — the markup, not just the geometry", () => {
  // The geometry is covered in render.test.ts. This is here because none of
  // that caught a `<rect …` opened in one lit template and closed in the next:
  // templates are parsed one at a time, so the tag never closed, both masks
  // lost their white ground, and the whole layer rendered invisible while
  // every pure function still returned exactly the right numbers.
  const wall = { id: "w", x1: 0, y1: 100, x2: 400, y2: 100 };
  const win = {
    id: "o",
    type: "window",
    x: 200,
    y: 100,
    length: 60,
    angle: 0,
  } as Opening;
  const sun = { x: 0, y: 1 };
  const walls = [wall];
  const light = (openings: Opening[] = [win], walls = [wall]) =>
    serialize(renderSunlight(walls, openings, 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined }));

  it("gives both masks a ground to subtract from, in one piece", () => {
    const s = light();
    expect(s.match(/<mask /g)?.length).toBe(2);
    // Three rects — a ground in each mask, and the shade itself — and every
    // one of them closes. That count is the whole point: a `<rect` with no `>`
    // is exactly the bug this describe exists for, and it leaves the masks
    // black, which hides what they were meant to shape.
    expect(s.match(/<rect[^>]*>/g)?.length).toBe(3);
    // The white grounds specifically — the shade mask also paints its wall
    // shadows white, which is a different thing wearing the same colour.
    expect(s.match(/<rect[^>]*fill=#fff[^>]*>/g)?.length).toBe(2);
  });

  it("draws a patch per opening that admits light, and a shadow per wall piece", () => {
    const s = light();
    // The window splits its wall in two, so two shadow pieces, in both masks
    // (4). The beam is a hole in the shade mask and the warm patch itself (2).
    expect(s.match(/<polygon/g)?.length).toBe(6);
    expect(s.match(/fp-sunbeam/g)?.length).toBe(1);
    // Two windows in the same wall: a patch each.
    const two = light([win, { ...win, id: "o2", x: 320 } as Opening]);
    expect(two.match(/fp-sunbeam/g)?.length).toBe(2);
  });

  it("every id a beam references is actually defined, shade or no shade", () => {
    // The bug this exists for: the edge masks were emitted INSIDE the shade
    // mask, so turning the shade off deleted them while the beams went on
    // pointing at them. An undefined mask is not an error in SVG — it simply
    // does not apply — so the patches came back at full strength with knife
    // edges and nothing looked broken enough to suspect. It shipped, and it
    // was the one configuration the reporter was running.
    //
    // So this checks the graph rather than any one feature: whatever a beam
    // points at has to exist, in both configurations.
    for (const shade of [undefined, null]) {
      const s = serialize(
        renderSunlight([wall], [win], 400, 400, "sun", {
          dir: sun, openAmount: () => 0, shutterOpen: () => undefined, shade,
        })
      );
      const referenced = [...s.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]!);
      expect(referenced.length).toBeGreaterThan(0);
      const defined = new Set(
        [...s.matchAll(/<(?:mask|linearGradient|radialGradient|clipPath) id=([^\s>]+)/g)].map((m) => m[1]!)
      );
      const dangling = referenced.filter((id) => !defined.has(id));
      expect(dangling).toEqual([]);
    }
  });

  it("fades over the distance the light really travels, not a share of the plan", () => {
    // A room shallower than the reach used to keep the patch at full strength
    // until a wall cut it — a hard bar across the floor.
    const near = { id: "near", x1: 0, y1: 160, x2: 400, y2: 160 };
    const far = { id: "far", x1: 0, y1: 340, x2: 400, y2: 340 };
    const alongWith = (blocker: Wall) =>
      falloff(
        serialize(
          renderSunlight([wall, blocker], [win], 400, 400, "sun", {
            dir: sun,
            openAmount: () => 0,
            shutterOpen: () => undefined,
          })
        )
      )!.along;
    expect(alongWith(near)).toBeCloseTo(60, 0);
    // A wall further off does not push it out: sunReach stays the ceiling.
    expect(alongWith(far)).toBeCloseTo(SUN_REACH * 400, 0);
  });

  it("runs its outline past the falloff, so the ellipse is what bounds it", () => {
    for (const dir of [sun, { x: 0.72, y: 0.69 }]) {
      const markup = serialize(
        renderSunlight([wall], [win], 400, 400, "sun", {
          dir,
          openAmount: () => 0,
          shutterOpen: () => undefined,
        })
      );
      const f = falloff(markup)!;
      const pts = markup.match(/class="fp-sunbeam" points=([-\d., ]+)/)![1]!.trim().split(" ")
        .map((q) => q.split(",").map(Number));
      // Distance from the opening to each FAR corner, measured in the
      // ellipse's own units: at or beyond 1 means the light is already gone.
      const rad = (-f.angle * Math.PI) / 180;
      for (const i of [2, 3]) {
        const dx = pts[i]![0]! - f.cx;
        const dy = pts[i]![1]! - f.cy;
        const u = (dx * Math.cos(rad) - dy * Math.sin(rad)) / f.along;
        const v = (dx * Math.sin(rad) + dy * Math.cos(rad)) / f.across;
        expect(Math.hypot(u, v)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("does not cut the beam's flanks while the light is still on them (#206)", () => {
    // The far corners were already checked above; these are the near two — the
    // gap's own ends, where the outline is at its narrowest. The falloff is
    // scaled by *semi*-axes, and it was being handed the beam's whole width
    // instead of half of it, so the ellipse ran nearly twice as wide as the
    // polygon that carried it. The straight edge then sliced through light at
    // roughly half strength, all the way up both sides: the hard diagonal
    // boundary reported in #206.
    for (const dir of [sun, { x: 0.72, y: 0.69 }, { x: -0.5, y: 0.87 }]) {
      const markup = serialize(
        renderSunlight([wall], [win], 400, 400, "sun", {
          dir,
          openAmount: () => 0,
          shutterOpen: () => undefined,
        })
      );
      const f = falloff(markup)!;
      const pts = markup.match(/class="fp-sunbeam" points=([-\d., ]+)/)![1]!.trim().split(" ")
        .map((q) => q.split(",").map(Number));
      const rad = (-f.angle * Math.PI) / 180;
      // Every corner, not just the far pair: the polygon may only ever clip
      // the ellipse where the ellipse has already reached zero.
      for (const i of [0, 1, 2, 3]) {
        const dx = pts[i]![0]! - f.cx;
        const dy = pts[i]![1]! - f.cy;
        const u = (dx * Math.cos(rad) - dy * Math.sin(rad)) / f.along;
        const v = (dx * Math.sin(rad) + dy * Math.cos(rad)) / f.across;
        expect(Math.hypot(u, v)).toBeGreaterThanOrEqual(1);
      }
    }
  });

  it("fits the falloff to half the beam, since a gradient is scaled by semi-axes", () => {
    // The arithmetic behind the test above, stated once so the next person
    // changing SUN_ACROSS can see what it is a fraction *of*.
    const markup = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 0,
        shutterOpen: () => undefined,
      })
    );
    const f = falloff(markup)!;
    // The window is 60 wide, square-on to a straight-down sun, so the beam is
    // 60 across and the ellipse may reach at most 30 to either side of it.
    expect(f.across).toBeCloseTo(30 * SUN_ACROSS, 6);
    expect(f.across).toBeLessThanOrEqual(30);
  });

  it("a door ajar throws a narrower patch than one standing open", () => {
    // The end of the boolean, seen in the markup: the width of the polygon is
    // the width of the gap that is actually clear, and the wall keeps the
    // rest — so the two never overlap and the light cannot leak past the leaf.
    const door = { ...win, type: "door" } as Opening;
    const at = (amount: number) =>
      serialize(
        renderSunlight([wall], [door], 400, 400, "sun", {
          dir: sun,
          openAmount: () => amount,
          shutterOpen: () => undefined,
        })
      );
    const spanOf = (markup: string) => {
      const pts = markup.match(/class="fp-sunbeam" points=([^ ]+ [^ ]+)/)![1];
      const xs = pts.split(" ").map((p) => Number(p.split(",")[0]));
      return Math.abs(xs[1]! - xs[0]!);
    };
    const open = spanOf(at(1));
    const ajar = spanOf(at(0.25));
    expect(open).toBeCloseTo(60); // the whole gap
    expect(ajar).toBeCloseTo(15); // a quarter of it
    expect(ajar).toBeLessThan(open);
  });

  it("stays away entirely when nothing lets light in", () => {
    // A shut door is opaque: no patches, so no layer at all rather than a
    // full-canvas shade sitting over the plan for nothing.
    const shut = { ...win, type: "door" } as Opening;
    expect(renderSunlight([wall], [shut], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    expect(renderSunlight([wall], [], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    // …but the same door, open, does let it in.
    expect(renderSunlight([wall], [shut], 400, 400, "sun", { dir: sun, openAmount: () => 1, shutterOpen: () => undefined })).not.toBe(nothing);
  });

  it("an opening standing in a wall's shadow lets nothing in", () => {
    // Every opening used to be a source in its own right, so an interior door
    // on the dark side of the house lit the room beyond it out of nothing.
    // Here a second wall sits upstream of the window, across the light.
    const upstream = { id: "up", x1: 0, y1: 40, x2: 400, y2: 40 };
    expect(renderSunlight([wall, upstream], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined })).toBe(nothing);
    // Move that wall out of the way (downstream of the window) and the same
    // window lights the room again.
    const downstream = { ...upstream, y1: 300, y2: 300 };
    const s = serialize(renderSunlight([wall, downstream], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined }));
    expect(s).toContain("fp-sunbeam");
  });

  it("a window on the shaded façade does not throw sunlight out of the house (#177)", () => {
    // Two windows facing each other across a room, which is as ordinary as a
    // plan gets. The far one used to line up with the near one's gap, escape
    // every shadow, and emit a patch of its own — sweeping *away* from the
    // building, so the reporter watched sunlight pour out of their apartment.
    const north = { id: "n", x1: 0, y1: 0, x2: 400, y2: 0 };
    const south = { id: "s", x1: 0, y1: 300, x2: 400, y2: 300 };
    const facing = [
      { ...win, id: "north", y: 0 },
      { ...win, id: "south", y: 300 },
    ] as Opening[];
    const s = light(facing, [north, south]);
    const beams = s.match(/class="fp-sunbeam"/g) ?? [];
    expect(beams.length).toBe(1); // exactly one lit opening
    // …and it is the one on the sunlit side: the patch starts at y=0.
    expect(s).toContain('points=170,0 230,0');
    expect(s).not.toContain("230,300");
  });

  it("an interior door does not re-emit the light that reaches it (#178)", () => {
    // A 20-wide window upstream of a 120-wide doorway. The doorway used to
    // become a source in its own right and flood the room behind it six times
    // wider than the light that arrived — "sunlight spawns at open doors".
    const mid = { id: "m", x1: 0, y1: 250, x2: 400, y2: 250 };
    const plan = [
      { ...win, id: "w", length: 20 },
      { ...win, id: "d", type: "door", y: 250, length: 120 },
    ] as Opening[];
    const s = serialize(
      renderSunlight([wall, mid], plan, 400, 400, "sun", {
        dir: sun,
        openAmount: () => 1,
        shutterOpen: () => undefined,
      })
    );
    expect(s.match(/class="fp-sunbeam"/g)?.length).toBe(1); // exactly one lit opening
    // The one beam is the window's, 20 across — not the door's 120.
    expect(s).toContain("points=190,100 210,100");
    // The light still gets *through* the doorway: the interior wall is cut
    // there, so its two shadow pieces stop either side of the beam and none
    // of them covers it. That is what makes re-emitting unnecessary.
    const shadows = [...s.matchAll(/<polygon points=([\d.,\- ]+) fill=#fff/g)].map((m) => m[1]!);
    const spans = shadows.map((p) => p.split(" ").map((q) => Number(q.split(",")[0]!)));
    expect(spans.some((xs) => xs[0]! <= 190 && xs[1]! >= 210)).toBe(false);
  });

  it("a beam carries on through a shut glazed door (#262)", () => {
    // The patio door the reporter had between a balcony and the room behind
    // it. Glass, so the wall's shade already has its gap cut and nothing
    // stands in the light — but the beam's own length was measured against
    // the *uncut* wall, so it faded to nothing at the door and the room
    // beyond stayed as dark as if the door were brick. The gap the shade
    // leaves is only worth having if there is still light arriving at it.
    const mid = { id: "m", x1: 0, y1: 180, x2: 400, y2: 180 };
    const far = { id: "f", x1: 0, y1: 220, x2: 400, y2: 220 };
    const patio = { ...win, id: "d", type: "door", glazed: true, y: 180, length: 200 } as Opening;
    const s = serialize(
      renderSunlight([wall, mid, far], [win, patio], 400, 400, "sun", {
        dir: sun,
        // Shut, which is the whole point: glass admits its gap whatever the
        // sash is doing, and the door in the report was a shut one.
        openAmount: () => 0,
        shutterOpen: () => undefined,
      })
    );
    // Still one source — the glazed door is not a second sun (#177 / #178).
    expect(s.match(/class="fp-sunbeam"/g)?.length).toBe(1);
    // The falloff is scaled by how far the light travels, and that is now the
    // wall past the door, 120 away, rather than the door's own wall at 80.
    expect(s).toContain("scale(120 ");
    expect(s).not.toContain("scale(80 ");
  });

  it("an opening switched out of the sunlight is wall to it (#177)", () => {
    // The solid front door the plan draws open because nothing is bound to it.
    const shut = { ...win, type: "door", sunlight: false } as Opening;
    expect(
      renderSunlight([wall], [shut], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 1,
        shutterOpen: () => undefined,
      })
    ).toBe(nothing);
    // Its wall keeps its full shadow too — it stops a beam like any wall does.
    const other = { ...win, id: "o2", x: 60 } as Opening;
    const s = serialize(
      renderSunlight([wall], [shut, other], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 1,
        shutterOpen: () => undefined,
      })
    );
    expect(s.match(/class="fp-sunbeam"/g)?.length).toBe(1); // exactly one lit opening
    expect(s).toContain("points=30,100 90,100");
  });

  it("fades every patch out with an ellipse fitted to it (issue #185)", () => {
    const s = light();
    // An ELLIPSE, not a circle. A circle centred on the opening is nearly a
    // straight edge by the time it has travelled far enough to matter — on
    // the plan that reopened #185 it bowed 13px across a 129-wide window —
    // so the tip read as a hard stop however the stops were tuned. Squashed
    // to the beam's own proportions it curves on the scale of the WIDTH.
    const f = falloff(s)!;
    expect(f).toBeDefined();
    expect(f.cx).toBe(win.x);
    expect(f.cy).toBe(win.y);
    expect(f.across).toBeLessThan(f.along); // squashed across the light
    // Tip curvature is across^2/along; it has to be small next to the beam's
    // own width or the end is flat again.
    expect((f.across * f.across) / f.along).toBeLessThan(win.length);
    expect(s).toContain('stop-opacity="0"');
    expect(s).toMatch(/class="fp-sunbeam"[^>]*fill=url\(#/);
  });

  it("lets the shade return as the patch dies, so no hard edge is left", () => {
    // The shade mask punches the beams out as holes. Flat holes against a
    // fading beam would leave the plan un-shaded in a hard-edged stripe well
    // past the point the light itself had gone — the bug swapped for a
    // subtler one. The hole has to fade on exactly the same ramp.
    const s = light();
    const mask = s.slice(s.indexOf("<mask id=sun-shade"), s.indexOf("</mask>"));
    expect(mask).toContain("fill=url(#");
    expect(mask).not.toMatch(/<polygon points=[^>]*fill="#000"/);
  });

  it("pins each beam's gradient id to its opening, not to its rank (issue #119)", () => {
    // The trap renderSunDimMask documents, in this feature's own terms: filter
    // the openings down to the lit ones and every later beam renumbers when a
    // door moves, rewriting the id on a <linearGradient> that a polygon is
    // already pointing at through a cached paint server. The beams after the
    // door would go back to painting flat and full-length — this very bug,
    // reappearing, and only sometimes.
    const many = [
      { ...win, id: "door", x: 80, type: "door" } as Opening,
      { ...win, id: "a", x: 200 } as Opening,
      { ...win, id: "b", x: 320 } as Opening,
    ];
    const idsByOpening = (doorOpen: number) => {
      const s = serialize(
        renderSunlight([wall], many, 400, 400, "sun", {
          dir: sun,
          openAmount: (o) => (o.id === "door" ? doorOpen : 0),
          shutterOpen: () => undefined,
        })
      );
      const out: Record<string, string> = {};
      for (const m of s.matchAll(
        /<radialGradient id=(sun-b\d+)[^>]*gradientTransform=translate\((\d+)/g
      ))
        out[m[2]!] = m[1]!;
      return out;
    };
    const shut = idsByOpening(0);
    const open = idsByOpening(1);
    // The two windows keep the same gradient ids whatever the door is doing.
    expect(shut["200"]).toBe(open["200"]);
    expect(shut["320"]).toBe(open["320"]);
    // …and the door, once it is lit, brings its own rather than taking one.
    expect(open["80"]).toBeDefined();
    expect(new Set(Object.values(open)).size).toBe(3);
  });

  it("never puts a NaN in a coordinate, whatever reach it is handed", () => {
    // sunReach is hand-editable YAML. "wide" made every far corner NaN, in
    // the polygon and in the gradient both; a negative one swept the beam
    // backwards, so the light left through the wall it came in by.
    for (const bad of [NaN, Infinity, -Infinity, "wide" as unknown as number, -3, 40, null]) {
      const s = serialize(
        renderSunlight([wall], [win], 400, 400, "sun", {
          dir: sun,
          openAmount: () => 1,
          shutterOpen: () => undefined,
          reach: bad as number,
        })
      );
      expect(s).not.toContain("NaN");
      expect(s).not.toContain("Infinity");
      // Light travels the way it was sent: sun is {x:0,y:1}, so the far edge
      // is below the wall at y=100, never back above it.
      const pts = s.match(/class="fp-sunbeam" points=([-\d., ]+)/)![1]!;
      const ys = pts.trim().split(" ").map((q) => Number(q.split(",")[1]));
      expect(Math.max(...ys)).toBeGreaterThan(100);
    }
  });

  it("paints with the colours it is given", () => {
    const s = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "#ff0000", shade: "#0000ff" })
    );
    // The light now carries its colour on the gradient that fades it out
    // along the beam (issue #185); the shade is still a flat fill.
    expect(s).toContain("stop-color=#ff0000");
    expect(s).toContain("fill:#0000ff");
    // …and refuses one that isn't a colour (#64), falling back rather than
    // letting it into a style attribute or a stop.
    const nasty = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "red;position:fixed", shade: "#000" })
    );
    expect(nasty).not.toContain("position:fixed");
    // The fallback is the skin default, not the rejected string.
    expect(nasty).toContain("--fp-skin-sunlight");
  });

  it("can draw the light without darkening anything else", () => {
    const s = serialize(
      renderSunlight([wall], [win], 400, 400, "sun", { dir: sun, openAmount: () => 0, shutterOpen: () => undefined, light: "#ff0", shade: null })
    );
    // The patches stay; the shade rect and the mask it needed are simply not
    // built, rather than emitted at zero opacity.
    expect(s).toContain("fp-sunbeam");
    expect(s.match(/<mask /g)?.length).toBe(1);
    expect(s.match(/<rect /g)?.length).toBe(1); // the surviving mask's ground
  });

  it("draws nothing once the sun is below the horizon", () => {
    const night = renderSunlight(walls, [win], 400, 400, "sun", {
      dir: sun,
      openAmount: () => 0,
      shutterOpen: () => undefined,
      strength: 0,
    });
    // Nothing at all, rather than a layer at zero opacity that still costs
    // every polygon on every render.
    expect(night).toBe(nothing);
    // A low sun still lights the room, only more faintly.
    const dusk = serialize(
      renderSunlight(walls, [win], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 0,
        shutterOpen: () => undefined,
        strength: 0.25,
      })
    );
    expect(dusk).toContain("fp-sunbeam");
    const noon = serialize(
      renderSunlight(walls, [win], 400, 400, "sun", {
        dir: sun,
        openAmount: () => 0,
        shutterOpen: () => undefined,
      })
    );
    // The strength lives on the beam group's own opacity; the penumbra bands
    // carry fill-opacity, which this must not match instead.
    const op = (s: string) => Number(s.match(/<g mask=[^>]*? opacity=([0-9.]+)/)![1]);
    expect(op(dusk)).toBeLessThan(op(noon));
  });

  it("takes no pointer events — the plan underneath stays pressable", () => {
    // It spans the whole canvas; the lesson from #108.
    expect(light()).toContain("fp-sunlight");
  });
});


/** The falloff ellipse a beam is painted with: where it sits and how big. */
function falloff(markup: string, id = "sun-b0") {
  const m = markup.match(
    new RegExp(`<radialGradient id=${id}[^>]*gradientTransform=translate\\(([-\\d.]+) ([-\\d.]+)\\) rotate\\(([-\\d.]+)\\) scale\\(([\\d.]+) ([\\d.]+)\\)`)
  );
  if (!m) return undefined;
  return { cx: +m[1]!, cy: +m[2]!, angle: +m[3]!, along: +m[4]!, across: +m[5]! };
}

describe("renderOpening — orientation mirror", () => {
  it("wraps the body in an identity scale by default (unchanged output)", () => {
    expect(svgOf({ type: "door" })).toContain("scale(1 1)");
  });
  it("mirrors via flipH / flipV", () => {
    expect(svgOf({ type: "door", flipH: true })).toContain("scale(-1 1)");
    expect(svgOf({ type: "door", flipV: true })).toContain("scale(1 -1)");
    expect(svgOf({ type: "door", flipH: true, flipV: true })).toContain("scale(-1 -1)");
  });
});

describe("renderOpening — swing door", () => {
  it("swings the leaf fully open / closed with the binary open flag", () => {
    expect(svgOf({ type: "door" }, { open: true })).toContain("rotate(-90deg)");
    expect(svgOf({ type: "door" }, { open: false })).toContain("rotate(0deg)");
  });
  it("swings partway for a fractional amount and clamps out-of-range", () => {
    expect(svgOf({ type: "door" }, { amount: 0.5 })).toContain("rotate(-45deg)");
    expect(svgOf({ type: "door" }, { amount: 2 })).toContain("rotate(-90deg)"); // clamp high
    expect(svgOf({ type: "door" }, { amount: -1 })).toContain("rotate(0deg)"); // clamp low
  });
});

describe("renderOpening — double door", () => {
  const dbl = { type: "door", sash: "double" } as Partial<Opening>;

  it("splits the opening into two leaves hinged at opposite jambs", () => {
    const s = svgOf(dbl, { open: false });
    // length 90 → two 45-wide leaves, one per jamb, meeting in the middle.
    expect(s.match(/width=45/g)?.length).toBe(2);
    expect(s).toContain("fp-door-leaf");
    expect(s).toContain("fp-leaf-r");
    expect(s).not.toContain("width=90"); // no full-width leaf left
  });

  it("swings them apart, each its own way", () => {
    const open = svgOf(dbl, { open: true });
    expect(open).toContain("rotate(-90deg)");
    expect(open).toContain("rotate(90deg)");
    const half = svgOf(dbl, { amount: 0.5 });
    expect(half).toContain("rotate(-45deg)");
    expect(half).toContain("rotate(45deg)");
  });

  it("gives each leaf its own arc, sized to that leaf", () => {
    const s = svgOf(dbl, { open: true });
    expect(s.match(/fp-door-arc/g)?.length).toBe(2);
    // Radius = half the opening, the distance that leaf's tip actually sweeps.
    expect(s).toContain("A 45 45");
    expect(s).not.toContain("A 90 90");
  });

  it("stays a door: no jambs, unlike the casement window it mirrors", () => {
    const door = svgOf(dbl, { open: false });
    const window = svgOf({ type: "window" }, { open: false });
    expect(door).not.toContain('stroke-width="2"'); // jamb lines
    expect(window).toContain('stroke-width="2"');
    // Both draw two leaves and two arcs — the jambs are the whole difference.
    expect(door.match(/fp-door-arc/g)?.length).toBe(window.match(/fp-door-arc/g)?.length);
  });

  it("a plain door is untouched — one leaf across the whole opening", () => {
    const single = svgOf({ type: "door" }, { open: true });
    expect(single).toContain("width=90");
    expect(single).not.toContain("fp-leaf-r");
    expect(single.match(/fp-door-arc/g)?.length).toBe(1);
    expect(single).toContain("A 90 90"); // arc radius = the full opening
  });

  it("only swings: a sliding or rolling door ignores the leaf count", () => {
    const slide = svgOf({ type: "door", motion: "slide", sash: "double" } as Partial<Opening>);
    expect(slide).toContain("fp-slide-panel");
    expect(slide).not.toContain("fp-door-arc");
    const roll = svgOf({ type: "door", motion: "roll", sash: "double" } as Partial<Opening>);
    expect(roll).toContain("fp-roll-curtain");
    expect(roll).not.toContain("fp-door-arc");
  });

  it("mirrors as one piece, so flipV opens both leaves into the other room", () => {
    expect(svgOf({ ...dbl, flipV: true })).toContain("scale(1 -1)");
  });
});

const sliding = (extra: Partial<Opening> = {}) =>
  ({ type: "door", motion: "slide", ...extra }) as Partial<Opening>;

describe("renderOpening — sliding door", () => {
  it("draws a single panel that slides the full length when open", () => {
    const closed = svgOf(sliding(), { open: false });
    const open = svgOf(sliding(), { open: true });
    expect(closed).toContain("fp-slide-panel");
    expect(closed).toContain("translateX(0px)");
    expect(open).toContain("translateX(90px)"); // length 90
  });
  it("slides partway for a fractional amount", () => {
    expect(svgOf(sliding(), { amount: 0.5 })).toContain("translateX(45px)");
  });
  it("draws two panels for a bypass slider that stack to one side", () => {
    const bypass = svgOf(sliding({ sliderStyle: "bypass" }), { open: true });
    // two half-width (45) panels + moving panel stacks by -half when open
    expect(bypass.match(/width=45/g)?.length).toBe(2);
    expect(bypass).toContain("translateX(-45px)");
  });
  it("parts two panels in opposite directions for a biparting slider", () => {
    const closed = svgOf(sliding({ sliderStyle: "biparting" }), { open: false });
    const open = svgOf(sliding({ sliderStyle: "biparting" }), { open: true });
    expect(closed.match(/width=45/g)?.length).toBe(2);
    expect(closed).toContain("translateX(0px)"); // meet in the middle when closed
    // one panel recesses left, the other right, by half (45) each when open
    expect(open).toContain("translateX(-45px)");
    expect(open).toContain("translateX(45px)");
  });
  it("draws solid door panels (thickness 2.5)", () => {
    expect(svgOf(sliding(), { open: false })).toContain("height=2.5");
  });
});

// Issue #145: a patio slider whose panels stack over fixed side panels rather
// than recessing into the walls, and one contact sensor per moving panel.
describe("renderOpening — biparting over fixed panels", () => {
  const bipartingBypass = (extra: Partial<Opening> = {}) =>
    sliding({ sliderStyle: "biparting-bypass", ...extra });

  it("splits the opening into four quarter panels", () => {
    const closed = svgOf(bipartingBypass(), { open: false });
    // length 90 → four 22.5 panels: two fixed at the jambs, two moving.
    expect(closed.match(/width=22\.5/g)?.length).toBe(4);
    expect(closed.match(/fp-slide-panel/g)?.length).toBe(2);
    expect(closed).toContain("translateX(0px)"); // meet in the middle when closed
  });
  it("travels a quarter of the opening, so the panels stay inside it", () => {
    const open = svgOf(bipartingBypass(), { open: true });
    // A quarter (22.5) each way — half of what `biparting` travels, because
    // these park over the fixed panels instead of disappearing into the wall.
    expect(open).toContain("translateX(-22.5px)");
    expect(open).toContain("translateX(22.5px)");
    expect(open).not.toContain("translateX(-45px)");
  });
  it("keeps both panels on parallel tracks, like a bypass slider", () => {
    const s = svgOf(bipartingBypass(), { open: false });
    expect(s).toContain("y1=1.75"); // two tracks drawn, as in bypass
    expect(s).toContain("y1=-1.75");
    expect(s).toContain("y=0.5"); // fixed panels ride the front track
    expect(s).toContain("y=-3"); // the moving ones the back track, clear of them
  });
  it("never accents the fixed panels, however open the slider is", () => {
    const open = svgOf(bipartingBypass(), { open: true, active: true, accent: "#f00" });
    // Two moving panels take the accent; the two fixed ones keep the base color.
    expect(open.match(/fill:#f00/g)?.length).toBe(2);
    expect(open.match(/fill=#000/g)?.length).toBe(2);
  });
});

// Issue #145: the two-operable-leaf slider. No fixed panels at all — both
// leaves move, toward each other, and stack over the middle.
describe("renderOpening — converging", () => {
  const converging = (extra: Partial<Opening> = {}) =>
    sliding({ sliderStyle: "converging", ...extra });

  it("draws two half-width moving panels and nothing fixed", () => {
    const closed = svgOf(converging(), { open: false });
    // length 90 → two 45 panels, both of them on a slide group. Contrast with
    // biparting-bypass, which splits the same opening into four quarters.
    expect(closed.match(/width=45/g)?.length).toBe(2);
    expect(closed.match(/fp-slide-panel/g)?.length).toBe(2);
    expect(closed).not.toContain("width=22.5");
    expect(closed).toContain("translateX(0px)"); // meet in the middle when shut
  });

  it("runs the panels toward each other, not apart", () => {
    const open = svgOf(converging(), { open: true });
    // First panel (at the −x jamb) travels +, second −: the opposite of every
    // biparting style, and the whole point of this one.
    expect(open).toContain("translateX(22.5px)");
    expect(open).toContain("translateX(-22.5px)");
  });

  it("stacks over the middle half, clearing a quarter at each jamb", () => {
    const open = svgOf(converging(), { open: true });
    // Panel one spans −45..0 and shifts +22.5 → −22.5..22.5; panel two spans
    // 0..45 and shifts −22.5 → the same. Both land on the middle half, so the
    // outer quarters (−45..−22.5 and 22.5..45) are what actually clears.
    expect(open).toContain("x=-45");
    expect(open).toContain('x="0"');
    expect(open).toContain("width=45");
  });

  it("keeps the panels on parallel tracks so neither blocks the other", () => {
    const s = svgOf(converging(), { open: false });
    expect(s).toContain("y1=1.75"); // two tracks, as in bypass
    expect(s).toContain("y1=-1.75");
    expect(s).toContain("y=0.5"); // first panel on the front track
    expect(s).toContain("y=-3"); // second on the back track, clear of it
  });

  it("accents both panels when both are open — neither one is fixed", () => {
    const open = svgOf(converging(), { open: true, active: true, accent: "#f00" });
    expect(open.match(/fill:#f00/g)?.length).toBe(2);
    expect(open).not.toContain("fill=#000"); // no fixed panel to keep the base color
  });
});

describe("renderOpening — a two-panel slider's second panel (issue #145)", () => {
  // Travel per panel, and which way the *first* one goes. The biparting styles
  // part outward from the centre; `converging` runs the other way, so the same
  // per-panel rules have to hold with both signs.
  const TWO_PANEL = [
    { sliderStyle: "biparting", travel: 45, out: -1 },
    { sliderStyle: "biparting-bypass", travel: 22.5, out: -1 },
    { sliderStyle: "converging", travel: 22.5, out: 1 },
  ] as const;
  for (const { sliderStyle, travel, out } of TWO_PANEL) {
    // Signed travel: `first` is what panel one shows fully open, `second` its
    // opposite number — the panels always move against each other.
    const first = `translateX(${out * travel}px)`;
    const second = `translateX(${-out * travel}px)`;
    describe(sliderStyle, () => {
      it("moves both panels together when no second state is given", () => {
        const open = svgOf(sliding({ sliderStyle }), { amount: 1 });
        expect(open).toContain(first);
        expect(open).toContain(second);
      });
      it("opens one panel while the other stays shut", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 1, second: { amount: 0 } });
        expect(s).toContain(first); // first panel open
        expect(s).toContain("translateX(0px)"); // second still closed
        expect(s).not.toContain(second);
      });
      it("opens the second panel while the first stays shut", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0, second: { amount: 1 } });
        expect(s).toContain(second);
        expect(s).toContain("translateX(0px)");
        expect(s).not.toContain(first);
      });
      it("gives each panel its own travel for two position-aware covers", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0.5, second: { amount: 1 } });
        expect(s).toContain(`translateX(${(out * travel) / 2}px)`);
        expect(s).toContain(second);
      });
      it("clamps a second panel's out-of-range amount", () => {
        const s = svgOf(sliding({ sliderStyle }), { amount: 0, second: { amount: 4 } });
        expect(s).toContain(second);
      });
      it("accents only the panel whose own sensor reads open", () => {
        const s = svgOf(sliding({ sliderStyle }), {
          amount: 1,
          active: true,
          accent: "#f00",
          second: { amount: 0, active: false },
        });
        expect(s.match(/fill:#f00/g)?.length).toBe(1); // the open panel only
        expect(s).toContain("fill:#000"); // the shut one keeps the base color
      });
    });
  }
  it("is ignored by the styles that only move one panel", () => {
    for (const sliderStyle of ["single", "bypass"] as const) {
      const s = svgOf(sliding({ sliderStyle }), { amount: 1, second: { amount: 0 } });
      const withoutSecond = svgOf(sliding({ sliderStyle }), { amount: 1 });
      expect(s).toBe(withoutSecond);
    }
  });
});

describe("renderOpening — a hinged double's second leaf (issue #159)", () => {
  // Both shapes with two hinged leaves: a window's casement pair (the type's
  // own default) and the double door #168 added.
  const DOUBLES = [
    { what: "casement window", o: { type: "window" } as Partial<Opening> },
    { what: "double door", o: { type: "door", sash: "double" } as Partial<Opening> },
  ] as const;

  for (const { what, o } of DOUBLES) {
    describe(what, () => {
      it("swings both leaves together when no second state is given", () => {
        const open = svgOf(o, { amount: 1 });
        expect(open).toContain("rotate(-90deg)"); // left leaf
        expect(open).toContain("rotate(90deg)"); // right leaf
      });

      it("opens one leaf while the other stays shut", () => {
        const s = svgOf(o, { amount: 1, second: { amount: 0 } });
        expect(s).toContain("rotate(-90deg)"); // the left one swung
        expect(s).toContain("rotate(0deg)"); // the right one still shut
        expect(s).not.toContain("rotate(90deg)");
      });

      it("opens the second leaf while the first stays shut", () => {
        const s = svgOf(o, { amount: 0, second: { amount: 1 } });
        expect(s).toContain("rotate(90deg)");
        expect(s).toContain("rotate(0deg)");
        expect(s).not.toContain("rotate(-90deg)");
      });

      it("gives each leaf its own travel for two position-aware covers", () => {
        const s = svgOf(o, { amount: 0.5, second: { amount: 1 } });
        expect(s).toContain("rotate(-45deg)");
        expect(s).toContain("rotate(90deg)");
      });

      it("clamps a second leaf's out-of-range amount", () => {
        expect(svgOf(o, { amount: 0, second: { amount: 4 } })).toContain("rotate(90deg)");
        expect(svgOf(o, { amount: 0, second: { amount: -2 } })).not.toContain("rotate(90deg)");
      });

      it("draws each arc from its own leaf's state", () => {
        // arcLen = (pi/2) * 45; the shut leaf's arc is fully offset, the open
        // one's not at all — so a half-open pair shows two different offsets.
        const arcLen = (Math.PI / 2) * 45;
        const s = svgOf(o, { amount: 1, second: { amount: 0 } });
        expect(s).toContain(`stroke-dashoffset:0;`); // the open leaf's arc, drawn on
        expect(s).toContain(`stroke-dashoffset:${arcLen};`); // the shut one's, hidden
      });

      it("accents only the leaf whose own sensor reads open", () => {
        const s = svgOf(o, {
          amount: 1,
          active: true,
          accent: "#f00",
          second: { amount: 0, active: false },
        });
        // The open leaf and its arc take the accent; the shut leaf and arc
        // keep the base colour.
        expect(s.match(/#f00/g)?.length).toBe(2);
        expect(s).toContain("fill:#000");
      });
    });
  }

  it("is ignored where there is only one leaf", () => {
    for (const o of [
      { type: "door" } as Partial<Opening>, // a plain swing door
      { type: "window", sash: "single" } as Partial<Opening>, // a single sash (issue #73)
      { type: "door", motion: "roll" } as Partial<Opening>, // a roll-up curtain
    ]) {
      expect(svgOf(o, { amount: 1, second: { amount: 0 } })).toBe(svgOf(o, { amount: 1 }));
    }
  });
});

describe("renderOpening — sliding window", () => {
  it("slides like a slider but with thin glass panels (thickness 1.5)", () => {
    const win = svgOf({ type: "window", motion: "slide" }, { open: true });
    expect(win).toContain("fp-slide-panel");
    expect(win).toContain("translateX(90px)"); // same slide as a single-panel door
    expect(win).toContain("height=1.5"); // thinner glass panel
    expect(win).not.toContain("height=2.5"); // not a solid door panel
  });
});

describe("renderOpening — roll-up cover (issue #45)", () => {
  it("closed: full-thickness slatted curtain on the track", () => {
    const closed = svgOf({ type: "door", motion: "roll" }, { open: false });
    expect(closed).toContain("fp-roll-curtain");
    expect(closed).toContain("scaleY(1)");
    expect(closed).toContain("height=5"); // curtain band, thicker than any panel
  });

  it("open: the curtain collapses onto the track line", () => {
    expect(svgOf({ type: "door", motion: "roll" }, { open: true })).toContain("scaleY(0)");
  });

  it("partial position thins the curtain proportionally", () => {
    expect(svgOf({ type: "door", motion: "roll" }, { amount: 0.6 })).toContain("scaleY(0.4)");
  });

  it("draws slat ticks so it reads as a shutter, not a slab", () => {
    // length 90 → ~8 slats → 7 interior ticks.
    const closed = svgOf({ type: "door", motion: "roll" }, { open: false });
    expect(closed.match(/var\(--card-background-color, #fff\)/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("nothing travels along the wall — no slide panels, no swing arc", () => {
    const s = svgOf({ type: "door", motion: "roll" }, { amount: 0.5 });
    expect(s).not.toContain("fp-slide-panel");
    expect(s).not.toContain("fp-door-arc");
    expect(s).not.toContain("fp-door-leaf");
  });
});

describe("renderOpening — an open roll-up reads as open (issue #154)", () => {
  const roll = { type: "door", motion: "roll" } as Partial<Opening>;

  it("accents the track, the only mark a wide-open garage leaves behind", () => {
    // The curtain has scaled to nothing at amount 1, so a base-coloured track
    // is indistinguishable from a shut garage — the bug this fixes.
    const open = svgOf(roll, { open: true, active: true, accent: "#ff0000" });
    expect(open).toContain('stroke=#ff0000 stroke-width="0.75"');
    expect(open).toContain('opacity=1'); // full strength: a 0.6 accent reads as neither colour
  });

  it("still accents it half-open, where curtain and track are both on screen", () => {
    const half = svgOf(roll, { amount: 0.5, active: true, accent: "#ff0000" });
    expect(half).toContain('stroke=#ff0000 stroke-width="0.75"');
    expect(half).toContain("scaleY(0.5)");
  });

  it("leaves a shut garage exactly as it was — dimmed track in the base colour", () => {
    const shut = svgOf(roll, { open: false, accent: "#ff0000" });
    expect(shut).toContain('stroke=#000 stroke-width="0.75"');
    expect(shut).toContain('opacity=0.6');
    expect(shut).not.toContain("#ff0000");
  });

  it("keeps the jambs structural: they are wall, not cover, so they never accent", () => {
    const open = svgOf(roll, { open: true, active: true, accent: "#ff0000" });
    expect(open.match(/stroke=#000 stroke-width="2"/g)?.length).toBe(2);
  });
});

describe("renderOpening — single-sash window (issue #73)", () => {
  const single = { type: "window", sash: "single" } as Partial<Opening>;

  it("draws one full-width sash and one arc instead of two casement leaves", () => {
    const s = svgOf(single, { open: true });
    expect(s.match(/fp-door-leaf/g)?.length).toBe(1);
    expect(s).not.toContain("fp-leaf-r");
    expect(s.match(/fp-door-arc/g)?.length).toBe(1);
    expect(s).toContain("width=90"); // sash spans the full opening
  });

  it("double stays the historic two-leaf look (default unchanged)", () => {
    const d = svgOf({ type: "window" }, { open: true });
    expect(d).toContain("fp-door-leaf");
    expect(d).toContain("fp-leaf-r");
    expect(svgOf({ type: "window", sash: "double" } as Partial<Opening>, { open: true })).toContain(
      "fp-leaf-r",
    );
  });

  it("hinge follows flipH via the mirror wrapper", () => {
    expect(svgOf({ ...single, flipH: true })).toContain("scale(-1 1)");
  });
});

describe("renderOpening — external shutter layer (issue #74)", () => {
  it("layers the roll curtain over the window body", () => {
    const s = svgOf({ type: "window" }, { open: true, shutter: { amount: 0.25 } });
    expect(s).toContain("fp-roll-curtain");
    expect(s).toContain("scaleY(0.75)"); // 1 - amount
    expect(s).toContain("fp-leaf-r"); // the window itself still renders
  });

  it("no shutter style, no curtain (existing windows unchanged)", () => {
    expect(svgOf({ type: "window" }, { open: true })).not.toContain("fp-roll-curtain");
  });

  it("shutter accent is independent of the window's active state", () => {
    const s = svgOf({ type: "window" }, {
      open: false,
      active: false,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true },
    });
    expect(s).toContain("#ff0000"); // curtain wears the accent while the sash doesn't
  });
});

describe("renderOpening — hinged external shutter (issue #74)", () => {
  const win = { type: "window" } as Partial<Opening>;

  it("closed: two louvered panels lying across the opening, outside the wall", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0, style: "swing" } });
    // One panel hinged at each jamb, neither rotated while shut.
    expect(s).toContain("rotate(0deg)");
    expect(s).toContain("fp-door-leaf");
    expect(s).toContain("fp-leaf-r");
    // Panels sit beyond the wall band (positive y), clear of the casement sashes.
    expect(s).toMatch(/translate\(-45 [0-9.]+\)/);
    // Louver ticks are drawn in the background colour.
    expect(s).toContain("var(--card-background-color, #fff)");
  });

  it("open: both panels fold back to the wall, in opposite directions", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 1, style: "swing" } });
    expect(s).toContain("rotate(90deg)");
    expect(s).toContain("rotate(-90deg)");
  });

  it("partial: panels swing proportionally", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(s).toContain("rotate(45deg)");
    expect(s).toContain("rotate(-45deg)");
  });

  it("swing draws no roll curtain, and roll draws no hinged panels", () => {
    const swing = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(swing).not.toContain("fp-roll-curtain");
    const roll = svgOf(win, { open: false, shutter: { amount: 0.5, style: "roll" } });
    expect(roll).toContain("fp-roll-curtain");
  });

  it("the window underneath still renders its own sashes", () => {
    const s = svgOf(win, { open: true, shutter: { amount: 0, style: "swing" } });
    // Casement leaves swung open behind a shut shutter — both are true at once.
    expect(s).toContain("rotate(-90deg)");
    expect(s).toContain("rotate(0deg)");
  });
});

describe("renderOpening — which side the shutter hangs on (issue #74 follow-up)", () => {
  const win = { type: "window" } as Partial<Opening>;
  // cutH/2 + t/2 = (8 + 4)/2 + 3/2
  const OFFSET = 7.5;

  it("hangs the panels on the far side of the wall by default", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(s).toContain(`translate(-45 ${OFFSET})`);
    expect(s).toContain(`translate(45 ${OFFSET})`);
  });

  it("flip moves them to the sash's own side, offset and all", () => {
    const s = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing", flip: true } });
    expect(s).toContain(`translate(-45 ${-OFFSET})`);
    expect(s).toContain(`translate(45 ${-OFFSET})`);
    expect(s).not.toContain(`translate(-45 ${OFFSET})`);
  });

  it("flipped panels still fold away from the wall, not through it", () => {
    // Same two angles either way — what changes is which panel takes which,
    // so that both still swing outward from their own jamb.
    const far = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing" } });
    expect(far).toMatch(/translate\(-45 7\.5\)[\s\S]*?fp-door-leaf" style="transform:rotate\(45deg\)/);
    expect(far).toMatch(/translate\(45 7\.5\)[\s\S]*?fp-leaf-r" style="transform:rotate\(-45deg\)/);
    const near = svgOf(win, { open: false, shutter: { amount: 0.5, style: "swing", flip: true } });
    expect(near).toMatch(/translate\(-45 -7\.5\)[\s\S]*?fp-door-leaf" style="transform:rotate\(-45deg\)/);
    expect(near).toMatch(/translate\(45 -7\.5\)[\s\S]*?fp-leaf-r" style="transform:rotate\(45deg\)/);
  });

  it("shut is shut on either side — the panels still cover the opening", () => {
    const near = svgOf(win, { open: false, shutter: { amount: 0, style: "swing", flip: true } });
    expect(near).toContain("rotate(0deg)");
    expect(near).toContain(`translate(-45 ${-OFFSET})`);
  });

  it("the roll curtain ignores the side — it is symmetric about the wall line", () => {
    const plain = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll" } });
    const flipped = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll", flip: true } });
    expect(flipped).toBe(plain);
  });
});

describe("renderOpening — a hinged shutter's second panel (issue #159)", () => {
  // A window with a single sash, so the only leaves in the markup are the
  // shutter's own pair — the sash's own second-leaf plumbing is tested above,
  // and this keeps the two from being confused for each other.
  const win = { type: "window", sash: "single" } as Partial<Opening>;
  const shut = { amount: 0, style: "swing" } as const;

  it("folds both panels together when no second state is given", () => {
    const s = svgOf(win, { open: false, shutter: { ...shut, amount: 1 } });
    expect(s).toContain("rotate(90deg)");
    expect(s).toContain("rotate(-90deg)");
  });

  it("folds one panel back while the other stays across the glass", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, amount: 1, second: { amount: 0 } },
    });
    expect(s).toContain("rotate(90deg)"); // the folded panel
    expect(s).toContain("rotate(0deg)"); // the one still shut
    expect(s).not.toContain("rotate(-90deg)");
  });

  it("folds the second panel while the first stays shut", () => {
    const s = svgOf(win, { open: false, shutter: { ...shut, second: { amount: 1 } } });
    expect(s).toContain("rotate(-90deg)");
    expect(s).toContain("rotate(0deg)");
    expect(s).not.toContain("rotate(90deg)");
  });

  it("gives each panel its own travel, and clamps a junk reading", () => {
    expect(
      svgOf(win, { open: false, shutter: { ...shut, amount: 0.5, second: { amount: 1 } } })
    ).toContain("rotate(45deg)");
    expect(svgOf(win, { open: false, shutter: { ...shut, second: { amount: 9 } } })).toContain(
      "rotate(-90deg)"
    );
  });

  it("still swings away from the wall on the near side", () => {
    // flip mirrors both panels, so the second one's angle flips with it.
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, flip: true, second: { amount: 1 } },
    });
    expect(s).toMatch(/fp-leaf-r" style="transform:rotate\(90deg\)/);
  });

  it("accents only the panel whose own contact reads open", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { ...shut, amount: 1, active: true, accent: "#0f0", second: { amount: 0 } },
    });
    expect(s.match(/fill:#0f0/g)?.length).toBe(1); // the folded panel only
    expect(s).toContain("fill:#000"); // the shut one keeps the base colour
  });

  it("the roll curtain ignores it — a slat band is one piece", () => {
    const plain = svgOf(win, { open: false, shutter: { amount: 0.4, style: "roll" } });
    const withSecond = svgOf(win, {
      open: false,
      shutter: { amount: 0.4, style: "roll", second: { amount: 1 } },
    });
    expect(withSecond).toBe(plain);
  });
});

describe("renderOpening — the symbol stays a symbol (issue #74 follow-up)", () => {
  const bound = { entity: "binary_sensor.win", shutterEntity: "cover.tapparella" };

  it("draws no badge of its own for the second entity", () => {
    // The shutter badge is HTML in the overlay, not SVG: it carries a real
    // ha-icon and is sized in screen pixels. See shutterMarkPoint / the card.
    const s = svgOf({ type: "window", ...bound }, { shutter: { amount: 0.5 } });
    expect(s).not.toContain("<circle");
    expect(s).not.toContain("<title>");
    // …and binding the second entity adds nothing to the symbol: the shutter
    // is drawn from `style.shutter`, which the host resolves either way.
    expect(s).toBe(
      svgOf({ type: "window", entity: "binary_sensor.win" }, { shutter: { amount: 0.5 } })
    );
  });
});

describe("renderOpening — the shutter's own accent (issue #74 follow-up)", () => {
  const win = { type: "window" } as Partial<Opening>;

  it("an open shutter wears its own accent, not the opening's", () => {
    const s = svgOf(win, {
      open: true,
      active: true,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true, accent: "#00ff00" },
    });
    expect(s).toContain("#00ff00"); // the curtain
    expect(s).toContain("#ff0000"); // the sash it covers, unchanged
  });

  it("falls back to the opening's accent when it has none of its own", () => {
    const s = svgOf(win, {
      open: false,
      accent: "#ff0000",
      shutter: { amount: 0.5, active: true },
    });
    expect(s).toContain("#ff0000");
    expect(s).not.toContain("#00ff00");
  });

  it("an accent it isn't wearing yet paints nothing — a shut shutter is base colour", () => {
    const s = svgOf(win, {
      open: false,
      shutter: { amount: 0, active: false, accent: "#00ff00", style: "swing" },
    });
    expect(s).not.toContain("#00ff00");
    expect(s).toContain("#000"); // the base colour passed as `color`
  });

  it("applies to the hinged panels as well as the roll curtain", () => {
    const swing = svgOf(win, {
      open: false,
      shutter: { amount: 0.5, active: true, accent: "#00ff00", style: "swing" },
    });
    expect(swing).toContain("fill:#00ff00");
  });
});

describe("renderOpening — a window that does not open (issue #218)", () => {
  const fixed = { type: "window", motion: "fixed" } as Partial<Opening>;

  it("draws jambs and glass, and nothing that could move", () => {
    const s = svgOf(fixed, { open: true, amount: 1 });
    expect(s).not.toContain("fp-door-leaf");
    expect(s).not.toContain("fp-leaf-r");
    expect(s).not.toContain("fp-door-arc");
    // Jambs still say "window", and the pane still fills the gap.
    expect(s).toContain('stroke-width="2"');
    expect(s).toContain("stroke-width=1.5");
  });

  it("stays put when a bound sensor says open — there is nothing to open", () => {
    // The case this exists for: people bind a contact to a fixed pane for the
    // tap target and the badge. Shut and wide open must draw identically.
    expect(svgOf(fixed, { open: true, amount: 1 })).toBe(svgOf(fixed, { open: false, amount: 0 }));
  });

  it("never wears the accent, because no part of it is ever the moving part", () => {
    const s = svgOf(fixed, { open: true, amount: 1, active: true, accent: "#ff0000" });
    expect(s).not.toContain("#ff0000");
  });

  it("a fixed door is a sealed panel: solid, and no jambs to read as glass", () => {
    const s = svgOf({ type: "door", motion: "fixed" }, { open: true });
    expect(s).toContain("stroke-width=2.5"); // solid, not the 1.5 of glass
    expect(s).not.toContain('stroke-width="2"'); // no jambs
  });
});

describe("renderOpening — a sash narrower than its frame (issue #218)", () => {
  const partial = { type: "window", sash: "single", sashSpan: 0.4 } as Partial<Opening>;

  it("draws the sash at its own width, not the frame's", () => {
    const s = svgOf(partial, { open: true });
    expect(s).toContain("width=36"); // 90 × 0.4
    expect(s).not.toContain("width=90");
  });

  it("fills the rest of the frame with fixed glass", () => {
    const s = svgOf(partial, { open: true });
    // Pane runs from where the sash ends (-45 + 36 = -9) to the far jamb.
    expect(s).toContain('x1=-9 y1="0" x2=45');
  });

  it("sweeps an arc the sash's own width, hinged at its own jamb", () => {
    const s = svgOf(partial, { open: true });
    expect(s).toContain("M -9 0 A 36 36 0 0 0 -45 -36");
  });

  it("a full-width sash is untouched — the arc it always drew", () => {
    const full = svgOf({ type: "window", sash: "single" } as Partial<Opening>, { open: true });
    expect(full).toContain("M 45 0 A 90 90 0 0 0 -45 -90");
    expect(full).not.toContain('y1="0" x2=45 y2="0"'); // no fixed pane
  });

  it("a door's remainder is a solid panel, not glass (review of #218)", () => {
    // A door leaf narrower than its frame is a sidelight door, so the field is
    // offered on doors too — and what it draws beside the leaf has to be the
    // door's own solid panel, not the window's thin glass line.
    const d = svgOf({ type: "door", sash: "single", sashSpan: 0.4 }, { open: true });
    expect(d).toContain('x1=-9 y1="0" x2=45');
    expect(d).toContain("stroke-width=2.5"); // solid panel
    expect(d).not.toContain("stroke-width=1.5"); // not glass
    // And still no jambs — a door is drawn by its leaf and arc alone.
    expect(d).not.toContain('stroke-width="2"');
  });

  it("is ignored by a double sash, which has no leftover to fix", () => {
    const two = svgOf({ type: "window", sash: "double", sashSpan: 0.4 } as Partial<Opening>, {
      open: true,
    });
    expect(two).toContain("fp-leaf-r");
    expect(two).toContain("width=45"); // each leaf still half the opening
  });
});

describe("an opening can say what colour it is when closed (issue #228)", () => {
  // "users could specify separate colors for switches or doors when they are
  // on/open and off/closed". A closed door was always a line the same colour
  // as the wall it sits in, which is exactly wrong when the thing you need to
  // notice is a door that is shut.
  const door = { type: "door", entity: "binary_sensor.front" } as Partial<Opening>;

  it("paints the moving parts with the closed colour", () => {
    const svg = svgOf(door, { color: "#000", inactive: "#c62828", active: false, open: false });
    expect(svg).toContain("#c62828");
  });

  it("leaves the frame the wall colour, and only moves the sash", () => {
    // `color` also draws the static frame. Recolouring that would turn the
    // symbol from a hole in a wall into a coloured shape, so the closed colour
    // must not reach it. A window is the case that draws both at once — a
    // closed door and a closed slider draw no frame stroke to check.
    const svg = svgOf(
      { type: "window", entity: "binary_sensor.front" },
      { color: "#0000ff", inactive: "#c62828", active: false, open: false },
    );
    expect(svg).toContain("#0000ff");
    expect(svg).toContain("#c62828");
  });

  it("works for every kind of opening, not just the one it was written for", () => {
    // Both types, and both motions — a slider's panel is drawn by a different
    // branch from a swing leaf, so covering one proves nothing about the other.
    const shapes = [
      { type: "door" },
      { type: "window" },
      { type: "door", motion: "slide" },
      { type: "window", motion: "slide" },
    ] as const;
    for (const shape of shapes) {
      const svg = svgOf(
        { ...shape, entity: "binary_sensor.front" },
        { color: "#000", inactive: "#c62828", active: false, open: false },
      );
      expect(svg, `${JSON.stringify(shape)} should paint its closed colour`).toContain("#c62828");
    }
  });

  it("is ignored while the opening is open, where the accent belongs", () => {
    const svg = svgOf(door, {
      color: "#000",
      inactive: "#c62828",
      active: true,
      open: true,
      accent: "#00ff00",
    });
    expect(svg).toContain("#00ff00");
    expect(svg).not.toContain("#c62828");
  });

  it("changes nothing for an opening that does not set one", () => {
    // The default path has to be byte-identical, since every existing plan is
    // on it.
    const withOut = svgOf(door, { color: "#123456", active: false, open: false });
    const withUndefined = svgOf(door, {
      color: "#123456",
      inactive: undefined,
      active: false,
      open: false,
    });
    expect(withUndefined).toBe(withOut);
  });

  it("carries the second leaf of a double, which has its own state", () => {
    // A pair of sashes with one open and one shut should show both colours —
    // the shut one is the whole point of the feature.
    const svg = svgOf(
      { ...door, sash: "double" },
      {
        color: "#000",
        inactive: "#c62828",
        accent: "#00ff00",
        active: true,
        open: true,
        second: { amount: 0, active: false },
      },
    );
    expect(svg).toContain("#00ff00");
    expect(svg).toContain("#c62828");
  });

  it("follows what the leaf is doing, not what its sensor says", () => {
    // `active` and "drawn shut" agree for every entity-bound opening, which is
    // why the tone started life as `active ? accent : shut`. They come apart
    // with no entity: a swing door is drawn *open* by the plan convention and
    // is never active, so reading one as the other painted a wide-open door in
    // the colour documented to mean closed.
    const openDoor = svgOf(
      { type: "door" },
      { color: "#0000ff", inactive: "#c62828", active: false, open: true, amount: 1 },
    );
    expect(openDoor).not.toContain("#c62828");
    expect(openDoor).toContain("#0000ff");

    // Shut, the same door does wear it.
    const shutDoor = svgOf(
      { type: "door" },
      { color: "#0000ff", inactive: "#c62828", active: false, open: false, amount: 0 },
    );
    expect(shutDoor).toContain("#c62828");
  });

  it("paints one sash of a double and not the other", () => {
    // Falls out of asking each leaf's own amount rather than one `active` flag,
    // which could not express a pair with one sash open and one shut.
    const svg = svgOf(
      { type: "window", sash: "double", entity: "binary_sensor.a" },
      {
        color: "#0000ff",
        inactive: "#c62828",
        accent: "#00ff00",
        active: true,
        open: true,
        amount: 1,
        second: { amount: 0, active: false },
      },
    );
    expect(svg).toContain("#00ff00"); // the open sash
    expect(svg).toContain("#c62828"); // the shut one
  });

  it("reaches a top-hinged sash too, which arrived at the same time", () => {
    // #272 merged while this was open, and its blade and glass line are drawn
    // from the same `tone` every other motion uses — so it gets a closed colour
    // for free. Pinned because "for free" is exactly the kind of thing a later
    // refactor of that branch could take away without noticing.
    const svg = svgOf(
      { type: "window", motion: "awning", entity: "cover.win" },
      { color: "#0000ff", inactive: "#c62828", active: false, open: false, amount: 0 },
    );
    expect(svg).toContain("#c62828");
    // …and its jambs are still the wall's colour, as every other opening's are.
    expect(svg).toContain("#0000ff");
  });

  it("takes a shutter down with it, as the accent takes one up", () => {
    const svg = svgOf(
      { ...door, shutterEntity: "cover.shutter" },
      {
        color: "#000",
        inactive: "#c62828",
        active: false,
        open: false,
        shutter: { amount: 0, active: false, style: "roll" },
      },
    );
    expect(svg).toContain("#c62828");
  });
});

describe("an unusable closed colour falls back to the wall, not the accent (issue #228)", () => {
  // `inactive` is documented to default to `color`. It reached
  // `cssColorOr(…, SKIN_ACCENT)` unsanitised, so a value cssColor refuses did
  // not fall back to the wall — it fell all the way through to the accent,
  // which is the colour this symbol wears when it is *open*. A typo in
  // `inactiveColor` therefore drew a shut door as an open one.
  const shut = { color: "#123456", open: false, amount: 0 } as const;

  it("draws an unsanitisable value as the wall colour", () => {
    const svg = svgOf({ type: "door" }, { ...shut, inactive: "url(javascript:alert(1))" });
    expect(svg).toContain("#123456");
    expect(svg).not.toContain("javascript");
  });

  it("still honours a usable one", () => {
    expect(svgOf({ type: "door" }, { ...shut, inactive: "#c62828" })).toContain("#c62828");
  });
});

describe("a window can be hinged at the top (issue #272)", () => {
  // "My windows are hinged at the top and swing out at the bottom." Every
  // other opening rotates within the plan; this one rotates about a horizontal
  // axis and leaves it, so the plan view is the sash edge-on — a blade
  // projecting from the wall, with the hinges left on the wall line.
  const awning = { type: "window", motion: "awning", entity: "cover.win" } as Partial<Opening>;
  /** The broken-line pattern the vacated glass line is drawn with. */
  const DASH = "6 4";

  it("projects a tapered blade once it is open", () => {
    const svg = svgOf(awning, { color: "#000", open: true, amount: 1 });
    expect(svg).toContain("<polyline");
    // Tapered, not a rectangle: the two far corners are pulled in.
    const pts = /points="([^"]+)"/.exec(svg)?.[1].split(" ").map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(4);
    const [base1, far1, far2, base2] = pts!;
    expect(Math.abs(far1[0])).toBeLessThan(Math.abs(base1[0]));
    expect(Math.abs(far2[0])).toBeLessThan(Math.abs(base2[0]));
    // …and it projects away from the wall line rather than sitting on it.
    expect(far1[1]).toBeLessThan(0);
    expect(base1[1]).toBe(0);
  });

  it("draws no blade while it is shut", () => {
    const svg = svgOf(awning, { color: "#000", open: false, amount: 0 });
    expect(svg).not.toContain("<polyline");
  });

  it("stays a trapezoid at any length, rather than folding through itself", () => {
    // The taper is a fraction of how far the sash projects, and the blade's
    // half-width shrinks to nothing on a very short opening — so uncapped, the
    // two far corners cross and the shape draws inverted. Below ~3.5 units
    // that is every awning. Nothing that small is legible on a plan, but the
    // editor's Length field goes down to 1, and a shape folded through itself
    // is not a drawing of anything.
    const far = (length: number) => {
      const svg = svgOf({ ...awning, length }, { color: "#000", open: true, amount: 1 });
      const pts = /points="([^"]+)"/.exec(svg)![1].split(" ").map((p) => p.split(",").map(Number));
      return [pts[1]![0], pts[2]![0]] as const;
    };
    for (const length of [1, 2, 3, 3.5, 5, 20, 140]) {
      const [left, right] = far(length);
      expect(left, `length ${length}`).toBeLessThanOrEqual(right);
    }
  });

  it("does not blunt the taper at a length anyone would draw", () => {
    // The guard against the cap quietly reshaping ordinary windows: at 140
    // units the taper is a sixth of the projection, nowhere near the cap.
    const svg = svgOf({ ...awning, length: 140 }, { color: "#000", open: true, amount: 1 });
    const pts = /points="([^"]+)"/.exec(svg)![1].split(" ").map((p) => p.split(",").map(Number));
    const [base, far1] = [pts[0]![0], pts[1]![0]];
    expect(Math.abs(far1 - base)).toBeCloseTo(5.44, 2);
  });

  it("leaves the broken glass line showing under the blade", () => {
    // The blade is an open shape on purpose. As a polygon it stroked its own
    // base straight back along the wall line — solid, over the dashes — and
    // the only glass left uncovered was the sliver outside the blade, which is
    // exactly where the knuckles sit. The dash pattern was in the markup and
    // the line was solid on screen at every size, so the test above passed on
    // a picture that never showed it.
    const svg = svgOf(awning, { color: "#000", open: true, amount: 1 });
    expect(svg).not.toContain("<polygon");
  });

  it("projects further the wider it is open", () => {
    const depth = (amount: number) => {
      const svg = svgOf(awning, { color: "#000", open: true, amount });
      return Math.abs(Number(/points="[^"]*?,(-[\d.]+)/.exec(svg)![1]));
    };
    expect(depth(1)).toBeGreaterThan(depth(0.4));
    expect(depth(0.4)).toBeGreaterThan(0);
  });

  it("breaks the glass line only once the sash has left it", () => {
    // Shut, the sash is sitting in the opening and the line is solid. Open,
    // the line is what the sash vacated.
    // Asserted on the dash pattern rather than the attribute name: the
    // attribute is bound to lit's `nothing` when shut, which removes it in a
    // real DOM but survives this serializer as a placeholder.
    expect(svgOf(awning, { color: "#000", open: false, amount: 0 })).not.toContain(DASH);
    expect(svgOf(awning, { color: "#000", open: true, amount: 1 })).toContain(DASH);
  });

  it("shows the hinges whether or not it is open", () => {
    // The request asked for them by name, and shut they are the only thing
    // that says this window is top-hung rather than fixed.
    for (const amount of [0, 1]) {
      const svg = svgOf(awning, { color: "#000", open: amount > 0, amount });
      expect((svg.match(/<rect/g) ?? []).length, `amount=${amount}`).toBe(2);
    }
  });

  it("is not a casement — no swinging leaf, no arc", () => {
    const svg = svgOf(awning, { color: "#000", open: true, amount: 1 });
    expect(svg).not.toContain("fp-door-leaf");
    expect(svg).not.toContain("fp-door-arc");
    expect(svg).not.toContain("fp-slide-panel");
  });

  it("wears the accent while it is actively open", () => {
    const svg = svgOf(awning, { color: "#000", open: true, amount: 1, active: true, accent: "#00ff00" });
    expect(svg).toContain("#00ff00");
  });

  it("opens the other way with flipV, which is how a hopper is drawn", () => {
    // A bottom-hinged sash tilting inward is the same picture on the other
    // side of the wall, so it needs no motion of its own.
    const out = svgOf(awning, { color: "#000", open: true, amount: 1 });
    const inward = svgOf({ ...awning, flipV: true }, { color: "#000", open: true, amount: 1 });
    expect(out).toContain("scale(1 1)");
    expect(inward).toContain("scale(1 -1)");
  });

  it("ignores sash and flipH, which have nothing to describe here", () => {
    // There is no hinge jamb to pick and no second leaf to hang. Pinned so a
    // config carrying them from a previous motion cannot change the drawing.
    const plain = svgOf(awning, { color: "#000", open: true, amount: 1 });
    const noisy = svgOf({ ...awning, sash: "single", flipH: true }, {
      color: "#000",
      open: true,
      amount: 1,
    });
    expect(noisy.replace(/scale\(-1 1\)/, "scale(1 1)")).toBe(plain);
  });
});

describe("openingClearFraction — a top-hinged sash leaves the plan (issue #272)", () => {
  const awning = {
    id: "a",
    x: 0,
    y: 0,
    length: 100,
    angle: 0,
    type: "window",
    motion: "awning",
  } as Opening;

  it("clears its whole width when open, because nothing is left in the gap", () => {
    expect(openingClearFraction(awning, 1)).toBe(1);
    expect(openingClearFraction(awning, 0.5)).toBe(0.5);
    expect(openingClearFraction(awning, 0)).toBe(0);
  });

  it("has one leaf, so a second amount changes nothing", () => {
    expect(openingClearFraction(awning, 1, 0)).toBe(1);
  });

  it("is a one-sash opening, so the editor offers it no second contact", () => {
    // A casement pair and a biparting slider each take a sensor per leaf. A
    // top-hung sash is one piece, and offering a second contact would be a
    // control that drives nothing.
    expect(openingHasTwoLeaves(awning)).toBe(false);
  });
});
