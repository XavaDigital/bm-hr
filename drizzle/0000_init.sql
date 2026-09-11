CREATE SCHEMA IF NOT EXISTS "hr";
--> statement-breakpoint
CREATE TABLE "hr"."audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_email" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"action" text NOT NULL,
	"diff" jsonb
);
--> statement-breakpoint
CREATE TABLE "hr"."compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"period" text NOT NULL,
	"effective_from" date NOT NULL,
	"reason" text DEFAULT 'pay_rise' NOT NULL,
	"notes" text,
	"created_by" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."pay_schedules" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"pay_day" integer,
	"payout_method" text DEFAULT 'wise' NOT NULL,
	"wise_recipient_id" text,
	"wise_recipient_name" text,
	"wise_recipient_email" text,
	"wise_recipient_kind" text,
	"wise_recipient_detail" text,
	"target_currency" text,
	"invoice_prefix" text,
	"next_invoice_number" integer,
	"thirteenth_month" boolean DEFAULT false NOT NULL,
	"thirteenth_month_pay_month" integer DEFAULT 12 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"preferred_name" text,
	"email" text,
	"phone" text,
	"country" text,
	"timezone" text,
	"job_title" text,
	"employment_type" text DEFAULT 'contractor' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"start_date" date,
	"end_date" date,
	"date_of_birth" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hr"."compensation" ADD CONSTRAINT "compensation_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."pay_schedules" ADD CONSTRAINT "pay_schedules_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_audit_row" ON "hr"."audit_log" USING btree ("table_name","row_id");--> statement-breakpoint
CREATE INDEX "idx_hr_compensation_member" ON "hr"."compensation" USING btree ("member_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_members_email" ON "hr"."team_members" USING btree (lower("email")) WHERE "hr"."team_members"."deleted_at" is null and "hr"."team_members"."email" is not null;--> statement-breakpoint
CREATE INDEX "idx_hr_members_status" ON "hr"."team_members" USING btree ("status");