export interface DevServer {
  port: number;
  url: string;
  status?: 'ok' | 'error';
}

/** Tracks dev-server ports detected in each session's agent output. */
class DevServerStore {
  serversBySession = $state<Record<string, DevServer[]>>({});

  get(sessionId: string): DevServer[] {
    return this.serversBySession[sessionId] ?? [];
  }

  /** Record a newly-detected server, ignoring ports already known for the session. */
  add(sessionId: string, port: number, url: string): void {
    const servers = this.serversBySession[sessionId] ?? [];
    if (servers.some((s) => s.port === port)) return;
    this.serversBySession[sessionId] = [...servers, { port, url, status: 'ok' }];
  }

  remove(sessionId: string, port: number): void {
    const servers = this.serversBySession[sessionId] ?? [];
    this.serversBySession[sessionId] = servers.filter((s) => s.port !== port);
  }

  /** Drop all servers for a destroyed session. */
  destroy(sessionId: string): void {
    const { [sessionId]: _drop, ...rest } = this.serversBySession;
    this.serversBySession = rest;
  }
}

export const devServerStore = new DevServerStore();
