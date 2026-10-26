<script lang="ts">
  /**
   * The Skills drawer's skill editor, in place of the This thread tab's list:
   * a skill's SKILL.md as text, frontmatter and all, so fields the Add Skill
   * form doesn't know (allowed-tools, model, ...) stay as they are. Save
   * writes it back (skills.ts saveSkillFile), unless the file changed since
   * it was read or the text renames the skill. Leaving with unsaved changes
   * asks first, whether by Back, Cancel, Escape, the other tab or closing
   * the drawer (skillsPanelStore.unlessUnsaved).
   */
  import { onMount } from 'svelte';
  import { skillsPanelStore } from '../stores/skillsPanel.svelte.js';
  import { SKILL_GROUPS } from '../lib/skill-groups.js';
  import { errorMessage } from '../../shared/error-message.js';
  import type { SkillInfo } from '../../shared/types.js';
  import { Badge } from '$lib/components/ui/badge/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Confirm } from '$lib/components/ui/confirm/index.js';
  import { Notice } from '$lib/components/ui/notice/index.js';
  import { Pulse } from '$lib/components/ui/pulse/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';

  let { repoPath, onsaved }: {
    /** The thread's project, for a thread that isn't running. */
    repoPath: string;
    /** After a save, with the skill as it now is. */
    onsaved: (skill: SkillInfo) => void;
  } = $props();

  const edit = $derived(skillsPanelStore.edit);
  const label = $derived(SKILL_GROUPS.find((g) => g.id === edit?.skill.source)?.label ?? '');

  let error = $state('');
  /** The file changed on disk after it was read, so Save can't go ahead. */
  let stale = $state(false);
  let saving = $state(false);
  let textarea = $state<HTMLTextAreaElement | null>(null);

  async function load() {
    const current = skillsPanelStore.edit;
    if (!current?.skill.path) return;
    error = '';
    stale = false;
    try {
      const file = await window.groveBench.readSkill(current.sessionId, repoPath, current.skill.path);
      // Left, or opened another skill, while it read.
      if (skillsPanelStore.edit !== current) return;
      current.file = file;
      current.text = file.content;
    } catch (e) {
      if (skillsPanelStore.edit === current) error = errorMessage(e);
    }
  }

  async function save() {
    const current = skillsPanelStore.edit;
    if (!current?.file || !current.skill.path || saving || !skillsPanelStore.unsaved) return;
    saving = true;
    error = '';
    try {
      const saved = await window.groveBench.saveSkill(current.sessionId, repoPath, current.skill.path, current.file.content, current.text);
      if (skillsPanelStore.edit === current) skillsPanelStore.edit = null;
      onsaved(saved);
    } catch (e) {
      error = errorMessage(e);
      // Main says why in words only, so read the file again to tell a
      // change on disk (Reload helps) from a problem with the text.
      const now = await window.groveBench.readSkill(current.sessionId, repoPath, current.skill.path).catch(() => null);
      stale = !!now && now.content !== current.file.content;
    } finally {
      saving = false;
    }
  }

  async function openElsewhere() {
    const current = skillsPanelStore.edit;
    if (!current?.skill.path) return;
    try {
      await window.groveBench.openSkillInEditor(current.sessionId, repoPath, current.skill.path);
    } catch (e) {
      error = errorMessage(e);
    }
  }

  /** Ctrl+S saves, as in an editor. */
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save();
    }
  }

  onMount(() => { void load(); });
</script>

{#if edit}
  <div class="flex flex-col h-full min-h-0 gap-2">
    <div class="flex items-center gap-1.5 min-w-0">
      <Button variant="quiet" size="icon-2xs" onclick={() => skillsPanelStore.leaveEdit()} title="Back to the skills" aria-label="Back to the skills"><ArrowLeftIcon /></Button>
      <span class="font-mono text-xs text-foreground truncate">{edit.skill.name}</span>
      {#if label}<Badge tone="muted">{label}</Badge>{/if}
      <span class="flex-1"></span>
      <Button
        variant="external"
        size="2xs"
        onclick={openElsewhere}
        disabled={!edit.file}
        title="Open SKILL.md in VS Code, Cursor or your default app"
      ><ExternalLinkIcon />Open in editor</Button>
    </div>
    {#if edit.file}
      <p class="text-caption text-muted-foreground font-mono truncate" title={edit.file.path}>{edit.file.path}</p>
      {#if edit.file.linkPath}
        <p class="text-caption text-muted-foreground">
          Kept in <span class="font-mono">.agents/skills</span> for every agent. Claude Agent reads it through a link in
          <span class="font-mono">.claude/skills</span>, which Save updates too.
        </p>
      {/if}
      <Textarea
        bind:ref={textarea}
        bind:value={edit.text}
        onkeydown={handleKeydown}
        spellcheck={false}
        aria-label="SKILL.md for {edit.skill.name}"
        class="flex-1 min-h-48 resize-none font-mono text-xs md:text-xs leading-relaxed"
      />
    {:else if !error}
      <div class="flex items-center justify-center py-8 text-muted-foreground">
        <Pulse class="mr-2" />
        <span class="text-xs">Reading SKILL.md…</span>
      </div>
    {/if}

    {#if error}
      <Notice tone="danger" class="break-words">
        {#snippet actions()}
          {#if stale || !edit.file}
            <Button variant="link" size="2xs" onclick={load} title={edit.file ? 'Read SKILL.md again. Your changes here are dropped.' : 'Try reading SKILL.md again'}>Reload</Button>
          {/if}
        {/snippet}
        {error}
      </Notice>
    {/if}

    {#if skillsPanelStore.pendingDiscard}
      <Confirm
        message="Discard your changes to {edit.skill.name}?"
        confirm="Discard"
        onconfirm={() => skillsPanelStore.discardEdit()}
        oncancel={() => { skillsPanelStore.pendingDiscard = null; textarea?.focus(); }}
      />
    {:else}
      <div class="flex items-center gap-2">
        <span class="text-caption text-muted-foreground flex-1 min-w-0">
          {#if edit.skill.source === 'project'}
            Saves in the project, for anyone working on it.
          {:else}
            Saves in your user folder, for all your projects.
          {/if}
        </span>
        <Button variant="subtle" size="xs" onclick={() => skillsPanelStore.leaveEdit()}>Cancel</Button>
        <Button
          variant="subtle-primary"
          size="xs"
          onclick={save}
          disabled={!edit.file || saving || !skillsPanelStore.unsaved}
          title="Save SKILL.md (Ctrl+S)"
        >{saving ? 'Saving…' : 'Save'}</Button>
      </div>
    {/if}
  </div>
{/if}
