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
import { ATTACHMENT_SCHEME, knownMediaType } from '../shared/attachments.js';
import type { AdapterEvent } from './adapters/types.js';
import { withLockRetry } from './fs-utils.js';
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

/** A conversation's attachments folder (which may not exist yet), or null
 *  for an id that could be a path. */
export function attachmentsFolder(sessionId: string): string | null {
  return ID_RE.test(sessionId) ? path.join(getAttachmentsDir(), sessionId) : null;
}

/** The conversation's attachments folder, created if missing. Null if it can't be. */
async function ensureFolder(sessionId: string): Promise<string | null> {
  const folder = attachmentsFolder(sessionId);
  if (!folder) return null;
  try {
    await fs.promises.mkdir(folder, { recursive: true });
    return folder;
  } catch (err) {
    logger.warn(`[attachments] could not create ${folder}:`, err);
    return null;
  }
}

/** Where a stored image is on disk and its type, or null if a name isn't valid. */
export function imagePath(sessionId: string, file: string): { path: string; mediaType: ImageMediaType } | null {
  const folder = attachmentsFolder(sessionId);
  const match = FILE_RE.exec(file);
  if (!folder || !match) return null;
  return { path: path.join(folder, file), mediaType: TYPE_BY_EXT[match[1]] };
}

type ImageInput = { data: string; mediaType: ImageMediaType; name?: string };

/** The content-hash part of an image's stored name (images are small). */
function contentHash(base64: string): string {
  return crypto.createHash('sha256').update(base64).digest('hex').slice(0, 32);
}

/** The content-hash part of a file's stored name. Files can be large, so
 *  this uses SubtleCrypto, which Node runs off the main thread. */
async function fileHash(data: Buffer): Promise<string> {
  const digest = await crypto.webcrypto.subtle.digest('SHA-256', data);
  return Buffer.from(digest).toString('hex').slice(0, 32);
}

/** Whether `file` holds exactly `data`. */
async function sameContent(file: string, data: Buffer): Promise<boolean> {
  try {
    if ((await fs.promises.stat(file)).size !== data.length) return false;
    return (await fs.promises.readFile(file)).equals(data);
  } catch {
    return false;
  }
}

/** Write `data` to `<folder>/<file>` unless the same content is already
 *  there. A copy that changed (the agent edited it) is written over, so a
 *  reattached file is never the edited one. */
async function writeOnce(folder: string, file: string, data: Buffer): Promise<void> {
  const dest = path.join(folder, file);
  if (await sameContent(dest, data)) {
    // Reused: it counts as just saved, so a prune running now keeps it.
    const now = new Date();
    await fs.promises.utimes(dest, now, now).catch(() => {});
    return;
  }
  // Write then rename, so a crash mid-write can't leave a truncated file
  // that every later copy of this content would be skipped in favour of.
  const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.promises.writeFile(tmp, data);
    // Retries: on Windows a copy open in another app can't be replaced.
    await withLockRetry(() => fs.promises.rename(tmp, dest));
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    // A concurrent save of the same content may have won the rename. A copy
    // that still differs is an error, not a save.
    if (!(await sameContent(dest, data))) throw err;
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
  const folder = images.length > 0 ? await ensureFolder(sessionId) : null;
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
  const folder = files.length > 0 ? await ensureFolder(sessionId) : null;
  if (!folder) return [];
  const saved = await Promise.all(files.map(async (f): Promise<SavedFile | null> => {
    try {
      if (typeof f.data !== 'string') return null;
      const data = Buffer.from(f.data, 'base64');
      const file = `${await fileHash(data)}${storedExt(f.name)}`;
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

/** Open a saved file attachment in its default app when it's a PDF or audio,
 *  which open in a viewer. Anything else (an .exe, a script) is only shown in
 *  its folder, so a click in the thread never runs it. False when it isn't there. */
export async function openAttachedFile(sessionId: string, file: string): Promise<boolean> {
  const folder = attachmentsFolder(sessionId);
  if (!folder || !STORED_RE.test(file)) return false;
  const filePath = path.join(folder, file);
  if (!fs.existsSync(filePath)) return false;
  if (knownMediaType(file) && (await shell.openPath(filePath)) === '') return true;
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

/** Delete these entries of `folder`, and nothing saved there since. */
function deleteEntries(folder: string, entries: string[]): Promise<void> {
  return Promise.all(entries.map((e) => fs.promises.rm(path.join(folder, e), { recursive: true, force: true, maxRetries: 5 })
    .catch((err) => logger.warn(`[attachments] could not remove ${e} from ${folder}:`, err)))).then(() => {});
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
  const folder = attachmentsFolder(sessionId);
  if (!folder) return Promise.resolve();
  const moved = path.join(getAttachmentsDir(), `${DELETED_PREFIX}${crypto.randomUUID()}`);
  try {
    fs.renameSync(folder, moved);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return Promise.resolve();
    // Can't be moved (on Windows, a file in it is open: a PDF opened from
    // the thread). Delete what's in it now, and leave anything saved there
    // from here on, which belongs to the next message.
    let entries: string[];
    try {
      entries = fs.readdirSync(folder);
    } catch {
      return Promise.resolve();
    }
    return deleteEntries(folder, entries);
  }
  return deleteFolder(moved);
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

/** File times can trail the clock by a tick (about 16 ms on Windows), so the
 *  cut-off for "saved during the prune" starts a second early. */
const PRUNE_CLOCK_SLACK_MS = 1000;

/** The stored names the events refer to. */
function referencedNames(events: readonly AgentEvent[]): Set<string> {
  const keep = new Set<string>();
  for (const e of events) {
    if ((e.type === 'user_message' || e.type === 'tool_result') && e.images) {
      for (const img of e.images) keep.add(img.file);
    }
    if (e.type === 'user_message' && e.files) {
      for (const f of e.files) keep.add(f.file);
    }
  }
  return keep;
}

/** Delete a conversation's attachments that no event refers to any more,
 *  after a rewind cut the turns that showed them. One saved (or reused)
 *  after the prune started stays: its message may not be in `events` yet,
 *  as with a send straight after a rewind. */
export async function pruneAttachments(sessionId: string, events: readonly AgentEvent[]): Promise<void> {
  const folder = attachmentsFolder(sessionId);
  if (!folder) return;
  const startedAt = Date.now() - PRUNE_CLOCK_SLACK_MS;
  let files: string[];
  try {
    files = await fs.promises.readdir(folder);
  } catch {
    return;
  }
  // Read after the listing, so a message added to `events` meanwhile counts.
  const keep = referencedNames(events);
  await Promise.all(files.filter((f) => STORED_RE.test(f) && !keep.has(f)).map(async (f) => {
    const filePath = path.join(folder, f);
    try {
      if ((await fs.promises.stat(filePath)).mtimeMs >= startedAt) return;
      await fs.promises.rm(filePath, { force: true, maxRetries: 3 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn(`[attachments] could not remove ${f} for ${sessionId}:`, err);
    }
  }));
}
