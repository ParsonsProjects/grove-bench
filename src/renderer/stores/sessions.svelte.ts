import type { SessionInfo, PrerequisiteStatus, SessionStatus, ClaudeEvent } from '../../shared/types.js';

const REPOS_KEY = 'grove-bench:repos';

function loadRepos(): string[] {
  try {
    const saved = localStorage.getItem(REPOS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

// ─── Chat types ───

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; input: string; id: string }
  | { type: 'permission'; requestId: string; toolName: string; input: Record<string, unknown>; resolved: boolean; allowed?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant';
  blocks: ContentBlock[];
}

interface SessionEntry {
  id: string;
  branch: string;
  repoPath: string;
  status: SessionStatus;
  messages: ChatMessage[];
  currentBlocks: ContentBlock[];
}

class SessionStore {
  sessions = $state<SessionEntry[]>([]);
  repos = $state<string[]>(loadRepos());
  activeSessionId = $state<string | null>(null);
  prerequisites = $state<PrerequisiteStatus | null>(null);
  error = $state<string | null>(null);
  creating = $state(false);

  get count() {
    return this.sessions.length;
  }

  get canCreate() {
    return this.repos.length > 0;
  }

  get activeSession() {
    return this.sessions.find((s) => s.id === this.activeSessionId) ?? null;
  }

  private persistRepos() {
    localStorage.setItem(REPOS_KEY, JSON.stringify(this.repos));
  }

  addRepo(path: string) {
    if (!this.repos.includes(path)) {
      this.repos = [...this.repos, path];
      this.persistRepos();
    }
  }

  removeRepo(path: string) {
    this.repos = this.repos.filter((r) => r !== path);
    this.persistRepos();
  }

  canRemoveRepo(path: string): boolean {
    return this.sessionsForRepo(path).length === 0;
  }

  sessionsForRepo(path: string): SessionEntry[] {
    return this.sessions.filter((s) => s.repoPath === path);
  }

  repoDisplayName(path: string): string {
    return path.split(/[/\\]/).pop() || path;
  }

  addSession(entry: Omit<SessionEntry, 'messages' | 'currentBlocks'>) {
    this.sessions = [...this.sessions, { ...entry, messages: [], currentBlocks: [] }];
    this.activeSessionId = entry.id;
  }

  removeSession(id: string) {
    this.sessions = this.sessions.filter((s) => s.id !== id);
    if (this.activeSessionId === id) {
      this.activeSessionId = this.sessions[0]?.id ?? null;
    }
  }

  updateStatus(id: string, status: SessionStatus) {
    this.sessions = this.sessions.map((s) =>
      s.id === id ? { ...s, status } : s
    );
  }

  addUserMessage(sessionId: string, text: string) {
    this.sessions = this.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      return {
        ...s,
        messages: [...s.messages, { role: 'user' as const, blocks: [{ type: 'text' as const, text }] }],
        currentBlocks: [],
      };
    });
  }

  handleClaudeEvent(sessionId: string, event: ClaudeEvent) {
    console.log('[claude event]', event.type, event);
    this.sessions = this.sessions.map((s) => {
      if (s.id !== sessionId) return s;

      const blocks = [...s.currentBlocks];

      switch (event.type) {
        case 'assistant': {
          // Claude Code stream-json emits 'assistant' with message.content array
          const message = event.message as { content?: Array<{ type: string; text?: string; name?: string; input?: unknown; id?: string }> } | undefined;
          const contentArr = message?.content;
          if (Array.isArray(contentArr)) {
            const parsed: ContentBlock[] = [];
            for (const item of contentArr) {
              if (item.type === 'text' && typeof item.text === 'string') {
                parsed.push({ type: 'text', text: item.text });
              } else if (item.type === 'tool_use') {
                parsed.push({
                  type: 'tool_use',
                  name: item.name ?? 'unknown',
                  input: typeof item.input === 'string' ? item.input : JSON.stringify(item.input ?? {}),
                  id: item.id ?? '',
                });
              }
            }
            if (parsed.length > 0) {
              return {
                ...s,
                messages: [...s.messages, { role: 'assistant' as const, blocks: parsed }],
                currentBlocks: [],
              };
            }
          }
          // Fallback: finalize any accumulated streaming blocks
          if (blocks.length > 0) {
            return {
              ...s,
              messages: [...s.messages, { role: 'assistant' as const, blocks }],
              currentBlocks: [],
            };
          }
          break;
        }

        // Low-level streaming events (may arrive with --verbose in some versions)
        case 'content_block_start': {
          const contentBlock = event.content_block as { type: string; text?: string; name?: string; id?: string } | undefined;
          if (contentBlock?.type === 'text') {
            blocks.push({ type: 'text', text: contentBlock.text ?? '' });
          } else if (contentBlock?.type === 'tool_use') {
            blocks.push({
              type: 'tool_use',
              name: contentBlock.name ?? 'unknown',
              input: '',
              id: contentBlock.id ?? '',
            });
          }
          break;
        }

        case 'content_block_delta': {
          const delta = event.delta as { type: string; text?: string; partial_json?: string } | undefined;
          if (delta?.type === 'text_delta' && delta.text) {
            const lastText = blocks.findLast((b) => b.type === 'text');
            if (lastText && lastText.type === 'text') {
              lastText.text += delta.text;
            }
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const lastTool = blocks.findLast((b) => b.type === 'tool_use');
            if (lastTool && lastTool.type === 'tool_use') {
              lastTool.input += delta.partial_json;
            }
          }
          break;
        }

        case 'content_block_stop':
          break;

        case 'result': {
          // Fallback: if no assistant message was produced, extract from result.result
          const hasAssistantMsg = s.messages.some(
            (m, i) => m.role === 'assistant' && i === s.messages.length - 1
          );
          if (!hasAssistantMsg && blocks.length === 0 && typeof event.result === 'string' && event.result.trim()) {
            blocks.push({ type: 'text', text: event.result as string });
          }
          if (blocks.length > 0) {
            return {
              ...s,
              messages: [...s.messages, { role: 'assistant' as const, blocks }],
              currentBlocks: [],
            };
          }
          break;
        }

        case 'error': {
          const errorText = (event.error as string) || 'Unknown error';
          blocks.push({ type: 'text', text: `**Error:** ${errorText}` });
          return {
            ...s,
            messages: [...s.messages, { role: 'assistant' as const, blocks }],
            currentBlocks: [],
          };
        }
      }

      return { ...s, currentBlocks: blocks };
    });
  }

  addPermissionBlock(sessionId: string, requestId: string, toolName: string, input: Record<string, unknown>) {
    this.sessions = this.sessions.map((s) => {
      if (s.id !== sessionId) return s;
      const blocks = [...s.currentBlocks];
      blocks.push({ type: 'permission', requestId, toolName, input, resolved: false });
      return { ...s, currentBlocks: blocks };
    });
  }

  resolvePermission(sessionId: string, requestId: string, allowed: boolean) {
    // Check both currentBlocks and messages
    this.sessions = this.sessions.map((s) => {
      if (s.id !== sessionId) return s;

      const currentBlocks = s.currentBlocks.map((b) =>
        b.type === 'permission' && b.requestId === requestId
          ? { ...b, resolved: true, allowed }
          : b
      );

      const messages = s.messages.map((m) => ({
        ...m,
        blocks: m.blocks.map((b) =>
          b.type === 'permission' && b.requestId === requestId
            ? { ...b, resolved: true, allowed }
            : b
        ),
      }));

      return { ...s, messages, currentBlocks };
    });
  }

  setError(msg: string | null) {
    this.error = msg;
  }

  clearError() {
    this.error = null;
  }
}

export const store = new SessionStore();
