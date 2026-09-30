/**
 * Images shown in the Activity thread: ones the user attached to a message
 * and ones a tool returned (a preview screenshot, an image file the agent
 * read). Each conversation keeps its images in its own folder, named by
 * content hash so an image read twice is stored once. Events refer to them by
 * file name (StoredImage) so the event log stays small.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AgentEvent, ImageMediaType, StoredImage } from '../shared/types.js';
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

/** A stored file name: a content hash and a known image extension. Anything
 *  else is refused, so a name from the renderer can't reach outside the folder. */
const FILE_RE = /^[0-9a-f]{32}\.(png|jpg|gif|webp)$/;
/** Conversation ids are short ids; refuse anything that could be a path. */
const ID_RE = /^[\w-]+$/;

export const getAttachmentsDir = () => path.join(app.getPath('userData'), 'worktrees', 'attachments');

function folderFor(sessionId: string): string | null {
  return ID_RE.test(sessionId) ? path.join(getAttachmentsDir(), sessionId) : null;
}

/**
 * Save base64 images to a conversation's attachments folder. An image that
 * can't be saved is logged and left out: the message or tool result still
 * goes through, it just shows without that image.
 */
export async function saveImages(
  sessionId: string,
  images: { data: string; mediaType: ImageMediaType; name?: string }[],
): Promise<StoredImage[]> {
  const folder = folderFor(sessionId);
  if (!folder || images.length === 0) return [];
  try {
    await fs.promises.mkdir(folder, { recursive: true });
  } catch (err) {
    logger.warn(`[attachments] could not create ${folder}:`, err);
    return [];
  }
  const stored: StoredImage[] = [];
  for (const img of images) {
    const ext = EXT_BY_TYPE[img.mediaType];
    if (!ext) continue;
    const hash = crypto.createHash('sha256').update(img.data).digest('hex').slice(0, 32);
    const file = `${hash}.${ext}`;
    const dest = path.join(folder, file);
    if (!fs.existsSync(dest)) {
      // Write then rename, so a crash mid-write can't leave a truncated file
      // that every later copy of this image would be skipped in favour of.
      const tmp = `${dest}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.promises.writeFile(tmp, Buffer.from(img.data, 'base64'));
        await fs.promises.rename(tmp, dest);
      } catch (err) {
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        // A concurrent save of the same image may have won the rename.
        if (!fs.existsSync(dest)) {
          logger.warn(`[attachments] could not save image for ${sessionId}:`, err);
          continue;
        }
      }
    }
    stored.push(img.name ? { file, name: img.name } : { file });
  }
  return stored;
}

/** A stored image as a data URL, or null if the name is invalid or the file is gone. */
export async function readImage(sessionId: string, file: string): Promise<string | null> {
  const folder = folderFor(sessionId);
  const match = typeof file === 'string' ? FILE_RE.exec(file) : null;
  if (!folder || !match) return null;
  try {
    const buf = await fs.promises.readFile(path.join(folder, file));
    return `data:${TYPE_BY_EXT[match[1]]};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

/** Delete a conversation's images (on delete and /clear). Synchronous so an
 *  image saved right after a /clear can't be caught by it. */
export function removeImages(sessionId: string): void {
  const folder = folderFor(sessionId);
  if (!folder) return;
  try {
    fs.rmSync(folder, { recursive: true, force: true });
  } catch (err) {
    logger.warn(`[attachments] could not remove ${folder}:`, err);
  }
}

/** Save the images a tool returned and pass the event on with references in
 *  place of the image data. Other events pass through unchanged. */
export async function storeToolImages(sessionId: string, event: AdapterEvent): Promise<AgentEvent> {
  if (event.type !== 'tool_result' || !('imageData' in event)) return event;
  const { imageData, ...rest } = event;
  const images = imageData?.length ? await saveImages(sessionId, imageData) : [];
  return images.length > 0 ? { ...rest, images } : rest;
}
