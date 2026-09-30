import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';

vi.mock('./logger.js', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { getAttachmentsDir, readImage, removeImages, saveImages, storeToolImages } from './attachments.js';

// A 1×1 transparent PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let userData: string;

beforeEach(() => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'grove-attachments-'));
  vi.mocked(app.getPath).mockReturnValue(userData);
});

afterEach(() => {
  vi.mocked(app.getPath).mockImplementation((name: string) => `/mock/${name}`);
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('saveImages', () => {
  it('saves each image under a content-hash name in the conversation folder', async () => {
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png', name: 'shot.png' }]);

    expect(stored.name).toBe('shot.png');
    expect(stored.file).toMatch(/^[0-9a-f]{32}\.png$/);
    const saved = fs.readFileSync(path.join(getAttachmentsDir(), 'abc123', stored.file));
    expect(saved.equals(Buffer.from(PNG, 'base64'))).toBe(true);
  });

  it('stores the same image once', async () => {
    const [a] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png', name: 'a.png' }]);
    const [b] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png', name: 'b.png' }]);

    expect(a.file).toBe(b.file);
    expect(fs.readdirSync(path.join(getAttachmentsDir(), 'abc123'))).toEqual([a.file]);
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

describe('readImage', () => {
  it('returns a saved image as a data URL', async () => {
    const [stored] = await saveImages('abc123', [{ data: PNG, mediaType: 'image/png' }]);
    expect(await readImage('abc123', stored.file)).toBe(`data:image/png;base64,${PNG}`);
  });

  it('returns null for a missing image', async () => {
    expect(await readImage('abc123', `${'0'.repeat(32)}.png`)).toBeNull();
  });

  it('refuses names that are not stored image names', async () => {
    fs.mkdirSync(path.join(getAttachmentsDir(), 'abc123'), { recursive: true });
    fs.writeFileSync(path.join(getAttachmentsDir(), 'secret.txt'), 'secret');

    expect(await readImage('abc123', '../secret.txt')).toBeNull();
    expect(await readImage('abc123', 'secret.txt')).toBeNull();
    expect(await readImage('..', 'secret.txt')).toBeNull();
  });
});

describe('removeImages', () => {
  it("deletes the conversation's images and leaves other conversations' alone", async () => {
    await saveImages('one', [{ data: PNG, mediaType: 'image/png' }]);
    const [other] = await saveImages('two', [{ data: PNG, mediaType: 'image/png' }]);

    removeImages('one');

    expect(fs.existsSync(path.join(getAttachmentsDir(), 'one'))).toBe(false);
    expect(await readImage('two', other.file)).not.toBeNull();
  });

  it('does nothing for a conversation without images', () => {
    expect(() => removeImages('none')).not.toThrow();
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

  it('passes other events through unchanged', async () => {
    const event = { type: 'assistant_text', text: 'hi', uuid: 'u1' } as const;
    expect(await storeToolImages('abc123', event)).toBe(event);
  });
});
