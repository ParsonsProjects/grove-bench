import { describe, it, expect } from 'vitest';
import { localFilePath, localFileTarget } from './worktree-files.js';

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
