<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import * as Segmented from '$lib/components/ui/segmented/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { stripIpcErrorPrefix } from '../lib/mcp-errors.js';
  import type { SkillPromptOpts } from '../lib/skill-prompt.js';
  import type { SkillInfo } from '../../shared/types.js';
  import { errorMessage } from '../../shared/error-message.js';
  import { MAX_SKILL_DESCRIPTION_LENGTH, skillNameProblem } from '../../shared/skill-name.js';

  let {
    sessionId,
    onclose,
    oncreated,
    onaskagent,
    initial = null,
  }: {
    sessionId: string;
    onclose: () => void;
    /** Fired after a manual create succeeds so the caller can refresh its list. */
    oncreated: (skill: SkillInfo) => void;
    /** Ask agent to write it: the caller starts the agent's thread (and can
     *  open the dialog again with these if it can't start). */
    onaskagent: (skill: SkillPromptOpts) => void;
    /** Prefill (e.g. from a skill suggestion) — editable before creating. */
    initial?: { name?: string; description?: string; instructions?: string; scope?: 'project' | 'user' } | null;
  } = $props();

  let open = $state(true);
  // `initial` is a one-time prefill: read it once at mount, deliberately
  // not tracked, so later prop changes don't clobber what the user typed.
  const prefill = untrack(() => initial);
  let name = $state(prefill?.name ?? '');
  let description = $state(prefill?.description ?? '');
  let scope = $state<'project' | 'user'>(prefill?.scope ?? 'project');
  let instructions = $state(prefill?.instructions ?? '');
  let creating = $state(false);
  let dialogError = $state('');

  /** What's wrong with the name, by the Agent Skills rules main checks too. */
  let nameProblem = $derived(skillNameProblem(name.trim()));
  let descriptionOk = $derived(description.trim().length > 0 && description.trim().length <= MAX_SKILL_DESCRIPTION_LENGTH);
  let canCreate = $derived(!nameProblem && descriptionOk && instructions.trim().length > 0);
  let canSendToAgent = $derived(!nameProblem && descriptionOk);
  /** A project without git: every thread runs in its folder, so no branch. */
  let folderProject = $derived(store.isFolderProject(store.sessions.find((s) => s.id === sessionId)?.repoPath ?? ''));

  function close() {
    open = false;
    onclose();
  }

  async function handleCreate() {
    if (!canCreate || creating) return;
    creating = true;
    dialogError = '';
    try {
      const repoPath = store.sessions.find((s) => s.id === sessionId)?.repoPath ?? '';
      const skill = await window.groveBench.addSkill(sessionId, repoPath, {
        name: name.trim(),
        description: description.trim(),
        instructions,
        scope,
      });
      oncreated(skill);
      close();
    } catch (e) {
      dialogError = stripIpcErrorPrefix(errorMessage(e));
    } finally {
      creating = false;
    }
  }

  /** Hand skill authoring to the agent in a new thread: it knows its own
   *  packaged-skill format (frontmatter extensions, resources) better than
   *  the manual form does, and follow-up questions go there. */
  function handleAskAgent() {
    if (!canSendToAgent) return;
    const skill = { name: name.trim(), description: description.trim(), scope, notes: instructions };
    // Closed first: the new thread takes the screen, and this dialog would
    // stay over it.
    close();
    onaskagent(skill);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) close();
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add skill</Dialog.Title>
      <Dialog.Description>
        Package instructions any agent can invoke by name. Saved in <span class="font-mono">.agents/skills</span>, which every agent reads (Claude Agent through a link). A thread that's already running may need a restart to see it.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-4">
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <Label for="skill-name" class="mb-1 block">Name</Label>
          <Input
            id="skill-name"
            type="text"
            bind:value={name}
            placeholder="release-notes"
            autofocus
          />
        </div>
        <div>
          <Label id="skill-scope" class="mb-1 block">Scope</Label>
          <Segmented.Root
            value={scope}
            onValueChange={(v) => { if (v === 'project' || v === 'user') scope = v; }}
            aria-labelledby="skill-scope"
            class="h-9"
          >
            <Segmented.Item
              value="project"
              title="Written into the project, so it ships with the code and is reviewed with it"
            >
              Project
            </Segmented.Item>
            <Segmented.Item
              value="user"
              title="Written to .agents/skills in your user folder, for all your projects"
            >
              User
            </Segmented.Item>
          </Segmented.Root>
        </div>
      </div>
      {#if name.trim() && nameProblem}
        <p class="text-micro text-destructive -mt-2">{nameProblem}.</p>
      {/if}

      <div>
        <Label for="skill-description" class="mb-1 block">Description</Label>
        <Input
          id="skill-description"
          type="text"
          bind:value={description}
          placeholder="When should the agent use this skill?"
        />
        {#if description.trim().length > MAX_SKILL_DESCRIPTION_LENGTH}
          <p class="text-micro text-destructive mt-1">Keep the description to {MAX_SKILL_DESCRIPTION_LENGTH} characters or fewer ({description.trim().length} now).</p>
        {/if}
      </div>

      <div>
        <Label for="skill-instructions" class="mb-1 block">Instructions</Label>
        <Textarea
          id="skill-instructions"
          bind:value={instructions}
          rows={7}
          placeholder="Markdown instruction body, or rough notes if you hand it to the agent below…"
          class="resize-y font-mono"
        />
        <p class="text-micro text-muted-foreground mt-1">
          {scope === 'user'
            ? 'User skills apply to every project on this machine.'
            : folderProject
              ? 'Project skills are written into the project folder.'
              : 'Create skill writes it into this thread\'s worktree, where it shows up in the Changes tab: a new thread has it once it is committed and merged. Ask agent writes it on a new branch.'}
        </p>
      </div>

      {#if dialogError}
        <Notice tone="danger">
          <p class="whitespace-pre-wrap">{dialogError}</p>
        </Notice>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          onclick={handleAskAgent}
          disabled={!canSendToAgent}
          title={scope === 'project' && !folderProject
            ? 'Start a new thread on a branch of its own where the agent drafts and writes the skill (instructions above become optional notes)'
            : 'Start a new thread in the project folder where the agent drafts and writes the skill (instructions above become optional notes)'}
        >
          Ask agent to write it
        </Button>
        <Button onclick={handleCreate} disabled={!canCreate || creating}>
          {#if creating}
            <span class="inline-flex items-center gap-1.5">
              <Pulse motion="spin" size="sm" tone="current" />
              Creating…
            </span>
          {:else}
            Create skill
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
