CREATE TABLE "backlink_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"target" text NOT NULL,
	"total_backlinks" numeric(20, 0),
	"referring_domains" numeric(20, 0),
	"referring_main_domains" numeric(20, 0),
	"referring_ips" numeric(20, 0),
	"domain_rank" real,
	"source_task_id" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitor_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"competitor_domain" text NOT NULL,
	"intersections" integer,
	"average_position" real,
	"source_task_id" text,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_data_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"operation" text NOT NULL,
	"external_task_id" text,
	"estimated_cost" numeric(12, 8),
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backlink_snapshots" ADD CONSTRAINT "backlink_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitor_snapshots" ADD CONSTRAINT "competitor_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_data_usage" ADD CONSTRAINT "seo_data_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_data_usage" ADD CONSTRAINT "seo_data_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_data_usage" ADD CONSTRAINT "seo_data_usage_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backlink_snapshots_project_time_idx" ON "backlink_snapshots" USING btree ("project_id","observed_at");--> statement-breakpoint
CREATE INDEX "competitor_snapshots_project_time_idx" ON "competitor_snapshots" USING btree ("project_id","observed_at");--> statement-breakpoint
CREATE INDEX "competitor_snapshots_project_domain_idx" ON "competitor_snapshots" USING btree ("project_id","competitor_domain");--> statement-breakpoint
CREATE INDEX "seo_data_usage_org_time_idx" ON "seo_data_usage" USING btree ("organization_id","requested_at");--> statement-breakpoint
CREATE INDEX "seo_data_usage_project_time_idx" ON "seo_data_usage" USING btree ("project_id","requested_at");