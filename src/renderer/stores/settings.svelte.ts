import type { GroveBenchSettings, ToolRule } from '../../shared/types.js';

const DEFAULT_SETTINGS: GroveBenchSettings = {
  toolAllowRules: [],
  toolDenyRules: [],
  disabledSkills: [],
  autoSkillSuggestions: false,
  defaultModels: {},
  adapterDefaults: {},
  showThinkingSummaries: true,
  cavemanMode: 'off',
  workingDirectories: [],
  defaultSystemPromptAppend: '',
  memoryAutoSave: true,
  memoryAutoCompact: false,
  memoryCompactTimeoutSeconds: 300,
  backgroundModels: {},
  autoInstallDeps: false,
  previewAgentTools: true,
  idleSleepMinutes: 30,
  defaultBaseBranch: '',
  branchNamingRule: '',
  theme: 'system',
  alwaysOnTop: false,
  autoDownloadUpdates: true,
  repoColors: {},
  groveCharacters: true,
  diffViewMode: 'unified',
  defaultActivityView: 'summary',
  spellcheck: true,
  notifyOnTurnComplete: true,
  notifyOnPermission: true,
  notifyOnPrAlert: true,
  notifyTaskbarFlash: true,
  notifyTaskbarBadge: true,
  analyticsEnabled: false,
  analyticsPrompted: false,
  crashReportsEnabled: false,
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

  /** Immediate saves in flight, run one at a time (see updateNow). */
  private saveChain: Promise<void> = Promise.resolve();

  /** Persist a partial change immediately (status-bar toggles), keeping any
   *  unrelated unsaved Settings-panel edits in the draft intact. Saves run one
   *  at a time, each on the settings the last one left: main replaces the
   *  whole file, so two overlapping saves built from the same starting point
   *  would drop the first one's change. `patch` may be a function of the
   *  current settings for changes that depend on them. */
  updateNow(patch: Partial<GroveBenchSettings> | ((current: GroveBenchSettings) => Partial<GroveBenchSettings>)): Promise<void> {
    const run = this.saveChain.then(async () => {
      const current = $state.snapshot(this.current) as GroveBenchSettings;
      const changes = typeof patch === 'function' ? patch(current) : patch;
      const next = { ...current, ...changes };
      this.error = null;
      try {
        await window.groveBench.saveSettings(next);
        this.current = next;
        this.draft = { ...($state.snapshot(this.draft) as GroveBenchSettings), ...changes };
      } catch (e: any) {
        this.error = e.message || String(e);
        throw e;
      }
    });
    this.saveChain = run.catch(() => {});
    return run;
  }

  /** Toggle one skill's disabled state and persist right away. */
  async setSkillDisabled(name: string, disabled: boolean) {
    await this.updateNow((current) => {
      const list = current.disabledSkills ?? [];
      return {
        disabledSkills: disabled
          ? (list.includes(name) ? list : [...list, name])
          : list.filter((n) => n !== name),
      };
    });
  }

  // ─── List helpers ───

  /** Draft default model for an adapter, or '' for the adapter's own default. */
  defaultModel(adapterId: string): string {
    return this.draft.defaultModels?.[adapterId] ?? '';
  }

  /** Set (or with an empty value, clear) an adapter's default model in the draft. */
  setDefaultModel(adapterId: string, model: string) {
    const next = { ...(this.draft.defaultModels ?? {}) };
    if (model) next[adapterId] = model;
    else delete next[adapterId];
    this.draft.defaultModels = next;
  }

  /** Draft background model for an adapter, or '' for the adapter's own default. */
  backgroundModel(adapterId: string): string {
    return this.draft.backgroundModels?.[adapterId] ?? '';
  }

  /** Set (or with an empty value, clear) an adapter's background model in the draft. */
  setBackgroundModel(adapterId: string, model: string) {
    const next = { ...(this.draft.backgroundModels ?? {}) };
    if (model) next[adapterId] = model;
    else delete next[adapterId];
    this.draft.backgroundModels = next;
  }

  /** Draft value for one adapter control, or undefined when unset. */
  adapterDefault(adapterId: string, controlId: string): string | undefined {
    return this.draft.adapterDefaults?.[adapterId]?.[controlId];
  }

  /** Set (or with an empty value, clear) an adapter control default in the draft. */
  setAdapterDefault(adapterId: string, controlId: string, value: string | null) {
    const current = this.draft.adapterDefaults ?? {};
    const forAdapter = { ...(current[adapterId] ?? {}) };
    if (value) forAdapter[controlId] = value;
    else delete forAdapter[controlId];
    const next = { ...current };
    if (Object.keys(forAdapter).length > 0) next[adapterId] = forAdapter;
    else delete next[adapterId];
    this.draft.adapterDefaults = next;
  }

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
