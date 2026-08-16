import { pgTable, uuid, text, integer, timestamp, doublePrecision, uniqueIndex } from 'drizzle-orm/pg-core';
import { agents } from './agents';
import { agentRuns } from './runs';

export const ciInstallations = pgTable(
  'ci_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    repo: text('repo').notNull(),
    targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
    installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    // AC-22 — re-exporting the same (agent, repo, target) updates the existing
    // installation instead of creating a duplicate row.
    agentRepoTargetUq: uniqueIndex('ci_installations_agent_repo_target_uq').on(
      t.agentId,
      t.repo,
      t.targetType,
    ),
  }),
);

export const ciRuns = pgTable(
  'ci_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
      onDelete: 'set null',
    }),
    prNumber: integer('pr_number'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    status: text('status'),
    findingsCount: integer('findings_count'),
    costUsd: doublePrecision('cost_usd'),
    githubUrl: text('github_url'),
    source: text('source'),
    // AC-47 — the paired agent_runs row this CI run was ingested into
    // (source:'ci'). Nullable: set null if the agent_runs row is deleted.
    agentRunId: uuid('agent_run_id').references(() => agentRuns.id, { onDelete: 'set null' }),
    // GitHub's own workflow run id, stored as text — only ever used as a
    // lookup key, so no int-precision question and no arithmetic on it.
    workflowRunId: text('workflow_run_id'),
  },
  (t) => ({
    // AC-48 — re-ingesting the same workflow run updates its row instead of
    // inserting a duplicate.
    installationWorkflowRunUq: uniqueIndex('ci_runs_installation_workflow_run_uq').on(
      t.ciInstallationId,
      t.workflowRunId,
    ),
  }),
);
