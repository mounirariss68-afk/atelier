/**
 * Marketplace demo tick engine.
 *
 * Provides `useScenarioEngine(scenario)` — a React hook that owns the
 * deterministic playback of a Scenario's `events` array, including:
 *
 *  - play / pause / step / reset / rewind controls,
 *  - speed control (ms per tick),
 *  - human checkpoint pause + resolve,
 *  - a typed snapshot of `inbox`, `workspace`, `kpis`, and `trace`.
 *
 * The engine is intentionally generic: every marketplace tool's demo is
 * driven by data only (its Scenario), so adding a new tool's demo is
 * authoring its scenario file — no new UI required.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Scenario, SimEvent, SimState, KpiValue } from "./types";

const DEFAULT_SPEED_MS = 1400;

function initialState(scenario: Scenario): SimState {
  const kpis: KpiValue[] = scenario.kpis.map((k) => ({
    id: k.id,
    label: k.label,
    value: k.initial,
    source: k.source,
  }));
  return {
    status: "idle",
    cursor: 0,
    speedMs: DEFAULT_SPEED_MS,
    inbox: scenario.initialInbox.map((i) => ({ ...i })),
    workspace: scenario.initialWorkspace.map((w) => ({ ...w })),
    kpis,
    trace: [],
    pendingCheckpoint: null,
    decisions: {},
  };
}

function applyEvent(prev: SimState, scenario: Scenario, ev: SimEvent): SimState {
  const next: SimState = { ...prev, trace: [...prev.trace, ev] };

  switch (ev.kind) {
    case "emit-inbox":
      if (ev.inboxItem) next.inbox = [ev.inboxItem, ...prev.inbox];
      break;
    case "update-inbox":
      if (ev.inboxUpdate) {
        next.inbox = prev.inbox.map((i) =>
          i.id === ev.inboxUpdate!.id ? { ...i, status: ev.inboxUpdate!.status } : i,
        );
      }
      break;
    case "patch-workspace": {
      if (!ev.workspacePatch) break;
      const p = ev.workspacePatch;
      if (p.op === "add") next.workspace = [...prev.workspace, p.widget];
      else if (p.op === "update")
        next.workspace = prev.workspace.map((w) =>
          w.id === p.id ? { ...w, rows: p.rows } : w,
        );
      else if (p.op === "remove")
        next.workspace = prev.workspace.filter((w) => w.id !== p.id);
      break;
    }
    case "update-kpi":
      if (ev.kpiPatch) {
        next.kpis = prev.kpis.map((k) =>
          k.id === ev.kpiPatch!.id
            ? { ...k, value: ev.kpiPatch!.value, delta: ev.kpiPatch!.delta }
            : k,
        );
      }
      break;
    case "checkpoint":
      if (ev.checkpointId) {
        const cp = scenario.checkpoints.find((c) => c.id === ev.checkpointId) || null;
        if (cp) {
          next.pendingCheckpoint = cp;
          next.status = "awaiting-human";
        }
      }
      break;
    case "complete":
      next.status = "complete";
      break;
    default:
      // think / tool-call / decision / handoff are pure cockpit events
      break;
  }
  return next;
}

export interface EngineApi {
  state: SimState;
  scenario: Scenario;
  play: () => void;
  pause: () => void;
  step: () => void;
  reset: () => void;
  rewindOne: () => void;
  setSpeed: (ms: number) => void;
  resolveCheckpoint: (optionId: string) => void;
  /** Inject an ad-hoc event into the running trace (e.g. an inbound
   * inbox item or a "what if" think step). The event is applied
   * immediately like any scripted event. Use to demonstrate that the
   * orchestrator reacts to live signals, not just pre-baked timelines. */
  injectEvent: (ev: SimEvent) => void;
  /** Serialize the current trace + decisions as a downloadable JSON
   * audit trail. Returns a stable, citation-ready snapshot. */
  exportAudit: () => string;
}

