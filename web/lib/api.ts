import type {
  Client,
  ClientProfile,
  CampaignMatch,
  Membership,
  MatchActionValue,
  Principal,
  StaffRole,
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

  listProfiles: (clientId: string) =>
    req<ClientProfile[]>(`/api/clients/${clientId}/profiles`),
  createProfile: (clientId: string, input: { label: string; resumeText?: string }) =>
    req<ClientProfile>(`/api/clients/${clientId}/profiles`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listCampaignMatches: (campaignId: string) =>
    req<CampaignMatch[]>(`/api/campaigns/${campaignId}/matches`),
  setMatchAction: (matchId: string, action: MatchActionValue) =>
    req<CampaignMatch>(`/api/matches/${matchId}/action`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }),

  listMembers: () => req<Membership[]>("/api/members"),
  inviteMember: (userId: string, role: StaffRole) =>
    req<Membership>("/api/members", {
      method: "POST",
      body: JSON.stringify({ userId, role }),
    }),
};
