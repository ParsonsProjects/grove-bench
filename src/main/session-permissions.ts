/**
 * Questions a running agent puts to the user: tool permission prompts and
 * MCP elicitations. Each waits in the session's pending map until the user
 * answers, the turn stops, or it times out.
 */
import type { McpElicitationRequest, McpElicitationResponse, PermissionDecision } from '../shared/types.js';
import type { PermissionRequest, PermissionResponse } from './adapters/types.js';
import { isReadOnlyToolCall } from './read-only-tools.js';
import type { Emit, ManagedSession } from './session-types.js';

const PERMISSION_TIMEOUT_MS = 30 * 60 * 1000;
const ELICITATION_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Decide a tool call the agent asks about. Read-safe mode lets read-only
 * calls scoped to the worktree (file reads, git reads) through; anything else
 * is put to the user, and denied if they don't answer in time.
 */
export function requestPermission(session: ManagedSession, request: PermissionRequest, emit: Emit): Promise<PermissionResponse> {
  // Mutating, out-of-worktree, or unrecognized calls fall through to the
  // prompt below. session.permissionMode is read live so mid-query mode
  // switches take effect immediately. (Native auto mode never reaches here
  // for classifier-approved calls; only its escalations do.)
  if (session.permissionMode === 'readSafe' && isReadOnlyToolCall(request.toolName, request.toolInput, session.worktreePath)) {
    return Promise.resolve({ behavior: 'allow', updatedInput: request.toolInput });
  }
  const pendingPermissions = session.pendingPermissions;
  const requestId = `perm_${session.id}_${++session.permRequestCounter}`;
  return new Promise<PermissionResponse>((resolve) => {
    const timer = setTimeout(() => {
      pendingPermissions.delete(requestId);
      emit({
        type: 'permission_resolved',
        requestId,
        toolUseId: request.toolUseId,
        decision: 'deny',
      });
      resolve({ behavior: 'deny', message: 'Permission request timed out' });
    }, PERMISSION_TIMEOUT_MS);

    pendingPermissions.set(requestId, {
      requestId,
      toolName: request.toolName,
      toolUseId: request.toolUseId,
      toolInput: request.toolInput,
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
    });
    emit({
      type: 'permission_request',
      toolName: request.toolName,
      toolInput: request.toolInput,
      toolUseId: request.toolUseId,
      requestId,
      decisionReason: request.decisionReason,
      suggestions: request.suggestions,
      isPlanExecution: request.isPlanExecution,
      toolCategory: request.toolCategory,
      planText: request.planText,
    });
  });
}

/**
 * Resolve a pending permission request with the user's answer.
 * Returns true if the permission was found and resolved, false if it was
 * already resolved or no longer exists (e.g. timed out).
 */
export function respondToPermission(session: ManagedSession, decision: PermissionDecision): boolean {
  const pending = session.pendingPermissions.get(decision.requestId);
  if (!pending) return false;

  session.pendingPermissions.delete(decision.requestId);

  const resolvedDecision = (decision.behavior === 'allow' || decision.behavior === 'allowAlways') ? 'allow' : 'deny';

  if (resolvedDecision === 'allow') {
    if (decision.behavior === 'allowAlways') {
      session.alwaysAllowedTools.add(pending.toolName);
    }
    const result: PermissionResponse = {
      behavior: 'allow',
      updatedInput: pending.toolInput,
      ...(decision.updatedPermissions ? { updatedPermissions: decision.updatedPermissions } : {}),
    };
    pending.resolve(result);
  } else {
    pending.resolve({
      behavior: 'deny',
      message: decision.message || 'User denied permission',
    });
  }

  // Notify renderer authoritatively. The deny message is the user's reply
  // to a question, so persist it with the event for history replay.
  session.emit?.({
    type: 'permission_resolved',
    requestId: decision.requestId,
    toolUseId: pending.toolUseId,
    decision: resolvedDecision,
    ...(resolvedDecision === 'deny' && decision.message ? { message: decision.message } : {}),
  });

  return true;
}

/** Deny every permission request still waiting on the user, e.g. when the
 *  turn stops, and tell the renderer each one is settled. */
export function denyPendingPermissions(session: ManagedSession, message: string, emit: Emit | null): void {
  for (const [, pending] of session.pendingPermissions) {
    pending.resolve({ behavior: 'deny', message });
    emit?.({
      type: 'permission_resolved',
      requestId: pending.requestId,
      toolUseId: pending.toolUseId,
      decision: 'deny',
    });
  }
  session.pendingPermissions.clear();
}

/** Keep only what an MCP elicitation result may carry: a known action and,
 *  when accepting, string, number, boolean or string-list values. Null when
 *  the action is unknown. */
export function sanitizeElicitationResponse(response: unknown): McpElicitationResponse | null {
  const r = response as Partial<McpElicitationResponse> | null;
  if (!r || (r.action !== 'accept' && r.action !== 'decline' && r.action !== 'cancel')) return null;
  if (r.action !== 'accept' || !r.content || typeof r.content !== 'object') return { action: r.action };
  const content: NonNullable<McpElicitationResponse['content']> = {};
  for (const [key, value] of Object.entries(r.content)) {
    const ok = typeof value === 'string' || typeof value === 'boolean'
      || (typeof value === 'number' && Number.isFinite(value))
      || (Array.isArray(value) && value.every((v) => typeof v === 'string'));
    if (ok) content[key] = value;
  }
  return { action: 'accept', content };
}

/** Hold an MCP elicitation until the user answers it in the conversation,
 *  the agent stops waiting (`signal`), or it times out. */
export function awaitElicitation(
  session: ManagedSession,
  request: McpElicitationRequest,
  signal: AbortSignal,
): Promise<McpElicitationResponse> {
  const requestId = `elicit_${session.id}_${++session.permRequestCounter}`;
  return new Promise<McpElicitationResponse>((resolve) => {
    const onAbort = () => finish({ action: 'cancel' });
    const timer = setTimeout(onAbort, ELICITATION_TIMEOUT_MS);
    function finish(response: McpElicitationResponse) {
      if (!session.pendingElicitations.delete(requestId)) return;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      session.emit?.({ type: 'elicitation_resolved', requestId, action: response.action });
      resolve(response);
    }
    session.pendingElicitations.set(requestId, { requestId, resolve: finish });
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    session.emit?.({ type: 'elicitation_request', requestId, request });
  });
}

/** Answer a pending MCP elicitation. Returns false when it already
 *  resolved (answered, cancelled or timed out). */
export function respondToElicitation(session: ManagedSession, requestId: string, response: McpElicitationResponse): boolean {
  const pending = session.pendingElicitations.get(requestId);
  const clean = sanitizeElicitationResponse(response);
  if (!pending || !clean) return false;
  pending.resolve(clean);
  return true;
}

/** Cancel every elicitation waiting on the user, e.g. when the turn stops. */
export function cancelElicitations(session: ManagedSession): void {
  for (const pending of [...session.pendingElicitations.values()]) {
    pending.resolve({ action: 'cancel' });
  }
}
