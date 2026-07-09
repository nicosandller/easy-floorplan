/**
 * Local dev harness — mounts the real editor + live card side by side with a
 * sample config and a minimal mock `hass`, so you can iterate on rendering
 * (walls, openings, background image, furniture…) in a normal browser with
 * Vite hot-reload. No Home Assistant and no service-worker caching.
 *
 * Run with: `npm run serve` (opens /dev/ on the Vite dev server).
 *
 * A few HA-provided custom elements are stubbed below: <ha-card>, <ha-icon> and
 * <ha-entity-picker>. The icon picker already falls back to a plain input in the
 * editor when unregistered, but the entity picker does not, so we stub it here
 * so Sensor / entity fields are usable outside HA.
 */
import type { FloorplanCardConfig, Tracker, TrackerSensor } from "../src/types";

// ---- minimal HA element stubs ---------------------------------------------
if (!customElements.get("ha-card")) {
  class HaCardStub extends HTMLElement {
    private _header?: string;
    set header(v: string | undefined) {
      this._header = v;
      this._render();
    }
    connectedCallback() {
      this._render();
    }
    private _render() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.shadowRoot!.innerHTML = `
        <style>
          :host { display:block; border:1px solid #e0e0e0; border-radius:8px;
                  overflow:hidden; background:var(--card-background-color,#fff); }
          h3 { margin:0; padding:8px 12px; font:600 14px system-ui; border-bottom:1px solid #eee; }
        </style>
        ${this._header ? `<h3>${this._header}</h3>` : ""}
        <slot></slot>`;
    }
  }
  customElements.define("ha-card", HaCardStub);
}

if (!customElements.get("ha-icon")) {
  // Render the mdi name as a tiny placeholder dot+label so icons are visible
  // without pulling in the real mdi icon set.
  class HaIconStub extends HTMLElement {
    static observedAttributes = ["icon"];
    private _icon = "";
    set icon(v: string) {
      this._icon = v;
      this._render();
    }
    attributeChangedCallback(_n: string, _o: string, v: string) {
      this._icon = v;
      this._render();
    }
    connectedCallback() {
      this._render();
    }
    private _render() {
      if (!this.shadowRoot) this.attachShadow({ mode: "open" });
      this.shadowRoot!.innerHTML = `
        <style>:host{display:inline-flex;align-items:center;justify-content:center;
          width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px);}
          i{display:block;width:62%;height:62%;border-radius:50%;
            background:currentColor;opacity:0.85;}</style>
        <i title="${this._icon}"></i>`;
    }
  }
  customElements.define("ha-icon", HaIconStub);
}

if (!customElements.get("ha-entity-picker")) {
  // The editor normally pulls <ha-entity-picker> in via loadCardHelpers(), which
  // only exists inside HA. Outside HA that load no-ops and the picker renders as
  // an empty unknown element (no way to bind a Sensor). Stub it with a plain text
  // input that emits the same `value-changed` event the editor listens for.
  class HaEntityPickerStub extends HTMLElement {
    private _value = "";
    private _input?: HTMLInputElement;
    set value(v: string) {
      this._value = v ?? "";
      if (this._input) this._input.value = this._value;
    }
    get value(): string {
      return this._value;
    }
    connectedCallback() {
      if (this._input) return;
      const input = document.createElement("input");
      input.type = "text";
      input.placeholder = "entity id (dev stub)";
      input.value = this._value;
      input.style.width = "100%";
      input.addEventListener("change", () => {
        this._value = input.value;
        this.dispatchEvent(
          new CustomEvent("value-changed", {
            detail: { value: input.value },
            bubbles: true,
            composed: true,
          }),
        );
      });
      this._input = input;
      this.appendChild(input);
    }
  }
  customElements.define("ha-entity-picker", HaEntityPickerStub);
}

// ---- register the real card + editor --------------------------------------
import "../src/index";

// ---- a minimal mock hass ---------------------------------------------------
const hass = {
  states: {
    "binary_sensor.front_door": { state: "off", attributes: { friendly_name: "Front Door" } },
    "light.living_room": { state: "on", attributes: { friendly_name: "Living Room" } },
  },
  locale: { language: "en" },
  themes: { darkMode: false },
  callService: (...args: unknown[]) => console.log("[mock hass] callService", ...args),
  formatEntityState: (s: { state: string }) => s.state,
  localize: (k: string) => k,
} as unknown;

