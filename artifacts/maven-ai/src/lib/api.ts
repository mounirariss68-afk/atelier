import type { ScoreResult, SubmissionInput } from "@workspace/assessments";

const BASE = "/api";

export interface SubmitResponse {
  publicId: string;
  result: ScoreResult;
}

export async function submitAssessment(input: SubmissionInput): Promise<SubmitResponse> {
  const r = await fetch(`${BASE}/assessments/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Submit failed: ${r.status}`);
  return r.json();
}

export interface SubmissionDetail {
  publicId: string;
  slug: string;
  overallScore: number;
  tier: string;
  sovereignScore: number;
  language: "en" | "ar" | "tr";
  profile: {
    name: string;
    email: string;
    company: string;
    role: string;
    industry: string;
    country: string;
    revenueBand: string;
    employeeCountBand: string;
    language: "en" | "ar" | "tr";
  };
  result: ScoreResult;
  memo: string | null;
  createdAt: string;
}

export async function fetchSubmission(publicId: string): Promise<SubmissionDetail> {
  const r = await fetch(`${BASE}/assessments/submissions/${publicId}`);
  if (!r.ok) throw new Error("Not found");
  return r.json();
}

export async function fetchMemo(publicId: string): Promise<{ memo: string }> {
  const r = await fetch(`${BASE}/assessments/submissions/${publicId}/memo`, { method: "POST" });
  if (!r.ok) throw new Error("Memo error");
  return r.json();
}

export async function emailReport(publicId: string, viewUrl: string): Promise<{ ok: boolean; via: string }> {
  const r = await fetch(`${BASE}/assessments/submissions/${publicId}/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ viewUrl }),
  });
  return r.json();
}

export async function bookCall(args: {
  submissionPublicId?: string;
  name: string;
  email: string;
  company: string;
  role?: string;
  preferredTime?: string;
  message?: string;
  language: "en" | "ar" | "tr";
}) {
  const r = await fetch(`${BASE}/assessments/book-call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("Book call failed");
  return r.json();
}

export async function createTeamLink(args: {
  slug: "ari" | "mvi" | "dafi" | "uvr";
  initiatorName: string;
  initiatorEmail: string;
  company: string;
  seats?: number;
}) {
  const r = await fetch(`${BASE}/assessments/team-links`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!r.ok) throw new Error("Team link failed");
  return r.json() as Promise<{ teamToken: string; slug: string; seats: number }>;
}

export async function fetchTeamLink(token: string) {
  const r = await fetch(`${BASE}/assessments/team-links/${token}`);
  if (!r.ok) throw new Error("Not found");
  return r.json() as Promise<{ slug: string; company: string; initiatorName: string; seats: number; closed: boolean }>;
}

export async function fetchTeamHeatmap(token: string) {
  const r = await fetch(`${BASE}/assessments/team-links/${token}/heatmap`);
  if (!r.ok) throw new Error("Heatmap error");
  return r.json();
}
