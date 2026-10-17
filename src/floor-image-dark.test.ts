import { describe, it, expect } from "vitest";
import { floorImage, hassDarkMode } from "./render";
import { floorImageForm } from "./editor-forms";
import type { Floor } from "./types";

const INVERT = "invert(1) hue-rotate(180deg)";

describe("floor image in dark mode (issue #366)", () => {
  it("is unchanged in light mode whatever is set", () => {
    const f = { image: "light.png", imageDark: "dark.png", imageInvertDark: true };
    expect(floorImage(f, false)).toEqual({ href: "light.png" });
  });

  it("inverts the light image in dark mode when asked", () => {
    expect(floorImage({ image: "light.png", imageInvertDark: true }, true)).toEqual({
      href: "light.png",
      filter: INVERT,
    });
    expect(floorImage({ image: "light.png" }, true)).toEqual({ href: "light.png" });
  });

  it("prefers a dark image of its own over inverting", () => {
    expect(floorImage({ image: "light.png", imageDark: "dark.png", imageInvertDark: true }, true)).toEqual({
      href: "dark.png",
    });
  });

  it("shows a dark-only image in dark mode and nothing in light", () => {
    expect(floorImage({ imageDark: "dark.png" }, true)).toEqual({ href: "dark.png" });
    expect(floorImage({ imageDark: "dark.png" }, false)).toBeUndefined();
    expect(floorImage({}, true)).toBeUndefined();
  });

  it("reads HA's resolved dark mode", () => {
    expect(hassDarkMode({ themes: { darkMode: true } })).toBe(true);
    expect(hassDarkMode({ themes: { darkMode: false } })).toBe(false);
    expect(hassDarkMode({ themes: {} })).toBe(false);
    expect(hassDarkMode(undefined)).toBe(false);
  });

  it("offers the dark fields only alongside an image, and the switch only without a dark image", () => {
    const names = (f: Partial<Floor>) => floorImageForm(f as Floor).fields.map((x) => x.name);
    expect(names({})).not.toContain("imageDark");
    expect(names({})).not.toContain("imageInvertDark");
    expect(names({ image: "a.png" })).toEqual(expect.arrayContaining(["imageDark", "imageInvertDark"]));
    expect(names({ image: "a.png", imageDark: "b.png" })).toContain("imageDark");
    expect(names({ image: "a.png", imageDark: "b.png" })).not.toContain("imageInvertDark");
  });

  it("keeps the defaults out of the YAML", () => {
    const form = floorImageForm({ image: "a.png" } as Floor);
    expect(form.toPatch({ imageInvertDark: false })).toEqual({ imageInvertDark: undefined });
    expect(form.toPatch({ imageInvertDark: true })).toEqual({ imageInvertDark: true });
    expect(form.toPatch({ imageDark: "" })).toEqual({ imageDark: undefined });
    expect(form.toPatch({ imageFit: "stretch" })).toEqual({ imageFit: undefined });
  });
});
