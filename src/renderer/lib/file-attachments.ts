import { knownMediaType } from '../../shared/attachments.js';

// ─── File attachment constants and utilities ───

export const MAX_TEXT_SIZE = 100 * 1024; // 100KB
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
/** Any other file. It's read into memory and sent to main over IPC, so it's
 *  capped, but well above what text and images are held to. */
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB
/** All of one message's attachments together: they go to main in one IPC
 *  message, which Chromium caps, and sit in memory until sent. */
export const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB

export const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

export const TEXT_EXTENSIONS = new Set([
  // Web
  'ts', 'tsx', 'mts', 'cts', 'js', 'jsx', 'mjs', 'cjs', 'svelte', 'vue', 'html', 'htm', 'xhtml',
  'css', 'scss', 'sass', 'less', 'styl', 'astro', 'webmanifest',
  // Templates
  'pug', 'hbs', 'handlebars', 'mustache', 'ejs', 'njk', 'liquid', 'twig', 'jinja', 'j2',
  // Data / config
  'json', 'jsonc', 'json5', 'jsonl', 'ndjson', 'geojson', 'ipynb', 'yaml', 'yml', 'toml', 'xml', 'xsd', 'xsl', 'xslt', 'plist',
  'md', 'mdx', 'txt', 'csv', 'tsv', 'sql', 'graphql', 'gql', 'proto', 'thrift', 'avsc', 'prisma',
  // Infrastructure
  'tf', 'tfvars', 'hcl', 'nix', 'bicep', 'jsonnet', 'libsonnet', 'cue', 'rego', 'bzl', 'bazel',
  // Shell / scripts
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'vbs', 'awk',
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
  'cs', 'fs', 'fsi', 'fsx', 'vb', 'csproj', 'fsproj', 'vbproj', 'vcxproj', 'props', 'targets', 'sln', 'xaml',
  'razor', 'cshtml', 'resx', 'config',
  // Swift / Objective-C
  'swift', 'm', 'mm',
  // PHP
  'php', 'blade.php',
  // Shaders
  'glsl', 'wgsl', 'hlsl', 'vert', 'frag',
  // Other languages
  'r', 'lua', 'pl', 'pm', 'ex', 'exs', 'erl', 'hrl', 'gleam', 'elm', 'hs', 'purs', 'ml', 'mli', 'clj', 'cljs', 'cljc',
  'el', 'lisp', 'scm', 'scala', 'sbt', 'dart', 'zig', 'nim', 'odin', 'v', 'sv', 'svh', 'vhd', 'vhdl', 'cr', 'jl', 'rkt',
  'sol', 'hx', 'tcl', 'vim', 'asm', 'f90', 'pas',
  // Config / misc
  'conf', 'ini', 'cfg', 'env', 'properties',
  'gitignore', 'gitattributes', 'gitmodules', 'mailmap', 'editorconfig', 'prettierrc', 'eslintrc', 'stylelintrc',
  'babelrc', 'browserslistrc', 'npmrc', 'nvmrc', 'htaccess', 'dockerignore', 'dockerfile', 'containerfile',
  'makefile', 'mk', 'mak', 'cmake', 'justfile', 'gemfile', 'rakefile', 'procfile', 'vagrantfile', 'brewfile', 'jenkinsfile',
  'codeowners', 'license',
  'lock', 'log', 'diff', 'patch', 'svg', 'http',
  // Prose / docs
  'rst', 'tex', 'bib', 'org', 'adoc', 'rmd', 'qmd', 'srt', 'vtt',
]);

export type AttachedFile =
  | { name: string; content: string; type: 'text' }
  | { name: string; dataUrl: string; type: 'image' }
  /** Any other file: the agent gets it inline where it can take the type (a
   *  small PDF, audio for some agents), otherwise the path of a saved copy. */
  | { name: string; dataUrl: string; mediaType: string; size: number; type: 'file' };

export type AttachmentKind = AttachedFile['type'];

export interface ProcessedFiles {
  files: AttachedFile[];
  skipped: string[];
}

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

/** Classify a file by its extension and MIME type. Anything that is neither
 *  an image the agent can see nor text is attached as a file. */
export function classifyFile(file: { name: string; type: string }): AttachmentKind {
  if (IMAGE_MIME_TYPES.has(file.type)) return 'image';
  const ext = extensionOf(file.name);
  const nameLC = file.name.toLowerCase();
  if (TEXT_EXTENSIONS.has(ext) || TEXT_EXTENSIONS.has(nameLC) || file.type.startsWith('text/')) return 'text';
  return 'file';
}

/** A file's MIME type: the browser's, or one from its extension for the types
 *  Grove treats specially (shared/attachments.ts). '' when neither knows. */
