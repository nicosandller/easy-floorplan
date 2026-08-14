# History Replay implementation notes

## Overview

This workspace now includes an initial History Replay implementation for Easy Floorplan.

### What ships

- A state-provider abstraction so the renderer can consume either live HA state or replay state.
- A playback controller for play/pause, seek, rewind, fast-forward and speed control.
- A lightweight history service that loads Home Assistant history events, normalizes them, and reconstructs entity state at a given timestamp.
- A timeline component that renders simple event markers and exposes seek interactions.
- A replay toolbar embedded in the card UI when history replay is enabled in config.

### Configuration

Enable replay mode with:

```yaml
historyReplay:
  enabled: true
  lookbackSeconds: 3600
  defaultSpeed: 1
```

### Notes

The initial implementation is intentionally focused on the core architecture described in the design brief:

- renderer stays agnostic to whether state is live or historical
- history is normalized into an internal event model
- playback is isolated from rendering concerns
- replay is layered on top of the existing floorplan rendering pipeline

Future iterations can expand this by adding richer timeline interactions, better caching, improved error states and more advanced replay features.
