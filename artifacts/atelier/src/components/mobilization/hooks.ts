/**
 * React-Query hooks for the mobilization surface:
 *   - engagement mobilization data (GET /engagements/:id/mobilization)
 *   - assignment state transitions via engagement endpoint (mobilizer)
 *   - assignment state transitions via /me endpoint (self accept/decline)
 *   - activation (POST /engagements/:id/mobilization/activate)
 *   - my own assignments (GET /me/mobilization-assignments)
 *   - my self accept/decline (PATCH /me/mobilization-assignments/:id)
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getAtelierGetEngagementQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { API, MOB_ENG_QK, MOB_ME_QK } from "./constants";
import type { MobilizationData, MyAssignment } from "./types";

// ─── Engagement mobilization data ────────────────────────────────────────────

export function useMobilizationData(engId: string) {
  return useQuery<MobilizationData>({
    queryKey: MOB_ENG_QK(engId),
    queryFn: async () => {
      const r = await fetch(`${API}/engagements/${engId}/mobilization`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) throw new Error(`mobilization_${r.status}`);
      return (await r.json()) as MobilizationData;
    },
    enabled: !!engId,
  });
}

// ─── Invalidation helper ──────────────────────────────────────────────────────

export function useInvalidateMobilization(engId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: MOB_ENG_QK(engId) });
    void qc.invalidateQueries({ queryKey: getAtelierGetEngagementQueryKey(engId) });
    void qc.invalidateQueries({ queryKey: MOB_ME_QK() });
  };
}

// ─── Mobilizer transition (end / replace) via engagement endpoint ─────────────

export function useEngagementTransition(engId: string, invalidate: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      state,
      reason,
    }: {
      assignmentId: string;
      state: string;
      reason?: string;
    }) => {
      const r = await fetch(
        `${API}/engagements/${engId}/mobilization/assignments/${assignmentId}`,
        {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state, reason }),
        },
      );
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `transition_${r.status}`);
      return j;
    },
    onSuccess: (_, vars) => {
      toast({ title: `Assignment ${vars.state}` });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });
}

// ─── Self accept/decline via /me endpoint ────────────────────────────────────

export function useSelfTransition(invalidate: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      state,
    }: {
      assignmentId: string;
      state: "accepted" | "declined";
    }) => {
      const r = await fetch(`${API}/me/mobilization-assignments/${assignmentId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `self_transition_${r.status}`);
      return j;
    },
    onSuccess: (_, vars) => {
      toast({ title: `Assignment ${vars.state}` });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });
}

// ─── Activate ────────────────────────────────────────────────────────────────

export function useActivate(engId: string, invalidate: () => void) {
  const { toast } = useToast();
  return useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API}/engagements/${engId}/mobilization/activate`, {
        method: "POST",
        credentials: "include",
      });
      const j = (await r.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        reasons?: string[];
      } | null;
      if (!r.ok)
        throw new Error(j?.reasons?.join("; ") ?? j?.error ?? `activate_${r.status}`);
      return j;
    },
    onSuccess: () => {
      toast({ title: "Engagement activated", description: "Mobilization is now active." });
      invalidate();
    },
    onError: (e: Error) =>
      toast({ title: "Activation blocked", description: e.message, variant: "destructive" }),
  });
}

// ─── My project assignments (GET /me/mobilization-assignments) ────────────────

export function useMyMobilizationAssignments() {
  return useQuery<MyAssignment[]>({
    queryKey: MOB_ME_QK(),
    queryFn: async () => {
      const r = await fetch(`${API}/me/mobilization-assignments`, {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as MyAssignment[];
    },
    staleTime: 30_000,
  });
}

// ─── Self-accept/decline from Me card ────────────────────────────────────────

export function useMeSelfTransition() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: async ({
      assignmentId,
      state,
    }: {
      assignmentId: string;
      state: "accepted" | "declined";
    }) => {
      const r = await fetch(`${API}/me/mobilization-assignments/${assignmentId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `self_${r.status}`);
      return j;
    },
    onSuccess: (_, vars) => {
      toast({ title: `Assignment ${vars.state}` });
      void qc.invalidateQueries({ queryKey: MOB_ME_QK() });
    },
    onError: (e: Error) =>
      toast({ title: "Transition failed", description: e.message, variant: "destructive" }),
  });
}