export function mediaTypeOf(file: { name: string; type: string }): string {
  return file.type || knownMediaType(file.name);
}

/** Validate a file's size given its classification. Returns an error message or null. */
export function validateFileSize(file: { name: string; size: number }, kind: AttachmentKind): string | null {
  if (kind === 'image' && file.size > MAX_IMAGE_SIZE) {
    return `${file.name} (too large, max 5MB)`;
  }
  if (kind === 'text' && file.size > MAX_TEXT_SIZE) {
    return `${file.name} (too large, max 100KB)`;
  }
  if (kind === 'file' && file.size > MAX_FILE_SIZE) {
    return `${file.name} (too large, max 25MB)`;
  }
  return null;
}

/** Make `name` unique against `taken` by appending a counter before the
 *  extension: image.png → image-2.png → image-3.png. */
export function uniquifyFileName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface ProcessFilesOptions {
  /** When a file's name collides with an existing attachment, rename it
   *  (image.png → image-2.png) instead of silently skipping it. Clipboard
   *  images all arrive named "image.png", so pasting must rename — otherwise
   *  every paste after the first is dropped. */
  renameDuplicates?: boolean;
  /** False when the conversation's agent can't take images: they are
   *  attached as files instead, which it gets by path. */
  allowImages?: boolean;
}

function readFile(file: File, as: 'text' | 'dataUrl'): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    // A folder dropped in, or a file that went away.
    reader.onerror = () => resolve(null);
    if (as === 'text') reader.readAsText(file);
    else reader.readAsDataURL(file);
  });
}

/**
 * Process a FileList into attached files. Returns a promise because files are read asynchronously.
 * `existing` is used to detect duplicates: by default a same-named file is skipped;
 * with `renameDuplicates` it is attached under a uniquified name instead.
 */
export function processFiles(
  files: FileList | File[],
  existing: AttachedFile[],
  options: ProcessFilesOptions = {},
): Promise<ProcessedFiles> {
  const result: AttachedFile[] = [];
  const skipped: string[] = [];
  const promises: Promise<void>[] = [];
  const takenNames = new Set(existing.map((f) => f.name));
  let total = existing.reduce((sum, f) => sum + attachedSize(f), 0);

  for (const file of Array.from(files)) {
    let kind = classifyFile(file);
    const isText = kind === 'text';
    // Too large to send with the message, or an image the agent can't see:
    // attached as a file, which the agent gets by path.
    if (kind === 'image' && (options.allowImages === false || file.size > MAX_IMAGE_SIZE)) kind = 'file';
    if (kind === 'text' && file.size > MAX_TEXT_SIZE) kind = 'file';

    const sizeError = validateFileSize(file, kind);
    if (sizeError) {
      skipped.push(sizeError);
      continue;
    }

    let name = file.name;
    if (takenNames.has(name)) {
      if (!options.renameDuplicates) continue;
      name = uniquifyFileName(name, takenNames);
    }
    if (total + file.size > MAX_TOTAL_SIZE) {
      skipped.push(`${file.name} (over the 50MB limit for one message)`);
      continue;
    }
    total += file.size;
    takenNames.add(name);

    // A text file goes by path as text: the OS may call a .ts file a video.
    const mediaType = isText ? (file.type.startsWith('text/') ? file.type : 'text/plain') : mediaTypeOf(file);
    promises.push(readFile(file, kind === 'text' ? 'text' : 'dataUrl').then((read) => {
      if (read === null) {
        skipped.push(`${file.name} (could not be read)`);
      } else if (kind === 'text') {
        result.push({ name, content: read, type: 'text' });
      } else if (kind === 'image') {
        result.push({ name, dataUrl: read, type: 'image' });
      } else {
        result.push({ name, dataUrl: read, mediaType, size: file.size, type: 'file' });
      }
    }));
  }

  return Promise.all(promises).then(() => ({ files: result, skipped }));
}

/** About how many bytes an attachment takes, toward MAX_TOTAL_SIZE. */
function attachedSize(f: AttachedFile): number {
  if (f.type === 'text') return f.content.length;
  if (f.type === 'image') return base64Size(dataUrlData(f.dataUrl));
  return f.size;
}

/** A size for a chip's tooltip: "512 B", "12 KB", "3.4 MB". */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The size in bytes of base64-encoded data. */
export function base64Size(data: string): number {
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  return Math.floor((data.length * 3) / 4) - padding;
}

/** The base64 data of a data: URL (what FileReader.readAsDataURL gives).
 *  '' when it has no data part, as an empty file's may not. */
export function dataUrlData(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma < 0 ? '' : dataUrl.slice(comma + 1);
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
