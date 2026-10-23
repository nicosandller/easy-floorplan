# Furniture symbols

Every glyph the card draws lives in this directory, one JSON file per symbol. Adding a new
one is adding a file — no code and no build step. Keep the symbol catalogue in step with the
`FurnitureType` union in [`src/types.ts`](../src/types.ts), which is what a hand-written
config autocompletes against. Add the id there and to the expected catalogue in
`src/symbols.test.ts`. Run both `src/symbols.test.ts` and `src/render.test.ts` when
adding or changing a symbol. The rendering/default-size checks automatically cover
every shipped symbol through `BUILTIN_SYMBOLS`; do not replace that with a manual list.

**A symbol is geometry, not markup.** It is a list of primitives with numeric attributes,
and the card builds the SVG elements itself. Nothing here is ever parsed as markup, which
is why you can paste a stranger's symbol into your dashboard without reading it first:
there is no `<script>`, no `on*` handler, no `javascript:` href, and no colour to smuggle a
`url()` into. That is also the constraint you have to draw within.

## The shape of a file

```jsonc
{
  "id": "sofa",                      // must match the filename
  "name": "sofa",                    // what the picker shows
  "category": "living",              // living | bedroom | kitchen | bath | utility | other
  "keywords": ["couch", "settee"],   // search only — "couch" should find this
  "size": { "w": 170, "h": 72 },     // default size when someone places it
  "viewBox": [0, 0, 100, 100],       // optional; this is the default
  // "footprint" is accepted for compatibility but unused: the light mask
  // follows the symbol's own geometry now.
  "parts": [
    { "rect": [0, 0, 100, 100], "rx": 5.555556, "role": "body" },
    { "line": [0, 30, 100, 30] },
    { "line": [12, 30, 12, 100] },
    { "line": [88, 30, 88, 100] }
  ]
}
```

## Coordinates

Draw inside the viewBox, origin top-left. The card maps that box onto whatever `w × h` the
user gave the piece, and centres it:

- **x** is a fraction of the width — `50` is the middle, `0` and `100` are the edges.
- **y** is a fraction of the height, the same way.
- **Lengths** (`r` on a circle, `rx` on a rect) scale by the **smaller** side, so a circle
  stays a circle on a piece that is not square.
- An **ellipse**'s `rx` and `ry` each follow their own axis, because you named both.
- **Stroke widths are canvas units** and never scale. A 2-unit line is 2 units on a chair
  and on a sectional; line art that thickened with the furniture would read as a different
  drawing at every size.

Coordinates outside the viewBox are fine and are not clipped — that is how `tv.json` draws
its stand below the box, at `y = 200`.

`"space": "square"` on a part lays it out in the centred square of side `min(w, h)` instead
of the full box. Reach for it when a group of parts has to stay concentric with a circle:
`hotTub.json` puts its jets in square space so they sit on the water rather than spreading
out with the shell.

## Primitives

| part | draws |
|---|---|
| `{ "line": [x1, y1, x2, y2] }` | a line |
| `{ "rect": [x, y, w, h], "rx": 4 }` | a rectangle, optionally rounded |
| `{ "circle": [cx, cy, r] }` | a circle — stays round at any aspect |
| `{ "ellipse": [cx, cy, rx, ry] }` | an ellipse, stretching with the box |
| `{ "polygon": [[x, y], …] }` | a closed shape |
| `{ "polyline": [[x, y], …] }` | an open run of segments |
| `{ "path": [["M", x, y], ["L", x, y], ["Q", …], ["C", …], ["Z"]] }` | a path |
| `{ "repeat": 6, "step": [dx, dy], "part": { … } }` | one part stamped 6 times |

A `path` is a list of commands, not a `d` string — the card has to scale x and y separately,
so it needs them apart. Absolute `M`, `L`, `Q`, `C` and `Z` only; flatten arcs to curves.

`repeat` is how a fitted wardrobe run, a flight of stairs and a piano keyboard stay short.
Each copy is offset by `i × step`, and it holds a single part rather than a group.

## Roles

A part never names a colour. It picks a **role**, and the card pours in whatever colour the
piece resolves to — the default grey, a `color:` from the config, a skin, or a live colour
driven by a bound entity. That is what makes a contributed symbol work with all of those
without doing anything.

| role | fill | stroke width | opacity | use for |
|---|---|---|---|---|
| `body` | yes, at 0.12 | 2 | 1 | the carcass — the outline of the thing |
| `line` | no | 2 | 1 | the main detail lines |
| `thin` | no | 1.5 | 1 | secondary detail |
| `detail` | no | 1.5 | 0.7 | quieter detail |
| `hint` | no | 1 | 0.6 | texture — keys, jets, bubbles |
| `solid` | yes, fully | — | 0.7 | a filled shape, e.g. a fish's tail |

