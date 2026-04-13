// ─── File attachment constants and utilities ───

export const MAX_TEXT_SIZE = 100 * 1024; // 100KB
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const TEXT_EXTENSIONS = new Set([
  // Web
  'ts', 'tsx', 'js', 'jsx', 'svelte', 'vue', 'html', 'css', 'scss', 'less', 'astro',
  // Data / config
  'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'xml', 'md', 'mdx', 'txt', 'csv', 'tsv', 'sql', 'graphql', 'gql',
  // Shell / scripts
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd',
  // Python
  'py', 'pyi', 'pyx', 'pxd',
  // Ruby
  'rb', 'erb', 'rake', 'gemspec',
  // Go
  'go', 'mod', 'sum',
  // Rust
  'rs',
  // JVM
  'java', 'kt', 'kts', 'groovy', 'gradle',
  // C / C++
  'c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hxx',
  // .NET
  'cs', 'fs', 'fsx', 'csproj', 'fsproj', 'sln', 'xaml',
  // Swift / Objective-C
  'swift', 'm', 'mm',
  // PHP
  'php', 'blade.php',
  // Other languages
  'r', 'lua', 'pl', 'pm', 'ex', 'exs', 'elm', 'hs', 'ml', 'mli', 'clj', 'cljs', 'cljc',
  'scala', 'sbt', 'dart', 'zig', 'nim', 'v', 'cr', 'jl', 'rkt',
  // Config / misc
  'conf', 'ini', 'cfg', 'env', 'properties',
  'gitignore', 'gitattributes', 'editorconfig', 'prettierrc', 'eslintrc',
  'dockerignore', 'dockerfile',
  'makefile', 'cmake', 'justfile',
  'lock', 'log', 'diff', 'patch', 'svg',
  // Prose / docs
  'rst', 'tex', 'bib', 'org', 'adoc',
]);

export type AttachedFile =
  | { name: string; content: string; type: 'text' }
  | { name: string; dataUrl: string; type: 'image' };

export interface ProcessedFiles {
  files: AttachedFile[];
  skipped: string[];
}

/** Classify a file by its extension and MIME type. */
export function classifyFile(file: { name: string; type: string }): 'image' | 'text' | null {
  if (IMAGE_MIME_TYPES.has(file.type)) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const nameLC = file.name.toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(nameLC) || file.type.startsWith('text/')) return 'text';
  return null;
}

/** Validate a file's size given its classification. Returns an error message or null. */
export function validateFileSize(file: { name: string; size: number }, kind: 'image' | 'text'): string | null {
  if (kind === 'image' && file.size > MAX_IMAGE_SIZE) {
    return `${file.name} (too large, max 5MB)`;
  }
  if (kind === 'text' && file.size > MAX_TEXT_SIZE) {
    return `${file.name} (too large, max 100KB)`;
  }
  return null;
}

/**
 * Process a FileList into attached files. Returns a promise because files are read asynchronously.
 * `existing` is used to skip duplicates.
 */
export function processFiles(
  files: FileList | File[],
  existing: AttachedFile[],
): Promise<ProcessedFiles> {
  const result: AttachedFile[] = [];
  const skipped: string[] = [];
  const promises: Promise<void>[] = [];

  for (const file of Array.from(files)) {
    const kind = classifyFile(file);
    if (!kind) {
      skipped.push(`${file.name} (unsupported type)`);
      continue;
    }

    const sizeError = validateFileSize(file, kind);
    if (sizeError) {
      skipped.push(sizeError);
      continue;
    }

    if (existing.some((f) => f.name === file.name)) continue;

    if (kind === 'image') {
      promises.push(
        new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            result.push({ name: file.name, dataUrl: reader.result as string, type: 'image' });
            resolve();
          };
          reader.onerror = () => resolve();
          reader.readAsDataURL(file);
        }),
      );
    } else {
      promises.push(
        new Promise<void>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            result.push({ name: file.name, content: reader.result as string, type: 'text' });
            resolve();
          };
          reader.onerror = () => resolve();
          reader.readAsText(file);
        }),
      );
    }
  }

  return Promise.all(promises).then(() => ({ files: result, skipped }));
}

/**
 * Extract image files from a clipboard paste event's DataTransfer.
 * Returns File objects for any images found.
 */
export function extractClipboardImages(dataTransfer: DataTransfer): File[] {
  const images: File[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind === 'file' && IMAGE_MIME_TYPES.has(item.type)) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  return images;
}
