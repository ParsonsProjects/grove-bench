import { describe, it, expect, afterEach } from 'vitest';
import { folderOf, localFilePath, localFileTarget, openWorktreeFile, pathFrom } from './worktree-files.js';
import { markdownPreviewStore } from '../stores/markdownPreview.svelte.js';
import { mockGroveBench } from '../__mocks__/setup.js';

describe('localFileTarget', () => {
  it('reads relative and absolute paths and file:// URLs', () => {
    expect(localFileTarget('shots/home.png')).toEqual({ path: 'shots/home.png', hash: '' });
    expect(localFileTarget('./out/report.pdf')).toEqual({ path: './out/report.pdf', hash: '' });
    expect(localFileTarget('C:\\Users\\me\\wt\\r.pdf')).toEqual({ path: 'C:\\Users\\me\\wt\\r.pdf', hash: '' });
    expect(localFileTarget('c:/wt/r.pdf')).toEqual({ path: 'c:/wt/r.pdf', hash: '' });
    expect(localFileTarget('/repo/r.pdf')).toEqual({ path: '/repo/r.pdf', hash: '' });
    // Left encoded: main reads the URL.
    expect(localFileTarget('file:///C:/wt/a%20b.pdf')).toEqual({ path: 'file:///C:/wt/a%20b.pdf', hash: '' });
  });

  it('is null for web addresses, other schemes and in-page links', () => {
    for (const href of ['https://example.com/a.png', 'mailto:a@b.c', 'data:image/png;base64,AA', 'javascript:alert(1)', '//cdn.example.com/a.png', '#top', '?x=1', '', '  ', null, undefined]) {
      expect(localFileTarget(href)).toBeNull();
    }
  });

  it('splits off a query and an anchor, keeping the anchor', () => {
    expect(localFileTarget('report.html#summary')).toEqual({ path: 'report.html', hash: '#summary' });
    expect(localFileTarget('shots/home.png?v=2')).toEqual({ path: 'shots/home.png', hash: '' });
    expect(localFileTarget('a.html?x=1#y')).toEqual({ path: 'a.html', hash: '#y' });
    expect(localFileTarget('file:///C:/wt/r.html#top')).toEqual({ path: 'file:///C:/wt/r.html', hash: '#top' });
  });

  it('splits off a line number, or a line and column, after the path as its lines', () => {
    const line42 = { start: 42, end: 42 };
    expect(localFileTarget('src/app.ts:42')).toEqual({ path: 'src/app.ts', hash: '', lines: line42 });
    expect(localFileTarget('src/app.ts:42:7')).toEqual({ path: 'src/app.ts', hash: '', lines: line42 });
    expect(localFileTarget('C:\\wt\\src\\app.ts:42')).toEqual({ path: 'C:\\wt\\src\\app.ts', hash: '', lines: line42 });
    expect(localFileTarget('file:///C:/wt/app.ts:42')).toEqual({ path: 'file:///C:/wt/app.ts', hash: '', lines: line42 });
    expect(localFileTarget('report.html:3#top')).toEqual({ path: 'report.html', hash: '#top', lines: { start: 3, end: 3 } });
    // No folder: read as a file with a line, not a scheme named app.ts.
    expect(localFileTarget('app.ts:42')).toEqual({ path: 'app.ts', hash: '', lines: line42 });
    expect(localFileTarget('README.md:12:1')).toEqual({ path: 'README.md', hash: '', lines: { start: 12, end: 12 } });
  });

  it('reads a line anchor (#L42, #L42-L50) as lines too', () => {
    expect(localFileTarget('src/app.ts#L42')?.lines).toEqual({ start: 42, end: 42 });
    expect(localFileTarget('src/app.ts#L42-L50')?.lines).toEqual({ start: 42, end: 50 });
    expect(localFileTarget('src/app.ts#L42-50')?.lines).toEqual({ start: 42, end: 50 });
    expect(localFileTarget('src/app.ts#L42C3-L45C1')?.lines).toEqual({ start: 42, end: 45 });
    expect(localFileTarget('src/app.ts#L50-L42')?.lines).toEqual({ start: 42, end: 50 });
    // The anchor stays, for a web page.
    expect(localFileTarget('src/app.ts#L42')?.hash).toBe('#L42');
  });

  it('has no lines without them, or for line 0 or another anchor', () => {
    for (const href of ['src/app.ts', 'src/app.ts:0', 'src/app.ts#top', 'src/app.ts#L', 'src/app.ts#Lx']) {
      expect(localFileTarget(href)?.lines).toBeUndefined();
    }
  });

  it('still reads a scheme, or a host and port, with digits after it as no file', () => {
    for (const href of ['tel:5551234', 'localhost:3000', 'sms:123']) {
      expect(localFileTarget(href)).toBeNull();
    }
  });

  it('keeps a # that a path follows, as in a folder named C#', () => {
    expect(localFileTarget('docs/C#/notes.pdf')).toEqual({ path: 'docs/C#/notes.pdf', hash: '' });
    expect(localFileTarget('docs\\C#\\notes.pdf')).toEqual({ path: 'docs\\C#\\notes.pdf', hash: '' });
  });

  it('decodes escapes after splitting, so %23 is a # in the name', () => {
    expect(localFileTarget('my%20shot.png')).toEqual({ path: 'my shot.png', hash: '' });
    expect(localFileTarget('issue%2342.png')).toEqual({ path: 'issue#42.png', hash: '' });
    // A bad escape is kept as written.
    expect(localFileTarget('100%.png')).toEqual({ path: '100%.png', hash: '' });
  });
});

