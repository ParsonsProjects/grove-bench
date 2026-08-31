import type { GroveBenchSettings, ToolRule } from '../../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  defaultPermissionMode: 'default',
  toolAllowRules: [],
  toolDenyRules: [],
  disableBypassMode: false,
  disabledSkills: [],
  defaultModel: '',
  defaultThinkingLevel: 'high',
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  memoryAutoSave: true,
  memoryAutoCompact: true,
  autoInstallDeps: false,
  idleAutoStopMinutes: 30,
  defaultBaseBranch: '',
  theme: 'system',
  alwaysOnTop: false,
  repoColors: {},
  diffViewMode: 'unified',
  spellcheck: true,
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,
  analyticsEnabled: false,
  analyticsPrompted: false,
};

class SettingsStore {
  current = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  draft = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  loading = $state(true);
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
      this.draft = JSON.parse(JSON.stringify(s));
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
      this.current = $state.snapshot(this.draft) as GroveBenchSettings;
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.saving = false;
    }
  }

  reset() {
    this.draft = $state.snapshot(this.current) as GroveBenchSettings;
    this.error = null;
  }

  /** Persist a partial change immediately (status-bar toggles), keeping any
   *  unrelated unsaved Settings-panel edits in the draft intact. */
  async updateNow(patch: Partial<GroveBenchSettings>) {
    const next = { ...($state.snapshot(this.current) as GroveBenchSettings), ...patch };
    this.error = null;
    try {
      await window.groveBench.saveSettings(next);
      this.current = next;
      this.draft = { ...($state.snapshot(this.draft) as GroveBenchSettings), ...patch };
    } catch (e: any) {
      this.error = e.message || String(e);
      throw e;
    }
  }

  /** Toggle one skill's disabled state and persist right away. */
  async setSkillDisabled(name: string, disabled: boolean) {
    const list = this.current.disabledSkills ?? [];
    const next = disabled
      ? (list.includes(name) ? list : [...list, name])
      : list.filter((n) => n !== name);
    await this.updateNow({ disabledSkills: next });
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

}

export const settingsStore = new SettingsStore();
