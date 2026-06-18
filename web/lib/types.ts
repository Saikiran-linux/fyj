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
  embeddedAt: string | null;
  createdAt: string;
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
