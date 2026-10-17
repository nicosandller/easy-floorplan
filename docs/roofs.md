# Roofs

Roofs are dedicated first-class elements on each floor (`floor.roofs?: Roof[]`) representing architectural roof boundaries and geometries over buildings, porches, gazebos, or sheds.

```yaml
floors:
  - id: 2nd
    walls: [...]
    areas: [...]
    roofs:
      - id: house_roof
        type: gable            # flat | gable | hip | shed
        points:
          - { 'x': 100, 'y': 120 }
          - { 'x': 700, 'y': 120 }
          - { 'x': 700, 'y': 420 }
          - { 'x': 100, 'y': 420 }
        height: 60             # ridge height above eaves
        overhang: 10           # optional eaves overhang
        color: "#8d6e63"       # optional color
      - id: shed_roof
        type: shed
        points: [...]
        highSide: top          # top | right | bottom | left (shed only)
```

---

## Drawing and Editing Roofs

Use the **Roof** drawing tool from the editor toolbar or drawing tool picker.

### 1. Drawing Modes
- **Drag-Rectangle**: Press and hold on the canvas for >200ms, then drag to draw a rectangular roof in one gesture.
- **Click-Polygon**: Click each vertex in sequence. Points snap to nearby wall endpoints and room corners. After placing 3 or more points, click the first point to close the outline (**Backspace** drops the last placed point, **Escape** cancels).
- **Create Roof from Room**: When any area (room) is selected, click **Create Roof from Room** in the inspector to instantly generate a matching roof polygon over that room.

### 2. Moving and Resizing
- **Move**: Click and drag inside the roof's fill area to move the entire roof.
- **Reshape**: Click and drag any corner vertex handle to move individual points.
- **Delete**: Click the trash icon in the inspector or press **Delete** / **Backspace** when selected.
- **Lock in Place**: Toggle **Lock** in the inspector to prevent accidental dragging. A locked roof can still be selected and edited in the inspector.

### 3. Bidirectional Inspector Navigation
- When a roof is selected, the inspector displays clickable **Elements under roof** chips for all rooms directly below it. Clicking a chip immediately navigates to and selects that room.
- When an area (room) is selected, the inspector displays clickable **Roofs above** chips for roofs spanning over it.

---

## Roof Types and Options

| Type | Description | Key Settings |
| --- | --- | --- |
| `gable` | Pitched roof with two sloping planes meeting at a central ridge and triangular gable end walls. | `ridge` (`horizontal` \| `vertical`), `height`, `overhang` |
| `hip` | Sloped roof where all four sides slope downward to the eaves. | `ridge` (`horizontal` \| `vertical`), `height`, `overhang` |
| `shed` | Mono-pitch single sloping roof plane. | `highSide` (`top` \| `bottom` \| `left` \| `right`), `height`, `overhang` |
| `flat` | Flat horizontal slab with extruded thickness. | `height` (slab thickness, defaults to 8) |

### Settings & Field Details

- **Type (`type`)**: `gable`, `hip`, `shed`, or `flat`. Pitched roofs (`gable`, `hip`, `shed`) project sloped planes across their footprint bounding box. Complex footprints (such as L-shaped, T-shaped, or cross plans) should be composed by drawing multiple rectangular roofs that intersect, allowing cross-gable valleys and distinct ridges to generate cleanly.
- **Height (`height`)**:
  - For pitched roofs (`gable`, `hip`, `shed`), this is the ridge height above the eaves in canvas units. Defaults to `round(wallHeight * 0.6)`.
  - For `flat` roofs, this is the thickness of the flat slab. Defaults to `8`.
- **Overhang (`overhang`)**: Extends the roof perimeter outward past its base footprint evenly on all sides. Defaults to `0`.
- **Ridge orientation (`ridge`)**: Gable and hip roofs automatically align their ridge parallel to the longer dimension. Set `ridge: horizontal` or `vertical` to explicitly choose the ridge direction (useful for square roofs).
- **High side (`highSide`)**: For shed roofs, chooses which edge sits at peak elevation:
  - `top`: High side at canvas min-Y (top edge), sloping down toward bottom.
  - `bottom`: High side at canvas max-Y (bottom edge), sloping down toward top.
  - `left`: High side at canvas min-X (left edge), sloping down toward right.
  - `right`: High side at canvas max-X (right edge), sloping down toward left.
- **Elevation (`elevation`)**: Optional base elevation override (`elevation?: number`). By default, roofs rest directly on top of their floor's walls (`z0 = floorBaseZ + wallHeight`) without requiring an explicit elevation field in the editor.
- **Color (`color`)**: Custom roof surface color (hex or named color). Defaults to `#8d6e63`.

---

## 3D Isometric Rendering

Roof geometries support complete 3D solid calculation (including gable, hip, shed, and flat roof profiles, ridge calculations, eaves overhang, directional shading, and cross-gable valley intersections). In 3D isometric view (`view: 3d` / `projection: iso`), roofs are rendered above their floors when viewing an outdoor floor (`isOutdoor: true`) or dedicated 3D building stack:

1. **Automatic Solid Generation**: Roof geometry is projected into 3D isometric solids with directional sun shading and horizontal tile course lines along sloped planes.
2. **Cross-Gable Valley Intersection**: When multiple gable roofs intersect on the same floor (such as T-shaped or L-shaped house layouts), the geometry automatically calculates valley lines and trims intersecting faces cleanly.
3. **Room Focus & Interior Peeking**:
   - Tapping a roof in 3D view zooms and focuses the room underneath (via `areaContainingPoint`).
   - When a room is zoomed into, the roof solid covering that room is automatically hidden so the interior layout, furniture, and devices are fully visible. Tapping again zooms back out and restores the roof.
4. **Integration with Multi-Floor Stacking**: See [`outdoor-3d-stacking.md`](outdoor-3d-stacking.md) for multi-level building stacking, courtyard layers, and ambient daylight shadows.
