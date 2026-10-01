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
  acpAgents: [],
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

/** Settings edited in a text field. Typing saves them after a pause rather
 *  than on every key; everything else saves as soon as it changes. */
const TEXT_SETTINGS: ReadonlySet<string> = new Set<keyof GroveBenchSettings>([
  'defaultSystemPromptAppend', 'defaultBaseBranch', 'branchNamingRule',
]);
const TEXT_SAVE_DELAY_MS = 500;

class SettingsStore {
  current = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  /** What the Settings panel edits. It saves itself (see scheduleSave), so
   *  it only differs from `current` while a save is pending or failed. */
  draft = $state<GroveBenchSettings>({ ...DEFAULT_SETTINGS });
  loading = $state(true);
  /** True once settings have loaded, so reopening Settings doesn't flash a
   *  loading state while it refreshes them. */
  loaded = $state(false);
  saving = $state(false);
  /** When the last save finished, for the panel's "saved" status. */
  savedAt = $state<number | null>(null);
  error = $state<string | null>(null);
  /** Whether the Settings panel is open (gear button or Ctrl+,). */
  panelOpen = $state(false);

  get dirty(): boolean {
    return JSON.stringify(this.current) !== JSON.stringify(this.draft);
  }

  /** Reload from disk. Pending edits are saved first, so a reload can't
   *  undo them. */
  async load() {
    await this.save();
    // That save failed: keep the edit (and its error) rather than replace it.
    if (this.dirty) return;
    this.loading = true;
    this.error = null;
    try {
      const s = await window.groveBench.getSettings();
      this.current = s;
      this.draft = JSON.parse(JSON.stringify(s));
      this.loaded = true;
    } catch (e: any) {
      this.error = e.message || String(e);
    } finally {
      this.loading = false;
    }
  }

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Save the draft soon after an edit: straight away for toggles and
   *  pickers, after a pause in typing for text fields. */
  scheduleSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const current = this.current as unknown as Record<string, unknown>;
    const draft = this.draft as unknown as Record<string, unknown>;
    const changed = Object.keys(draft).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(current[k]));
    if (changed.length === 0) {
      // A change whose save failed was undone: its error no longer applies.
      if (this.loaded) this.error = null;
      return;
    }
    // While a save is failing, every edit waits for a pause, so typing
    // doesn't retry (and fail) on each key.
    const delay = this.error || changed.every((k) => TEXT_SETTINGS.has(k)) ? TEXT_SAVE_DELAY_MS : 0;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, delay);
  }

  /** Save the draft now, if it has unsaved edits. Runs after any save
   *  already in flight, and saves the draft as it is when its turn comes. */
  save(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    const run = this.saveChain.then(async () => {
      if (!this.dirty) {
        // Nothing is unsaved, so an earlier save error (say, from a
        // status-bar toggle) no longer applies. Not before the first load,
        // whose error is about loading.
        if (this.loaded) this.error = null;
        return;
      }
      const next = $state.snapshot(this.draft) as GroveBenchSettings;
      this.saving = true;
      this.error = null;
      try {
        await window.groveBench.saveSettings(next);
        this.current = next;
        this.savedAt = Date.now();
      } catch (e: any) {
        this.error = e.message || String(e);
      } finally {
        this.saving = false;
      }
    });
    this.saveChain = run.catch(() => {});
    return run;
  }

  /** Saves in flight, run one at a time (see save and updateNow). */
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

  /** Add a rule unless the list already has it. */
  addToolAllowRule(pattern: string) {
    if (this.draft.toolAllowRules.some((r) => r.pattern === pattern)) return;
    this.draft.toolAllowRules = [...this.draft.toolAllowRules, { pattern }];
  }

  removeToolAllowRule(index: number) {
    this.draft.toolAllowRules = this.draft.toolAllowRules.filter((_, i) => i !== index);
  }

  /** Add a rule unless the list already has it. */
  addToolDenyRule(pattern: string) {
    if (this.draft.toolDenyRules.some((r) => r.pattern === pattern)) return;
    this.draft.toolDenyRules = [...this.draft.toolDenyRules, { pattern }];
  }

  removeToolDenyRule(index: number) {
    this.draft.toolDenyRules = this.draft.toolDenyRules.filter((_, i) => i !== index);
  }

  /** Add a directory unless the list already has it. */
  addWorkingDirectory(dir: string) {
    if (this.draft.workingDirectories.includes(dir)) return;
    this.draft.workingDirectories = [...this.draft.workingDirectories, dir];
  }

  removeWorkingDirectory(index: number) {
    this.draft.workingDirectories = this.draft.workingDirectories.filter((_, i) => i !== index);
  }

  addAcpAgent(agent: { name: string; command: string; args: string[] }) {
    this.draft.acpAgents = [...this.draft.acpAgents, { id: '', ...agent }];
  }

  removeAcpAgent(index: number) {
    this.draft.acpAgents = this.draft.acpAgents.filter((_, i) => i !== index);
  }

}

export const settingsStore = new SettingsStore();
