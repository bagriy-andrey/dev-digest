/**
 * Export-to-CI (SPEC-04) — hermetic unit tests for `modules/ci/workflow.ts`.
 * Pure string assertions on the rendered YAML; no DB, no network, no LLM.
 */
import { describe, it, expect } from 'vitest';
import { renderWorkflow } from '../src/modules/ci/workflow.js';
import { sanitizeTriggers } from '../src/modules/ci/helpers.js';
import { ARTIFACT_FILE, ARTIFACT_NAME, WORKFLOW_JOB_ID, WORKFLOW_JOB_NAME } from '../src/modules/ci/constants.js';

const POST_AS_VALUES = ['github_review', 'pr_comment', 'none'];

describe('renderWorkflow', () => {
  it('runs the embedded runner via `node .devdigest/runner/index.js`, no marketplace review action', () => {
    const yaml = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    expect(yaml).toContain('run: node .devdigest/runner/index.js');
  });

  it('types: reflects the sanitized trigger selection, dropping unknown strings (AC-9, D9)', () => {
    const sanitized = sanitizeTriggers(['opened', 'issue_comment', 'push', 'reopened']);
    const yaml = renderWorkflow({ triggers: sanitized, postAs: 'github_review' });
    expect(yaml).toContain('types: [opened, reopened]');
    expect(yaml).not.toContain('issue_comment');
    expect(yaml).not.toContain('push]');
  });

  it('the permissions: block is exactly the three fixed lines, for every post_as value (AC-10)', () => {
    for (const postAs of POST_AS_VALUES) {
      const yaml = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs });
      expect(yaml).toContain(
        'permissions:\n  contents: read\n  pull-requests: write\n  issues: write\n',
      );
    }
  });

  it('never uses pull_request_target (AC-11)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).not.toContain('pull_request_target');
    expect(yaml).toContain('pull_request:');
  });

  it('has an explicit external-PR-skip condition at job level, keyed on repo identity not the fork flag (AC-12)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).toContain(
      'if: github.event.pull_request.head.repo.full_name == github.event.pull_request.base.repo.full_name',
    );
    // `head.repo.fork` is a property of the repo (was it ever created via Fork?), not of
    // whether this specific PR crosses a repo boundary — it must not be used here, or every
    // PR in an installing repo that is itself a fork of some upstream would wrongly skip.
    expect(yaml).not.toContain('head.repo.fork');
  });

  it('job id + name are the fixed constants, independent of postAs/triggers (AC-13)', () => {
    const yamlA = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    const yamlB = renderWorkflow({ triggers: ['opened', 'synchronize', 'reopened'], postAs: 'none' });
    for (const yaml of [yamlA, yamlB]) {
      expect(yaml).toContain(`  ${WORKFLOW_JOB_ID}:\n    name: ${WORKFLOW_JOB_NAME}`);
    }
  });

  it('passes all five env vars, DEVDIGEST_POST_AS reflecting the wizard choice (AC-14)', () => {
    for (const postAs of POST_AS_VALUES) {
      const yaml = renderWorkflow({ triggers: ['opened'], postAs });
      expect(yaml).toContain('OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}');
      expect(yaml).toContain('GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}');
      expect(yaml).toContain('GITHUB_REPOSITORY: ${{ github.repository }}');
      expect(yaml).toContain('PR_NUMBER: ${{ github.event.pull_request.number }}');
      expect(yaml).toContain(`DEVDIGEST_POST_AS: ${postAs}`);
    }
  });

  it('the upload step carries if: always() (AC-15)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).toContain('- name: Upload DevDigest result\n        if: always()');
    expect(yaml).toContain(`name: ${ARTIFACT_NAME}`);
    expect(yaml).toContain(`path: ${ARTIFACT_FILE}`);
  });

  it('no step echoes a secret value (AC-16)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).not.toMatch(/echo.*secrets\./i);
    // secrets only ever appear as the `${{ secrets.X }}` expression form
    for (const line of yaml.split('\n')) {
      if (line.includes('secrets.')) {
        expect(line).toMatch(/\$\{\{\s*secrets\.\w+\s*\}\}/);
      }
    }
  });

  it('the only `uses:` entries are the pinned checkout + upload-artifact actions (AC-17)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    const usesLines = yaml.split('\n').filter((l) => l.includes('uses:'));
    expect(usesLines).toEqual([
      '      - uses: actions/checkout@v4',
      '        uses: actions/upload-artifact@v4',
    ]);
  });

  it('no setup-node step is emitted', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).not.toContain('setup-node');
  });

  it('no configured secret value ever appears in the rendered output (AC-6)', () => {
    const yaml = renderWorkflow({ triggers: ['opened'], postAs: 'github_review' });
    expect(yaml).not.toContain('sk-devdigest-fake-secret-do-not-leak-9f3a1c');
  });
});
