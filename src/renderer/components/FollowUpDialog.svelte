<script lang="ts">
  import { untrack } from 'svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { followUpsStore } from '../stores/followUps.svelte.js';
  import { store } from '../stores/sessions.svelte.js';
  import { FOLLOW_UP_LIMITS } from '../../shared/follow-ups.js';
  import { ipcErrorText } from '../lib/mcp-errors.js';

  /**
   * Add a follow-up by hand: work you want a later thread to pick up. Agents
   * add theirs with followup_add; one added here works the same way (Start
   * thread opens the new thread with it as the first message). Opened by the
   * + in the Follow-ups drawer and in the board's Follow-ups column
   * (followUpsStore.openAdd), and mounted by App while open.
   */
  const asked = $derived(followUpsStore.addingIn);

  let repo = $state('');
  let title = $state('');
  let details = $state('');
  let saving = $state(false);
  let message = $state<{ tone: 'warning' | 'danger'; text: string } | null>(null);

  // Fresh each time it opens, in the project it was opened for. Only the
  // opening is tracked: a change to the project list while it is open (a
  // thread starting in a new project) mustn't wipe what was typed.
  $effect(() => {
    const opened = asked;
    if (!opened) return;
    untrack(() => {
      repo = opened.repoPath && store.repos.includes(opened.repoPath) ? opened.repoPath : (store.repos[0] ?? '');
      title = '';
      details = '';
      message = null;
    });
  });

  const canAdd = $derived(!!title.trim() && !!repo && !saving);

  async function submit(e?: Event) {
    e?.preventDefault();
    if (!canAdd) return;
    if (followUpsStore.openIn(repo) >= FOLLOW_UP_LIMITS.openPerProject) {
      message = {
        tone: 'warning',
        text: `${store.repoDisplayName(repo)} already has ${FOLLOW_UP_LIMITS.openPerProject} open follow-ups, the most a project can have. Mark finished ones done, or delete some, first.`,
      };
      return;
    }
    saving = true;
    try {
      const { followUp, existing } = await followUpsStore.add(repo, title, details);
      if (existing) {
        message = { tone: 'warning', text: `${store.repoDisplayName(repo)} already has an open follow-up called "${followUp.title}".` };
        return;
      }
      followUpsStore.closeAdd();
    } catch (err) {
      message = { tone: 'danger', text: ipcErrorText(err, "The follow-up couldn't be saved.") };
    } finally {
      saving = false;
    }
  }

  /** Ctrl+Enter adds it from the details box, where Enter is a new line. */
  function handleDetailsKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void submit(e);
  }
</script>

{#if asked}
  <Dialog.Root open onOpenChange={(o) => { if (!o) followUpsStore.closeAdd(); }}>
    <Dialog.Content class="sm:max-w-lg">
      <Dialog.Header>
        <Dialog.Title>New follow-up</Dialog.Title>
        <Dialog.Description>
          Work for a later thread. It waits in Follow-ups until you start a thread from it, and that thread's agent marks it done.
        </Dialog.Description>
      </Dialog.Header>
      <form id="new-follow-up" class="flex flex-col gap-3" onsubmit={submit} aria-label="New follow-up">
        <div class="flex flex-col gap-1.5">
          <Label for="follow-up-title">What needs doing</Label>
          <Input
            id="follow-up-title"
            bind:value={title}
            oninput={() => { message = null; }}
            maxlength={FOLLOW_UP_LIMITS.title}
            placeholder="Add a test for the retry banner on a second 401"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="follow-up-details">Details <span class="font-normal text-muted-foreground">(optional)</span></Label>
          <Textarea
            id="follow-up-details"
            bind:value={details}
            onkeydown={handleDetailsKeydown}
            maxlength={FOLLOW_UP_LIMITS.details}
            rows={5}
            placeholder="What a thread with none of your context needs to start: where, why, and what done looks like."
          />
        </div>
        {#if store.repos.length > 1}
          <div class="flex flex-col gap-1.5">
            <Label for="follow-up-project">Project</Label>
            <Select.Root type="single" value={repo} onValueChange={(v: string) => { if (v) { repo = v; message = null; } }}>
              <Select.Trigger id="follow-up-project" class="w-64">{store.repoDisplayName(repo)}</Select.Trigger>
              <Select.Content>
                {#each store.repos as r (r)}
                  <Select.Item value={r} label={store.repoDisplayName(r)} />
                {/each}
              </Select.Content>
            </Select.Root>
          </div>
        {/if}
        {#if store.repos.length === 0}
          <p class="text-xs text-status-attention" role="status">Add a project first: a follow-up belongs to one.</p>
        {/if}
        {#if message}
          <p class="text-xs {message.tone === 'danger' ? 'text-destructive' : 'text-status-attention'}" role="status">{message.text}</p>
        {/if}
      </form>
      <Dialog.Footer>
        <Button variant="secondary" size="sm" onclick={() => followUpsStore.closeAdd()}>Cancel</Button>
        <Button type="submit" form="new-follow-up" size="sm" disabled={!canAdd}>Add follow-up</Button>
      </Dialog.Footer>
    </Dialog.Content>
  </Dialog.Root>
{/if}
