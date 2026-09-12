CREATE TABLE "hr"."checklist_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text DEFAULT 'onboarding' NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"done_at" timestamp with time zone,
	"done_by_email" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'onboarding' NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."member_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"type" text DEFAULT 'note' NOT NULL,
	"text" text NOT NULL,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr"."checklist_tasks" ADD CONSTRAINT "checklist_tasks_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."member_events" ADD CONSTRAINT "member_events_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_checklist_tasks_member" ON "hr"."checklist_tasks" USING btree ("member_id","kind");--> statement-breakpoint
CREATE INDEX "idx_hr_member_events_member" ON "hr"."member_events" USING btree ("member_id","date");