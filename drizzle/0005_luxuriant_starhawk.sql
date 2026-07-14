CREATE TABLE "resume_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"client_id" uuid,
	"source_match_id" uuid,
	"title" text NOT NULL,
	"body_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"r2_pdf_key" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_documents" ADD CONSTRAINT "resume_documents_source_match_id_campaign_matches_id_fk" FOREIGN KEY ("source_match_id") REFERENCES "public"."campaign_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_documents_org_idx" ON "resume_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "resume_documents_client_idx" ON "resume_documents" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "resume_documents_match_idx" ON "resume_documents" USING btree ("source_match_id");