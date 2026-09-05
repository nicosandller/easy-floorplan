# Appearance

How the plan presents itself: its colours, the size of what it draws, and the hooks to restyle it.

Back to the [README](../README.md).

## Skins

A skin restyles the whole plan at once — paper, walls, badges, accents — from one line.
Pick one under **Project → Skin**, or set it by hand:

```yaml
type: custom:easy-floorplan-card
skin: tron
```

| Skin | What it looks like |
| --- | --- |
| `default` | Follows your Home Assistant theme, as the card always has. What you get with no `skin` set. |
| `odnetnin` | Playful and chunky: thick charcoal outlines on warm cream, rounded-square badges with a printed-sticker shadow, red accent, bright yellow for anything on. |
| `pastel` | Soft and low-contrast: muted mauve walls on blush paper, peach for active devices. Easy on a dashboard that stays on screen. |
| `tron` | Neon on near-black: thin glowing cyan walls, amber for active devices, light text. Light pools read best here. |

A skin only supplies **fallbacks**, so anything you set on an element yourself still wins —
a room's own `color`, a device's `activeColor`, a `background` on the plan. Switch skins
freely without losing colors you chose by hand.

It deliberately leaves two things alone: the **editor's own chrome** stays in your HA theme
so the canvas reads as the plan, and a **background image** still covers the skin's paper.

### Rolling your own

