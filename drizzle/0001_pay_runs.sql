CREATE TABLE "hr"."pay_run_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_run_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"included" boolean DEFAULT true NOT NULL,
	"member_name" text DEFAULT '' NOT NULL,
	"base_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"thirteenth_month_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"adjustments_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"adjustments_note" text,
	"net_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"amount_mode" text DEFAULT 'source' NOT NULL,
	"fee_fixed" numeric(12, 2) DEFAULT '0' NOT NULL,
	"fee_pct" numeric(9, 6) DEFAULT '0' NOT NULL,
	"gross_up_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"export_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"export_currency" text DEFAULT 'USD' NOT NULL,
	"payment_reference" text,
	"payment_reference_manual" boolean DEFAULT false NOT NULL,
	"recipient_id" text,
	"recipient_name" text,
	"recipient_email" text,
	"recipient_detail" text,
	"recipient_kind" text,
	"target_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."pay_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pay_date" date NOT NULL,
	"period_start" date,
	"period_end" date,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"source_currency" text DEFAULT 'USD' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"notes" text,
	"exported_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"created_by" text,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr"."pay_schedules" ADD COLUMN "invoice_pad" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "hr"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_pay_run_id_pay_runs_id_fk" FOREIGN KEY ("pay_run_id") REFERENCES "hr"."pay_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr"."pay_run_lines" ADD CONSTRAINT "pay_run_lines_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "hr"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_hr_pay_run_lines_member" ON "hr"."pay_run_lines" USING btree ("pay_run_id","member_id");--> statement-breakpoint
CREATE INDEX "idx_hr_pay_run_lines_member" ON "hr"."pay_run_lines" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "idx_hr_pay_runs_date" ON "hr"."pay_runs" USING btree ("pay_date");