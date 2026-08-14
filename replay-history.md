Overview
Goal

Add a History Replay mode to Easy Floorplan that allows users to visually replay historical Home Assistant events on their floorplan.

Unlike the Home Assistant History page, which presents data as graphs and logs, this feature presents history spatially, allowing users to understand what happened, where it happened, and in what order.

The goal is not to build an analytics platform. The goal is to create a smooth, intuitive "time machine" for the floorplan.

User Story

As a user, I want to scrub through a timeline and replay historical device activity on my floorplan so that I can visually understand what happened in my home over time.

Design Philosophy

There is one principle that should drive the implementation:

History Replay should reuse the existing rendering system as much as possible.

The current renderer already knows how to display:

lights
doors
windows
locks
sensors
colors
animations
icons

Replay mode should simply provide historical state instead of live state.

If rendering logic needs to know whether it is in replay mode, the architecture is probably wrong.

Non Goals

The initial implementation should NOT include:

Heat maps
Analytics
Camera synchronization
Motion trails
Event filtering
Multi-floor synchronization
Exporting videos
AI summaries

These can be layered on later.

High-Level Architecture

Current architecture:

Home Assistant
      │
      ▼
Entity Renderer
      │
      ▼
SVG Floorplan

Proposed architecture:

                 Home Assistant
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
 Live State Provider        History Provider
        │                           │
        └─────────────┬─────────────┘
                      │
              State Provider Interface
                      │
                      ▼
               Existing Renderer
                      │
                      ▼
                SVG Floorplan

The renderer never knows where state came from.

Major Components

The implementation should introduce five new components.

1. State Provider

This becomes the abstraction between Home Assistant and rendering.

Interface:

interface StateProvider {
    getEntityState(entityId: string): HassEntity | undefined;
}

Implementations:

LiveStateProvider
HistoryStateProvider

The renderer requests entity state from the provider instead of directly accessing:

hass.states[entityId]

This is the single most important architectural decision.

2. Playback Controller

Responsible for all replay logic.

Responsibilities:

play
pause
seek
playback speed
rewind
fast forward
current timestamp

Suggested API

class PlaybackController {

    currentTime: number;

    speed: number;

    playing: boolean;

    play()

    pause()

    seek(timestamp)

    rewind(seconds)

    fastForward(seconds)

    setPlaybackSpeed(speed)

}

The playback controller should know nothing about SVG rendering.

It only manages time.

3. History Service

Responsible for loading Home Assistant history.

Responsibilities

request history
cache history
normalize events
expose historical state

Suggested API

loadHistory(start, end)

getStateAt(timestamp)

getEvents()
4. Timeline Component

Responsible only for UI.

Responsibilities

display timeline
display event markers
display playhead
emit seek events

The Timeline should never know how entity rendering works.

5. Replay Toolbar

Contains

<<
<
Play/Pause
>
>>
Speed selector

The toolbar communicates exclusively with PlaybackController.

Data Model
Raw Home Assistant History

HA history is event based.

Example:

12:01

Kitchen Light
off → on

12:03

Front Door

closed → open

12:05

Motion

off → on

There are no snapshots.

Internal Event Model

Normalize everything.

interface HistoryEvent {

    timestamp: number;

    entityId: string;

    oldState: string;

    newState: string;

    attributes: object;

}

The renderer should never consume raw HA responses.

Historical State

The History Service should reconstruct complete entity state.

HistoricalState

{

light.kitchen

ON

door.front

OPEN

lock.front

LOCKED

...
}

This allows rendering to remain unchanged.

Playback Algorithm

Playback should operate independently from Home Assistant updates.

requestAnimationFrame()

↓

elapsed real time

↓

multiply by playback speed

↓

advance virtual clock

↓

update historical state

↓

request renderer refresh

Example

Playback

2×

Real time

1 second

↓

History advances

2 seconds
Timeline

The timeline represents a selected time range.

Example

08:00

10:00

12:00

14:00

16:00

18:00

●

● ●

●

● ● ●

────────────▲────────────

Playhead

Dots represent events.

Spacing represents actual elapsed time.

Clusters indicate periods of activity.

Timeline Interaction

Supported interactions

Click

Jump to timestamp

Drag

Scrub continuously

Hover

Tooltip

Time

Entity

New state
Playback Controls

Minimum controls

<<

Jump back 30 sec

<

Step backward one event

Play / Pause

>

Step forward one event

>>

Jump forward 30 sec

Playback Speed

0.25×

0.5×

1×

2×

