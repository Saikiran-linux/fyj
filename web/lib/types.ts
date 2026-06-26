// Shapes returned by the Worker API (src/api.ts / src/db/repo.ts). Kept narrow
// — just what the UI renders. Mirror, don't import (separate repo/runtime).

export type StaffRole = "admin" | "operator" | "viewer";

export type Principal =
  | { principal: "staff"; userId: string; orgId: string; role: StaffRole }
  | { principal: "client"; userId: string; orgId: string; clientId: string };

export type ClientStatus = "active" | "paused" | "placed" | "archived";
export type ConsentStatus = "active" | "pending" | "revoked";

export type FeedbackSignal =
  | "interested"
  | "not_interested"
  | "already_applied"
  | "wrong_location"
  | "comp_too_low"
  | "seniority_off"
  | "not_my_field"
  | "other";

export interface Feedback {
  id: string;
  clientId: string;
  signal: FeedbackSignal;
  rating: number | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CandidateDocuments {
  resumes: {
    profileId: string;
    label: string;
    fileName: string;
    hasFile: boolean;
    hasText: boolean;
    embeddedAt: string | null;
    uploadedAt: string;
  }[];
  tailored: {
    matchId: string;
    model: string | null;
    generatedAt: string;
    jobId: string | null;
    companyId: string | null;
    jobTitle: string | null;
    company: string | null;
  }[];
}

export interface Client {
  id: string;
  orgId: string;
  assignedOperatorId: string | null;
  fullName: string;
  email: string | null;
  phone: string | null;
  headline: string | null;
  status: ClientStatus;
  consentStatus: ConsentStatus;
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
  autopilot: boolean;
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
  // joined from the auth user (null for legacy rows without a username)
  username: string | null;
  name: string | null;
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
  jobTitle: string | null;
  companyName: string | null;
  status: string;
  appliedAt: string | null;
  updatedAt: string;
}

// ── match review / Explore (f-139 P2) ──────────────────────────────────
export type MatchConfidence = "high" | "medium" | "low";

/** A campaign match for the Explore view — enriched (fit/confidence/rationale/
 *  skills/guardrails) and hydrated with job detail from the index. */
export interface Match {
  id: string;
  clientId: string;
  clientName: string;
  campaignId: string;
  jobId: string;
  companyId: string;
  score: number | null;
  rank: number | null;
  fitScore: number | null;
  confidence: MatchConfidence | null;
  rationale: string | null;
  matchedSkills: string[] | null;
  missingSkills: string[] | null;
  guardrails: string[] | null;
  action: MatchActionValue;
  surfacedAt: string;
  // hydrated from the read-only index (may be null if unreachable/uncached)
  jobTitle: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
}

export interface ApproveMatchResult {
  matchId: string;
  action: MatchActionValue;
  placementId: string | null;
}

// ── calendar (f-139 P4) ────────────────────────────────────────────────
export type CalendarKind = "interview" | "offer" | "call" | "sync";

export interface CalendarEvent {
  id: string;
  date: string; // YYYY-MM-DD
  kind: CalendarKind;
  status: string;
  clientName: string;
  jobTitle: string | null;
  companyName: string | null;
}