A skin is a set of CSS custom properties, so [card-mod](appearance.md#styling-hooks-card-mod) can set
the same ones for the same result — including on top of a skin, to change one thing about
it rather than replace it. A skinned card also carries its id as `data-skin` on the card
element, so a rule can apply to one skin only:

```yaml
type: custom:easy-floorplan-card
card_mod:
  style: |
    ha-card {
      --fp-skin-bg: #101820;
      --fp-skin-wall: #f2aa4c;
      --fp-skin-text: #f2f2f2;
      --fp-skin-accent: #f2aa4c;
    }
```

Values are plain CSS, so quoting them breaks the declaration rather than setting it:
`--fp-skin-wall-width: 5` works, `--fp-skin-wall-width: "5"` draws hairline walls. The
`var()` default can't catch that — a fallback only applies to a property that is *unset*,
never to one set to something invalid.

| Token | Default | Paints |
| --- | --- | --- |
| `--fp-skin-bg` | card background | The canvas paper. |
| `--fp-skin-card-bg` | card background | The card around the canvas. |
| `--fp-skin-wall` | theme text color | Walls, and the jambs and leaves of openings. |
| `--fp-skin-wall-width` | `8` | Wall stroke width. **Keep at 10 or below** — a doorway is a 12-unit gap cut through the wall layer, and a wider wall wouldn't be fully cleared by its own door. |
| `--fp-skin-wall-filter` | `none` | A CSS `filter` on the walls, e.g. `drop-shadow(0 0 4px #22d3ee)`. |
| `--fp-skin-accent` | theme primary | Ripples, trackers, room fills, active doors, the floor switcher. |
| `--fp-skin-accent-ink` | theme text-on-primary | Reading color on the accent. Set it whenever your accent is pale. |
| `--fp-skin-active` | theme active color | Badge color for a device that is on. |
| `--fp-skin-active-ink` | theme text color | Icon/reading color on that badge. Set it whenever the active color is pale. |
| `--fp-skin-text` | theme text color | Labels, free text, room names, card title, editor grid. |
| `--fp-skin-badge-bg` | card background | Badge and label-chip background. |
| `--fp-skin-badge-border` | divider color | Badge border color. |
| `--fp-skin-badge-border-width` | `1.5px` | Badge border weight. |
| `--fp-skin-badge-radius` | `50%` | Badge roundness — `50%` a circle, `30%` a rounded square. |
| `--fp-skin-badge-shadow` | `0 1px 3px rgba(0,0,0,0.2)` | Badge shadow. |
| `--fp-skin-furniture` | `#9e9e9e` | Furniture with no color of its own. |
| `--fp-skin-glow` | `#ffd9a0` | Light-pool color for a bulb that reports none. |

Set them on `ha-card` and the whole plan follows, editor included. Any token you leave
alone keeps its default, so you can restyle one thing without restating the rest.

**On top of a built-in skin, add `!important`.** A `skin:` is applied as an inline `style`
on the card, which outranks a card-mod rule — so without it your override is silently
ignored, and only while a skin is set:

```yaml
type: custom:easy-floorplan-card
skin: tron
card_mod:
  style: |
    ha-card {
      --fp-skin-accent: #f2aa4c !important;
    }
```

## Named colors

If every temperature sensor on a plan turns red above 25°, that hex code is written into
every one of them — and changing your mind means finding them all again. Name the colour
once instead, and point the fields at the name.

Add names under **Project → Named colors**. Every colour field on the plan then grows a
dropdown listing them; pick one and the field follows that name from then on. The dropdown
only appears once a plan has a palette, so a plan that never names a colour sees the
editor it always did.

```yaml
type: custom:easy-floorplan-card
palette:
  - name: Warm
    color: "#ff8800"
  - name: Alert
    color: "#e53935"
floors:
  - id: ground
    areas:
      - id: living
        color: var(--fp-color-warm)
    items:
      - id: thermostat
        entity: sensor.living_temperature
        stateColor:
          - above: 25
            color: var(--fp-color-alert)
          - above: 0
            color: var(--fp-color-warm)
```

A reference is an ordinary CSS custom property, which is what makes it work everywhere a
colour does — room fills, badges, state rules, text, furniture, trackers, the floor
buttons — with no separate syntax to learn. The name becomes the property by lowercasing
it and turning anything that is not a letter or digit into a `-`, so `Warm white` is
`var(--fp-color-warm-white)`.

Two consequences worth knowing:

- **Recolouring a name moves everything using it**, live. That is the point.
- **Renaming or deleting one leaves nothing dangling.** A rename rewrites every reference
  to the new name. A delete rewrites them to the colour the name held, so the plan looks
  exactly as it did and has simply lost the link — a reference to a colour that no longer
  exists is not a colour at all, and would paint black.

The editor refuses a rename that would collide with another entry, since two names
reducing to the same reference means one of them silently stops resolving.

Because a reference is just CSS, you can also point one at a Home Assistant theme
variable and let the palette follow your theme:

```yaml
palette:
  - name: Accent
    color: var(--primary-color)
```

## Overlay scale

The card draws in two layers. Walls, doors, furniture and room fills are SVG, scaled from
the canvas to whatever width the card gets — draw at any size, they always fit. Badges,
labels, room names and text are HTML on top of that, so they stay upright under `rotation`
and can take clicks.

**A new plan is created with the overlay in canvas units too** (`overlayScale: plan`), so
both layers shrink together and the card looks the same at every size — a scale drawing
rather than a drawing with fixed-size furniture on it. Every measure follows: `size` and
`labelSize` on a device, the reading drawn inside a badge, `size` on text, an area's
`labelSize`, and `rippleSize`. Hairlines deliberately don't — a badge border and a label's
drop shadow are about a pixel either way, and scaling them down is how you lose them.

Sizes then mean the same thing as everything else in the config: `labelSize: 14` is 14
units on a `980`-unit-wide canvas, about 1.4 % of the card's width whatever that turns out
to be.

**The editor previews whichever mode the plan uses.** The canvas sizes its badges and
labels the same way the card will, so the number you type is the number that renders — and
zooming the canvas previews the card at other widths. (Before this it always drew screen
pixels, so a plan in canvas units looked right in the editor and small on the dashboard,
which is what made 1.5's change so hard to place.)

### `fixed`, and when to reach for it

`overlayScale: fixed` pins the overlay to **screen pixels** instead:

```yaml
type: custom:easy-floorplan-card
width: 980
height: 700
overlayScale: fixed
```

That is the original behaviour, and what a config that doesn't mention `overlayScale`
still renders as. It agrees with the drawing only while the card renders at roughly its
canvas size — which is not something a plan gets to
decide, because the dashboard hands it whatever width it has. Below that the two come
apart: a `980`-wide plan shown `500` wide draws every wall at half size while a 14px room
name stays 14px, so names spill past their rooms and collide with the badges under them.
Nothing in the config fixes it, because a label's px size doesn't know what scale the plan
ended up at.

It also loses a **cluster**. A group of badges placed close together — three sensors of the
same physical device, say — has positions that scale with the plan and sizes that do not,
so a cluster neatly spaced on a wide card collides on a narrow one: the badges stay 34px
while the gaps between them shrink. Under `plan` the whole cluster shrinks as one and the
spacing you set is the spacing you keep. (That is the answer to "my grouped icons drift
apart when the card resizes" — though the better answer is often to have no cluster at
all: put the readings on **one** device with [`readings`](configuration.md#more-readings-per-device) and
there is no relative position left to preserve.)

> **"It looks right on my computer and wrong on my phone."** Same plan, same config —
> a phone just gives the card less width. Under `fixed` the badges stay 34px and the text
> stays 12px while everything they were spaced against halves, so a badge ends up sitting
> on the label or the free text beside it, and it reads as a label that has moved. Nothing
> has moved: the gaps shrank and the badges did not. `overlayScale: plan` is the answer —
> it is what a plan drawn once and shown at two sizes wants. (Issue #217.)

Reach for `fixed` when the card renders **larger** than its canvas, or on a wall tablet
where a px floor under the text is what keeps it readable from across the room.

> **Upgrading from 1.5.x?** 1.5.0 changed what a *missing* `overlayScale` meant, which
> resized the overlay of every plan that had never set one — including plans whose author
> had deliberately chosen the pixels, since that was the default at the time and the editor
> wrote nothing down for it. On a card narrower than its canvas the badges came out a
> fraction of their size (issue #192). That is undone: **a config with no `overlayScale`
> renders in pixels, as it always did.** Canvas units are what a plan wants, so a card
> added from the picker is created with `overlayScale: plan` written into it — a new
> default belongs in new configs, not in a changed reading of old ones.
>
> If you liked what 1.5 did, add `overlayScale: plan` and keep it — or pick **Canvas
> units** under **Display** in the editor, which now writes your choice down instead of
> omitting it for being the default. Merely opening that panel changes nothing: a plan's
> YAML gains the key when you choose a mode, not because you looked at the setting.

### Where it helps, and where it costs

Scaling with the drawing cuts both ways: it stops text overflowing its room, and it also
keeps shrinking past the point text can be read. On a `980`-wide canvas at the default
sizes (room name `14`, device label `12`):

| Card width | Room name | Device label |
| --- | --- | --- |
| 1200 | 17px | 15px |
| 800 | 11px | 10px |
| 600 | 9px | 7px |
| 450 | 6px | 6px |
| 350 | 5px | 4px |

So `plan` suits a card rendering down to roughly **two-thirds of its canvas width** on the
defaults. Below that it trades collision for illegibility, and the sizes have to come up
to compensate — a `labelSize` of `20`–`24` on a card at half its canvas width lands back
where the default was. That is a real trade, not a free win: sizes are relative, and
nothing puts a floor under them.

So the escape hatch runs both ways. On a card **much** smaller than its canvas, raise the
sizes rather than switching to `fixed` — the geometry is still right, only the numbers are
too small. Switch to `fixed` when the card is rendered **larger** than its canvas, or on a
wall tablet showing the plan at full size where a px floor is what keeps text legible from
across the room.

The rule of thumb: `plan` is what a plan wants, and the size numbers are yours to set.

## Compact header

For a dashboard where the top of the card is mostly empty:

```yaml
type: custom:easy-floorplan-card
title: Ground floor
compactHeader: true
```

- The **title** becomes a small chip in the plan's top-left corner instead of an
  `ha-card` header. That header is a fixed ~76px whatever it says — 48px of line-height
  plus its padding — and none of it is reachable from outside `ha-card`, so the only way
  to stop spending it is not to use it.
- The **floor buttons** lay out as a row rather than a column, sharing that one strip
  with the title instead of running down the side.

Off by default, because the title then sits over the drawing — the right trade only when
there is room for it, which is the author's call. Set it in the editor under
**Project → Compact header**.

## Rotation that follows the screen

A rectangular flat wants its long side across the screen, and which side that is changes
with the device. One `rotation` cannot be right for both, so there are two more:

```yaml
type: custom:easy-floorplan-card
rotation: 0            # the fallback, and what an unset override falls back to
rotationPortrait: 270  # phones
rotationLandscape: 0   # desktop, wall tablet
```

- Set **either** override, or both. An unset one means "same as `rotation`", which is what
  every plan did before these existed — a config that sets neither is completely
  unaffected.
- `0` in an override is a real answer, not "unset". On a plan that is otherwise rotated,
  `rotationLandscape: 0` says *don't* rotate on a desktop. Writing the key with **no
  value** (`rotationPortrait:`) is unset, though — not 0°.
- It follows the **screen's** orientation, not the card's own box. That is what "my
  vertical devices" means, and it keeps a narrow card in a sidebar from rotating itself on
  a landscape desktop. On any current browser it follows the device being turned live,
  with no reload; on an older WebView without a subscribable `matchMedia` it is still
  correct when the page loads and simply stops following turns after that.
- Editing is unaffected. The editor always shows the plan as drawn, as it does for plain
  `rotation`.

In the editor: **Project → Display**, under *Rotate display*.

Icons and labels stay upright at every angle, so a rotated plan is still readable.

## Styling hooks (card-mod)

Every rendered element carries its config `id` as `data-id`, plus a type class, so
[card-mod](https://github.com/thomasloven/lovelace-card-mod) and any other CSS can target
it by something stable.

| Element | Class | Attributes |
| --- | --- | --- |
| Area (fill) | `fp-area` | `data-id`, `data-entity` |
| Dead space | `fp-dead-space` (hatch lines: `fp-dead-space-line`) | — |
| Area (outline) | `fp-area-border` | `data-id`, `data-entity` |
| Furniture | `fp-furniture`, `fp-furniture-<type>` | `data-id`, `data-entity` |
| Door / window | `fp-opening`, `fp-opening-door` \| `fp-opening-window` | `data-id`, `data-entity` |
| Wall | `wall`, `fp-wall` | `data-id` |
| Device | `item`, `fp-item` (plus `offline` while its entity has dropped out) | `data-id`, `data-entity`, `data-kind` |
| Text | `text`, `fp-text` | `data-id` |
| Room name | `area-label` | — |
| Tracker | `tracker`, `fp-tracker` | `data-id` |

Ids come from the editor (`area_a5r5nwl`, `furn_3j66s50`, …) and are stable across edits.

The stage carries the plan-wide modes as classes too — `press-scale` … `press-none`, and
`offline-dim` / `offline-strike` / `offline-none` — so a rule can be scoped to one of
them. The offline mark's own colour is `--fp-offline-mark` (see
[Offline devices](behavior.md#offline-devices)).

A dead space has no `data-id`, and cannot: it's derived from the walls rather than placed,
so there's nothing for an id to be stable against. Style them as a group —
`.fp-dead-space { fill-opacity: 0.7; }` for a heavier hatch, `.fp-dead-space-line
{ stroke: #c62828; }` to color the lines.

An area is **two** elements answering the same `data-id`: the fill, under the walls, and
the outline, over them. Scope `fill` rules to `.fp-area` — the outline is drawn
`fill="none"`, so an unscoped rule floods it solid:

```css
[data-id="area_hall"]          { fill: #62f202; }  /* also floods the outline */
.fp-area[data-id="area_hall"]  { fill: #62f202; }  /* the fill, as intended */
.fp-area-border[data-id="area_hall"] { stroke-dasharray: 6 4; }
```

Non-`fill` properties — `opacity`, `filter`, `stroke` — are usually fine on both, which is
why the `data-entity` example below is left unscoped.

```yaml
type: custom:easy-floorplan-card
card_mod:
  style: |
    /* One specific room */
    .fp-area[data-id="area_a5r5nwl"] { fill: #62f202; fill-opacity: 0.35; }
    /* Every sofa on the plan */
    .fp-furniture-sofa { opacity: 0.5; }
    /* The element bound to one entity, whatever kind it is */
    [data-entity="light.kitchen"] { filter: drop-shadow(0 0 6px gold); }
```

CSS wins over SVG presentation attributes, so `fill` and `fill-opacity` set this way
override what the card draws.

Note that colouring a room from a sensor needs no CSS — areas take `entity`, `stateColor`,
`activeColor` and `activeOpacity` natively (see [Area](configuration.md#area)) — and restyling the whole
plan doesn't either: the `--fp-skin-*` tokens in [Skins](appearance.md#skins) are the supported way to
build a look of your own. These hooks are a *styling* surface, not an API: class names are
stable, but the SVG inside an element may change between releases, so target the element
rather than its internals.
