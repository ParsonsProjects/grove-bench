import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { MemoryEntry } from '../shared/types.js';

// ─── Types ───

interface RepoIndex {
  repoPath: string;
  createdAt: string;
}

// ─── Constants ───

const MEMORY_ROOT = () => path.join(app.getPath('userData'), 'memory');

const DEFAULT_FOLDERS = ['repo', 'conventions', 'architecture', 'sessions'];

const MAX_SYSTEM_PROMPT_BYTES = 16 * 1024; // ~4K tokens

// ─── Path helpers ───

export function sanitizeRepoPath(repoPath: string): string {
  return repoPath
    .toLowerCase()
    .replace(/[:\\\/]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+/g, '-');
}

export function getMemoryDir(repoPath: string): string {
  return path.join(MEMORY_ROOT(), sanitizeRepoPath(repoPath));
}

function validateAndResolvePath(repoPath: string, relativePath: string): string {
  const normalized = path.normalize(relativePath);
  if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
    throw new Error(`Invalid memory path: ${relativePath}`);
  }
  // Block _index.json from being read/written via the memory tools
  if (normalized === '_index.json') {
    throw new Error('Cannot access _index.json via memory tools');
  }
  // Post-join containment check to prevent any path traversal
  const memDir = getMemoryDir(repoPath);
  const resolved = path.resolve(memDir, normalized);
  if (!resolved.startsWith(memDir + path.sep) && resolved !== memDir) {
    throw new Error(`Invalid memory path: ${relativePath}`);
  }
  return resolved;
}

// ─── Frontmatter parsing ───

function parseFrontmatter(content: string): { title: string; updatedAt: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { title: '', updatedAt: '' };

  const block = match[1];
  const title = block.match(/^title:\s*"?([^"\n]*)"?/m)?.[1]?.trim() ?? '';
  const updatedAt = block.match(/^updatedAt:\s*"?([^"\n]*)"?/m)?.[1]?.trim() ?? '';
  return { title, updatedAt };
}

// ─── Core operations ───

export function ensureRepoMemory(repoPath: string): void {
  const dir = getMemoryDir(repoPath);
  if (fs.existsSync(dir)) return;

  fs.mkdirSync(dir, { recursive: true });
  for (const folder of DEFAULT_FOLDERS) {
    fs.mkdirSync(path.join(dir, folder), { recursive: true });
  }

  const index: RepoIndex = { repoPath, createdAt: new Date().toISOString() };
  fs.writeFileSync(path.join(dir, '_index.json'), JSON.stringify(index, null, 2));
}

export function listMemoryFiles(repoPath: string): MemoryEntry[] {
  const dir = getMemoryDir(repoPath);
  if (!fs.existsSync(dir)) return [];

  const entries: MemoryEntry[] = [];

  function walk(currentDir: string, prefix: string) {
    let items: fs.Dirent[];
    try {
      items = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (item.name.startsWith('_')) continue;
      const fullPath = path.join(currentDir, item.name);
      const relPath = prefix ? `${prefix}/${item.name}` : item.name;

      if (item.isDirectory()) {
        walk(fullPath, relPath);
      } else if (item.name.endsWith('.md')) {
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const { title, updatedAt } = parseFrontmatter(content);
          entries.push({
            relativePath: relPath,
            title: title || item.name.replace(/\.md$/, ''),
            updatedAt,
            folder: prefix || '.',
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(dir, '');
  return entries;
}

export function readMemoryFile(repoPath: string, relativePath: string): string | null {
  const filePath = validateAndResolvePath(repoPath, relativePath);
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

export function writeMemoryFile(repoPath: string, relativePath: string, content: string): void {
  if (!relativePath.endsWith('.md')) {
    throw new Error('Memory files must have a .md extension');
  }

  const filePath = validateAndResolvePath(repoPath, relativePath);
  ensureRepoMemory(repoPath);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content);
}

export function deleteMemoryFile(repoPath: string, relativePath: string): boolean {
  const filePath = validateAndResolvePath(repoPath, relativePath);
  try {
    fs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

// ─── System prompt builder ───

export function getMemoryForSystemPrompt(repoPath: string): string {
  const entries = listMemoryFiles(repoPath);
  if (entries.length === 0) return '';

  const repoEntries = entries.filter(e => !e.folder.startsWith('sessions'));
  const sessionEntries = entries.filter(e => e.folder.startsWith('sessions'));

  const blocks: string[] = [];
  let totalSize = 0;
  const skippedFiles: string[] = [];

  for (const entry of repoEntries) {
    const content = readMemoryFile(repoPath, entry.relativePath);
    if (!content) continue;

    // Strip frontmatter first, then check size consistently
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '').trim();
    if (!body) continue;

    if (totalSize + body.length > MAX_SYSTEM_PROMPT_BYTES) {
      skippedFiles.push(entry.relativePath);
      continue;
    }

    blocks.push(`## ${entry.title || entry.relativePath}\n${body}`);
    totalSize += body.length;
  }

  let prompt = '';

  if (blocks.length > 0) {
    prompt += '<project_memory>\n' + blocks.join('\n\n') + '\n</project_memory>\n\n';
  }

  if (skippedFiles.length > 0) {
    prompt += `Additional memory files available (use memory_read to access): ${skippedFiles.join(', ')}\n\n`;
  }

  if (sessionEntries.length > 0) {
    const sessionList = sessionEntries.map(e => e.relativePath).join(', ');
    prompt += `Session memory files available: ${sessionList}\n\n`;
  }

  prompt += `You have access to project memory tools (memory_list, memory_read, memory_write, memory_delete) to manage persistent notes about this project.

IMPORTANT — You MUST proactively save to memory. Do not wait to be asked. Follow these rules:
- On your FIRST interaction with a project that has no memory files, immediately explore the codebase and save: tech stack, framework, language, build tools, project structure, and key architectural patterns.
- Whenever you discover something new about the project (conventions, patterns, important decisions, gotchas), save or update the relevant memory file right away.
- When the user corrects you or clarifies how something works, save that correction to memory so it is never forgotten.
- At the end of a substantial conversation, save a summary of what was accomplished and any important context to a session memory file.
- Always use memory_read before memory_write to check existing content and avoid duplicates or contradictions. Update existing files rather than creating new ones when the topic already has a file.
- Organize files into folders: repo/ (overview, tech stack), conventions/ (naming, patterns), architecture/ (data flow, modules), sessions/ (per-session notes).
- Memory files use markdown with YAML frontmatter (title, updatedAt).

PLANS & TODO LISTS — When working on multi-step tasks or plans:
- ALWAYS save your current plan and todo list to memory (e.g. "sessions/current-plan.md") before starting work. This is critical because context compaction will erase your working memory.
- The todo file should include: the goal, each step with a status (pending/in-progress/done), and any important decisions or blockers.
- Update the todo file in memory each time you complete a step or the plan changes.
- After context compaction, immediately use memory_read on your plan/todo file to restore your understanding of where you are.
- When the plan is fully complete, update the file to mark it done with a summary of what was accomplished.`;

  return prompt;
}
