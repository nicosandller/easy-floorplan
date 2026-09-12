import { describe, it, expect } from "vitest";
/**
 * The card's stylesheet, as source. Read as text rather than imported,
 * because importing the card pulls in Lit's whole element machinery — and
 * registers a custom element — for a question the CSS itself answers.
 */
import cardSourceRaw from "./floorplan-card.ts?raw";
const cardSource = cardSourceRaw as string;

describe("the stylesheet does not overwrite paint the renderer computes", () => {
  /**
   * CSS beats the SVG presentation attribute. Anything the renderer paints
   * with a per-element `url(#...)` — a gradient it builds, a mask it sizes —
   * is therefore silently discarded by a flat declaration of the same
   * property in here.
   *
   * This is not hypothetical. `.fp-sunbeam { fill: var(--fp-skin-sunlight) }`
   * shipped in the sunlight feature (#169) and threw away every falloff the
   * renderer produced: the markup kept saying url(#...), the computed style
   * said rgb(...), and sunlight came out as a flat hard-edged slab. Issue
   * #185 was reopened three times against it, and four separate rewrites of
   * the falloff — a fan, a penumbra, a circle, an ellipse — were each correct
   * and none of them was ever rendered. The tests all passed throughout,
   * because they asserted on markup, and the markup was right.
   *
   * The skin still reaches these: the colour is read into the gradient's own
   * stops, which is where a per-element paint has to be set from.
   */
  const gradientPainted = [
    { selector: ".fp-sunbeam", property: "fill" },
    { selector: ".fp-glow", property: "fill" },
    // Ambient daylight paints a per-element linearGradient the same way, and
    // hangs the room's softness on a per-element `filter: url(#...)` besides.
    // A flat `fill` here would give every window the same hard slab the
    // sunbeam got; a flat `filter` would take the blur away and leave the bare
    // trapezoid, which is the shape the gradient exists to hide.
    { selector: ".fp-ambient-daylight-patch", property: "fill" },
    { selector: ".fp-ambient-daylight-patch", property: "filter" },
  ];

  for (const { selector, property } of gradientPainted) {
    it(`${selector} declares no ${property}`, () => {
      const at = cardSource.indexOf(`${selector} {`);
      if (at === -1) return; // the class is gone; nothing to guard
      const block = cardSource.slice(at, cardSource.indexOf("}", at));
      expect(block).not.toMatch(new RegExp(`(^|[;\\s])${property}\\s*:`));
    });
  }

  it("says why, so the next person does not add it back", () => {
    // A rule this easy to re-add needs its reason written next to it.
    const at = cardSource.indexOf(".fp-sunlight {");
    expect(at).toBeGreaterThan(-1);
    const nearby = cardSource.slice(at, at + 1400);
    expect(nearby).toMatch(/CSS beats the presentation attribute/i);
  });
});
