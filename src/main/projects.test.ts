import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockReadFileSync, mockWriteFileSync } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
}));

vi.mock('node:fs', () => ({
  default: {
    readFileSync: mockReadFileSync,
    writeFileSync: mockWriteFileSync,
  },
}));

import {
  loadProjects, listProjects, getProject, findProjectByPath, ensureProjectForPath, ensureProjectsForPaths,
  renameProject, removeProject, validateProjects, upgradeProjects, defaultProjectName, samePath,
  PROJECTS_SCHEMA_VERSION,
} from './projects.js';

/** The file as the last write left it, so read-modify-write chains see their own updates. */
function useDisk(initial: unknown) {
  let disk = initial === undefined ? null : JSON.stringify(initial);
  mockReadFileSync.mockImplementation(() => {
    if (disk === null) throw new Error('ENOENT');
    return disk;
  });
  mockWriteFileSync.mockImplementation((_p: string, data: string) => { disk = data; });
  return { get: () => (disk === null ? null : JSON.parse(disk)) };
}

const stored = (projects: unknown[]) => ({ schemaVersion: PROJECTS_SCHEMA_VERSION, projects });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('defaultProjectName', () => {
  it('uses the last path segment on either separator', () => {
    expect(defaultProjectName('/home/user/grove-bench')).toBe('grove-bench');
    expect(defaultProjectName('C:\\dev\\api-service')).toBe('api-service');
  });

  it('ignores a trailing separator', () => {
    expect(defaultProjectName('/home/user/grove-bench/')).toBe('grove-bench');
    expect(defaultProjectName('C:\\dev\\api-service\\')).toBe('api-service');
  });

  it('falls back to the whole path when there is no segment', () => {
    expect(defaultProjectName('repo')).toBe('repo');
  });
});

describe('samePath', () => {
  it('treats a trailing slash as the same path', () => {
    expect(samePath('/a/b', '/a/b/')).toBe(true);
  });

  it('distinguishes different folders', () => {
    expect(samePath('/a/b', '/a/c')).toBe(false);
  });
});

