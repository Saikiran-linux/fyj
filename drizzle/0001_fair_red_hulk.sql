CREATE TYPE "public"."match_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "fit_score" smallint;--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "confidence" "match_confidence";--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "matched_skills" text[];--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "missing_skills" text[];--> statement-breakpoint
ALTER TABLE "campaign_matches" ADD COLUMN "guardrails" text[];