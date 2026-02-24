import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { PrerequisiteStatus } from '../shared/types.js';
import { gitVersion } from './git.js';

const execFileAsync = promisify(execFile);

const MIN_GIT_MAJOR = 2;
const MIN_GIT_MINOR = 17;

export async function checkGit(): Promise<PrerequisiteStatus['git']> {
  const info = await gitVersion();
  if (!info) {
    return { available: false };
  }
  const meetsMinimum =
    info.major > MIN_GIT_MAJOR ||
    (info.major === MIN_GIT_MAJOR && info.minor >= MIN_GIT_MINOR);
  return {
    available: true,
    version: info.version,
    meetsMinimum,
  };
}

export async function findClaudeCode(): Promise<PrerequisiteStatus['claudeCode']> {
  try {
    const { stdout } = await execFileAsync('where.exe', ['claude']);
    const firstMatch = stdout.trim().split('\n')[0];
    return { available: true, path: firstMatch };
  } catch {
    return { available: false };
  }
}

export async function checkAllPrerequisites(): Promise<PrerequisiteStatus> {
  const [gitStatus, claudeCode] = await Promise.all([
    checkGit(),
    findClaudeCode(),
  ]);
  return { git: gitStatus, claudeCode };
}
