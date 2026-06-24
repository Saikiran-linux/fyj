CREATE TYPE "public"."consent_status" AS ENUM('active', 'pending', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."placement_status" ADD VALUE 'drafted';--> statement-breakpoint
ALTER TYPE "public"."placement_status" ADD VALUE 'ready_to_send';--> statement-breakpoint
ALTER TYPE "public"."placement_status" ADD VALUE 'responded';--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "autopilot" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "headline" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "consent_status" "consent_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "job_title" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "company_name" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "tailored_resume_name" text;--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "stage_changed_at" timestamp with time zone;