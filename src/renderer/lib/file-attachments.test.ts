import { describe, it, expect } from 'vitest';
import {
  classifyFile,
  validateFileSize,
  processFiles,
  extractClipboardImages,
  TEXT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  MAX_TEXT_SIZE,
  MAX_IMAGE_SIZE,
} from './file-attachments.js';

// ─── classifyFile ───

describe('classifyFile', () => {
  it('classifies JPEG images by MIME type', () => {
    expect(classifyFile({ name: 'photo.jpg', type: 'image/jpeg' })).toBe('image');
  });

  it('classifies PNG images by MIME type', () => {
    expect(classifyFile({ name: 'screenshot.png', type: 'image/png' })).toBe('image');
  });

  it('classifies GIF images by MIME type', () => {
    expect(classifyFile({ name: 'anim.gif', type: 'image/gif' })).toBe('image');
  });

  it('classifies WebP images by MIME type', () => {
    expect(classifyFile({ name: 'img.webp', type: 'image/webp' })).toBe('image');
  });

  it('classifies TypeScript files by extension', () => {
    expect(classifyFile({ name: 'index.ts', type: '' })).toBe('text');
  });

  it('classifies Python files by extension', () => {
    expect(classifyFile({ name: 'main.py', type: '' })).toBe('text');
  });

  it('classifies files with text/ MIME type', () => {
    expect(classifyFile({ name: 'unknown.abc', type: 'text/plain' })).toBe('text');
  });

  it('classifies extensionless filenames like dockerfile', () => {
    expect(classifyFile({ name: 'dockerfile', type: '' })).toBe('text');
    expect(classifyFile({ name: 'makefile', type: '' })).toBe('text');
  });

  // New file types added in this feature
  it('classifies Astro files', () => {
    expect(classifyFile({ name: 'Layout.astro', type: '' })).toBe('text');
  });

  it('classifies PowerShell files', () => {
    expect(classifyFile({ name: 'build.ps1', type: '' })).toBe('text');
  });

  it('classifies Zig files', () => {
    expect(classifyFile({ name: 'main.zig', type: '' })).toBe('text');
  });

  it('classifies Julia files', () => {
    expect(classifyFile({ name: 'solve.jl', type: '' })).toBe('text');
  });

  it('classifies GraphQL files', () => {
    expect(classifyFile({ name: 'schema.graphql', type: '' })).toBe('text');
  });

  it('classifies .jsonc and .json5 files', () => {
    expect(classifyFile({ name: 'tsconfig.jsonc', type: '' })).toBe('text');
    expect(classifyFile({ name: 'config.json5', type: '' })).toBe('text');
  });

  it('classifies C++ variant extensions', () => {
    expect(classifyFile({ name: 'main.cc', type: '' })).toBe('text');
    expect(classifyFile({ name: 'main.cxx', type: '' })).toBe('text');
    expect(classifyFile({ name: 'main.hxx', type: '' })).toBe('text');
  });

  it('classifies .editorconfig and .prettierrc', () => {
    expect(classifyFile({ name: '.editorconfig', type: '' })).toBe('text');
    expect(classifyFile({ name: '.prettierrc', type: '' })).toBe('text');
  });

  it('returns null for unsupported binary types', () => {
    expect(classifyFile({ name: 'archive.zip', type: 'application/zip' })).toBeNull();
    expect(classifyFile({ name: 'video.mp4', type: 'video/mp4' })).toBeNull();
    expect(classifyFile({ name: 'music.mp3', type: 'audio/mpeg' })).toBeNull();
  });

  it('returns null for unsupported image types (bmp, tiff)', () => {
    expect(classifyFile({ name: 'old.bmp', type: 'image/bmp' })).toBeNull();
    expect(classifyFile({ name: 'scan.tiff', type: 'image/tiff' })).toBeNull();
  });
});

// ─── validateFileSize ───

describe('validateFileSize', () => {
  it('accepts text files under 100KB', () => {
    expect(validateFileSize({ name: 'small.ts', size: 1024 }, 'text')).toBeNull();
  });

  it('rejects text files over 100KB', () => {
    expect(validateFileSize({ name: 'big.ts', size: MAX_TEXT_SIZE + 1 }, 'text')).toContain('too large');
    expect(validateFileSize({ name: 'big.ts', size: MAX_TEXT_SIZE + 1 }, 'text')).toContain('100KB');
  });

  it('accepts image files under 5MB', () => {
    expect(validateFileSize({ name: 'photo.png', size: 1024 * 1024 }, 'image')).toBeNull();
  });

  it('rejects image files over 5MB', () => {
    expect(validateFileSize({ name: 'huge.png', size: MAX_IMAGE_SIZE + 1 }, 'image')).toContain('too large');
    expect(validateFileSize({ name: 'huge.png', size: MAX_IMAGE_SIZE + 1 }, 'image')).toContain('5MB');
  });

  it('accepts files at exactly the size limit', () => {
    expect(validateFileSize({ name: 'exact.ts', size: MAX_TEXT_SIZE }, 'text')).toBeNull();
    expect(validateFileSize({ name: 'exact.png', size: MAX_IMAGE_SIZE }, 'image')).toBeNull();
  });
});

