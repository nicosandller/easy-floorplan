# Furniture symbols

Every glyph the card draws lives in this directory, one JSON file per symbol. Adding a new
one is adding a file — no code, no build step, no entry in a list somewhere else.

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
  "footprint": "rect",               // optional; "ellipse" for a round-bodied piece
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
3. When it looks right, drop it here as `<id>.json` and open a pull request.

Check it at its default size *and* stretched: a glyph can be right by the numbers and wrong
on screen. `npm run ha` (see the [main README](../README.md#local-home-assistant)) gets you
an editor to drop it into and resize.

## What gets merged

Symbols that a lot of people would place. A fitted wardrobe, a kitchen island, a treadmill —
things a floorplan needs. Keep it to one drawing per file, readable at 40 pixels wide, in the
same flat line-art style as the rest, and give it keywords someone would actually search for.
