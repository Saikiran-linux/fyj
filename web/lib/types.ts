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

/** One work-history role extracted from a résumé (editable on the Overview). */
export interface ExperienceEntry {
  title: string | null;
  company: string | null;
  period: string | null;
  summary: string | null;
}

/** The résumé-extracted candidate fields stored on `ClientProfile.parsedProfile.candidate`. */
export interface CandidateExtraction {
  fullName?: string | null;
  headline?: string | null;
  location?: string | null;
  seniority?: string | null;
  skills?: string[];
  experience?: ExperienceEntry[];
  roleFamilies?: string[];
  minComp?: number | null;
  workplace?: string | null;
  targetTitles?: string[];
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
  // display enrichment (additive on the Worker; null on older responses)
  workplace?: string | null;
  employmentType?: string | null;
  source?: string | null;
  postedAt?: string | null;
  compMin?: number | null;
  compMax?: number | null;
  compCurrency?: string | null;
  compInterval?: string | null;
  compText?: string | null;
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

/** Pipeline stages (placements.status). Presented as lists — no kanban. */
export type PlacementStatus =
  | "lead"
  | "drafted"
  | "ready_to_send"
  | "applied"
  | "responded"
  | "screening"
  | "interview"
  | "offer"
  | "placed"
  | "rejected"
  | "withdrawn";

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
  // f-139 design card enrichment (from the extended get_job)
  workplace: string | null; // "remote" | "hybrid" | …
  employmentType: string | null;
  source: string | null; // ATS provider badge
  postedAt: string | null;
  comp: string | null; // formatted pay range, e.g. "$160k–$190k"
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

// ── resume documents (Write library + tailor workspace, f-156) ──────────

/** One block of the résumé block editor. Stored as-is in `resume_documents.body_json`. */
export type ResumeBlock =
  | { id: string; type: "section" | "h" | "p" | "bullet"; html: string }
  | { id: string; type: "divider" }
  | { id: string; type: "job"; data: { title: string; company: string; when: string } }
  | { id: string; type: "skills"; data: { items: string[] } };

export interface ResumeDocMeta {
  name: string;
  contact: string; // one line: "City, ST · you@email.com · linkedin.com/in/you"
}

export interface ResumeDocVersion {
  at: string; // ISO timestamp
  label: string;
  markdown: string;
}

/** The editor document persisted in `resume_documents.body_json`. */
export interface ResumeDocBody {
  meta: ResumeDocMeta;
  blocks: ResumeBlock[];
  versions?: ResumeDocVersion[]; // newest first, capped client-side
}

export interface ResumeDocumentListRow {
  id: string;
  clientId: string | null;
  clientName: string | null;
  sourceMatchId: string | null;
  title: string;
  version: number;
  updatedAt: string;
  createdAt: string;
}

export interface ResumeDocument {
  id: string;
  orgId: string;
  clientId: string | null;
  sourceMatchId: string | null;
  title: string;
  bodyJson: Partial<ResumeDocBody>;
  version: number;
  r2PdfKey: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** AI line-transform kinds accepted by POST /api/resumes/ai. */
export type AiEditKind =
  | "improve"
  | "grammar"
  | "shorter"
  | "longer"
  | "simplify"
  | "continue"
  | "custom";

// ── résumé prompt lab (dev tool; mirrors src/graph/tailor-lab.ts) ────────
export interface LabModel {
  id: string;
  label: string;
  provider: "anthropic" | "openai";
  inPricePerM: number;
  outPricePerM: number;
}

export interface LabStageConfig {
  model: string;
  system: string;
}

export interface LabDefaults {
  plannerEnabled: boolean;
  planner: LabStageConfig;
  generator: LabStageConfig;
  verifier: LabStageConfig;
  maxIterations: number;
  maxOutputTokens: number;
}

export interface LabConfig {
  models: LabModel[];
  defaults: LabDefaults;
  sample: { candidateSummary: string; master: string; jobText: string };
  hasAnthropic: boolean;
  hasOpenai: boolean;
}

export interface LabUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type LabStageName = "planner" | "generator" | "verifier" | "revise";

export interface LabStep {
  stage: LabStageName;
  iteration: number;
  model: string;
  ms: number;
  output: string;
  usage: LabUsage;
  pass?: boolean;
  issues?: string[];
  error?: string;
}

export interface LabResult {
  steps: LabStep[];
  final: string;
  iterations: number;
  totalMs: number;
  usage: LabUsage;
  error?: string;
}

export interface LabRunInput {
  master: string;
  jobText: string;
  candidateSummary: string;
  maxIterations: number;
  maxOutputTokens: number;
  planner: LabStageConfig | null;
  generator: LabStageConfig;
  verifier: LabStageConfig;
}
