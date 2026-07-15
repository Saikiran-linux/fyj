CREATE TABLE "activity_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"task_key" text NOT NULL,
	"done_by" text,
	"done_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activity_state_org_task_uq" UNIQUE("org_id","task_key")
);
--> statement-breakpoint
ALTER TABLE "activity_state" ADD CONSTRAINT "activity_state_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_state_org_idx" ON "activity_state" USING btree ("org_id");