describe('loadProjects', () => {
  it('returns an empty list when the file is missing', () => {
    useDisk(undefined);
    expect(loadProjects()).toEqual([]);
  });

  it('returns an empty list when the file is not JSON', () => {
    mockReadFileSync.mockReturnValue('{not json');
    expect(loadProjects()).toEqual([]);
  });

  it('reads valid projects back', () => {
    const project = { id: 'p1', name: 'Grove', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    useDisk(stored([project]));
    expect(loadProjects()).toEqual([project]);
  });
});

describe('validateProjects', () => {
  it('drops entries that are missing required fields', () => {
    const good = { id: 'p1', name: 'Grove', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    const noWorkspace = { id: 'p2', name: 'Empty', workspaces: [], createdAt: 5 };
    const badKind = { id: 'p3', name: 'Odd', workspaces: [{ id: 'w3', path: '/repo/c', kind: 'svn' }], createdAt: 5 };
    expect(validateProjects({ projects: [good, noWorkspace, badKind, 'junk', null] })).toEqual([good]);
  });

  it('drops a second project with a duplicate id', () => {
    const a = { id: 'p1', name: 'A', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    const b = { id: 'p1', name: 'B', workspaces: [{ id: 'w2', path: '/repo/b', kind: 'git' }], createdAt: 6 };
    expect(validateProjects({ projects: [a, b] })).toEqual([a]);
  });

  it('replaces a blank name with the folder name', () => {
    const blank = { id: 'p1', name: '   ', workspaces: [{ id: 'w1', path: '/repo/grove', kind: 'git' }], createdAt: 5 };
    expect(validateProjects({ projects: [blank] })[0].name).toBe('grove');
  });

  it('returns an empty list for anything that is not a projects file', () => {
    expect(validateProjects(null)).toEqual([]);
    expect(validateProjects({ projects: 'nope' })).toEqual([]);
    expect(validateProjects([])).toEqual([]);
  });
});

describe('upgradeProjects', () => {
  it('reports the version it read and whether a migration ran', () => {
    const project = { id: 'p1', name: 'Grove', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    const current = upgradeProjects(stored([project]));
    expect(current).toMatchObject({ projects: [project], migrated: false, fromVersion: PROJECTS_SCHEMA_VERSION });

    const unversioned = upgradeProjects({ projects: [project] });
    expect(unversioned).toMatchObject({ projects: [project], migrated: true, fromVersion: 0 });
  });

  it('keeps known fields from a file written by a newer app', () => {
    const project = { id: 'p1', name: 'Grove', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = upgradeProjects({ schemaVersion: PROJECTS_SCHEMA_VERSION + 5, projects: [project] });
    expect(result.projects).toEqual([project]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ensureProjectForPath', () => {
  it('creates a project named after the folder and writes it with a version stamp', () => {
    const disk = useDisk(undefined);
    const project = ensureProjectForPath('/home/user/grove-bench');

    expect(project.name).toBe('grove-bench');
    expect(project.id).toMatch(/^[0-9a-f]{8}$/);
    expect(project.workspaces).toEqual([{ id: expect.stringMatching(/^[0-9a-f]{8}$/), path: '/home/user/grove-bench', kind: 'git' }]);
    expect(disk.get()).toMatchObject({ schemaVersion: PROJECTS_SCHEMA_VERSION, projects: [project] });
  });

  it('returns the existing project for a known path instead of creating another', () => {
    useDisk(undefined);
    const first = ensureProjectForPath('/repo/a');
    const again = ensureProjectForPath('/repo/a/');
    expect(again).toEqual(first);
    expect(listProjects()).toHaveLength(1);
  });

  it('keeps a user-chosen name when the path is ensured again', () => {
    useDisk(undefined);
    const project = ensureProjectForPath('/repo/a');
    renameProject(project.id, 'Custom');
    expect(ensureProjectForPath('/repo/a').name).toBe('Custom');
  });
});

describe('ensureProjectsForPaths', () => {
  it('adopts manifest paths that have no project, in one write, and leaves existing ones alone', () => {
    const existing = { id: 'p1', name: 'Named', workspaces: [{ id: 'w1', path: '/repo/a', kind: 'git' }], createdAt: 5 };
    useDisk(stored([existing]));
    mockWriteFileSync.mockClear();

    const projects = ensureProjectsForPaths(['/repo/a', '/repo/b', '/repo/c']);

    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
    expect(projects.map((p) => p.name)).toEqual(['Named', 'b', 'c']);
    expect(projects[0]).toEqual(existing);
  });

  it('is a no-op when every path already has a project', () => {
    useDisk(undefined);
    ensureProjectsForPaths(['/repo/a']);
    const before = listProjects();
    ensureProjectsForPaths(['/repo/a']);
    expect(listProjects()).toEqual(before);
  });
});

describe('renameProject', () => {
  it('trims and stores the new name', () => {
    useDisk(undefined);
    const project = ensureProjectForPath('/repo/a');
    const renamed = renameProject(project.id, '  Grove Bench  ');
    expect(renamed.name).toBe('Grove Bench');
    expect(getProject(project.id)?.name).toBe('Grove Bench');
  });

  it('reverts to the folder name when given an empty name', () => {
    useDisk(undefined);
    const project = ensureProjectForPath('/repo/grove');
    renameProject(project.id, 'Custom');
    expect(renameProject(project.id, '   ').name).toBe('grove');
  });

  it('throws for an unknown project', () => {
    useDisk(undefined);
    expect(() => renameProject('nope', 'x')).toThrow('Project not found');
  });
});

describe('removeProject / lookups', () => {
  it('removes only the named project', () => {
    useDisk(undefined);
    const a = ensureProjectForPath('/repo/a');
    const b = ensureProjectForPath('/repo/b');
    removeProject(a.id);
    expect(listProjects()).toEqual([b]);
    expect(getProject(a.id)).toBeUndefined();
    expect(findProjectByPath('/repo/b')).toEqual(b);
    expect(findProjectByPath('/repo/a')).toBeUndefined();
  });

  it('ignores an unknown id', () => {
    useDisk(undefined);
    ensureProjectForPath('/repo/a');
    removeProject('nope');
    expect(listProjects()).toHaveLength(1);
  });
});
