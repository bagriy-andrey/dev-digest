import { describe, expect, it } from 'vitest';
import type { AgentDto, ConventionDto, ReviewDto } from '../src/api/types.js';
import { pickReviewForRun, toAgentSummary, toConventionSummary, toReviewResult } from '../src/mappers.js';

function review(overrides: Partial<ReviewDto> = {}): ReviewDto {
  return {
    id: 'review-1',
    pr_id: 'pr-1',
    run_id: 'run-1',
    agent_id: 'agent-1',
    verdict: 'request_changes',
    summary: 'looks risky',
    score: 0.5,
    findings: [
      {
        id: 'finding-1',
        severity: 'CRITICAL',
        category: 'security',
        title: 'SQL injection',
        file: 'src/db.ts',
        start_line: 10,
        end_line: 12,
        confidence: 0.9,
        rationale: 'raw string concat into query',
      },
    ],
    ...overrides,
  };
}

describe('toReviewResult', () => {
  it('passes verdict through unchanged and drops the id field from findings', () => {
    const result = toReviewResult(review());

    expect(result.verdict).toBe('request_changes');
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toEqual({
      severity: 'CRITICAL',
      category: 'security',
      title: 'SQL injection',
      file: 'src/db.ts',
      start_line: 10,
      end_line: 12,
      confidence: 0.9,
      rationale: 'raw string concat into query',
    });
    expect(result.findings[0]).not.toHaveProperty('id');
  });

  it('passes a null verdict through unchanged', () => {
    const result = toReviewResult(review({ verdict: null, findings: [] }));
    expect(result.verdict).toBeNull();
    expect(result.findings).toEqual([]);
  });
});

describe('pickReviewForRun', () => {
  it('matches by run_id', () => {
    const older = review({ id: 'review-1', run_id: 'run-1' });
    const newer = review({ id: 'review-2', run_id: 'run-2' });
    const reviews = [newer, older]; // newest-first, per GET /pulls/:id/reviews ordering

    expect(pickReviewForRun(reviews, 'run-1')).toBe(older);
    expect(pickReviewForRun(reviews, 'run-2')).toBe(newer);
  });

  it('falls back to the newest review when no run_id matches', () => {
    const newest = review({ id: 'review-2', run_id: 'run-2' });
    const older = review({ id: 'review-1', run_id: 'run-1' });
    const reviews = [newest, older];

    expect(pickReviewForRun(reviews, 'run-missing')).toBe(newest);
  });

  it('returns undefined when there are no reviews at all', () => {
    expect(pickReviewForRun([], 'run-1')).toBeUndefined();
  });
});

describe('toAgentSummary', () => {
  it('projects the concise agent fields', () => {
    const agent: AgentDto = {
      id: 'agent-1',
      name: 'security-reviewer',
      description: 'Finds security issues',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    };
    expect(toAgentSummary(agent)).toEqual({
      id: 'agent-1',
      name: 'security-reviewer',
      description: 'Finds security issues',
      provider: 'openai',
      model: 'gpt-4.1',
      enabled: true,
    });
  });
});

describe('toConventionSummary', () => {
  it('projects the concise convention fields', () => {
    const convention: ConventionDto = {
      id: 'conv-1',
      rule: 'Use zod for input validation',
      evidence_path: 'src/schemas.ts',
      evidence_line: 5,
      evidence_snippet: 'z.object({...})',
      confidence: 0.8,
      accepted: true,
    };
    expect(toConventionSummary(convention)).toEqual({
      rule: 'Use zod for input validation',
      evidence_path: 'src/schemas.ts',
      evidence_line: 5,
      confidence: 0.8,
    });
  });
});
