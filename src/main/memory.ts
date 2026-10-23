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

/** All that memory adds to the system prompt (~4K tokens): the conventions
 *  loaded in full plus the index lines. */
export const MAX_SYSTEM_PROMPT_BYTES = 16 * 1024;

/** conventions/ files load in full up to this many bytes; the rest are only
 *  listed in the index, like every other folder. */
export const FULL_CONVENTIONS_BYTES = 6 * 1024;

/** Thread notes (sessions/) older than this are archived. */
export const SESSION_NOTE_MAX_AGE_DAYS = 30;

/** Thread notes kept at most, newest first. */
export const MAX_SESSION_NOTES = 20;

/** Longest description an index line shows. */
const MAX_INDEX_DESCRIPTION_CHARS = 120;

/** Index order for the folders that last: what the project is, how to work
 *  in it, then how it fits together. Other folders follow, thread notes last. */
const INDEX_FOLDER_ORDER = ['repo', 'conventions', 'architecture'];

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

function parseFrontmatter(content: string): { title: string; description: string; updatedAt: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { title: '', description: '', updatedAt: '' };

  const block = match[1];
  const title = block.match(/^title:\s*"?([^"\n]*)"?/m)?.[1]?.trim() ?? '';
  const description = block.match(/^description:\s*"?([^"\n]*)"?/m)?.[1]?.trim() ?? '';
  const updatedAt = block.match(/^updatedAt:\s*"?([^"\n]*)"?/m)?.[1]?.trim() ?? '';
  return { title, description, updatedAt };
}

/**
 * The file with `description` set in its frontmatter, right after the title
 * (or in place of an empty one), leaving everything else as it was. A file
 * that already has a description is returned unchanged; a file without
 * frontmatter gets one.
 */
