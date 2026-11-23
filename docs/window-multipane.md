# Window – Multipane

Windows accept `panes`, ordered **bottom to top**, with 1–8 full-width panes.
Each pane has a positive relative `height` (default 1), `motion` (`fixed`,
`swing`, `awning`, `slide-up`, `slide-down`), optional `entity`, and `invert`.
Moving panes inherit the window's entity when their own is unset. Fixed panes
never move. Use a binary contact or a cover's `current_position` (0–100).

Set `sill: 0` for floor-level glass. Optional `openingHeight` is the glass
height in the same plan units as `wallHeight`, capped at the wall top.
For a centimetre-scale plan, 200 means two metres.

```yaml
# Three stacked panes, only the middle one opens.
type: window
sill: 0
openingHeight: 200
entity: binary_sensor.living_window
panes:
  - motion: fixed
  - motion: awning
  - motion: fixed
```

```yaml
# American single-hung window; add slide-down to the top for double-hung.
panes:
  - motion: slide-up
    entity: cover.lower_sash
  - motion: fixed
```

The 3D view draws each pane separately. The plan view shows the most-open
moving sash; vertical movement is visible in 3D. Existing windows without
`panes` retain their previous rendering. Pane count and individual settings
are available under Shape in the editor. Tap actions remain on the window;
separate pane controls can be added as device badges.

## Frame color

Set `frameColor` on a window or door to color its 3D frame and glazing bars, for example `frameColor: "#805020"`. The editor exposes **Frame and glazing bars** under Color. Clearing it restores the light default. Glass and solid infill keep their own state colors.
