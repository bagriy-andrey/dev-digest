import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock `node:child_process` so the shell-adapter tests never invoke a real
// `git` binary (spec M2: "no real git invocation" in the test suite).
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { createGitPort, MODE_DIFF_ARGS, parseRemoteUrl } from '../src/git.js';

type ExecFileCallback = (error: Error | null, stdout: string, stderr?: string) => void;
const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  execFileMock.mockReset();
});

describe('MODE_DIFF_ARGS', () => {
  it('maps working -> bare `git diff`', () => {
    expect(MODE_DIFF_ARGS.working).toEqual(['diff']);
  });

  it('maps staged -> `git diff --cached`', () => {
    expect(MODE_DIFF_ARGS.staged).toEqual(['diff', '--cached']);
  });

  it('maps branch -> null (not yet implemented in v1)', () => {
    expect(MODE_DIFF_ARGS.branch).toBeNull();
  });
});

describe('createGitPort — diff()', () => {
  it('throws a clear not-implemented error for mode "branch"', async () => {
    const port = createGitPort('/repo');
    await expect(port.diff('branch')).rejects.toThrow(/not yet implemented/i);
    // The `branch` case must never shell out.
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('shells `git diff` for mode "working" via execFile (array args, no shell string)', async () => {
    execFileMock.mockImplementationOnce(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, 'diff --git a/x b/x\n');
      },
    );

    const port = createGitPort('/repo');
    const diff = await port.diff('working');

    expect(diff).toBe('diff --git a/x b/x\n');
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [file, args, options] = execFileMock.mock.calls[0] as [string, string[], { cwd: string }];
    expect(file).toBe('git');
    expect(args).toEqual(['diff']);
    expect(options.cwd).toBe('/repo');
  });

  it('shells `git diff --cached` for mode "staged"', async () => {
    execFileMock.mockImplementationOnce(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, '');
      },
    );

    const port = createGitPort('/repo');
    await port.diff('staged');

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['diff', '--cached']);
  });
});

describe('createGitPort — remoteUrl()', () => {
  it('uses `git remote get-url origin` when it succeeds', async () => {
    execFileMock.mockImplementationOnce(
      (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
        callback(null, 'git@github.com:owner/name.git\n');
      },
    );

    const port = createGitPort('/repo');
    const url = await port.remoteUrl();

    expect(url).toBe('git@github.com:owner/name.git');
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    expect(args).toEqual(['remote', 'get-url', 'origin']);
  });

  it('falls back to `git config --get remote.origin.url` when the primary command fails', async () => {
    execFileMock
      .mockImplementationOnce(
        (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
          callback(new Error('fatal: No such remote origin'), '');
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], _options: unknown, callback: ExecFileCallback) => {
          callback(null, 'https://github.com/owner/name.git\n');
        },
      );

    const port = createGitPort('/repo');
    const url = await port.remoteUrl();

    expect(url).toBe('https://github.com/owner/name.git');
    expect(execFileMock).toHaveBeenCalledTimes(2);
    const [, secondArgs] = execFileMock.mock.calls[1] as [string, string[]];
    expect(secondArgs).toEqual(['config', '--get', 'remote.origin.url']);
  });
});

describe('parseRemoteUrl', () => {
  it.each([
    ['git@github.com:owner/name.git', { owner: 'owner', name: 'name' }],
    ['git@github.com:owner/name', { owner: 'owner', name: 'name' }],
    ['git@github.com:owner/name/', { owner: 'owner', name: 'name' }],
    ['git@github.com:owner/name.git/', { owner: 'owner', name: 'name' }],
    ['https://github.com/owner/name.git', { owner: 'owner', name: 'name' }],
    ['https://github.com/owner/name', { owner: 'owner', name: 'name' }],
    ['https://github.com/owner/name/', { owner: 'owner', name: 'name' }],
    ['http://github.com/owner/name.git', { owner: 'owner', name: 'name' }],
    ['git@github.com:Owner/Name.git', { owner: 'Owner', name: 'Name' }],
  ] as const)('parses %s -> %o', (url, expected) => {
    expect(parseRemoteUrl(url)).toEqual(expected);
  });

  it.each([
    '',
    '   ',
    'not-a-url',
    'ftp://example.com/owner/name.git',
    'git@github.com:onlyowner',
    'https://github.com/owner',
    'just some garbage text with spaces',
  ])('returns null for unrecognized input %j', (url) => {
    expect(parseRemoteUrl(url)).toBeNull();
  });
});