`rect`, `ellipse` and `polygon` default to `body`; everything else defaults to `line`. Add
numeric `width`, `opacity`, `fillOpacity` or `dash` to override the role — see `rug.json`,
which is a `body` at `0.08` with a dashed outline.

## Drawing one

1. Copy the closest existing file and change the numbers. Most glyphs are under a dozen parts.
2. Try it without a PR: paste the JSON into **Project → Custom symbols** in the editor. It
   lands in your card's `symbols:` block and shows up in the picker beside the built-ins.
3. When it looks right, drop it here as `<id>.json`, add the id to the `FurnitureType`
   union in `src/types.ts` and the expected catalogue in `src/symbols.test.ts`. Run
   `npm test -- src/symbols.test.ts src/render.test.ts`, then open a pull request.

Check it at its default size *and* stretched: a glyph can be right by the numbers and wrong
on screen. `npm run ha` (see [`docker/README.md`](../docker/README.md)) gets you
an editor to drop it into and resize.

### Lighting

If you create your own furniture, be careful which primitives you use for what. For the lighting mask to display correctly, always use at least a closed shape as the outermost line. For example, if you draw a hexagonal table, do not draw the outer lines as separate `line` objects, use a `polygon` instead.

## What gets merged

Symbols that a lot of people would place. A fitted wardrobe, a kitchen island, a treadmill —
things a floorplan needs. Keep it to one drawing per file, readable at 40 pixels wide, in the
same flat line-art style as the rest, and give it keywords someone would actually search for.

## Optional 3D models (version 1)

`model3d` is an optional, declarative model used only in the standing isometric view.
The existing `parts`, `viewBox`, and `size.w/h` still define the 2D symbol, picker,
footprint and glow mask. Missing, invalid or unsupported 3D models use the previous
isometric block with the 2D glyph on top. Older readers ignore `model3d`.

```json
"model3d": {
  "version": 1,
  "units": "cm",
  "size": { "width": 60, "depth": 60, "height": 180 },
  "parts": [
    { "box": [2, 30, 180], "position": [58, 0, 0] },
    {
      "repeat": 5,
      "step": [0, 0, 42],
      "part": {
        "extrude": {
          "polygon": [[0, 0], [60, 0], [60, 30], [30, 60], [0, 60]],
          "height": 2
        },
        "position": [0, 0, 8]
      }
    }
  ]
}
```

Coordinates start at the footprint's top-left corner on the floor. X is width,
Y is depth and Z points up. `position` defaults to `[0,0,0]` and locates the minimum
corner of a box or cylinder; extrusion vertices are relative to that position.
An optional `axes: {"up":"z"}` can make the convention explicit.

Supported primitives:

- `box: [width, depth, height]`.
- `cylinder: {"radius": 10, "height": 30}`; twelve flat segments, centred at
  `[radius, radius]` relative to its position.
- `extrude: {"polygon": [[x,y], ...], "height": 2}`; a strictly convex footprint
  with 3–24 vertices, without repeating the first vertex at the end.
- `repeat`, `step` and `part` repeat one primitive. Nested repeats are rejected.

Every part must fit inside the model size. All lengths are positive, coordinates
are finite numbers, and a model expands to at most 64 solids. Concave, intersecting
or degenerate polygons are rejected. Split concave furniture into convex parts.
Materials inherit the furniture's resolved colour and skin. Optional
`material: "glass"` gives a translucent approximation; other material names have
no effect. No external textures, URLs, scripts or raw SVG are loaded.

Horizontal dimensions follow the placed furniture's width and depth. Z uses the
same scale as floor coordinates: heights are not compressed when resizing furniture.
The displayed wall height currently acts as a section plane. Parts above it are
omitted, and crossing parts are clipped with a flat top at that height. For example,
a 200 cm shelf unit viewed at 60 cm retains only its lower shelves and the cut sides.
Beds have a 50 cm sleeping surface (the headboard may be taller); tables are 80 cm.
At wall height zero the existing flat symbols remain visible. A separate section-height
setting can be introduced later; there is no additional configuration parameter yet.

All parts join the existing wall/opening depth ordering. This is an SVG solid
renderer, not a mesh engine: complex interpenetrating solids and layered transparency
are approximate. The supplied models are stylised silhouettes; heights not specified
by a manufacturer are illustrative defaults, not measured product specifications.
