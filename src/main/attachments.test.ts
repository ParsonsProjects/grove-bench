import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, protocol, shell } from 'electron';
import type { AgentEvent } from '../shared/types.js';
import { attachmentImageUrl } from '../shared/attachments.js';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  attachmentResponse,
  ensureAttachmentsFolder,
  getAttachmentsDir,
  handleAttachmentProtocol,
  openAttachedFile,
  pruneAttachments,
  registerAttachmentScheme,
  removeDeletedFolders,
  removeAttachments,
  saveFiles,
  saveImages,
  storeToolImages,
} from './attachments.js';

// A 1×1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const GIF = 'R0lGODlhAQABAAAAACw=';

let userData: string;

function folder(id: string): string {
  return path.join(getAttachmentsDir(), id);
}

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-attachments-'));
  vi.mocked(app.getPath).mockReturnValue(userData);
});

afterEach(() => {
  vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('getAttachmentsDir', () => {
  it('is outside the worktrees folder, which the worktree sweep clears of folders it does not know', () => {
    expect(getAttachmentsDir()).toBe(path.join(userData, 'attachments'));
  });
});

describe('saveImages', () => {
  it('saves each image under a content-hash name in the conversation folder', async () => {
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png', name: 'shot.png' }]);

    expect(stored.name).toBe('shot.png');
    expect(stored.file).toMatch(/^[0-9a-f]{32}\.png$/);
    const saved = fs.readFileSync(path.join(folder('abc123'), stored.file));
    expect(saved.equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('stores the same image once', async () => {
    const [a] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png', name: 'a.png' }]);
    const [b, c] = await saveImages('abc123', [
      { data: PNG, mediaType: 'image/png', name: 'b.png' },
      { data: PNG, mediaType: 'image/png', name: 'c.png' },
    ]);

    expect(b.file).toBe(a.file);
    expect(c.file).toBe(a.file);
    expect(fs.readdirSync(folder('abc123'))).toEqual([a.file]);
  });

  it('keeps the order of the images it saved and leaves out ones it could not', async () => {
    const stored = await saveImages('abc123', [
      { data: PNG, mediaType: 'image/png', name: 'a.png' },
      { data: 42 as unknown as string, mediaType: 'image/png', name: 'broken.png' },
      { data: GIF, mediaType: 'image/tiff' as never, name: 'tiff.tif' },
      { data: GIF, mediaType: 'image/gif', name: 'b.gif' },
    ]);

    expect(stored.map((s) => s.name)).toEqual(['a.png', 'b.gif']);
  });

  it('leaves out the name for images that had none', async () => {
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/jpeg' }]);
    expect(stored).toEqual({ file: expect.stringMatching(/\.jpg$/) });
  });

  it('refuses a conversation id that could be a path', async () => {
    expect(await saveImages('../escape', [{ data: PNG, mediaType: 'image/png' }])).toEqual([]);
    expect(fs.existsSync(path.join(getAttachmentsDir(), '..', 'escape'))).toBe(false);
  });
});

describe('ensureAttachmentsFolder', () => {
  it("creates the conversation's folder and returns it", () => {
    expect(ensureAttachmentsFolder('abc123')).toBe(folder('abc123'));
    expect(fs.statSync(folder('abc123')).isDirectory()).toBe(true);
  });

  it('refuses a conversation id that could be a path', () => {
    expect(ensureAttachmentsFolder('../escape')).toBeNull();
  });
});

describe('saveFiles', () => {
  const PDF = Buffer.from('%PDF-1.4 fake').toString('base64');

  it('saves each file under a content-hash name that keeps its extension', async () => {
    const [saved] = await saveFiles('abc123', [{ data: PDF, mediaType: 'application/pdf', name: 'Spec.PDF' }]);

    expect(saved.stored).toEqual({ file: expect.stringMatching(/^[0-9a-f]{32}\.pdf$/), name: 'Spec.PDF', mediaType: 'application/pdf', size: 13 });
    expect(saved.path).toBe(path.join(folder('abc123'), saved.stored.file));
    expect(saved.data).toBe(PDF);
    expect(fs.readFileSync(saved.path).toString()).toBe('%PDF-1.4 fake');
  });

  it('drops an extension that is not plain letters and digits', async () => {
    const [noExt, odd] = await saveFiles('abc123', [
      { data: 'AAAA', mediaType: '', name: 'README' },
      { data: 'BBBB', mediaType: '', name: 'notes.my file' },
    ]);
    expect(noExt.stored.file).toMatch(/^[0-9a-f]{32}$/);
    expect(odd.stored.file).toMatch(/^[0-9a-f]{32}$/);
  });

  it('stores the same file once', async () => {
    const [a, b] = await saveFiles('abc123', [
      { data: PDF, mediaType: 'application/pdf', name: 'a.pdf' },
      { data: PDF, mediaType: 'application/pdf', name: 'b.pdf' },
    ]);
    expect(b.stored.file).toBe(a.stored.file);
    expect(fs.readdirSync(folder('abc123'))).toEqual([a.stored.file]);
  });

  it('leaves out a file it could not save and keeps the rest in order', async () => {
    const saved = await saveFiles('abc123', [
      { data: 'AAAA', mediaType: '', name: 'one.bin' },
      { data: 42 as unknown as string, mediaType: '', name: 'broken.bin' },
      { data: 'BBBB', mediaType: '', name: 'two.bin' },
    ]);
    expect(saved.map((f) => f.stored.name)).toEqual(['one.bin', 'two.bin']);
  });

  it('refuses a conversation id that could be a path', async () => {
    expect(await saveFiles('../escape', [{ data: PDF, mediaType: 'application/pdf', name: 'a.pdf' }])).toEqual([]);
  });
});

describe('openAttachedFile', () => {
  beforeEach(() => {
    vi.mocked(shell.openPath).mockClear().mockResolvedValue('');
    vi.mocked(shell.showItemInFolder).mockClear();
  });

  it('opens a PDF or audio file in its default app', async () => {
    const [pdf] = await saveFiles('abc123', [{ data: 'JVBERi0=', mediaType: 'application/pdf', name: 'a.pdf' }]);

    expect(await openAttachedFile('abc123', pdf.stored.file)).toBe(true);
    expect(shell.openPath).toHaveBeenCalledWith(pdf.path);
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });

  it('only shows other types in their folder, so a click never runs one', async () => {
    const [exe] = await saveFiles('abc123', [{ data: 'TVqQ', mediaType: 'application/x-msdownload', name: 'setup.exe' }]);

    expect(await openAttachedFile('abc123', exe.stored.file)).toBe(true);
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).toHaveBeenCalledWith(exe.path);
  });

  it('shows the file in its folder when no app opens it', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('No application is associated');
    const [pdf] = await saveFiles('abc123', [{ data: 'JVBERi0=', mediaType: 'application/pdf', name: 'a.pdf' }]);

    expect(await openAttachedFile('abc123', pdf.stored.file)).toBe(true);
    expect(shell.showItemInFolder).toHaveBeenCalledWith(pdf.path);
  });

  it('is false for a missing file or a name that is not a stored one', async () => {
    expect(await openAttachedFile('abc123', `${'0'.repeat(32)}.pdf`)).toBe(false);
    expect(await openAttachedFile('abc123', '../../secrets.pdf')).toBe(false);
    expect(await openAttachedFile('../x', `${'0'.repeat(32)}.pdf`)).toBe(false);
    expect(shell.openPath).not.toHaveBeenCalled();
    expect(shell.showItemInFolder).not.toHaveBeenCalled();
  });
});

describe('storeToolImages', () => {
  it("swaps a tool result's image data for references to the saved images", async () => {
    const event = await storeToolImages('abc123', {
      type: 'tool_result', toolUseId: 'tu1', content: 'ok', imageData: [{ data: PNG, mediaType: 'image/png' }],
    });

    expect(event).toEqual({
      type: 'tool_result', toolUseId: 'tu1', content: 'ok', images: [{ file: expect.stringMatching(/\.png$/) }],
    });
  });

  it('passes the result on without images when none could be saved', async () => {
    const event = await storeToolImages('../bad', {
      type: 'tool_result', toolUseId: 'tu1', content: 'ok', imageData: [{ data: PNG, mediaType: 'image/png' }],
    });
    expect(event).toEqual({ type: 'tool_result', toolUseId: 'tu1', content: 'ok' });
  });
});

describe('attachmentResponse', () => {
  it('serves a saved image with its type', async () => {
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png' }]);

    const res = await attachmentResponse(attachmentImageUrl('abc123', stored.file));

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('is not found for a missing image', async () => {
    const res = await attachmentResponse(attachmentImageUrl('abc123', `${'0'.repeat(32)}.png`));
    expect(res.status).toBe(404);
  });

  it('refuses anything that is not a stored image name', async () => {
    fs.mkdirSync(folder('abc123'), { recursive: true });
    fs.writeFileSync(path.join(getAttachmentsDir(), 'secret.txt'), 'secret');

    for (const url of [
      attachmentImageUrl('abc123', '../secret.txt'),
      attachmentImageUrl('..', 'secret.txt'),
      'grove-attachment://image/abc123/..%2F..%2Fsecret.txt',
      'grove-attachment://image/abc123/x/y.png',
      'grove-attachment://other/abc123/secret.txt',
      'grove-attachment://image/abc123/%E0%A4%A',
    ]) {
      expect((await attachmentResponse(url)).status).toBe(404);
    }
  });
});

describe('protocol registration', () => {
  it('registers the scheme and serves it from the attachments folder', async () => {
    registerAttachmentScheme();
    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: 'grove-attachment', privileges: { standard: true, secure: true } },
    ]);

    handleAttachmentProtocol();
    const [scheme, handler] = vi.mocked(protocol.handle).mock.calls.at(-1)!;
    expect(scheme).toBe('grove-attachment');
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png' }]);
    const res = await handler(new Request(attachmentImageUrl('abc123', stored.file)));
    expect(res.status).toBe(200);
  });
});

describe('removeAttachments', () => {
  it("moves the conversation's folder aside at once, then deletes it", async () => {
    await saveImages('one', [{ data: PNG, mediaType: 'image/png' }]);
    const [other] = await saveImages('two', [{ data: PNG, mediaType: 'image/png' }]);

    const done = removeAttachments('one');
    // Gone before the delete finishes, so a new image lands in a fresh folder.
    expect(fs.existsSync(folder('one'))).toBe(false);
    await done;

    expect(fs.readdirSync(getAttachmentsDir())).toEqual(['two']);
    expect((await attachmentResponse(attachmentImageUrl('two', other.file))).status).toBe(200);
  });

  it('does nothing for a conversation without images', async () => {
    await expect(removeAttachments('none')).resolves.toBeUndefined();
  });

  it('finishes deletions a quit interrupted', async () => {
    await saveImages('keep', [{ data: PNG, mediaType: 'image/png' }]);
    fs.mkdirSync(path.join(getAttachmentsDir(), '.deleted-1234', 'x'), { recursive: true });

    await removeDeletedFolders();

    expect(fs.readdirSync(getAttachmentsDir())).toEqual(['keep']);
  });
});

describe('pruneAttachments', () => {
  it('deletes the images no event refers to any more and keeps the rest', async () => {
    const [kept, dropped, fromTool] = await saveImages('abc123', [
      { data: PNG, mediaType: 'image/png', name: 'kept.png' },
      { data: GIF, mediaType: 'image/gif', name: 'dropped.gif' },
      { data: PNG, mediaType: 'image/jpeg' },
    ]);
    const events: AgentEvent[] = [
      { type: 'user_message', text: 'look', uuid: 'u1', images: [kept] },
      { type: 'tool_result', toolUseId: 't1', content: '', images: [{ file: fromTool.file }] },
    ];

    await pruneAttachments('abc123', events);

    expect(fs.readdirSync(folder('abc123')).sort()).toEqual([kept.file, fromTool.file].sort());
    expect(fs.existsSync(path.join(folder('abc123'), dropped.file))).toBe(false);
  });

  it('keeps the files a message still refers to and deletes the rest', async () => {
    const [kept, dropped] = await saveFiles('abc123', [
      { data: 'AAAA', mediaType: 'application/pdf', name: 'kept.pdf' },
      { data: 'BBBB', mediaType: 'application/zip', name: 'dropped.zip' },
    ]);
    const events: AgentEvent[] = [{ type: 'user_message', text: 'read this', uuid: 'u1', files: [kept.stored] }];

    await pruneAttachments('abc123', events);

    expect(fs.readdirSync(folder('abc123'))).toEqual([kept.stored.file]);
    expect(fs.existsSync(dropped.path)).toBe(false);
  });

  it('leaves files that are not stored images alone', async () => {
    fs.mkdirSync(folder('abc123'), { recursive: true });
    fs.writeFileSync(path.join(folder('abc123'), 'saving.png.1234.tmp'), '');

    await pruneAttachments('abc123', []);

    expect(fs.readdirSync(folder('abc123'))).toEqual(['saving.png.1234.tmp']);
  });
});
