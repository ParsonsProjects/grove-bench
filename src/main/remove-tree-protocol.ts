/**
 * Messages between the main process and the delete thread
 * (remove-tree-worker.ts). Kept apart from both, so neither loads the
 * other's modules and the handling is tested without a thread.
 */

/** Delete the folder at `path`, recursively. */
export interface RemoveRequest {
  id: number;
  path: string;
}

export type RemoveMessage =
  | { type: 'done'; id: number }
  | { type: 'failed'; id: number; code?: string; message: string };

export function isRemoveRequest(data: unknown): data is RemoveRequest {
  const d = data as Partial<RemoveRequest> | null;
  return typeof d?.id === 'number' && typeof d.path === 'string' && d.path.length > 0;
}

export function isRemoveMessage(data: unknown): data is RemoveMessage {
  const d = data as { type?: unknown; id?: unknown } | null;
  return (d?.type === 'done' || d?.type === 'failed') && typeof d.id === 'number';
}

/** Run one request with `rm`, and say how it went. */
export function handleRemoveRequest(request: RemoveRequest, rm: (path: string) => void): RemoveMessage {
  try {
    rm(request.path);
    return { type: 'done', id: request.id };
  } catch (e) {
    const err = e as { code?: unknown; message?: unknown };
    return {
      type: 'failed',
      id: request.id,
      ...(typeof err?.code === 'string' ? { code: err.code } : {}),
      message: typeof err?.message === 'string' ? err.message : String(e),
    };
  }
}
