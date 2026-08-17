ALTER TABLE "ci_runs" ADD COLUMN "agent_run_id" uuid;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD CONSTRAINT "ci_runs_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_installations_agent_repo_target_uq" ON "ci_installations" USING btree ("agent_id","repo","target_type");--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_workflow_run_uq" ON "ci_runs" USING btree ("ci_installation_id","workflow_run_id");