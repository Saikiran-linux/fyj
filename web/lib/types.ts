// Shapes returned by the Worker API (src/api.ts / src/db/repo.ts). Kept narrow
// — just what the UI renders. Mirror, don't import (separate repo/runtime).

export type StaffRole = "admin" | "operator" | "viewer";

export type Principal =
  | { principal: "staff"; userId: string; orgId: string; role: StaffRole }
  | { principal: "client"; userId: string; orgId: string; clientId: string };

export type ClientStatus = "active" | "paused" | "placed" | "archived";

export interface Client {
  id: string;
  orgId: string;
  assignedOperatorId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  status: ClientStatus;
  portalEnabled: boolean;
  notes: string | null;
  createdAt: string;
}

export interface ClientProfile {
  id: string;
  clientId: string;
  label: string;
  resumeText: string | null;
  resumeStoragePath: string | null;
  parsedProfile: Record<string, unknown> | null;
  embeddingModel: string | null;
  embeddedAt: string | null;
  createdAt: string;
}

/** A ranked job from the index, hydrated for display (search routes). */
export interface JobHit {
  jobId: string;
  companyId: string;
  title: string;
  company: string;
  location: string | null;
  url: string | null;
  description: string | null;
  score: number;
  rank: number;
}

export type MatchActionValue =
  | "new"
  | "saved"
  | "shortlisted"
  | "dismissed"
  | "evaluated"
  | "applied";

export interface CampaignMatch {
  id: string;
  campaignId: string;
  jobId: string;
  companyId: string;
  score: number | null;
  rank: number | null;
  action: MatchActionValue;
  surfacedAt: string;
}

export interface Membership {
  id: string;
  orgId: string;
  userId: string;
  role: StaffRole;
  status: "active" | "invited" | "disabled";
}

// ── dashboard analytics (f-139) ────────────────────────────────────────
export interface DashboardKpis {
  placementsMtd: number;
  responseRate: number;
  liveApplications: number;
  awaitingReview: number;
}

export interface FunnelRow {
  label: string;
  value: number;
}

export interface OperatorStat {
  userId: string;
  name: string | null;
  email: string | null;
  candidateCount: number;
  matchesAwaiting: number;
  applicationsWeek: number;
  responseRate: number;
  placementsMtd: number;
}

export interface TrendPoint {
  day: string;
  applications: number;
  responses: number;
  placements: number;
}

export interface ActivityEvent {
  id: string;
  action: string;
  entityType: string | null;
  actorUserId: string | null;
  actorName: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A placement row joined to its client, for the "top live applications" table. */
export interface ApplicationRow {
  id: string;
  clientId: string;
  clientName: string;
  jobId: string | null;
  companyId: string | null;
  status: string;
  appliedAt: string | null;
  updatedAt: string;
}
