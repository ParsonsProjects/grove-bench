/**
 * Images shown in the Activity thread: ones the user attached to a message
 * and ones a tool returned (a preview screenshot, an image file the agent
 * read). Each conversation keeps its images in its own folder, named by
 * content hash so an image read twice is stored once. Events refer to them by
 * file name (StoredImage) so the event log stays small, and the app window
 * loads them over the grove-attachment scheme.
 *
 * Other files attached to a message (PDFs, audio, anything else) are saved in
 * the same folder the same way (StoredFile), so an agent can be given the
 * path of the saved copy.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app, protocol, shell } from 'electron';
import type { AgentEvent, FileAttachment, ImageMediaType, StoredFile, StoredImage } from '../shared/types.js';
import { ATTACHMENT_SCHEME } from '../shared/attachments.js';
import type { AdapterEvent } from './adapters/types.js';
import { logger } from './logger.js';

const EXT_BY_TYPE: Record<ImageMediaType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

const TYPE_BY_EXT: Record<string, ImageMediaType> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type as ImageMediaType]),
);

/** A stored image name: a content hash and a known image extension. Anything
 *  else is refused, so a name from a URL can't reach outside the folder. */
const FILE_RE = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
/** Any stored name, images included: a content hash and the extension the
 *  attached file had, when it had a plain one. */
const STORED_RE = /^[0-9a-f]{32}(?:\.[a-z0-9]{1,10})?$/;
/** Conversation ids are short ids; refuse anything that could be a path. */
const ID_RE = /^[\w-]+$/;
/** A conversation folder being deleted is renamed to this prefix, which no
 *  conversation id can start with. */
const DELETED_PREFIX = '.deleted-';

/** Not under the worktrees folder: its sweep removes folders it doesn't know. */
export const getAttachmentsDir = () => path.join(app.getPath('userData'), 'attachments');

function folderFor(sessionId: string): string | null {
  return ID_RE.test(sessionId) ? path.join(getAttachmentsDir(), sessionId) : null;
}

/** A conversation's attachments folder, created if missing, so an agent can
 *  be given access to it before anything is saved there. Null if it can't be.
 *  Synchronous (one mkdir) so starting an agent doesn't wait a tick for it. */
export function ensureAttachmentsFolder(sessionId: string): string | null {
  const folder = folderFor(sessionId);
  if (!folder) return null;
  try {
    fs.mkdirSync(folder, { recursive: true });
    return folder;
  } catch (err) {
    logger.warn(`[attachments] could not create ${folder}:`, err);
    return null;
  }
}

/** Where a stored image is on disk and its type, or null if a name isn't valid. */
export function imagePath(sessionId: string, file: string): { path: string; mediaType: ImageMediaType } | null {
  const folder = folderFor(sessionId);
  const match = FILE_RE.exec(file);
  if (!folder || !match) return null;
  return { path: path.join(folder, file), mediaType: TYPE_BY_EXT[match[1]] };
}

type ImageInput = { data: string; mediaType: ImageMediaType; name?: string };

/** The content-hash part of a stored name. */
function contentHash(base64: string): string {
  return crypto.createHash('sha256').update(base64).digest('hex').slice(0, 32);
}

/** Write `data` to `<folder>/<file>` unless a copy is already there. */
async function writeOnce(folder: string, file: string, data: Buffer): Promise<void> {
  const dest = path.join(folder, file);
  if (fs.existsSync(dest)) return;
  // Write then rename, so a crash mid-write can't leave a truncated file
  // that every later copy of this content would be skipped in favour of.
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, dest);
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    // A concurrent save of the same content may have won the rename.
    if (!fs.existsSync(dest)) throw err;
  }
}

async function saveImage(sessionId: string, folder: string, img: ImageInput): Promise<StoredImage | null> {
  try {
    if (!Object.hasOwn(EXT_BY_TYPE, img.mediaType)) return null;
    const file = `${contentHash(img.data)}.${EXT_BY_TYPE[img.mediaType]}`;
    await writeOnce(folder, file, Buffer.from(img.data, 'base64'));
    return img.name ? { file, name: img.name } : { file };
  } catch (err) {
    logger.warn(`[attachments] could not save image for ${sessionId}:`, err);
    return null;
  }
}

/**
 * Save base64 images to a conversation's attachments folder. An image that
 * can't be saved is logged and left out: the message or tool result still
 * goes through, it just shows without that image.
 */
export async function saveImages(sessionId: string, images: ImageInput[]): Promise<StoredImage[]> {
  const folder = images.length > 0 ? ensureAttachmentsFolder(sessionId) : null;
  if (!folder) return [];
  const saved = await Promise.all(images.map((img) => saveImage(sessionId, folder, img)));
  return saved.filter((s): s is StoredImage => s !== null);
}

/** The extension a saved file keeps, so the agent's tools (and Explorer) can
 *  tell what it is: the attached name's, when it's plain letters and digits. */
function storedExt(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
  return /^[a-z0-9]{1,10}$/.test(ext) ? `.${ext}` : '';
}

/** A file attachment as saved: what the event records, where it is, and
 *  its content for agents that take it inline. */
export interface SavedFile {
  stored: StoredFile;
  /** Absolute path of the saved copy. */
  path: string;
  /** base64-encoded content, as attached. */
  data: string;
}

/**
 * Save files attached to a message to the conversation's attachments folder,
 * in order. One that can't be saved is logged and left out, as with images.
 */
