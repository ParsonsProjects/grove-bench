import type { ShellOutputEvent } from '../../shared/types.js';

export interface TerminalLine {
  id: string;
  stream: 'stdout' | 'stderr' | 'system';
  text: string;
}

let lineCounter = 0;
function nextLineId(): string {
  return `tl_${++lineCounter}`;
}

const MAX_LINES = 5000;

class TerminalStore {
  linesBySession = $state<Record<string, TerminalLine[]>>({});
  activeExecBySession = $state<Record<string, string | null>>({});
  isRunningBySession = $state<Record<string, boolean>>({});
  private cleanups = new Map<string, () => void>();

  getLines(sessionId: string): TerminalLine[] {
    return this.linesBySession[sessionId] ?? [];
  }

  getIsRunning(sessionId: string): boolean {
    return this.isRunningBySession[sessionId] ?? false;
  }

  getActiveExecId(sessionId: string): string | null {
    return this.activeExecBySession[sessionId] ?? null;
  }

  subscribe(sessionId: string) {
    if (this.cleanups.has(sessionId)) return;
    const cleanup = window.groveBench.onShellOutput(sessionId, (event) => {
      this.handleOutput(sessionId, event);
    });
    this.cleanups.set(sessionId, cleanup);
  }

  unsubscribe(sessionId: string) {
    const cleanup = this.cleanups.get(sessionId);
    if (cleanup) {
      cleanup();
      this.cleanups.delete(sessionId);
    }
  }

  async startCommand(sessionId: string, command: string) {
    this.pushLine(sessionId, { id: nextLineId(), stream: 'system', text: `$ ${command}` });
    this.isRunningBySession[sessionId] = true;

    try {
      const execId = await window.groveBench.shellRun(sessionId, command);
      this.activeExecBySession[sessionId] = execId;
    } catch (err: any) {
      this.pushLine(sessionId, { id: nextLineId(), stream: 'stderr', text: `Failed to start: ${err?.message ?? err}` });
      this.isRunningBySession[sessionId] = false;
    }
  }

  killActive(sessionId: string) {
    const execId = this.activeExecBySession[sessionId];
    if (execId) {
      window.groveBench.shellKill(execId);
    }
  }

  clearOutput(sessionId: string) {
    this.linesBySession[sessionId] = [];
  }

  private handleOutput(sessionId: string, event: ShellOutputEvent) {
    if (event.stream === 'exit') {
      this.pushLine(sessionId, {
        id: nextLineId(),
        stream: 'system',
        text: `Process exited with code ${event.exitCode ?? 0}`,
      });
      this.activeExecBySession[sessionId] = null;
      this.isRunningBySession[sessionId] = false;
      return;
    }

    if (event.data) {
      // Split into lines but keep as a single block to avoid excessive DOM elements
      const text = event.data;
      this.pushLine(sessionId, {
        id: nextLineId(),
        stream: event.stream,
        text,
      });
    }
  }

  private pushLine(sessionId: string, line: TerminalLine) {
    const current = this.linesBySession[sessionId] ?? [];
    const updated = [...current, line];
    // Cap at MAX_LINES
    if (updated.length > MAX_LINES) {
      updated.splice(0, updated.length - MAX_LINES);
    }
    this.linesBySession[sessionId] = updated;
  }
}

export const terminalStore = new TerminalStore();