describe('localFilePath', () => {
  it('is the path alone', () => {
    expect(localFilePath('report.html#summary')).toBe('report.html');
    expect(localFilePath('https://example.com')).toBeNull();
  });
});

describe('folderOf / pathFrom', () => {
  it('gives the folder a file is in, either slash', () => {
    expect(folderOf('docs/plan.md')).toBe('docs');
    expect(folderOf('C:\\wt\\docs\\plan.md')).toBe('C:\\wt\\docs');
    expect(folderOf('plan.md')).toBe('');
  });

  it('reads a relative path from the folder, working out . and ..', () => {
    expect(pathFrom('docs', 'arch.png')).toBe('docs/arch.png');
    expect(pathFrom('docs/guide', './../api.md')).toBe('docs/api.md');
    expect(pathFrom('C:\\wt\\docs', '..\\README.md')).toBe('C:/wt/README.md');
    expect(pathFrom('/wt/docs', 'img/a.png')).toBe('/wt/docs/img/a.png');
    // Out of the folder it goes as far as it says; main refuses it outside the worktree.
    expect(pathFrom('docs', '../../x.md')).toBe('../x.md');
  });

  it('leaves an absolute path, a file:// URL, or any path without a folder as it is', () => {
    expect(pathFrom('docs', 'C:\\wt\\a.png')).toBe('C:\\wt\\a.png');
    expect(pathFrom('docs', '/wt/a.png')).toBe('/wt/a.png');
    expect(pathFrom('docs', 'file:///C:/wt/a.png')).toBe('file:///C:/wt/a.png');
    expect(pathFrom('', 'docs/a.png')).toBe('docs/a.png');
  });
});

describe('openWorktreeFile', () => {
  afterEach(() => markdownPreviewStore.close());

  it('shows a Markdown file in the Focus panel, titled by its path', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'markdown', content: '# Plan' });
    expect(await openWorktreeFile('s1', 'docs/plan.md')).toBe(true);
    expect(markdownPreviewStore).toMatchObject({ open: true, content: '# Plan', title: 'docs/plan.md', sessionId: 's1', baseDir: 'docs' });
  });

  it('shows another text file in the Focus panel as lines, at the lines a link named', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'text', content: 'export const a = 1;' });
    expect(await openWorktreeFile('s1', 'src/app.ts', '', { start: 4, end: 6 })).toBe(true);
    expect(markdownPreviewStore).toMatchObject({
      open: true, content: 'export const a = 1;', title: 'src/app.ts', sessionId: 's1',
      code: { path: 'src/app.ts', lines: { start: 4, end: 6 } },
    });
  });

  it('shows Markdown as Markdown again after a text file', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'text', content: 'a' });
    await openWorktreeFile('s1', 'src/app.ts');
    expect(markdownPreviewStore.code).toEqual({ path: 'src/app.ts', lines: null });
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'markdown', content: '# Plan' });
    await openWorktreeFile('s1', 'docs/plan.md');
    expect(markdownPreviewStore.code).toBeNull();
  });

  it('says when the file is gone', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'missing' });
    expect(await openWorktreeFile('s1', 'docs/plan.md')).toBe(false);
    expect(markdownPreviewStore.open).toBe(false);
  });
});
