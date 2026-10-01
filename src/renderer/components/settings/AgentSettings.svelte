<script lang="ts">
  import { untrack } from 'svelte';
  import { settingsStore } from '../../stores/settings.svelte.js';
  import { store } from '../../stores/sessions.svelte.js';
  import { agentsStore } from '../../stores/agents.svelte.js';
  import ApiKeyField from '../ApiKeyField.svelte';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { defaultModelChoices, DEFAULT_MODEL_VALUE } from '$lib/model-choices.js';
  import type { CavemanMode, ControlDescriptor, ControlOption } from '../../../shared/types.js';
  import { CONTROL_IDS, CONTROL_SHORTCUTS } from '../../../shared/types.js';
  import SettingRow from './SettingRow.svelte';
  import CheckboxSetting from './CheckboxSetting.svelte';
  import ListSetting from './ListSetting.svelte';
  import SettingsGroup from './SettingsGroup.svelte';

  // ── Per-agent defaults ──
  // One group per registered agent: its credentials, its default model and
  // the session controls it declares for that model (permission mode,
  // thinking, speed, ...).
  // Everything comes from the adapter's own descriptors, so a new agent needs
  // no Settings changes. Models are picked from a list rather than typed, so
  // a typo can't break every new conversation.
  interface AgentGroup {
    id: string;
    displayName: string;
    models: Array<{ id: string; label: string }>;
    controls: ControlDescriptor[];
    /** The adapter's own model for background tasks, if it declares one. */
    backgroundModel?: string;
    /** Offers the Show thinking summaries setting. */
    thinkingSummaries: boolean;
  }
  let agentGroups = $state<AgentGroup[]>([]);
  let agentGroupsLoading = $state(false);
  let agentGroupsRequest = 0;

  async function loadAgentGroups(defaultModels: Record<string, string>) {
    const request = ++agentGroupsRequest;
    agentGroupsLoading = true;
    try {
      await agentsStore.load();
      const groups = await Promise.all(agentsStore.list.map(async (a): Promise<AgentGroup> => {
        const [models, controls] = await Promise.all([
          window.groveBench.getModels(a.id).catch(() => []),
          window.groveBench.getAdapterControls(a.id, defaultModels[a.id] || null).catch(() => [] as ControlDescriptor[]),
        ]);
        return {
          id: a.id,
          displayName: a.displayName,
          models,
          controls,
          backgroundModel: a.backgroundModel,
          thinkingSummaries: !!a.capabilities.thinkingSummaries,
        };
      }));
      if (request === agentGroupsRequest) agentGroups = groups;
    } catch {
      if (request === agentGroupsRequest) agentGroups = [];
    } finally {
      if (request === agentGroupsRequest) agentGroupsLoading = false;
    }
  }

  // Control descriptors depend on the model (e.g. adaptive thinking, fast
  // mode), so reload when a default model changes, and when an agent reports
  // a new model list.
  let modelsVersion = $state(0);
  $effect(() => window.groveBench.onModelsChanged(() => {
    agentsStore.refresh().finally(() => { modelsVersion++; });
  }));
  $effect(() => {
    const defaults = settingsStore.draft.defaultModels ?? {};
    void modelsVersion;
    // Untracked: the load reads agentsStore.loaded, which a models-changed
    // refresh flips twice, and each re-run would fetch every agent's models.
    untrack(() => loadAgentGroups(defaults));
  });

  function controlValue(adapterId: string, control: ControlDescriptor): string {
    const saved = settingsStore.adapterDefault(adapterId, control.id);
    return saved && control.options.some((o) => o.value === saved) ? saved : control.default;
  }

  /** Options from another source (e.g. Grove's own Read-safe mode) grouped
   *  by that source, so they render under a divider with it as the heading.
   *  Ungrouped options come first (see ControlOption.group). */
  function optionGroups(options: ControlOption[]): { name: string; options: ControlOption[] }[] {
    const groups: { name: string; options: ControlOption[] }[] = [];
    for (const option of options) {
      if (!option.group) continue;
      const group = groups.find((g) => g.name === option.group);
      if (group) group.options.push(option);
      else groups.push({ name: option.group, options: [option] });
    }
    return groups;
  }

  function controlLabel(control: ControlDescriptor): string {
    return `Default ${control.id === CONTROL_IDS.permissionMode ? 'permission mode' : control.label.toLowerCase()}`;
  }

  // Caveman mode trims the agent's wording to save output tokens.
  const responseStyles: { value: CavemanMode; label: string; description: string }[] = [
    { value: 'off', label: 'Normal', description: 'Full, normal wording' },
    { value: 'lite', label: 'Caveman lite', description: 'Drops filler and hedging, keeps articles' },
    { value: 'full', label: 'Caveman full', description: 'Drops articles; sentence fragments are fine' },
    { value: 'ultra', label: 'Caveman ultra', description: 'Most compressed, with abbreviations' },
  ];
  const responseStyle = $derived(responseStyles.find((s) => s.value === settingsStore.draft.cavemanMode) ?? responseStyles[0]);

  /** Thinking summaries is one setting, offered only by some agents. */
  const summaryAgents = $derived(agentGroups.filter((a) => a.thinkingSummaries));
