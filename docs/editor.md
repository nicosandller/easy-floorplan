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

## Tracing over an existing plan

Open **Project → Plan → Trace template** and choose **Load PDF or image…**.
A PDF (with a page picker), PNG, JPG or SVG is laid under the canvas. Each floor
has its own template. It is editor-only: the template is not saved to YAML and
is not displayed by the dashboard card.

Use **Set by 2 points** to click the ends of a known length and enter its size in
canvas units (an ordinary door is 60, a wall is 8, a grid square is 20).
Then draw walls over the template. **Move**, position, rotation, width and opacity
adjust the placement. **Replace** loads another drawing; **Remove** drops it.
Escape or selecting a drawing tool ends moving or calibration.

**Floor under** displays another floor as a faint reference so you can align
storeys. Reference corners also participate in snapping when editing existing
wall ends and area vertices.

PDFs use pinned pdf.js 4.10.38, fetched on first use from jsDelivr. Both the reader
and its worker are checked against fixed SHA-384 hashes before execution; the
browser rejects changed files. Only verified source is imported from a blob URL,
and PDF font evaluation is disabled. This retains the single JS file installed
by HACS. PDF loading requires access to the CDN and permission for blob modules
and workers; without that, export the plan as PNG/JPG and load the image instead.
PDF files themselves stay in the browser and are not sent to the CDN.

### Remembered wall thickness

The Wall tool's **Thickness** stays in effect for every new wall until you change
it again. Setting thickness on a selected wall also updates this preference.
It is remembered in this browser across plans and dashboards. Clearing the input
keeps the previous thickness. Existing walls are not all changed together.

### Follow-up limitations

Templates remain in memory while their editor instance exists. Deleting a floor
releases its template and reference entries, but cleanup on a real editor close
is deferred because Home Assistant can temporarily reparent the editor.
Reference-wall style parity, applying the remembered thickness to automatic
room-outline walls, the image-size fallback and caching parsed PDFs between page
changes remain separate follow-ups.
