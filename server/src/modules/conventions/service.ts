import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { ConventionCandidate } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import * as schema from '../../db/schema.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { SkillsService } from '../skills/service.js';
import { ConventionsRepository, toDto } from './repository.js';

const CONFIG_FILE_CANDIDATES = [
  'eslint.config.js',
  'eslint.config.mjs',
  'eslint.config.ts',
  '.eslintrc.js',
  '.eslintrc.json',
  '.eslintrc.yml',
  '.eslintrc.yaml',
  'tsconfig.json',
  'tsconfig.base.json',
  'prettier.config.js',
  'prettier.config.mjs',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yml',
];

const MAX_CONFIG_LINES = 200;
const MAX_SOURCE_LINES = 80;
const CONVENTION_SAMPLE_COUNT = 12;

const LlmCandidate = z.object({
  rule: z.string().min(1),
  evidence_path: z.string(),
  evidence_line: z.number().int().nonnegative().nullable().optional(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
});

const ExtractionSchema = z.object({
  candidates: z.array(LlmCandidate),
});

function truncate(content: string, maxLines: number): string {
  const lines = content.split('\n');
  return lines.length <= maxLines
    ? content
    : lines.slice(0, maxLines).join('\n') + `\n…(${lines.length - maxLines} more lines)`;
}

async function readFileIfExists(path: string, maxLines: number): Promise<string | null> {
  try {
    await access(path);
    const content = await readFile(path, 'utf8');
    return truncate(content, maxLines);
  } catch {
    return null;
  }
}

export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = new ConventionsRepository(container.db);
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const rows = await this.repo.list(workspaceId, repoId);
    return rows.map(toDto);
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionCandidate[]> {
    const [repoRow] = await this.container.db
      .select({
        clonePath: schema.repos.clonePath,
        fullName: schema.repos.fullName,
        defaultBranch: schema.repos.defaultBranch,
      })
      .from(schema.repos)
      .where(eq(schema.repos.id, repoId));

    if (!repoRow?.clonePath) {
      throw new Error('Repository is not cloned yet. Please wait for indexing to complete.');
    }

    const clonePath = repoRow.clonePath;
    const sections: string[] = [];

    // Read config files
    const configParts: string[] = [];
    for (const filename of CONFIG_FILE_CANDIDATES) {
      const content = await readFileIfExists(join(clonePath, filename), MAX_CONFIG_LINES);
      if (content) {
        configParts.push(`### ${filename}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
    if (configParts.length > 0) {
      sections.push(`## Configuration Files\n\n${configParts.join('\n\n')}`);
    }

    // Read top-ranked source files
    const samplePaths = await this.container.repoIntel.getConventionSamples(
      repoId,
      CONVENTION_SAMPLE_COUNT,
    );

    const sourceParts: string[] = [];
    for (const relPath of samplePaths) {
      const content = await readFileIfExists(join(clonePath, relPath), MAX_SOURCE_LINES);
      if (content) {
        sourceParts.push(`### ${relPath}\n\`\`\`\n${content}\n\`\`\``);
      }
    }
    if (sourceParts.length > 0) {
      sections.push(`## Source Files\n\n${sourceParts.join('\n\n')}`);
    }

    if (sections.length === 0) {
      return [];
    }

    const { provider, model } = await resolveFeatureModel(
      this.container,
      workspaceId,
      'conventions',
    );

    const llm = await this.container.llm(provider as 'openai' | 'anthropic' | 'openrouter');

    const result = await llm.completeStructured({
      model,
      schema: ExtractionSchema,
      schemaName: 'convention_extraction',
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content:
            'You are a code convention extractor. Analyze the provided configuration files and ' +
            'representative source files and return a list of coding conventions you observe. ' +
            'Each convention must cite exact evidence from the provided files. ' +
            'Only return rules clearly evidenced in the files — do not invent rules. ' +
            'Return 8–15 high-quality, specific conventions (not generic advice).',
        },
        {
          role: 'user',
          content: sections.join('\n\n'),
        },
      ],
    });

    // Code-validate each candidate: file must exist, snippet must appear in file
    const validated: typeof result.data.candidates = [];
    for (const candidate of result.data.candidates) {
      if (!candidate.evidence_path || !candidate.rule) continue;

      const filePath = join(clonePath, candidate.evidence_path);
      const content = await readFileIfExists(filePath, Infinity);
      if (!content) continue;

      if (candidate.evidence_snippet && !content.includes(candidate.evidence_snippet)) continue;

      validated.push(candidate);
    }

    await this.repo.deleteByRepo(workspaceId, repoId);
    const inserted = await this.repo.insert(
      workspaceId,
      repoId,
      validated.map((c) => ({
        rule: c.rule,
        evidencePath: c.evidence_path,
        evidenceLine: c.evidence_line ?? null,
        evidenceSnippet: c.evidence_snippet,
        confidence: c.confidence,
      })),
    );

    return inserted.map(toDto);
  }

  async createSkill(
    workspaceId: string,
    candidateIds: string[],
    name: string,
    description: string,
  ): Promise<{ skillId: string }> {
    const rows = await this.repo.findByIds(workspaceId, candidateIds);
    if (rows.length === 0) {
      throw new Error('No candidates found for the given IDs.');
    }

    const body =
      `# ${name}\n\n` +
      `The following coding conventions were extracted from this repository and validated against source files.\n\n` +
      rows
        .map(
          (c) =>
            `## ${c.rule}\n\n` +
            `**Evidence:** \`${c.evidencePath ?? ''}\`\n\n` +
            (c.evidenceSnippet ? `\`\`\`\n${c.evidenceSnippet}\n\`\`\`` : ''),
        )
        .join('\n\n');

    const skillsService = new SkillsService(this.container.db);
    const skill = await skillsService.create(workspaceId, {
      name,
      description,
      type: 'convention',
      source: 'extracted',
      body,
      enabled: true,
    });

    return { skillId: skill.id };
  }
}
