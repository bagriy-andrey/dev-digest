CREATE TABLE "repo_feature_models" (
	"repo_id" uuid NOT NULL,
	"feature_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	CONSTRAINT "repo_feature_models_repo_id_feature_id_pk" PRIMARY KEY("repo_id","feature_id")
);
--> statement-breakpoint
ALTER TABLE "repo_feature_models" ADD CONSTRAINT "repo_feature_models_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;