</script>

{#if agentGroups.length === 0}
  <p class="text-xs text-muted-foreground">
    {agentGroupsLoading ? 'Loading agents…' : 'No agents registered.'}
  </p>
{/if}

{#each agentGroups as agent (agent.id)}
  {@const status = store.prerequisites?.agents[agent.id]}
  {@const currentModel = settingsStore.defaultModel(agent.id)}
  {@const modelChoices = defaultModelChoices(agent.models, currentModel)}
  {@const selectedModel = currentModel || DEFAULT_MODEL_VALUE}
  {@const currentBackground = settingsStore.backgroundModel(agent.id)}
  {@const backgroundChoices = defaultModelChoices(agent.models, currentBackground, agent.backgroundModel ?? null)}
  {@const selectedBackground = currentBackground || DEFAULT_MODEL_VALUE}
  <SettingsGroup title={agent.displayName} card>
    <!-- Credentials: asked for when a conversation starts, changed here -->
    {#if status?.apiKey}
      <div data-setting="credentials" class="flex flex-col gap-2">
        <p class="text-xs text-muted-foreground">
          {#if status.apiKey.saved}
            Using the saved API key.
          {:else if status.authenticated}
            Signed in{status.email ? ` as ${status.email}` : ''}{status.authMethod ? ` via ${status.authMethod}` : ''}.
          {:else}
            No credentials found. Add a key, or sign in with the CLI in a terminal.
          {/if}
        </p>
        <ApiKeyField adapterId={agent.id} />
      </div>
    {/if}

    <SettingRow
      setting="default-model"
      label="Default model"
      for="settings-{agent.id}-model"
      description="New conversations with this agent start on this model. Each conversation can switch from the status bar."
    >
      <Select.Root
        type="single"
        value={selectedModel}
        onValueChange={(v) => { if (v) settingsStore.setDefaultModel(agent.id, v === DEFAULT_MODEL_VALUE ? '' : v); }}
      >
        <Select.Trigger id="settings-{agent.id}-model" class="w-64" aria-label={`${agent.displayName} default model`}>
          {modelChoices.find((c) => c.value === selectedModel)?.label ?? selectedModel}
        </Select.Trigger>
        <Select.Content>
          {#each modelChoices as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </SettingRow>

    <SettingRow
      setting="background-model"
      label="Background model"
      for="settings-{agent.id}-background-model"
      description="Used for memory notes, memory compaction, commit messages and skill suggestions in this agent's conversations. These run often, so a cheap model is best."
    >
      <Select.Root
        type="single"
        value={selectedBackground}
        onValueChange={(v) => { if (v) settingsStore.setBackgroundModel(agent.id, v === DEFAULT_MODEL_VALUE ? '' : v); }}
      >
        <Select.Trigger id="settings-{agent.id}-background-model" class="w-64" aria-label={`${agent.displayName} background model`}>
          {backgroundChoices.find((c) => c.value === selectedBackground)?.label ?? selectedBackground}
        </Select.Trigger>
        <Select.Content>
          {#each backgroundChoices as choice (choice.value)}
            <Select.Item value={choice.value} label={choice.label} />
          {/each}
        </Select.Content>
      </Select.Root>
    </SettingRow>

    {#if agent.controls.length === 0}
      <p class="text-xs text-muted-foreground">This agent has no conversation controls to set.</p>
    {:else}
      <div data-setting="default-controls" class="flex flex-col gap-5">
        <p class="text-xs text-muted-foreground">Options depend on the default model above. They apply to new conversations.</p>
        {#each agent.controls as control (control.id)}
          {@const value = controlValue(agent.id, control)}
          {@const selected = control.options.find((o) => o.value === value)}
          <SettingRow setting="default-{control.id}" label={controlLabel(control)} for="settings-{agent.id}-{control.id}">
            {#snippet help()}
              {selected?.description ? selected.description.replace(/[.\s]*$/, '') + '.' : ''}
              {#if CONTROL_SHORTCUTS[control.id]}
                Each conversation can change it from the status bar ({CONTROL_SHORTCUTS[control.id]}).
              {/if}
            {/snippet}
            <Select.Root type="single" {value} onValueChange={(v) => { if (v) settingsStore.setAdapterDefault(agent.id, control.id, v === control.default ? null : v); }}>
              <Select.Trigger id="settings-{agent.id}-{control.id}" class="w-48" aria-label={`${agent.displayName} default ${control.label.toLowerCase()}`}>
                {selected?.label ?? value}
              </Select.Trigger>
              <Select.Content>
                {#each control.options.filter((o) => !o.group) as option (option.value)}
                  <Select.Item value={option.value} label={option.label} />
                {/each}
                {#each optionGroups(control.options) as group (group.name)}
                  <Select.Separator />
                  <Select.Group>
                    <Select.GroupHeading>{group.name}</Select.GroupHeading>
                    {#each group.options as option (option.value)}
                      <Select.Item value={option.value} label={option.label} />
                    {/each}
                  </Select.Group>
                {/each}
              </Select.Content>
            </Select.Root>
          </SettingRow>
        {/each}
      </div>
    {/if}
  </SettingsGroup>
{/each}

<SettingsGroup title="All agents" description="These apply to every agent's conversations." card>
  <SettingRow
    setting="system-prompt"
    label="System prompt append"
    for="settings-prompt"
    description="Instructions added to every conversation."
  >
    <Textarea
      id="settings-prompt"
      bind:value={settingsStore.draft.defaultSystemPromptAppend}
      class="min-h-20 max-h-52 resize-y"
    />
  </SettingRow>

  <ListSetting
    setting="working-directories"
    label="Additional working directories"
    layout="rows"
    items={settingsStore.draft.workingDirectories}
    placeholder="e.g. C:\dev\shared-config"
    removeLabel="Remove directory"
    onadd={(v) => settingsStore.addWorkingDirectory(v)}
    onremove={(i) => settingsStore.removeWorkingDirectory(i)}
  >
    {#snippet help()}Folders outside the project that agents can also use.{/snippet}
  </ListSetting>

  <SettingRow
    setting="response-style"
    label="Response style"
    for="settings-response-style"
    description="{responseStyle.description}.{settingsStore.draft.cavemanMode !== 'off' ? ' Uses about 65 to 75% fewer output tokens. Code blocks stay normal.' : ''}"
  >
    <Select.Root type="single" value={settingsStore.draft.cavemanMode} onValueChange={(v) => { if (v) settingsStore.draft.cavemanMode = v as CavemanMode; }}>
      <Select.Trigger id="settings-response-style" class="w-48">
        {responseStyle.label}
      </Select.Trigger>
      <Select.Content>
        {#each responseStyles as style (style.value)}
          <Select.Item value={style.value} label={style.label} />
        {/each}
      </Select.Content>
    </Select.Root>
  </SettingRow>

  {#if summaryAgents.length > 0}
    <CheckboxSetting
      setting="thinking-summaries"
      label="Show thinking summaries"
      description="Show a short summary of the model's thinking in the conversation. Doesn't change how much the model thinks or what it costs. Applies to agents started after the change.{summaryAgents.length < agentGroups.length ? ` Only ${summaryAgents.map((a) => a.displayName).join(' and ')} can show these.` : ''}"
      bind:checked={settingsStore.draft.showThinkingSummaries}
    />
  {/if}

  <CheckboxSetting
    setting="preview-agent-tools"
    label="Let the agent use the Preview browser"
    description="Gives the agent its own page in the Preview tab to open, screenshot, read, click and type in. Local addresses only. Applies to agents started after the change."
    bind:checked={settingsStore.draft.previewAgentTools}
  />
</SettingsGroup>