// ─── processFiles ───

describe('processFiles', () => {
  function makeFile(name: string, content: string, type = ''): File {
    return new File([content], name, { type });
  }

  it('processes a text file', async () => {
    const file = makeFile('hello.ts', 'const x = 1;', 'text/typescript');
    const result = await processFiles([file], []);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({ name: 'hello.ts', content: 'const x = 1;', type: 'text' });
    expect(result.skipped).toHaveLength(0);
  });

  it('processes an image file', async () => {
    const file = makeFile('photo.png', 'fake-png-data', 'image/png');
    const result = await processFiles([file], []);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].type).toBe('image');
    expect(result.files[0].name).toBe('photo.png');
    expect((result.files[0] as { dataUrl: string }).dataUrl).toContain('data:');
    expect(result.skipped).toHaveLength(0);
  });

  it('skips unsupported file types', async () => {
    const file = makeFile('archive.zip', 'data', 'application/zip');
    const result = await processFiles([file], []);
    expect(result.files).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('unsupported type');
  });

  it('skips oversized text files', async () => {
    const bigContent = 'x'.repeat(MAX_TEXT_SIZE + 1);
    const file = makeFile('big.ts', bigContent, 'text/typescript');
    const result = await processFiles([file], []);
    expect(result.files).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain('too large');
  });

  it('skips duplicate files based on name', async () => {
    const file = makeFile('index.ts', 'code', 'text/typescript');
    const existing = [{ name: 'index.ts', content: 'old code', type: 'text' as const }];
    const result = await processFiles([file], existing);
    expect(result.files).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
  });

  it('processes multiple files of mixed types', async () => {
    const files = [
      makeFile('app.ts', 'code', 'text/typescript'),
      makeFile('logo.png', 'img', 'image/png'),
      makeFile('data.zip', 'bin', 'application/zip'),
    ];
    const result = await processFiles(files, []);
    expect(result.files).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
  });
});

// ─── extractClipboardImages ───

describe('extractClipboardImages', () => {
  function makeDataTransfer(items: Array<{ kind: string; type: string; file: File | null }>): DataTransfer {
    // jsdom doesn't provide DataTransfer, so build a minimal mock
    return {
      items: items.map((item) => ({
        kind: item.kind,
        type: item.type,
        getAsFile: () => item.file,
      })),
    } as unknown as DataTransfer;
  }

  it('extracts PNG images from clipboard', () => {
    const file = new File(['data'], 'image.png', { type: 'image/png' });
    const dt = makeDataTransfer([{ kind: 'file', type: 'image/png', file }]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('image.png');
  });

  it('extracts JPEG images from clipboard', () => {
    const file = new File(['data'], 'photo.jpg', { type: 'image/jpeg' });
    const dt = makeDataTransfer([{ kind: 'file', type: 'image/jpeg', file }]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(1);
  });

  it('ignores non-file clipboard items (e.g. text)', () => {
    const dt = makeDataTransfer([{ kind: 'string', type: 'text/plain', file: null }]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(0);
  });

  it('ignores unsupported image types', () => {
    const file = new File(['data'], 'image.bmp', { type: 'image/bmp' });
    const dt = makeDataTransfer([{ kind: 'file', type: 'image/bmp', file }]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(0);
  });

  it('handles mixed clipboard items', () => {
    const imgFile = new File(['data'], 'screenshot.png', { type: 'image/png' });
    const dt = makeDataTransfer([
      { kind: 'string', type: 'text/plain', file: null },
      { kind: 'file', type: 'image/png', file: imgFile },
    ]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('screenshot.png');
  });

  it('returns empty array when getAsFile returns null', () => {
    const dt = makeDataTransfer([{ kind: 'file', type: 'image/png', file: null }]);
    const result = extractClipboardImages(dt);
    expect(result).toHaveLength(0);
  });
});

// ─── Constants coverage ───

describe('TEXT_EXTENSIONS', () => {
  it('contains common web extensions', () => {
    for (const ext of ['ts', 'tsx', 'js', 'jsx', 'html', 'css', 'svelte', 'vue']) {
      expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
    }
  });

  it('contains newly added extensions', () => {
    for (const ext of ['astro', 'ps1', 'zig', 'jl', 'graphql', 'jsonc', 'json5', 'cc', 'cxx', 'hxx', 'nim', 'cr', 'rkt']) {
      expect(TEXT_EXTENSIONS.has(ext)).toBe(true);
    }
  });
});

describe('IMAGE_MIME_TYPES', () => {
  it('includes jpeg, png, gif, webp', () => {
    expect(IMAGE_MIME_TYPES.has('image/jpeg')).toBe(true);
    expect(IMAGE_MIME_TYPES.has('image/png')).toBe(true);
    expect(IMAGE_MIME_TYPES.has('image/gif')).toBe(true);
    expect(IMAGE_MIME_TYPES.has('image/webp')).toBe(true);
  });

  it('does not include bmp or tiff', () => {
    expect(IMAGE_MIME_TYPES.has('image/bmp')).toBe(false);
    expect(IMAGE_MIME_TYPES.has('image/tiff')).toBe(false);
  });
});
