<script lang="ts">
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { store } from '../stores/sessions.svelte.js';
  import { messageStore } from '../stores/messages.svelte.js';
  import { buildCreateSkillPrompt } from '../lib/skill-prompt.js';
  import type { SkillInfo } from '../../shared/types.js';

  let {
    sessionId,
    onclose,
    oncreated,
    initial = null,
  }: {
    sessionId: string;
    onclose: () => void;
    /** Fired after a manual create succeeds so the caller can refresh its list. */
    oncreated: (skill: SkillInfo) => void;
    /** Prefill (e.g. from a skill suggestion) — editable before creating. */
    initial?: { name?: string; description?: string; instructions?: string } | null;
  } = $props();

  let open = $state(true);
  let name = $state(initial?.name ?? '');
  let description = $state(initial?.description ?? '');
  let scope = $state<'project' | 'user'>('project');
  let instructions = $state(initial?.instructions ?? '');
  let creating = $state(false);
  let dialogError = $state('');

  let sessionStatus = $derived(store.sessions.find((s) => s.id === sessionId)?.status);
  let isRunning = $derived(messageStore.getIsRunning(sessionId));
  /** The agent path needs a live, idle session to take the turn. */
  let canAskAgent = $derived(sessionStatus === 'running' && !isRunning);

  let nameValid = $derived(/^[a-z0-9][a-z0-9-]*$/.test(name.trim()));
  let canCreate = $derived(nameValid && description.trim().length > 0 && instructions.trim().length > 0);
  let canSendToAgent = $derived(nameValid && description.trim().length > 0 && canAskAgent);

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
    } catch (e: any) {
      dialogError = e?.message || String(e);
    } finally {
      creating = false;
    }
  }

  /** Hand skill authoring to the agent as a turn in this conversation — it
   *  knows its own packaged-skill format (frontmatter extensions, resources)
   *  better than the manual form does. */
  function handleAskAgent() {
    if (!canSendToAgent) return;
    const prompt = buildCreateSkillPrompt({
      name: name.trim(),
      description: description.trim(),
      scope,
      notes: instructions,
    });
    messageStore.addUserMessage(sessionId, prompt);
    window.groveBench.sendMessage(sessionId, prompt);
    store.updateLastActive(sessionId);
    close();
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) close();
  }
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
  <Dialog.Content class="max-w-lg">
    <Dialog.Header>
      <Dialog.Title>Add Skill</Dialog.Title>
      <Dialog.Description>
        Package instructions the agent can invoke by name. Loaded when a session's agent (re)starts.
      </Dialog.Description>
    </Dialog.Header>

    <div class="flex flex-col gap-3 mt-4">
      <div class="flex items-end gap-3">
        <div class="flex-1">
          <Label for="skill-name" class="mb-1 block">Name</Label>
          <!-- svelte-ignore a11y_autofocus -->
          <Input
            id="skill-name"
            type="text"
            bind:value={name}
            placeholder="release-notes"
            autofocus
          />
        </div>
        <div>
          <Label class="mb-1 block">Scope</Label>
          <div class="flex border border-input">
            <button
              type="button"
              onclick={() => scope = 'project'}
              class="px-2.5 py-1.5 text-xs transition-colors {scope === 'project' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
              title="Written into this session's worktree — ships with the branch and gets code review"
            >
              Project
            </button>
            <button
              type="button"
              onclick={() => scope = 'user'}
              class="px-2.5 py-1.5 text-xs transition-colors border-l border-input {scope === 'user' ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:text-foreground'}"
              title="Written to your user profile — applies to every repo immediately"
            >
              User
            </button>
          </div>
        </div>
      </div>
      {#if name.trim() && !nameValid}
        <p class="text-[10px] text-destructive -mt-2">Use kebab-case: lowercase letters, digits, and dashes.</p>
      {/if}

      <div>
        <Label for="skill-description" class="mb-1 block">Description</Label>
        <Input
          id="skill-description"
          type="text"
          bind:value={description}
          placeholder="When should the agent use this skill?"
        />
      </div>

      <div>
        <Label for="skill-instructions" class="mb-1 block">Instructions</Label>
        <textarea
          id="skill-instructions"
          bind:value={instructions}
          rows="7"
          placeholder="Markdown instruction body — or rough notes, if you hand it to the agent below…"
          class="w-full text-sm bg-background border border-input px-3 py-2 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
        ></textarea>
        <p class="text-[10px] text-muted-foreground mt-1">
          {scope === 'project'
            ? 'Project skills are written into the worktree and show up in the Changes tab.'
            : 'User skills apply to every repo on this machine.'}
        </p>
      </div>

      {#if dialogError}
        <div class="bg-destructive/10 border border-destructive/50 p-2 text-xs text-destructive whitespace-pre-wrap">
          {dialogError}
        </div>
      {/if}

      <Dialog.Footer>
        <Button variant="secondary" onclick={close}>
          Cancel
        </Button>
        <Button
          variant="secondary"
          onclick={handleAskAgent}
          disabled={!canSendToAgent}
          title={canAskAgent
            ? 'Send a turn asking the agent to draft and write the skill itself (instructions above become optional notes)'
            : 'Needs a running, idle agent session'}
        >
          Ask Agent to Write It
        </Button>
        <Button onclick={handleCreate} disabled={!canCreate || creating}>
          {#if creating}
            <span class="inline-flex items-center gap-1.5">
              <span class="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
              Creating…
            </span>
          {:else}
            Create Skill
          {/if}
        </Button>
      </Dialog.Footer>
    </div>
  </Dialog.Content>
</Dialog.Root>
