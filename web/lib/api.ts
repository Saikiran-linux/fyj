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
  Match,
  MatchConfidence,
  ApproveMatchResult,
  ClientStatus,
  ConsentStatus,
  CalendarEvent,
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
    input: { status?: ClientStatus; headline?: string | null; consentStatus?: ConsentStatus },
  ) => req<Client>(`/api/clients/${id}`, { method: "PATCH", body: JSON.stringify(input) }),
  listClientApplications: (clientId: string) =>
    req<ApplicationRow[]>(`/api/clients/${clientId}/applications`),

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
  uploadResume: (clientId: string, profileId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload<ClientProfile>(`/api/clients/${clientId}/profiles/${profileId}/resume`, fd);
  },

  // Index search (f-134): a profile's embedding, or an ad-hoc text query.
  profileJobs: (profileId: string) => req<JobHit[]>(`/api/profiles/${profileId}/jobs`),
  searchJobs: (query: string) =>
    req<JobHit[]>("/api/search", { method: "POST", body: JSON.stringify({ query }) }),

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

  // Match review / Explore (f-139 P2)
  listMatches: (params?: { candidateId?: string; confidence?: MatchConfidence }) => {
    const qs = new URLSearchParams();
    if (params?.candidateId) qs.set("candidateId", params.candidateId);
    if (params?.confidence) qs.set("confidence", params.confidence);
    const q = qs.toString();
    return req<Match[]>(`/api/matches${q ? `?${q}` : ""}`);
  },
  approveMatch: (matchId: string) =>
    req<ApproveMatchResult>(`/api/matches/${matchId}/approve`, { method: "POST" }),
  declineMatch: (matchId: string) =>
    req<CampaignMatch>(`/api/matches/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify({ action: "dismissed" }),
    }),

  // Calendar (f-139 P4) — month: 0-11
  listCalendar: (params?: { year?: number; month?: number }) => {
    const qs = new URLSearchParams();
    if (params?.year != null) qs.set("year", String(params.year));
    if (params?.month != null) qs.set("month", String(params.month));
    const q = qs.toString();
    return req<CalendarEvent[]>(`/api/calendar${q ? `?${q}` : ""}`);
  },
};
