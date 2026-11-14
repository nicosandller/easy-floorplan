import { afterEach, describe, expect, it, vi } from "vitest";
import { loadTraceFile, type LoadedRaster, type TraceTemplate } from "./editor-trace";
import "./editor";
import type { FloorplanCardEditor } from "./editor";

vi.mock("./editor-trace", async (original) => {
  const actual = await original<typeof import("./editor-trace")>();
  return { ...actual, loadTraceFile: vi.fn(actual.loadTraceFile) };
});

type TraceState = {
  _loadTrace(file: File): Promise<void>;
  _setTrace(trace: TraceTemplate | undefined, id?: string): void;
  _deleteFloor(): void;
  _startTraceMode(mode: "move"): void;
  _traces: Map<string, TraceTemplate>;
  _refFloors: Map<string, { floorId: string; opacity: number }>;
  _traceMode: string | null;
  _traceBusy: boolean;
};

async function mount() {
  const ed = document.createElement("easy-floorplan-card-editor") as FloorplanCardEditor;
  ed.hass = { states: {}, entities: {} } as FloorplanCardEditor["hass"];
  ed.setConfig({ type: "custom:easy-floorplan-card", width: 1000, height: 600, defaultFloor: "f1",
    floors: ["f1", "f2"].map((id) => ({ id, name: id, walls: [], openings: [], items: [], texts: [], furniture: [], trackers: [], areas: [] })) });
  document.body.append(ed);
  await ed.updateComplete;
  const state = ed as unknown as TraceState;
  const src = URL.createObjectURL(new Blob(["old"]));
  state._setTrace({ src, name: "old.svg", pw: 100, ph: 100, x: 0, y: 0, scale: 1, rotation: 0, opacity: 0.5, visible: true });
  return { ed, state, src };
}

function deferredRaster() {
  let resolve!: (raster: LoadedRaster) => void;
  const result = new Promise<LoadedRaster>((r) => { resolve = r; });
  vi.mocked(loadTraceFile).mockReturnValueOnce(result);
  return { resolve, src: URL.createObjectURL(new Blob(["new"])) };
}

afterEach(() => { document.body.innerHTML = ""; vi.restoreAllMocks(); });

describe("trace lifetime while loading", () => {
  it("does not restore a template removed during replacement", async () => {
    const { ed, state, src } = await mount();
    const next = deferredRaster();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const loading = state._loadTrace(new File(["replacement"], "new.svg"));
    await ed.updateComplete;
    state._setTrace(undefined);
    next.resolve({ src: next.src, pw: 100, ph: 100 });
    await loading;
    expect(state._traces.size).toBe(0);
    expect(revoke).toHaveBeenCalledWith(src);
    expect(revoke).toHaveBeenCalledWith(next.src);
    expect(state._traceBusy).toBe(false);
  });

  it("drops the deleted floor's trace and all references, ends move mode and rejects a pending load", async () => {
    const { ed, state, src } = await mount();
    state._refFloors = new Map([["f1", { floorId: "f2", opacity: 0.25 }], ["f2", { floorId: "f1", opacity: 0.25 }]]);
    state._startTraceMode("move");
    const next = deferredRaster();
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const loading = state._loadTrace(new File(["replacement"], "new.svg"));
    await ed.updateComplete;
    state._deleteFloor();
    next.resolve({ src: next.src, pw: 100, ph: 100 });
    await loading;
    expect(state._traces.size).toBe(0);
    expect(state._refFloors.size).toBe(0);
    expect(state._traceMode).toBeNull();
    expect(state._traceBusy).toBe(false);
    expect(revoke).toHaveBeenCalledWith(src);
    expect(revoke).toHaveBeenCalledWith(next.src);
  });

  it("keeps the latest replacement if requests complete in reverse order", async () => {
    const { state } = await mount();
    const older = deferredRaster();
    const a = state._loadTrace(new File(["a"], "a.svg"));
    const newer = deferredRaster();
    const b = state._loadTrace(new File(["b"], "b.svg"));
    newer.resolve({ src: newer.src, pw: 100, ph: 100 });
    await b;
    older.resolve({ src: older.src, pw: 100, ph: 100 });
    await a;
    expect(state._traces.get("f1")?.src).toBe(newer.src);
    URL.revokeObjectURL(newer.src);
  });
});
