import type {
  Client,
  ClientProfile,
  CampaignMatch,
  JobHit,
  Membership,
  MatchActionValue,
  Principal,
  StaffRole,
  DashboardKpis,
  FunnelRow,
  OperatorStat,
  TrendPoint,
  ActivityEvent,
  ApplicationRow,
  PlacementStatus,
  Match,
  MatchConfidence,
  ApproveMatchResult,
  ClientStatus,
  ConsentStatus,
  CalendarEvent,
  ExperienceEntry,
  Feedback,
  FeedbackSignal,
  CandidateDocuments,
  LabConfig,
  LabResult,
  LabRunInput,
} from "./types";

/**
 * Typed client for the Worker API (src/api.ts). All calls send the Better Auth
 * session cookie (credentials: "include") and parse JSON. Tenant scoping +
 * authorization happen server-side (RLS) — this layer never decides access.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:8787";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) detail = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// Multipart upload: the browser must set Content-Type (with the boundary), so we
// deliberately don't send the JSON header here. Shares error handling shape.
async function upload<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const b = (await res.json()) as { error?: string };
      if (b?.error) detail = b.error;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  me: () => req<{ principal: Principal }>("/api/me"),

  listClients: () => req<Client[]>("/api/clients"),
  getClient: (id: string) => req<Client>(`/api/clients/${id}`),
  createClient: (input: {
    fullName: string;
    email?: string;
    phone?: string;
    assignedOperatorId?: string;
    notes?: string;
  }) => req<Client>("/api/clients", { method: "POST", body: JSON.stringify(input) }),
  updateClient: (
    id: string,
    input: {
      fullName?: string;
      email?: string | null;
      phone?: string | null;
      status?: ClientStatus;
      headline?: string | null;
      consentStatus?: ConsentStatus;
      notes?: string | null;
    },
  ) => req<Client>(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  // Permanently delete a candidate + all its campaigns/matches/placements (admin only).
  deleteClient: (id: string) =>
    req<{ ok: true; id: string }>(`/api/clients/${id}`, { method: "DELETE" }),
  listClientApplications: (clientId: string) =>
    req<ApplicationRow[]>(`/api/clients/${clientId}/applications`),

  // Candidate feedback (f-146) — operators log signals/notes; client portal also inserts.
  listFeedback: (clientId: string) => req<Feedback[]>(`/api/clients/${clientId}/feedback`),
  addFeedback: (
    clientId: string,
    input: { signal: FeedbackSignal; note?: string | null; rating?: number | null },
  ) =>
    req<Feedback>(`/api/clients/${clientId}/feedback`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  // Documents (f-146) — résumés + generated tailored résumés for a candidate.
  listDocuments: (clientId: string) => req<CandidateDocuments>(`/api/clients/${clientId}/documents`),
  // Original uploaded résumé file (R2). A plain link/navigation; the session
  // cookie rides along, so use it as an <a href> rather than a fetch.
  resumeFileUrl: (clientId: string, profileId: string) =>
    `${API_URL}/api/clients/${clientId}/profiles/${profileId}/resume-file`,

  listProfiles: (clientId: string) =>
    req<ClientProfile[]>(`/api/clients/${clientId}/profiles`),
  createProfile: (clientId: string, input: { label: string; resumeText?: string }) =>
    req<ClientProfile>(`/api/clients/${clientId}/profiles`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateProfile: (
    id: string,
    input: { autopilot?: boolean; targetFilters?: Record<string, unknown> },
  ) => req<ClientProfile>(`/api/profiles/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  // Delete a track (profile) + its campaign/matches (admin/operator with access).
  deleteProfile: (id: string) =>
    req<{ ok: true; id: string }>(`/api/profiles/${id}`, { method: "DELETE" }),
  // Save operator edits to the résumé-extracted Experience / Skills sections (f-146).
  updateProfileExtraction: (
    id: string,
    input: { experience?: ExperienceEntry[]; skills?: string[] },
  ) =>
    req<ClientProfile>(`/api/profiles/${id}/extraction`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  uploadResume: (clientId: string, profileId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload<{ profile: ClientProfile; surfaced: number }>(
      `/api/clients/${clientId}/profiles/${profileId}/resume`,
      fd,
    );
  },
  // On-demand "Find matches": surface the top ~25 for this profile now.
  runMatch: (profileId: string) =>
    req<{ surfaced: number; matches: Match[] }>(`/api/profiles/${profileId}/match`, {
      method: "POST",
    }),

  // Index search (f-134): a profile's embedding, or an ad-hoc text query.
  profileJobs: (profileId: string) => req<JobHit[]>(`/api/profiles/${profileId}/jobs`),
  searchJobs: (query: string) =>
    req<JobHit[]>("/api/search", { method: "POST", body: JSON.stringify({ query }) }),
  // Newest active postings (Explore default browse view, f-151).
  recentJobs: (limit?: number) =>
    req<JobHit[]>(`/api/jobs/recent${limit ? `?limit=${limit}` : ""}`),

  listCampaignMatches: (campaignId: string) =>
    req<CampaignMatch[]>(`/api/campaigns/${campaignId}/matches`),
  setMatchAction: (matchId: string, action: MatchActionValue) =>
    req<CampaignMatch>(`/api/matches/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  listMembers: () => req<Membership[]>("/api/members"),
  // Admin creates a staff login (username + password). Operators never self-sign-up.
  createMember: (input: {
    username: string;
    password: string;
    name?: string;
    role: StaffRole;
  }) => req<Membership>("/api/members", { method: "POST", body: JSON.stringify(input) }),

  // Dashboard analytics (f-136) — org-wide rollups for the operator home.
  dashboardKpis: () => req<DashboardKpis>("/api/dashboard/kpis"),
  dashboardFunnel: () => req<FunnelRow[]>("/api/dashboard/funnel"),
  dashboardLeaderboard: () => req<OperatorStat[]>("/api/dashboard/leaderboard"),
  dashboardTrends: () => req<TrendPoint[]>("/api/dashboard/trends"),
  dashboardActivity: () => req<ActivityEvent[]>("/api/dashboard/activity"),
  listApplications: () => req<ApplicationRow[]>("/api/applications"),

  // Placement writes (f-155) — stage/notes/follow-ups from the pipeline lists.
  updatePlacement: (
    id: string,
    input: { status?: PlacementStatus; notes?: string | null; followUps?: unknown[] },
  ) =>
    req<ApplicationRow>(`/api/placements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  createPlacement: (input: {
    clientId: string;
    jobTitle: string;
    companyName: string;
    jobId?: string | null;
    companyId?: string | null;
    status?: PlacementStatus;
    notes?: string | null;
  }) => req<ApplicationRow>("/api/placements", { method: "POST", body: JSON.stringify(input) }),

  // Match review / Explore (f-139 P2)
  listMatches: (params?: { candidateId?: string; confidence?: MatchConfidence }) => {
    const qs = new URLSearchParams();
    if (params?.candidateId) qs.set("candidateId", params.candidateId);
    if (params?.confidence) qs.set("confidence", params.confidence);
    const q = qs.toString();
    return req<Match[]>(`/api/matches${q ? `?${q}` : ""}`);
  },
  approveMatch: (matchId: string) =>
    req<ApproveMatchResult & { tailoring?: boolean }>(`/api/matches/${matchId}/approve`, {
      method: "POST",
    }),
  // Kick (or re-kick) tailoring without changing the match action — used when the
  // drawer is opened directly. `reason` explains why it can't run (no résumé / no AI).
  tailorMatch: (matchId: string) =>
    req<{ tailoring: boolean; reason?: "no_resume" | "no_ai" }>(
      `/api/matches/${matchId}/tailor`,
      { method: "POST" },
    ),
  declineMatch: (matchId: string) =>
    req<CampaignMatch>(`/api/matches/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "dismissed" }),
    }),

  // Tailored résumé (f-141) — Markdown the operator edits, then exports to PDF.
  getTailoredResume: (matchId: string) =>
    req<{ status: "pending" | "ready"; markdown: string | null; model?: string; generatedAt?: string }>(
      `/api/matches/${matchId}/resume`,
    ),
  saveTailoredResume: (matchId: string, markdown: string) =>
    req<{ ok: true }>(`/api/matches/${matchId}/resume`, {
      method: "PUT",
      body: JSON.stringify({ markdown }),
    }),

  // Résumé prompt lab (dev tool) — defaults/models/sample, and a synchronous run.
  tailorLabConfig: () => req<LabConfig>("/api/tools/tailor-lab"),
  runTailorLab: (input: LabRunInput) =>
    req<LabResult>("/api/tools/tailor-lab", { method: "POST", body: JSON.stringify(input) }),
  // Parse an uploaded résumé (PDF/DOCX/text) to plain text for the master field.
  parseTailorLabResume: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload<{ text: string; kind: string; name: string }>("/api/tools/tailor-lab/parse", fd);
  },

  // Calendar (f-139 P4) — month: 0-11
  listCalendar: (params?: { year?: number; month?: number }) => {
    const qs = new URLSearchParams();
    if (params?.year != null) qs.set("year", String(params.year));
    if (params?.month != null) qs.set("month", String(params.month));
    const q = qs.toString();
    return req<CalendarEvent[]>(`/api/calendar${q ? `?${q}` : ""}`);
  },
};
