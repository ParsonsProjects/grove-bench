import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { MAX_LISTED, TurnFiles, isListable, type WatchFn } from './turn-files.js';

const ROOT = path.resolve('/wt');
const START = 1_000_000;

/** A watcher the test drives: `change(rel)` reports a change under the root. */
function fakeWatch() {
  let onChange: ((rel: string) => void) | null = null;
  let onError: ((err: unknown) => void) | null = null;
  const close = vi.fn();
  const watch: WatchFn = (_root, change, error) => {
    onChange = change;
    onError = error;
    return { close };
  };
  return { watch, close, change: (rel: string) => onChange?.(rel), fail: (err: unknown) => onError?.(err) };
}

type FakeStat = { size?: number; mtimeMs?: number; birthtimeMs?: number; dir?: boolean };

/** Stats by absolute path; a path not listed is gone. */
function fakeStat(files: Record<string, FakeStat>) {
  return async (p: string) => {
    const rel = path.relative(ROOT, p).split(path.sep).join('/');
    const f = files[rel];
    if (!f) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return {
      isFile: () => !f.dir,
      size: f.size ?? 100,
      mtimeMs: f.mtimeMs ?? START + 10,
      birthtimeMs: f.birthtimeMs ?? START + 10,
    };
  };
}

function turn(files: Record<string, FakeStat>, platform: NodeJS.Platform = 'linux') {
  const w = fakeWatch();
  const t = new TurnFiles(ROOT, START, { watch: w.watch, stat: fakeStat(files), platform });
  return { t, ...w };
}

describe('isListable', () => {
  it('takes output to look at, not source code or logs', () => {
    for (const p of ['shot.png', 'a/b/chart.SVG', 'report.pdf', 'index.html', 'demo.webm', 'data.csv', 'deck.pptx']) {
      expect(isListable(p)).toBe(true);
    }
    for (const p of ['src/app.ts', 'notes.md', 'out.log', 'data.json', 'Makefile', 'macro.xlsm']) {
      expect(isListable(p)).toBe(false);
    }
  });

  it('skips dependencies, caches and build output, wherever they are', () => {
    expect(isListable('node_modules/pkg/logo.png')).toBe(false);
    expect(isListable('packages/web/node_modules/pkg/logo.png')).toBe(false);
    expect(isListable('dist/assets/logo.png')).toBe(false);
    expect(isListable(path.join('.git', 'x.png'))).toBe(false);
    expect(isListable('coverage/index.html')).toBe(false);
    expect(isListable('Build/logo.png')).toBe(false);
    // A file named like one of those folders is fine.
    expect(isListable('screenshots/dist.png')).toBe(true);
  });
});

describe('TurnFiles', () => {
  it('lists the files that changed during the turn, images first, then by path', async () => {
    const { t, change } = turn({
      'report.pdf': {},
      'shots/b.png': {},
      'shots/a.png': {},
    });
    change('report.pdf');
    change('shots/b.png');
    change('shots/a.png');
    change('shots/a.png');

    const { files, more } = await t.finish();
    expect(files.map((f) => [f.path, f.kind])).toEqual([
      ['shots/a.png', 'image'],
      ['shots/b.png', 'image'],
      ['report.pdf', 'pdf'],
    ]);
    expect(files[0]).toMatchObject({ absPath: path.join(ROOT, 'shots', 'a.png'), size: 100 });
    expect(more).toBe(0);
  });

  it('leaves out files only read during the turn, gone again, empty, or not files', async () => {
    const { t, change } = turn({
      'read.png': { mtimeMs: START - 60_000 },
      'empty.png': { size: 0 },
      'folder.png': { dir: true },
      'kept.png': {},
    });
    for (const p of ['read.png', 'empty.png', 'folder.png', 'temp.png', 'kept.png']) change(p);

    expect((await t.finish()).files.map((f) => f.path)).toEqual(['kept.png']);
  });

  it('allows for file times that trail the clock', async () => {
    const { t, change } = turn({ 'shot.png': { mtimeMs: START - 1500 } });
    change('shot.png');
    expect((await t.finish()).files).toHaveLength(1);
  });

  it('ignores changes it would never list', async () => {
    const { t, change } = turn({ 'src/app.ts': {}, 'node_modules/x/logo.png': {} });
    change('src/app.ts');
    change('node_modules/x/logo.png');
    expect((await t.finish()).files).toEqual([]);
  });

  it('lists a web page only when the turn made it, not one it edited', async () => {
    const { t, change } = turn({
      'report.html': {},
      'old.html': { birthtimeMs: START - 60_000 },
      'edited.html': {},
      'unknown.html': { birthtimeMs: 0 },
    });
    t.noteEdited(path.join(ROOT, 'edited.html'));
    for (const p of ['report.html', 'old.html', 'edited.html', 'unknown.html']) change(p);

    expect((await t.finish()).files.map((f) => f.path)).toEqual(['report.html']);
  });

  it('matches an edited path whatever its case on Windows', async () => {
    const { t, change } = turn({ 'Index.html': {} }, 'win32');
    t.noteEdited('index.HTML');
    change('Index.html');
    expect((await t.finish()).files).toEqual([]);
  });

  it(`lists at most ${MAX_LISTED} files and counts the rest`, async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_LISTED + 3 }, (_, i) => [`s${String(i).padStart(2, '0')}.png`, {}]));
    const { t, change } = turn(files);
    for (const p of Object.keys(files)) change(p);

    const res = await t.finish();
    expect(res.files).toHaveLength(MAX_LISTED);
    expect(res.more).toBe(3);
  });

  it('stops watching when it finishes or closes, and on a watch error', async () => {
    const a = turn({});
    await a.t.finish();
    expect(a.close).toHaveBeenCalledTimes(1);

    const b = turn({ 'late.png': {} });
    b.fail(new Error('EPERM'));
    expect(b.close).toHaveBeenCalledTimes(1);
    b.change('late.png');
    b.t.close();
    expect(b.close).toHaveBeenCalledTimes(1);
  });

  it('lists nothing when the folder cannot be watched', async () => {
    const t = new TurnFiles(ROOT, START, { watch: () => { throw new Error('ENOENT'); }, stat: fakeStat({}) });
    expect(await t.finish()).toEqual({ files: [], more: 0 });
  });
});

describe('TurnFiles on a real folder', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('sees a screenshot a script saves in a subfolder', async () => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grove-turn-')));
    fs.mkdirSync(path.join(dir, 'shots'));
    fs.writeFileSync(path.join(dir, 'before.png'), 'old');
    const t = new TurnFiles(dir);

    fs.writeFileSync(path.join(dir, 'shots', 'home.png'), 'png');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not listed');
    // Watch events arrive asynchronously.
    await vi.waitFor(async () => {
      const probe = await peek(t);
      expect(probe).toContain('shots/home.png');
    }, { timeout: 3000, interval: 50 });

    const { files } = await t.finish();
    expect(files.map((f) => f.path)).toEqual(['shots/home.png']);
  });
});

/** What a turn would list now, without ending it. */
async function peek(t: TurnFiles): Promise<string[]> {
  const candidates = (t as unknown as { candidates: Set<string> }).candidates;
  return [...candidates].map((c) => c.split(path.sep).join('/'));
}
