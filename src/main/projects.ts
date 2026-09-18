/**
 * Projects — the sidebar's top-level grouping, persisted in projects.json
 * under userData.
 *
 * Before this file existed the project list was derived from the worktree
 * manifest (the distinct `repoPath` values), so a project with no
 * conversations vanished on restart and had nothing to hang a name on.
 * `ensureProjectsForPaths()` adopts those manifest paths on first load.
 *
 * A project has exactly one workspace today, and `workspaces[0].path` is the
 * `repoPath` everything else (memory, colors, manifest) keys on. Phase 2/3 of
 * docs/projects-plan.md add folder workspaces and several workspaces per
 * project.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { app } from 'electron';
import { z } from 'zod';

import type { Project, ProjectWorkspace } from '../shared/types.js';
import { migrateRaw, stampSchemaVersion, type Migration } from './persisted-state.js';

export interface ProjectsFile {
  projects: Project[];
}

// ─── Schema versioning ───

/** Bump when a persisted field changes meaning or shape, and add a migration
 *  below. New optional fields need no bump. */
export const PROJECTS_SCHEMA_VERSION = 1;

/** `PROJECTS_MIGRATIONS[n]` upgrades a version-n file to n+1. */
export const PROJECTS_MIGRATIONS: readonly Migration[] = [
  // 0 → 1: the file has always been versioned; this step only gives future
  // migrations a well-defined starting point.
  (raw) => raw,
];

// ─── Validation ───

const workspaceSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['git', 'folder']),
}) satisfies z.ZodType<ProjectWorkspace, unknown>;

const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  workspaces: z.array(workspaceSchema).min(1),
  createdAt: z.number().finite(),
}) satisfies z.ZodType<Project, unknown>;

/** Normalize a raw file into a project list. A corrupt entry is dropped; a
 *  corrupt file yields an empty list. Never throws. */
export function validateProjects(raw: unknown): Project[] {
  const list = typeof raw === 'object' && raw !== null && Array.isArray((raw as { projects?: unknown }).projects)
    ? (raw as { projects: unknown[] }).projects
    : [];
  const projects: Project[] = [];
  const seenIds = new Set<string>();
  for (const entry of list) {
    const result = projectSchema.safeParse(entry);
    if (!result.success || seenIds.has(result.data.id)) continue;
    seenIds.add(result.data.id);
    projects.push({ ...result.data, name: result.data.name.trim() || defaultProjectName(result.data.workspaces[0].path) });
  }
  return projects;
}

/** Migrate + validate a parsed projects.json. Exported for tests. */
export function upgradeProjects(raw: unknown): { projects: Project[]; migrated: boolean; fromVersion: number } {
  const { data, migrated, fromVersion, newerThanApp } = migrateRaw(raw, PROJECTS_MIGRATIONS, PROJECTS_SCHEMA_VERSION);
  if (newerThanApp) {
    console.warn(`[projects] projects.json is schema v${fromVersion}, newer than this app (v${PROJECTS_SCHEMA_VERSION})`);
  }
  return { projects: validateProjects(data), migrated, fromVersion };
}

// ─── Paths and names ───

/** The folder name of a path, which is what a project is called until the
 *  user renames it. Handles both separators so a Windows path read on any
 *  platform (tests, demo) still yields the last segment. */
export function defaultProjectName(workspacePath: string): string {
  const trimmed = workspacePath.replace(/[\\/]+$/, '');
  const last = trimmed.split(/[\\/]/).pop();
  return last || workspacePath;
}

/** Compare two workspace paths the way the file system does: separators and
 *  trailing slashes normalised, and case-insensitive on Windows. */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => {
    let out = path.normalize(p).replace(/[\\/]+$/, '');
    if (process.platform === 'win32') out = out.toLowerCase();
    return out;
  };
  return norm(a) === norm(b);
}

function newId(): string {
  return crypto.randomUUID().slice(0, 8);
}

// ─── Persistence ───

function getProjectsPath(): string {
  return path.join(app.getPath('userData'), 'projects.json');
}

function writeProjects(projects: Project[]): void {
  const file: ProjectsFile = { projects };
  fs.writeFileSync(getProjectsPath(), JSON.stringify(stampSchemaVersion(file, PROJECTS_SCHEMA_VERSION), null, 2));
}

export function loadProjects(): Project[] {
  try {
    const data = fs.readFileSync(getProjectsPath(), 'utf-8');
    const { projects, migrated } = upgradeProjects(JSON.parse(data));
    if (migrated) {
      try { writeProjects(projects); } catch { /* ignore */ }
    }
    return projects;
  } catch {
    return [];
  }
}

/** Read-modify-write projects.json. Unlike app-state this is not debounced:
 *  project changes are rare, user-initiated, and must be on disk before the
 *  IPC call returns so a crash right after "add" cannot lose the project. */
function updateProjects<T>(mutate: (projects: Project[]) => T): T {
  const projects = loadProjects();
  const result = mutate(projects);
  writeProjects(projects);
  return result;
}

// ─── API ───

export function listProjects(): Project[] {
  return loadProjects();
}

export function getProject(projectId: string): Project | undefined {
  return loadProjects().find((p) => p.id === projectId);
}

export function findProjectByPath(workspacePath: string): Project | undefined {
  return loadProjects().find((p) => p.workspaces.some((w) => samePath(w.path, workspacePath)));
}

/** The project whose workspace is `workspacePath`, created if there is none.
 *  Idempotent, so callers can use it as "make sure this path has a project". */
export function ensureProjectForPath(workspacePath: string, kind: ProjectWorkspace['kind'] = 'git'): Project {
  return updateProjects((projects) => {
    const existing = projects.find((p) => p.workspaces.some((w) => samePath(w.path, workspacePath)));
    if (existing) return existing;
    const project: Project = {
      id: newId(),
      name: defaultProjectName(workspacePath),
      workspaces: [{ id: newId(), path: workspacePath, kind }],
      createdAt: Date.now(),
    };
    projects.push(project);
    return project;
  });
}

/** Adopt every path that has no project yet, in one write. Used at startup
 *  to migrate the manifest-derived repo list, and harmless afterwards. */
export function ensureProjectsForPaths(workspacePaths: string[]): Project[] {
  return updateProjects((projects) => {
    for (const workspacePath of workspacePaths) {
      if (projects.some((p) => p.workspaces.some((w) => samePath(w.path, workspacePath)))) continue;
      projects.push({
        id: newId(),
        name: defaultProjectName(workspacePath),
        workspaces: [{ id: newId(), path: workspacePath, kind: 'git' }],
        createdAt: Date.now(),
      });
    }
    return projects;
  });
}

/** Rename a project. An empty name reverts to the folder name. */
export function renameProject(projectId: string, name: string): Project {
  return updateProjects((projects) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found');
    project.name = name.trim() || defaultProjectName(project.workspaces[0].path);
    return project;
  });
}

/** Forget a project. Files on disk are untouched; the caller has already
 *  checked for running conversations and swept orphan worktrees. */
export function removeProject(projectId: string): void {
  updateProjects((projects) => {
    const index = projects.findIndex((p) => p.id === projectId);
    if (index >= 0) projects.splice(index, 1);
  });
}