4×

8×

Event Markers

Each state change becomes one marker.

Example

09:12

Front Door

Opened

●

09:13

Hall Motion

Detected

●

09:16

Kitchen Light

On

●

Tooltip example

09:13:42

binary_sensor.hall_motion

off → on
Rendering Strategy

Current renderer likely performs

entity.state

Replace with

provider.getEntityState(entityId)

Nothing else should change.

Lights should still animate.

Doors should still animate.

Everything continues to function exactly as today.

History Loading

MVP

Load history only for selected range.

Example

Last Hour

↓

Fetch

↓

Replay

Avoid downloading several days unnecessarily.

Caching

Recommended

Map

Time Range

↓

History Cache

Example

Today

↓

Already Loaded

↓

Reuse

Avoid repeated API calls during scrubbing.

State Reconstruction

History consists of events.

The replay engine must reconstruct full state.

Example

History

12:00

Kitchen

OFF

12:02

Kitchen

ON

12:05

Bedroom

ON

Seeking to

12:04

Should produce

Kitchen

ON

Bedroom

OFF

This reconstruction belongs exclusively inside the History Service.

Performance Considerations

Never recompute history from the beginning on every frame.

Instead

Seek

↓

Binary search nearest event

↓

Apply only remaining events

or maintain incremental state during playback.

History reconstruction should be approximately

O(log n)

for seek operations.

Renderer Independence

The renderer should never ask

if (historyMode)

Instead

stateProvider.getState(...)

This allows:

Future offline playback

Recorded sessions

Simulation

Testing

without renderer changes.

Error Handling

If history cannot be loaded

Display

Unable to load history.

If an entity has no history

Render latest known state.

If recorder is disabled

Inform the user that Home Assistant history is unavailable.

Testing

Unit tests

PlaybackController

Play
Pause
Seek
Speed
Rewind
Fast Forward

HistoryService

Event normalization
State reconstruction
Cache reuse

Timeline

Marker positioning
Scrubbing
Hover

Integration

Replay a known event sequence.

Verify rendered states.

Future Extensions

The architecture should naturally support future additions without major refactoring.

Potential future features include:

Event filtering (specific entities, domains, or areas)
Heatmaps showing activity density
Motion and presence trails
Camera snapshot synchronization
Bookmarks and annotations
Incident mode (jump between significant events)
Side-by-side comparisons of different days
Exporting replay animations

These features should be built on top of the same HistoryService, PlaybackController, and StateProvider abstractions.

Implementation Roadmap
Phase 1 — Core Infrastructure
Introduce the StateProvider abstraction.
Refactor the renderer to consume state through the provider.
Ensure existing functionality remains unchanged using LiveStateProvider.
Phase 2 — History Backend
Implement HistoryService.
Fetch and normalize Home Assistant history.
Reconstruct historical entity states.
Add in-memory caching for loaded time ranges.
Phase 3 — Playback Engine
Implement PlaybackController.
Support play, pause, seek, playback speed, fast-forward, and rewind.
Trigger renderer updates using historical state.
Phase 4 — Timeline UI
Build the timeline component.
Display event markers and the playhead.
Support click, drag, and hover interactions.
Phase 5 — Playback Controls
Add toolbar controls for playback.
Add playback speed selector.
Handle end-of-range behavior cleanly.
Phase 6 — Polish
Optimize seek performance.
Add loading and error states.
Improve tooltip formatting.
Add comprehensive unit and integration tests.
Key Architectural Decisions
Decision	Rationale
Introduce a StateProvider abstraction	Keeps the renderer agnostic to live vs. historical state and minimizes code changes.
Normalize Home Assistant history into an internal event model	Shields the rest of the application from API-specific formats and simplifies future enhancements.
Reconstruct complete historical state before rendering	Allows reuse of the existing rendering pipeline without replay-specific logic.
Keep playback logic in a dedicated PlaybackController	Separates time management from rendering and UI concerns, improving maintainability and testability.
Build the timeline as an independent UI component	Encourages reuse and keeps UI concerns isolated from history processing.
Cache loaded history in memory	Eliminates redundant API requests and enables smooth scrubbing.
Load only the requested time range	Reduces memory usage and improves responsiveness for large Home Assistant installations.
Design for future extensibility	Enables advanced replay features later without requiring architectural changes.

This architecture keeps replay as a new layer on top of the existing floorplan system rather than weaving replay-specific logic throughout the codebase, resulting in a cleaner implementation, lower maintenance burden, and significantly lower risk of regressions.