// ---- a sample floorplan (one floor, with a bg image, a door + a window) ----
// Diagonal-gradient SVG data URI so you can clearly see the image showing
// through door/window gaps in the walls.
const bgImage =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='1000' height='600'>
       <defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'>
         <stop offset='0' stop-color='#ffd54f'/><stop offset='1' stop-color='#4fc3f7'/>
       </linearGradient></defs>
       <rect width='1000' height='600' fill='url(#g)'/>
       <g stroke='#000' stroke-opacity='0.18'>
         ${Array.from({ length: 11 }, (_, i) => `<line x1='${i * 100}' y1='0' x2='${i * 100}' y2='600'/>`).join("")}
         ${Array.from({ length: 7 }, (_, i) => `<line x1='0' y1='${i * 100}' x2='1000' y2='${i * 100}'/>`).join("")}
       </g>
     </svg>`
  );

// Start with a blank floor so you can draw a perimeter from scratch. Flip
// START_WITH_DEMO to true to instead load a sample room (walls + door + window
// over the background image) — handy for testing rendering of existing plans.
const START_WITH_DEMO = false;

const demoFloor = {
  id: "f1",
  name: "Floor 1",
  image: bgImage,
  imageOpacity: 1,
  walls: [
    { id: "w1", x1: 100, y1: 100, x2: 900, y2: 100 },
    { id: "w2", x1: 900, y1: 100, x2: 900, y2: 500 },
    { id: "w3", x1: 900, y1: 500, x2: 100, y2: 500 },
    { id: "w4", x1: 100, y1: 500, x2: 100, y2: 100 },
  ],
  openings: [
    { id: "o1", type: "window" as const, x: 500, y: 100, length: 140, angle: 0 },
    { id: "o2", type: "door" as const, x: 500, y: 500, length: 90, angle: 0 },
  ],
  items: [],
  texts: [],
  furniture: [],
  trackers: [],
};

const emptyFloor = {
  id: "f1",
  name: "Floor 1",
  walls: [],
  openings: [],
  items: [],
  texts: [],
  furniture: [],
  trackers: [],
};

const config: FloorplanCardConfig = {
  type: "easy-floorplan-card",
  title: "Dev floorplan",
  width: 1000,
  height: 600,
  grid: 20,
  snap: 0,
  background: "#ffffff",
  walls: [],
  openings: [],
  items: [],
  texts: [],
  furniture: [],
  defaultFloor: "f1",
  floors: [START_WITH_DEMO ? demoFloor : emptyFloor],
};

// ---- mount -----------------------------------------------------------------
const editor = document.createElement("easy-floorplan-card-editor") as HTMLElement & {
  hass: unknown;
  setConfig: (c: FloorplanCardConfig) => void;
};
const card = document.createElement("easy-floorplan-card") as HTMLElement & {
  hass: unknown;
  setConfig: (c: FloorplanCardConfig) => void;
};

editor.hass = hass;
card.hass = hass;
editor.setConfig(config);
card.setConfig(config);

// Editing in the editor fires `config-changed`; mirror HA by feeding the new
// config back into both the editor (round-trip) and the live preview.
editor.addEventListener("config-changed", (e: Event) => {
  const next = (e as CustomEvent).detail.config as FloorplanCardConfig;
  card.setConfig(next);
  editor.setConfig(next);
  refreshTrackerEmu(next);
  refreshOpeningEmu(next);
});

// ---- tracker emulator -------------------------------------------------------
// Mock distance sensors so the Tracker animations can be exercised without HA.
// For every tracker found in the config we expose a slider per configured
// sensor (X / Y); an Auto-orbit toggle drives both sliders with a slow
// Lissajous curve via rAF so the pulsating triangle / line continually moves.
//
// Sensor values are written into `hass.states[entity].state` and `hass` is
// reassigned to a fresh object so Lit's @property hass triggers a re-render.

type MockStates = Record<string, { state: string; attributes?: Record<string, unknown> }>;
const baseStates = hass.states as MockStates;

function setHassState(entity: string, value: number) {
  baseStates[entity] = { state: String(value) };
  // Re-assign hass with a *new* states object reference so Lit picks up the
  // change (Lit treats hass as opaque and re-renders on identity change).
  const nextHass = { ...hass, states: { ...baseStates } };
  card.hass = nextHass;
  editor.hass = nextHass;
}

/** Set a binary entity to "on"/"off" so presence-gating can be toggled in the emulator. */
function setHassBinary(entity: string, on: boolean) {
  baseStates[entity] = { state: on ? "on" : "off" };
  const nextHass = { ...hass, states: { ...baseStates } };
  card.hass = nextHass;
  editor.hass = nextHass;
}

/**
 * Drive an opening's bound entity so the door/window/slider animates open and
 * closed. Uses `cover` open/closed states for cover entities and on/off for
 * everything else (contact `binary_sensor`, `input_boolean`, …) — the card
 * treats `on`/`open` as open either way.
 */
function setOpeningState(entity: string, open: boolean) {
  const domain = entity.split(".")[0];
  const state = domain === "cover" ? (open ? "open" : "closed") : open ? "on" : "off";
  baseStates[entity] = { state };
  const nextHass = { ...hass, states: { ...baseStates } };
  card.hass = nextHass;
  editor.hass = nextHass;
}

/** Drive a cover's `current_position` (0–100) so partial-open renders in realtime. */
function setCoverPosition(entity: string, pos: number) {
  baseStates[entity] = {
    state: pos > 0 ? "open" : "closed",
    attributes: { current_position: pos },
  };
  const nextHass = { ...hass, states: { ...baseStates } };
  card.hass = nextHass;
  editor.hass = nextHass;
}

/**
 * Opening emulator: one open/closed toggle per entity-bound opening in the
 * config, so the swing/slide animation can be exercised without Home Assistant.
 * (The card only animates openings that carry a `Sensor` entity — bind one in
 * the editor and its toggle appears here.)
 */
function refreshOpeningEmu(cfg: FloorplanCardConfig) {
  const host = document.getElementById("opening-emu")!;
  const pane = document.getElementById("opening-emu-pane")!;
  const openings = (cfg.floors ?? []).flatMap((f) => f.openings ?? []).filter((o) => o.entity);
  if (!openings.length) {
    pane.style.display = "none";
    host.replaceChildren();
    return;
  }
  pane.style.display = "block";

  const frag = document.createDocumentFragment();
  const seen = new Set<string>();
  for (const o of openings) {
    const entity = o.entity!;
    if (seen.has(entity)) continue; // one control per entity, even if reused
    seen.add(entity);

    const row = document.createElement("div");
    row.className = "op-row";
    const label = document.createElement("span");
    label.className = "ent";
    label.textContent = `${o.type}: ${entity}`;
    row.appendChild(label);

    if (entity.split(".")[0] === "cover") {
      // Position-aware cover: a 0–100 slider drives partial-open in realtime.
      const wrap = document.createElement("label");
      wrap.className = "op-toggle";
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      const curPos = baseStates[entity]?.attributes?.current_position;
      slider.value = String(typeof curPos === "number" ? curPos : 0);
      const valLbl = document.createElement("span");
      valLbl.textContent = `${slider.value}%`;
      slider.addEventListener("input", () => {
        setCoverPosition(entity, Number(slider.value));
        valLbl.textContent = `${slider.value}%`;
      });
      wrap.append(slider, valLbl);
      row.appendChild(wrap);
    } else {
      const toggleWrap = document.createElement("label");
      toggleWrap.className = "op-toggle";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      const cur = baseStates[entity]?.state;
      chk.checked = cur === "on" || cur === "open";
      const stateLbl = document.createElement("span");
      stateLbl.textContent = chk.checked ? "open" : "closed";
      chk.addEventListener("change", () => {
        setOpeningState(entity, chk.checked);
        stateLbl.textContent = chk.checked ? "open" : "closed";
      });
      toggleWrap.append(chk, stateLbl);
      row.appendChild(toggleWrap);
    }
    frag.appendChild(row);
  }
  host.replaceChildren(frag);
}

const orbitState = new Map<string, { rafId: number | null }>();

function refreshTrackerEmu(cfg: FloorplanCardConfig) {
  const host = document.getElementById("tracker-emu")!;
  const pane = document.getElementById("tracker-emu-pane")!;
  const trackers: Tracker[] = (cfg.floors ?? []).flatMap((f) => f.trackers ?? []);
  if (!trackers.length) {
    pane.style.display = "none";
    host.replaceChildren();
    // Cancel any pending orbit raf when the last tracker is removed.
    for (const [, st] of orbitState) if (st.rafId != null) cancelAnimationFrame(st.rafId);
    orbitState.clear();
    return;
  }
  pane.style.display = "block";

  const frag = document.createDocumentFragment();
  for (const tr of trackers) {
    const panel = document.createElement("div");
    panel.className = "tracker-panel";
    const xs = tr.xSensor;
    const ys = tr.ySensor;
    const head = document.createElement("header");
    head.innerHTML = `<strong>Tracker ${tr.id.slice(0, 10)}</strong>`;

    // Auto-orbit only makes sense when at least one sensor is configured.
    const orbitLabel = document.createElement("label");
    orbitLabel.className = "orbit";
    const orbitChk = document.createElement("input");
    orbitChk.type = "checkbox";
    orbitChk.disabled = !xs && !ys;
    orbitLabel.append(orbitChk, document.createTextNode("Auto-orbit"));
    head.appendChild(orbitLabel);
    panel.appendChild(head);

    panel.appendChild(buildAxisRow("X", xs));
    if (xs?.presence) panel.appendChild(buildPresenceRow("X", xs.presence.entity));
    panel.appendChild(buildAxisRow("Y", ys));
    if (ys?.presence) panel.appendChild(buildPresenceRow("Y", ys.presence.entity));
    frag.appendChild(panel);

    // Wire orbit AFTER sliders exist so we can drive them.
    const st = orbitState.get(tr.id) ?? { rafId: null as number | null };
    orbitState.set(tr.id, st);
    if (st.rafId != null) {
      cancelAnimationFrame(st.rafId);
      st.rafId = null;
    }
    orbitChk.addEventListener("change", () => {
      if (!orbitChk.checked) {
        if (st.rafId != null) cancelAnimationFrame(st.rafId);
        st.rafId = null;
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = (now - t0) / 1000;
        if (xs) {
          const v = xs.min + ((Math.sin(t * 0.9) + 1) / 2) * (xs.max - xs.min);
          setHassState(xs.entity, round2(v));
          const slider = panel.querySelector<HTMLInputElement>(`input[data-axis="X"]`);
          if (slider) slider.value = String(v);
        }
        if (ys) {
          const v = ys.min + ((Math.sin(t * 1.3 + Math.PI / 3) + 1) / 2) * (ys.max - ys.min);
          setHassState(ys.entity, round2(v));
          const slider = panel.querySelector<HTMLInputElement>(`input[data-axis="Y"]`);
          if (slider) slider.value = String(v);
        }
        st.rafId = requestAnimationFrame(tick);
      };
      st.rafId = requestAnimationFrame(tick);
    });
  }
  host.replaceChildren(frag);
}

/**
 * Per-axis presence toggle. Distance sliders and Auto-orbit keep working
 * independently — flipping the toggle off should make the marker vanish even
 * mid-orbit so you can see the gating in action.
 */
function buildPresenceRow(axis: "X" | "Y", entity: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "axis-row presence";
  // Default to detected so the marker is visible until the user toggles off.
  if (baseStates[entity]?.state !== "off") setHassBinary(entity, true);

  const ent = document.createElement("span");
  ent.className = "ent";
  ent.textContent = `${axis} presence: ${entity}`;
  const wrap = document.createElement("label");
  wrap.style.gridColumn = "2 / 4";
  wrap.style.display = "inline-flex";
  wrap.style.alignItems = "center";
  wrap.style.gap = "6px";
  wrap.style.fontSize = "12px";
  wrap.style.color = "#455a64";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = baseStates[entity]?.state !== "off";
  const lbl = document.createElement("span");
  lbl.textContent = chk.checked ? "detected" : "clear";
  chk.addEventListener("change", () => {
    setHassBinary(entity, chk.checked);
    lbl.textContent = chk.checked ? "detected" : "clear";
  });
  wrap.append(chk, lbl);
  row.append(ent, wrap);
  return row;
}

function buildAxisRow(axis: "X" | "Y", s: TrackerSensor | undefined): HTMLElement {
  const row = document.createElement("div");
  row.className = "axis-row";
  if (!s) {
    row.innerHTML = `<span class="ent">${axis} sensor</span><span class="ent" style="grid-column:2/4;opacity:.6;">(not configured)</span>`;
    return row;
  }
  // Initialize state so the dot has a starting position even before the user
  // moves the slider (otherwise the entity reads NaN and we'd render stale).
  const start = baseStates[s.entity]?.state;
  const initial = Number.isFinite(Number(start)) ? Number(start) : (s.min + s.max) / 2;
  if (start == null) setHassState(s.entity, initial);

  const ent = document.createElement("span");
  ent.className = "ent";
  ent.textContent = `${axis}: ${s.entity}`;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.dataset.axis = axis;
  slider.min = String(s.min);
  slider.max = String(s.max);
  slider.step = String(Math.max(0.01, (s.max - s.min) / 200));
  slider.value = String(initial);
  const val = document.createElement("span");
  val.className = "ent";
  val.style.textAlign = "right";
  val.textContent = String(initial);
  slider.addEventListener("input", () => {
    const v = Number(slider.value);
    val.textContent = String(v);
    setHassState(s.entity, v);
  });
  row.append(ent, slider, val);
  return row;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// Initial render — covers the case where the starter config already has trackers
// or entity-bound openings.
refreshTrackerEmu(config);
refreshOpeningEmu(config);

// Clear the hosts before mounting so re-running this module (HMR, etc.) can
// never stack a second editor/card on top of the first — duplicate mounts make
// edits in one instance look like they "disappear" in the other.
const editorHost = document.getElementById("editor-host")!;
const cardHost = document.getElementById("card-host")!;
editorHost.replaceChildren(editor);
cardHost.replaceChildren(card);

// If this module is hot-reloaded, do a full page reload instead of re-executing
// the top-level side effects (which would re-define elements and re-mount).
if (import.meta.hot) {
  import.meta.hot.accept(() => import.meta.hot!.invalidate());
}
