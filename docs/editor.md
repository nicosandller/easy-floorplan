# Editing a floorplan

Back to the [README](../README.md). Start with [your first plan](../README.md#create-your-first-plan),
then use the [element guide](elements.md) for individual controls. The
[editor workspace guide](editor-workspace.md) shows the tools, inspector and phone layouts.

The visual editor lets you draw walls, place openings, move elements, nudge them with
the arrow keys, multi-select, copy/paste, undo/redo and zoom. Each floor holds its own
elements. You can also use a [background image](configuration.md#floor) as a tracing guide.

## Applying changes

**Apply** saves the plan to the dashboard without closing the editor, so you can judge
a change on the real card in a second tab or by collapsing the editor, then keep editing.
It needs Home Assistant 2025.3 or newer; on older versions the button explains this and
**Save** still works. Use **Save** when you are ready to close the card editor.

## Plan check

The editor checks the active floor's walls as you work and flags two mistakes that
the plan itself hides, usually left by YAML written by hand or by a tool:

- **A wall end that stops just short of another wall.** If the gap is within the two
  walls' drawn thickness (at least 8 units), the strokes overlap and the walls look
  joined, but nothing connects them, so dead spaces and room light see a slot.
  **Join** moves the end onto the other wall.
- **A wall drawn on top of another.** **Remove duplicate** deletes a wall that lies
  wholly on another one; **Trim overlap** shortens a wall that overlaps another part
  of the way, so the two just meet.

Each finding gets an orange ring on the canvas and a notice above the context bar;
with several, the arrows step through them. A fix is one edit, so **Undo** reverts
it. Corners, T-junctions and gaps wider than the tolerance, such as doorways, are
never flagged, and a plan with nothing to flag shows no notice. The check only reads
`walls:` (not walls generated from rooms), changes nothing by itself, and does not
affect the card.

## Locking elements in place

Select anything and press the padlock in the **Selection** inspector's header. It applies to every kind
of element — walls, doors and windows, devices, text, furniture, trackers and rooms — and
to a whole multi-selection at once.

A locked element:

- **still selects, still edits, still deletes.** Everything works except *moving* it.
- **never moves.** Not by dragging, not by its endpoint or vertex handles (which stop
  being drawn, so nothing on it pretends to be draggable), and not by arrow keys — alone
  or as part of a group. Drag a group by an unlocked member and the locked ones stay put
  while the rest travel.
- **yields the click.** Anything unlocked under the pointer is picked first, whatever kind
  it is. Lock the wall and a window drawn on it selects on the first click instead of
  after cycling past the wall.

Both halves are the point. Yielding alone would still let a stray drag move the wall;
pinning alone would still cost a click to get past it. Together they answer the thing
that prompted this: *"every time I want to move a window, I end up moving a wall
instead"*.

Locked elements stay selectable on purpose — a design tool hides them behind a layers
panel to unlock from, and this editor has none, so an element you could not click would
be one you could never unlock. Pasted copies are never locked: a duplicate lands offset
and the first thing you do is position it.

Nothing about the rendered card reads this — it is an editing aid, and `locked: true` in
the YAML changes nothing a viewer sees.
