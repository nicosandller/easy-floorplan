# Issue #353: floor button appearance

Screenshots from the built card running in an isolated Home Assistant 2026.9.2
instance. The [three-floor fixture](../../docker/fixtures/issue-353.json) contains
only demonstration geometry and names. No live household data is used.

- [Classic and dashboard buttons](comparison.jpg): the same ground floor and
  anchor, with the existing classic column on the left and `style: buttons`,
  `layout: horizontal` on the right. Both are rendered by this branch.
- [Phone layout](phone.jpg): a 390 × 844 CSS-pixel viewport. The editor-saved
  position is `{x: 200, y: 250}`; all three buttons are 44px high and fit inside
  the plan. This is browser viewport testing, not physical phone testing.
- [Custom CSS](custom-phone.jpg): the same phone viewport with the
  [documented card-mod variables](../../docs/appearance.md#floor-button-appearance),
  verified with card-mod 4.2.1. Selecting First floor also applies the documented
  per-floor gradient selector.
- [Visual editor](editor.jpg): Style, Layout, coordinates, and the live preview
  in Home Assistant's native card configuration dialog.

To reproduce, load the fixture as an Easy Floorplan card in the
[development Home Assistant](../../docker/README.md). Duplicate it and set
`floorSwitcher.style: buttons` and `floorSwitcher.layout: horizontal` on the copy.
For the custom appearance, apply the card-mod example from the appearance guide.

Native checks: change Classic/Dashboard buttons and Vertical/Horizontal, reset
the position, confirm the appearance is retained, enter coordinates, Save, reload
Home Assistant, and reopen the editor. The saved style, layout and coordinates
survive. Enter on the First floor button changes the rooms to Bedroom/Bathroom.

Automated checks also cover eight-floor wrapping at 320px, explicit layout versus
compact headers, placed/rotated switchers, inherited CSS variables, CSS parts,
per-floor overrides, accessibility state, and preserving appearance through
coordinate edits, drag and undo.
