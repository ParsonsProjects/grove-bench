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

  it('shows another text file in the Focus panel as a code block in its language', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'text', content: 'export const a = 1;' });
    expect(await openWorktreeFile('s1', 'src/app.ts')).toBe(true);
    expect(markdownPreviewStore).toMatchObject({ open: true, content: '```ts\nexport const a = 1;\n```', title: 'src/app.ts', sessionId: 's1' });
  });

  it('says when the file is gone', async () => {
    mockGroveBench.openWorktreeFile.mockResolvedValueOnce({ kind: 'missing' });
    expect(await openWorktreeFile('s1', 'docs/plan.md')).toBe(false);
    expect(markdownPreviewStore.open).toBe(false);
  });
});
