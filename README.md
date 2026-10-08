# Easy Floorplan

[![hacs][hacs-badge]][hacs-url]
[![release][release-badge]][release-url]
[![license][license-badge]](LICENSE)

A Home Assistant Lovelace card for building an interactive floorplan with a visual
drag-and-drop editor. Draw walls, place furniture and connect your devices to see
and control your home in 2D or 3D.

[Installation](#installation) · [Your first plan](#create-your-first-plan) · [Documentation](#documentation)

<a name="what-you-can-end-up-with"></a>

https://github.com/user-attachments/assets/8a156cb4-92c2-477a-9b7e-63de15f9b470

20-second overview: draw walls and doors, connect a Home Assistant entity,
control lights, and view the plan in 3D.

## Features

- **Visual editing** — draw walls, snap doors and windows into place, and arrange
  furniture, text and devices with undo/redo, copy/paste and position locking.
- **Live devices** — control lights and switches, show sensor readings, and follow
  doors, windows and shutters as they open and close.
- **Lighting** — colored light from your lamps, day/night dimming, sunlight,
  moonlight and ambient daylight.
- **Rooms and presence** — zoom into rooms, link Home Assistant areas, show
  presence ripples and track positions from distance sensors.
- **Multiple floors** — switch between floors or navigate with a staircase.
- **2D and 3D views** — display the same plan flat or with raised walls and furniture.
- **Appearance** — choose skins and named colors, add a background image to trace,
  and let the plan scale to your screen.

## Installation

### HACS (recommended)

Distributed as a **custom repository**. Add it in one click:

[![Open Easy Floorplan in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=nicosandller&repository=easy-floorplan&category=frontend)

Or add it manually:

1. In Home Assistant, open **HACS**.
2. Open **⋮ → Custom repositories**.
3. Add `https://github.com/nicosandller/easy-floorplan` with category
   **Dashboard** (also called Plugin).
4. Find **Easy Floorplan** and click **Download**.
5. Hard-refresh your browser (Cmd/Ctrl-Shift-R).

HACS adds the dashboard resource automatically.

### Manual

1. Download `easy-floorplan-card.js` from the [latest release][release-url].
2. Copy it to `<config>/www/easy-floorplan-card.js`.
3. Add a dashboard resource under **Settings → Dashboards → ⋮ → Resources → Add**:
   - URL: `/local/easy-floorplan-card.js`
   - Type: **JavaScript module**
4. Hard-refresh your browser.

## Create your first plan

1. Edit your Home Assistant dashboard, select **Add card** and choose **Easy Floorplan**.
2. In the visual editor, choose **Wall** and drag to draw each wall.
3. Choose **Door** or **Window** and place it on a wall.
4. Choose **+ Add → Device**, move it into place, then select its Home Assistant
   entity in the **Element** section below the canvas.
5. **Save** the card and leave dashboard edit mode to try the controls.

The visual editor writes the configuration for you. To start through a **Manual**
card instead, paste this YAML and switch to the visual editor:

```yaml
type: custom:easy-floorplan-card
overlayScale: plan
```

Use the [element guide](docs/elements.md) for device settings, rooms, trackers and
animations. The [editor guide](docs/editor.md) explains saving without closing the
editor and locking finished elements in place.

## Documentation

<!-- Preserve section links from older README versions. Each anchor lands beside
     the guide containing the moved material. Link directly to docs/ in new text. -->
<a name="feature-guides"></a>

| Guide | What it covers |
| --- | --- |
| <a name="locking-elements-in-place"></a>[Editor](docs/editor.md) | Applying changes and locking elements in place. |
| <a name="elements"></a><a name="devices"></a><a name="animations"></a><a name="press-feedback"></a><a name="doors-windows-skylights--passages"></a><a name="areas"></a><a name="live-position-trackers"></a><a name="presence-ripples"></a><a name="fans"></a>[Elements and controls](docs/elements.md) | Devices, openings, rooms, trackers and animations, with examples. |
| <a name="configuration-reference"></a><a name="more-readings-per-device"></a>[Configuration](docs/configuration.md) | YAML keys, defaults, coordinates and a complete example. |
| <a name="follow-the-sun"></a><a name="sunlight"></a>[Lighting](docs/lighting.md) | Device light, sun, moon, skylights, ambient daylight and clouds. |
| <a name="skins"></a><a name="overlay-scale"></a><a name="compact-header"></a><a name="rotation-that-follows-the-screen"></a><a name="styling-hooks-card-mod"></a>[Appearance](docs/appearance.md) | Skins, colors, 3D view, room navigation, scaling and styling. |
| <a name="dead-spaces"></a><a name="doors-on-locks"></a><a name="actions-on-rooms"></a><a name="stairs-that-change-floor"></a><a name="offline-devices"></a><a name="advanced-hiding-logic"></a>[Behaviour](docs/behavior.md) | Actions, visibility, floor navigation and unavailable entities. |
| [Furniture symbols](furniture/README.md) | Creating and contributing your own symbols. |
| [Video walkthrough](https://youtu.be/M-b7xK-4Bpw) | A community setup guide in Italian. |

See the [release notes][release-url] for published changes and the
[changelog](CHANGELOG.md) for documented unreleased changes.

## Development

Build commands and test guidance are in [Contributing](CONTRIBUTING.md).
The [local Home Assistant guide](docker/README.md) explains the Docker demo,
its sample plan and the development workflow.

## Support

Use [Issues](https://github.com/nicosandller/easy-floorplan/issues) to report bugs
or request features, and [Discussions](https://github.com/nicosandller/easy-floorplan/discussions)
to ask questions and share your setup.

<a href="https://www.buymeacoffee.com/nicosandller" target="_blank">
  <img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="height: 60px !important; width: 217px !important;" >
</a>

## License

[MIT](LICENSE)

[hacs-badge]: https://img.shields.io/badge/HACS-Custom-41BDF5.svg
[hacs-url]: https://github.com/hacs/integration
[release-badge]: https://img.shields.io/github/v/release/nicosandller/easy-floorplan
[release-url]: https://github.com/nicosandller/easy-floorplan/releases
[license-badge]: https://img.shields.io/github/license/nicosandller/easy-floorplan