export async function saveFiles(sessionId: string, files: FileAttachment[]): Promise<SavedFile[]> {
  const folder = files.length > 0 ? ensureAttachmentsFolder(sessionId) : null;
  if (!folder) return [];
  const saved = await Promise.all(files.map(async (f): Promise<SavedFile | null> => {
    try {
      if (typeof f.data !== 'string') return null;
      const data = Buffer.from(f.data, 'base64');
      const file = `${contentHash(f.data)}${storedExt(f.name)}`;
      await writeOnce(folder, file, data);
      return {
        stored: { file, name: f.name, mediaType: f.mediaType, size: data.length },
        path: path.join(folder, file),
        data: f.data,
      };
    } catch (err) {
      logger.warn(`[attachments] could not save ${f.name} for ${sessionId}:`, err);
      return null;
    }
  }));
  return saved.filter((s): s is SavedFile => s !== null);
}

/** Types the OS opens in a viewer. Anything else (an .exe, a script) is only
 *  shown in its folder, so a click in the thread never runs it. */
const OPENABLE_EXT = new Set(['pdf', 'mp3', 'wav', 'm4a', 'ogg', 'oga', 'opus', 'flac', 'aac', 'weba']);

/** Open a saved file attachment in its default app, or show it in its folder
 *  when it isn't a type that's safe to open. False when it isn't there. */
export async function openAttachedFile(sessionId: string, file: string): Promise<boolean> {
  const folder = folderFor(sessionId);
  if (!folder || !STORED_RE.test(file)) return false;
  const filePath = path.join(folder, file);
  if (!fs.existsSync(filePath)) return false;
  const ext = path.extname(file).slice(1);
  if (OPENABLE_EXT.has(ext) && (await shell.openPath(filePath)) === '') return true;
  shell.showItemInFolder(filePath);
  return true;
}

/** Save the images a tool returned and pass the tool result on with
 *  references in place of the image data. */
export async function storeToolImages(
  sessionId: string,
  event: Extract<AdapterEvent, { type: 'tool_result' }>,
): Promise<Extract<AgentEvent, { type: 'tool_result' }>> {
  const { imageData, ...rest } = event;
  const images = imageData?.length ? await saveImages(sessionId, imageData) : [];
  return images.length > 0 ? { ...rest, images } : rest;
}

/** The response for a grove-attachment://image/<id>/<file> request. */
export async function attachmentResponse(url: string): Promise<Response> {
  let found: ReturnType<typeof imagePath> = null;
  try {
    const { host, pathname } = new URL(url);
    const [, id, file, ...rest] = pathname.split('/');
    if (host === 'image' && id && file && rest.length === 0) {
      found = imagePath(decodeURIComponent(id), decodeURIComponent(file));
    }
  } catch { /* malformed URL */ }
  if (!found) return new Response(null, { status: 404 });
  try {
    const data = await fs.promises.readFile(found.path);
    // Named by content hash, so a URL's image never changes.
    return new Response(data, {
      headers: { 'Content-Type': found.mediaType, 'Cache-Control': 'max-age=31536000, immutable' },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}

/** Must run before the app is ready. */
export function registerAttachmentScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true } }]);
}

/** Serve stored images on the default session. Preview pages run in their
 *  own partitions, so the pages being previewed can't load them. */
export function handleAttachmentProtocol(): void {
  protocol.handle(ATTACHMENT_SCHEME, (request) => attachmentResponse(request.url));
}

function deleteFolder(folder: string): Promise<void> {
  // Retries: on Windows a file still open (an image loading) fails with EBUSY.
  return fs.promises.rm(folder, { recursive: true, force: true, maxRetries: 5 })
    .catch((err) => logger.warn(`[attachments] could not remove ${folder}:`, err));
}

/**
 * Delete a conversation's attachments (on delete and /clear). The folder is moved
 * aside at once, so an image saved straight after (the first one after a
 * /clear) lands in a new folder, then deleted in the background so a large
 * folder doesn't hold up the main process.
 */
export function removeAttachments(sessionId: string): Promise<void> {
  const folder = folderFor(sessionId);
  if (!folder) return Promise.resolve();
  let target = folder;
  try {
    const moved = path.join(getAttachmentsDir(), `${DELETED_PREFIX}${crypto.randomUUID()}`);
    fs.renameSync(folder, moved);
    target = moved;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Promise.resolve();
    // Can't be moved (a file open on Windows): delete it where it is.
  }
  return deleteFolder(target);
}

/** Finish deletions a quit interrupted. */
export async function removeDeletedFolders(): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(getAttachmentsDir());
  } catch {
    return;
  }
  await Promise.all(
    entries.filter((e) => e.startsWith(DELETED_PREFIX)).map((e) => deleteFolder(path.join(getAttachmentsDir(), e))),
  );
}

/** Delete a conversation's attachments that no event refers to any more,
 *  after a rewind cut the turns that showed them. */
export async function pruneAttachments(sessionId: string, events: AgentEvent[]): Promise<void> {
  const folder = folderFor(sessionId);
  if (!folder) return;
  const keep = new Set<string>();
  for (const e of events) {
    if ((e.type === 'user_message' || e.type === 'tool_result') && e.images) {
      for (const img of e.images) keep.add(img.file);
    }
    if (e.type === 'user_message' && e.files) {
      for (const f of e.files) keep.add(f.file);
    }
  }
  let files: string[];
  try {
    files = await fs.promises.readdir(folder);
  } catch {
    return;
  }
  await Promise.all(
    files
      .filter((f) => STORED_RE.test(f) && !keep.has(f))
      .map((f) => fs.promises.rm(path.join(folder, f), { force: true, maxRetries: 3 })
        .catch((err) => logger.warn(`[attachments] could not remove ${f} for ${sessionId}:`, err))),
  );
}
