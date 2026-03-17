import type { GroveBenchSettings, ToolRule } from '../../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  defaultModel: '',
  extendedThinking: false,
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  defaultTaskTimeoutMinutes: 10,
  maxParallelAgents: 5,
  circuitBreakerThreshold: 50,
  autoCleanupStaleWorktrees: true,
  worktreeCleanupIntervalMinutes: 15,
  enableDockerByDefault: false,
  sandboxAllowedDomains: [],
  defaultContainerImage: '',
  dockerOAuthToken: '',
  defaultBaseBranch: 'main',
  theme: 'system',
  alwaysOnTop: false,
};

class SettingsStore {
  current = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  draft = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  loading = $state(false);
  saving = $state(false);
  error = $state<string | null>(null);

  get dirty(): boolean {
    return JSON.stringify(this.current) !== JSON.stringify(this.draft);
  }

  async load() {
    this.loading = true;
    this.error = null;
    try {
      const s = await window.groveBench.getSettings();
      this.current = s;
      this.draft = structuredClone(s);
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
    }
  }

  async save() {
    this.saving = true;
    this.error = null;
    try {
      await window.groveBench.saveSettings($state.snapshot(this.draft));
      this.current = structuredClone(this.draft);
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.saving = false;
    }
  }

  reset() {
    this.draft = structuredClone(this.current);
    this.error = null;
  }

  // ─── List helpers ───

  addToolAllowRule(pattern: string) {
    this.draft.toolAllowRules = [...this.draft.toolAllowRules, { pattern }];
  }

  removeToolAllowRule(index: number) {
    this.draft.toolAllowRules = this.draft.toolAllowRules.filter((_, i) => i !== index);
  }

  addToolDenyRule(pattern: string) {
    this.draft.toolDenyRules = [...this.draft.toolDenyRules, { pattern }];
  }

  removeToolDenyRule(index: number) {
    this.draft.toolDenyRules = this.draft.toolDenyRules.filter((_, i) => i !== index);
  }

  addWorkingDirectory(dir: string) {
    this.draft.workingDirectories = [...this.draft.workingDirectories, dir];
  }

  removeWorkingDirectory(index: number) {
    this.draft.workingDirectories = this.draft.workingDirectories.filter((_, i) => i !== index);
  }

  addSandboxDomain(domain: string) {
    this.draft.sandboxAllowedDomains = [...this.draft.sandboxAllowedDomains, domain];
  }

  removeSandboxDomain(index: number) {
    this.draft.sandboxAllowedDomains = this.draft.sandboxAllowedDomains.filter((_, i) => i !== index);
  }
}

export const settingsStore = new SettingsStore();