export function withDescription(content: string, description: string, fallbackTitle: string): string {
  const quote = (text: string) => `"${oneLine(text, MAX_INDEX_DESCRIPTION_CHARS).replace(/"/g, "'")}"`;
  const match = content.match(/^---(\r?\n)([\s\S]*?)\r?\n---/);
  if (!match) {
    return `---\ntitle: ${quote(fallbackTitle)}\ndescription: ${quote(description)}\n---\n\n${content.trimStart()}`;
  }
  const [frontmatter, newline, block] = match;
  const lines = block.split(/\r?\n/);
  const line = `description: ${quote(description)}`;
  const existing = lines.findIndex(l => /^description:/.test(l));
  if (existing !== -1) {
    if (lines[existing].replace(/^description:[\s"']*/, '').trim()) return content;
    lines[existing] = line;
  } else {
    lines.splice(lines.findIndex(l => /^title:/.test(l)) + 1, 0, line);
  }
  return `---${newline}${lines.join(newline)}${newline}---${content.slice(frontmatter.length)}`;
}

/** The same memory path however it's spelled: ./ prefix, backslashes, or
 *  letter case (Windows paths ignore case). For comparing, not for writing. */
export function memoryPathKey(relativePath: string): string {
  return path.posix.normalize(relativePath.replace(/\\/g, '/')).toLowerCase();
}

/** Whether an entry is in conventions/ or a folder under it. */
export const isConventions = (e: MemoryEntry) => e.folder.split('/')[0] === 'conventions';

export function stripFrontmatter(content: string): string {
  return content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n*/, '').trim();
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

/** Every memory file, or only those under `folder` (e.g. 'sessions'), which
 *  reads just that folder. */
export function listMemoryFiles(repoPath: string, folder?: string): MemoryEntry[] {
  const dir = getMemoryDir(repoPath);
  const root = folder ? path.join(dir, folder) : dir;
  if (!fs.existsSync(root)) return [];

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
          const { title, description, updatedAt } = parseFrontmatter(content);
          entries.push({
            relativePath: relPath,
            title: title || item.name.replace(/\.md$/, ''),
            description,
            updatedAt,
            folder: prefix || '.',
          });
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  walk(root, folder ?? '');
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

// ─── What reaches the agent ───

/**
 * What memory puts in the system prompt: conventions/ in full up to
 * FULL_CONVENTIONS_BYTES, then an index with one line per file, which the
 * agent reads on demand with memory_read. The prompt builder and the panel's
 * meter both use this, so the meter shows exactly what the agent gets.
 */
export interface MemoryPromptPlan {
  /** conventions/ files loaded in full, newest first. */
  full: Array<{ entry: MemoryEntry; body: string }>;
  /** Files listed in the index, thread notes last. */
  indexed: Array<{ entry: MemoryEntry; line: string }>;
  /** Files past the budget: the agent finds them only with memory_list. */
  unlisted: string[];
  /** Bytes the full files and index lines take in the prompt. */
  bytes: number;
}

const isSessionNote = (e: MemoryEntry) => e.folder.startsWith('sessions');

function folderRank(e: MemoryEntry): number {
  if (isSessionNote(e)) return INDEX_FOLDER_ORDER.length + 1;
  const top = e.folder.split('/')[0];
  const i = INDEX_FOLDER_ORDER.indexOf(top);
  return i === -1 ? INDEX_FOLDER_ORDER.length : i;
}

function timestamp(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Folder order, then newest first, then path, so the order is stable. */
export function byIndexOrder(a: MemoryEntry, b: MemoryEntry): number {
  return folderRank(a) - folderRank(b)
    || timestamp(b.updatedAt) - timestamp(a.updatedAt)
    || a.relativePath.localeCompare(b.relativePath);
}

function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** One line of the memory index: path, title, description and, for a thread
 *  note, when it was updated. */
export function indexLine(entry: MemoryEntry): string {
  const title = oneLine(entry.title, MAX_INDEX_DESCRIPTION_CHARS);
  let line = `- ${entry.relativePath}: ${title}`;
  if (entry.description) {
    line += `${/[.!?:]$/.test(title) ? '' : '.'} ${oneLine(entry.description, MAX_INDEX_DESCRIPTION_CHARS)}`;
  }
  if (isSessionNote(entry) && entry.updatedAt) line += ` (updated ${entry.updatedAt.slice(0, 10)})`;
  return line;
}

const bytesOf = (text: string) => Buffer.byteLength(text, 'utf-8');

export function planMemoryPrompt(repoPath: string, files: MemoryEntry[] = listMemoryFiles(repoPath)): MemoryPromptPlan {
  const entries = [...files].sort(byIndexOrder);
  const plan: MemoryPromptPlan = { full: [], indexed: [], unlisted: [], bytes: 0 };

  const toIndex: MemoryEntry[] = [];
  let fullBytes = 0;
  for (const entry of entries) {
    if (!isConventions(entry)) {
      toIndex.push(entry);
      continue;
    }
    const content = readMemoryFile(repoPath, entry.relativePath);
    const body = content ? stripFrontmatter(content) : '';
    if (!body) continue;
    const size = bytesOf(body);
    if (fullBytes + size <= FULL_CONVENTIONS_BYTES) {
      plan.full.push({ entry, body });
      fullBytes += size;
    } else {
      toIndex.push(entry);
    }
  }
  toIndex.sort(byIndexOrder);

  // Stop at the first line that doesn't fit, so what's left out is always
  // the end of the list (oldest thread notes first), never a file in between.
  let indexBytes = 0;
  for (const entry of toIndex) {
    const line = indexLine(entry);
    const size = bytesOf(line) + 1;
    if (plan.unlisted.length === 0 && fullBytes + indexBytes + size <= MAX_SYSTEM_PROMPT_BYTES) {
      plan.indexed.push({ entry, line });
      indexBytes += size;
    } else {
      plan.unlisted.push(entry.relativePath);
    }
  }

  plan.bytes = fullBytes + indexBytes;
  return plan;
}

// ─── Stats ───

export interface MemoryStats {
  /** Bytes memory adds to the system prompt: conventions in full plus the index. */
  promptBytes: number;
  budgetBytes: number;
  /** Files outside sessions/. */
  fileCount: number;
  sessionNoteCount: number;
  /** conventions/ files loaded in full. */
  fullFiles: string[];
  /** Files not listed in the index; the agent finds them only with memory_list. */
  unlistedFiles: string[];
}

/** The panel's meter, from the same plan the prompt builder uses. */
export function getMemoryStats(repoPath: string): MemoryStats {
  const entries = listMemoryFiles(repoPath);
  const plan = planMemoryPrompt(repoPath, entries);
  const sessionNoteCount = entries.filter(isSessionNote).length;
  return {
    promptBytes: plan.bytes,
    budgetBytes: MAX_SYSTEM_PROMPT_BYTES,
    fileCount: entries.length - sessionNoteCount,
    sessionNoteCount,
    fullFiles: plan.full.map(f => f.entry.relativePath),
    unlistedFiles: plan.unlisted,
  };
}

// ─── System prompt builder ───

export function getMemoryForSystemPrompt(repoPath: string): string {
  const entries = listMemoryFiles(repoPath);
  if (entries.length === 0) return '';

  const plan = planMemoryPrompt(repoPath, entries);
  const sections: string[] = [];

  if (plan.full.length > 0) {
    sections.push('## Conventions (loaded in full)\n\n'
      + plan.full.map(({ entry, body }) => `### ${entry.title || entry.relativePath}\n${body}`).join('\n\n'));
  }

  const lasting = plan.indexed.filter(i => !isSessionNote(i.entry));
  const notes = plan.indexed.filter(i => isSessionNote(i.entry));
  if (plan.indexed.length > 0 || plan.unlisted.length > 0) {
    let index = '## Index\n\n'
      + 'Read a file with memory_read when its topic touches your task, before you start on it. '
      + 'This list was taken when the thread started; memory_list shows the current files.';
    if (lasting.length > 0) index += '\n\n' + lasting.map(i => i.line).join('\n');
    if (notes.length > 0) {
      index += `\n\nThread notes (sessions/, archived after ${SESSION_NOTE_MAX_AGE_DAYS} days):\n`
        + notes.map(i => i.line).join('\n');
    }
    if (plan.unlisted.length > 0) {
      index += `\n\n${plan.unlisted.length} more ${plan.unlisted.length === 1 ? 'file is' : 'files are'} not listed here; memory_list shows every file.`;
    }
    sections.push(index);
  }

  let prompt = '';
  if (sections.length > 0) {
    prompt += '<project_memory>\n' + sections.join('\n\n') + '\n</project_memory>\n\n';
  }

  prompt += `You have access to Grove memory tools (memory_list, memory_read, memory_write, memory_delete)
via the grove-memory MCP server to manage persistent notes about this project.
These tools are your PRIMARY memory system — prefer them over any built-in memory.

READING: only conventions/ is loaded in full above. Every other file is listed in the index by path, title and description: use memory_read on the ones that matter for your task.

SAVING: save to memory without being asked.
- On your FIRST interaction with a project that has no memory files, explore the codebase and save: tech stack, framework, language, build tools, project structure, and key architectural patterns.
- When the user corrects you or clarifies how something works, save that correction (usually to conventions/) so it is never forgotten.
- When you learn something that will help future threads in this project (a convention, a pattern, an important decision, a gotcha), save or update the relevant memory file.
- At the end of a substantial conversation, save a summary of what was accomplished and any important context to a thread note in sessions/.
- Always use memory_read before memory_write to check existing content and avoid duplicates or contradictions. Update existing files rather than creating new ones when the topic already has a file.

WHERE THINGS GO:
- repo/: overview, tech stack, project structure.
- conventions/: rules to always follow (naming, patterns, user corrections). Loaded in full into every thread, so keep it short.
- architecture/: data flow, modules and decisions that last and span features.
- sessions/: notes about one feature, task, bug or investigation, and plans. They are archived after ${SESSION_NOTE_MAX_AGE_DAYS} days (at most ${MAX_SESSION_NOTES} are kept), so anything specific to one piece of work goes here, not in architecture/.
- Memory files use markdown with YAML frontmatter: title, description (one line, under 100 characters, shown in the index so future threads know when to read the file) and updatedAt.

PLANS & TODO LISTS — When working on multi-step tasks or plans:
- ALWAYS save your current plan and todo list to memory (e.g. "sessions/current-plan.md") before starting work. This is critical because context compaction will erase your working memory.
- The todo file should include: the goal, each step with a status (pending/in-progress/done), and any important decisions or blockers.
- Update the todo file in memory each time you complete a step or the plan changes.
- After context compaction, immediately use memory_read on your plan/todo file to restore your understanding of where you are.
- When the plan is fully complete, update the file to mark it done with a summary of what was accomplished.`;

  return prompt;
}