export function useScenarioEngine(scenario: Scenario): EngineApi {
  const [state, setState] = useState<SimState>(() => initialState(scenario));
  const stateRef = useRef(state);
  stateRef.current = state;

  const stepOnce = useCallback(() => {
    setState((prev) => {
      if (prev.cursor >= scenario.events.length) {
        return prev.status === "complete" ? prev : { ...prev, status: "complete" };
      }
      if (prev.pendingCheckpoint) return prev;
      const ev = scenario.events[prev.cursor];
      const after = applyEvent(prev, scenario, ev);
      after.cursor = prev.cursor + 1;
      if (after.cursor >= scenario.events.length && after.status !== "awaiting-human") {
        after.status = "complete";
      } else if (after.status !== "awaiting-human") {
        after.status = prev.status === "playing" ? "playing" : after.status;
      }
      return after;
    });
  }, [scenario]);

  // Tick driver
  useEffect(() => {
    if (state.status !== "playing") return;
    if (state.pendingCheckpoint) return;
    const id = window.setTimeout(stepOnce, state.speedMs);
    return () => window.clearTimeout(id);
  }, [state.status, state.cursor, state.speedMs, state.pendingCheckpoint, stepOnce]);

  const play = useCallback(() => {
    setState((s) =>
      s.status === "complete" || s.pendingCheckpoint
        ? s
        : { ...s, status: "playing" },
    );
  }, []);

  const pause = useCallback(() => {
    setState((s) => (s.status === "playing" ? { ...s, status: "paused" } : s));
  }, []);

  const step = useCallback(() => {
    setState((s) => (s.status === "playing" ? { ...s, status: "paused" } : s));
    stepOnce();
  }, [stepOnce]);

  const reset = useCallback(() => {
    setState(initialState(scenario));
  }, [scenario]);

  const rewindOne = useCallback(() => {
    setState((prev) => {
      if (prev.cursor === 0) return prev;
      // Rewind by replaying from start, one step short.
      const target = prev.cursor - 1;
      let s = initialState(scenario);
      s.speedMs = prev.speedMs;
      for (let i = 0; i < target; i++) {
        s = applyEvent(s, scenario, scenario.events[i]);
        s.cursor = i + 1;
      }
      // Drop any pending checkpoint from the rewound point.
      s.pendingCheckpoint = null;
      s.status = "paused";
      return s;
    });
  }, [scenario]);

  const setSpeed = useCallback((ms: number) => {
    setState((s) => ({ ...s, speedMs: Math.max(200, Math.min(5000, ms)) }));
  }, []);

  const injectEvent = useCallback((ev: SimEvent) => {
    setState((prev) => {
      if (prev.pendingCheckpoint) return prev;
      const after = applyEvent(prev, scenario, ev);
      // Injected events do not advance the scripted cursor — they sit
      // alongside the timeline so Play resumes scripted playback from
      // wherever it left off.
      return after;
    });
  }, [scenario]);

  const exportAudit = useCallback((): string => {
    const snapshot = {
      scenario: {
        slug: scenario.slug,
        toolTitle: scenario.toolTitle,
      },
      generatedAt: new Date().toISOString(),
      status: stateRef.current.status,
      cursor: stateRef.current.cursor,
      decisions: stateRef.current.decisions,
      trace: stateRef.current.trace,
      kpis: stateRef.current.kpis,
    };
    return JSON.stringify(snapshot, null, 2);
  }, [scenario]);

  const resolveCheckpoint = useCallback((optionId: string) => {
    setState((prev) => {
      const cp = prev.pendingCheckpoint;
      if (!cp) return prev;
      const option = cp.options.find((o) => o.id === optionId);
      const decisionEvent: SimEvent = {
        id: `${cp.id}-resolved-${Date.now()}`,
        kind: "decision",
        agentId: undefined,
        label: {
          en: `Human resolved "${cp.question.en}" → ${option?.label.en ?? optionId}`,
          ar: `حسم الإنسان "${cp.question.ar}" → ${option?.label.ar ?? optionId}`,
        },
        detail: cp.rationale,
      };
      return {
        ...prev,
        decisions: { ...prev.decisions, [cp.id]: optionId },
        pendingCheckpoint: null,
        // Hand control back to the user. Pressing Play resumes the run;
        // this avoids yanking them out of step / pause mode unexpectedly.
        status: "paused",
        trace: [...prev.trace, decisionEvent],
      };
    });
  }, []);

  return useMemo<EngineApi>(
    () => ({
      state,
      scenario,
      play,
      pause,
      step,
      reset,
      rewindOne,
      setSpeed,
      resolveCheckpoint,
      injectEvent,
      exportAudit,
    }),
    [state, scenario, play, pause, step, reset, rewindOne, setSpeed, resolveCheckpoint, injectEvent, exportAudit],
  );
}
