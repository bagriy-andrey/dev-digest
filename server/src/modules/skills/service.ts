import AdmZip from 'adm-zip';
import type { Skill, SkillSource, SkillType } from '@devdigest/shared';
import { SkillsRepository, toSkillDto, type InsertSkill, type SkillStats } from './repository.js';
import type { Db } from '../../db/client.js';

export type { SkillStats };

export interface CreateSkillInput {
  name: string;
  description?: string;
  type: SkillType;
  body: string;
  source?: SkillSource;
  enabled?: boolean;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
}

export interface ImportPreview {
  name: string;
  body: string;
  source: SkillSource;
}

export class SkillsService {
  private repo: SkillsRepository;

  constructor(db: Db) {
    this.repo = new SkillsRepository(db);
  }

  async list(workspaceId: string): Promise<Skill[]> {
    const rows = await this.repo.list(workspaceId);
    return rows.map(toSkillDto);
  }

  async get(workspaceId: string, id: string): Promise<Skill | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    return row ? toSkillDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateSkillInput): Promise<Skill> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      type: input.type,
      source: input.source ?? 'manual',
      body: input.body,
      enabled: input.enabled,
    });
    return toSkillDto(row);
  }

  async update(workspaceId: string, id: string, input: UpdateSkillInput): Promise<Skill | undefined> {
    const row = await this.repo.update(workspaceId, id, input);
    return row ? toSkillDto(row) : undefined;
  }

  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  async getStats(workspaceId: string, id: string): Promise<SkillStats | undefined> {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    return this.repo.getStats(workspaceId, id);
  }

  async listVersions(workspaceId: string, id: string) {
    const skill = await this.repo.getById(workspaceId, id);
    if (!skill) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map((r) => ({
      skill_id: r.skillId,
      version: r.version,
      body: r.body,
      created_at: r.createdAt.toISOString(),
    }));
  }

  parseMarkdownFile(filename: string, text: string): ImportPreview {
    const headingMatch = text.match(/^#\s+(.+)$/m);
    const name = headingMatch?.[1]?.trim() ?? filename.replace(/\.md$/i, '');
    return { name, body: text, source: 'manual' };
  }

  parseZipFile(buffer: Buffer): ImportPreview {
    const zip = new AdmZip(buffer);
    const EXEC_EXT = /\.(sh|bash|js|mjs|cjs|ts|mts|py|rb|pl|php|go|rs|java|c|cpp)$/i;
    const entry = zip
      .getEntries()
      .find((e) => e.entryName.endsWith('.md') && !EXEC_EXT.test(e.entryName));
    if (!entry) throw new Error('No markdown file found in archive');
    const text = entry.getData().toString('utf8');
    const filename = entry.entryName.split('/').pop() ?? 'skill.md';
    return this.parseMarkdownFile(filename, text);
  }
}
