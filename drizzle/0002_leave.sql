CREATE TABLE "hr"."leave_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"date" date NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"reason" text NOT NULL,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."leave_policies" (
	"member_id" uuid PRIMARY KEY NOT NULL,
	"leave_year_start" text DEFAULT '01-01' NOT NULL,
	"annual_entitlement_days" numeric(6, 2) DEFAULT '10' NOT NULL,
	"accrual" text DEFAULT 'monthly' NOT NULL,
	"carry_over_max_days" numeric(6, 2) DEFAULT '5' NOT NULL,
	"sick_days" numeric(6, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"type" text DEFAULT 'annual' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"status" text DEFAULT 'approved' NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr"."leave_adjustments" ADD CONSTRAINT "leave_adjustments_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."leave_policies" ADD CONSTRAINT "leave_policies_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."leave_requests" ADD CONSTRAINT "leave_requests_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_hr_leave_adjustments_member" ON "hr"."leave_adjustments" USING btree ("member_id","date");--> statement-breakpoint
CREATE INDEX "idx_hr_leave_requests_member" ON "hr"."leave_requests" USING btree ("member_id","start_date");--> statement-breakpoint
CREATE INDEX "idx_hr_leave_requests_dates" ON "hr"."leave_requests" USING btree ("start_date","end_date");