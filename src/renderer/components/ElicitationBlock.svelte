<script lang="ts">
  import { untrack } from 'svelte';
  import { messageStore } from '../stores/messages.svelte.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import type { McpElicitationRequest, McpElicitationResponse } from '../../shared/types.js';
  import {
    elicitationContent,
    elicitationFields,
    initialElicitationValues,
    type ElicitationValues,
  } from '../lib/elicitation-form.js';

  let {
    sessionId,
    requestId,
    request,
    resolved,
    action,
  }: {
    sessionId: string;
    requestId: string;
    request: McpElicitationRequest;
    resolved: boolean;
    action?: McpElicitationResponse['action'];
  } = $props();

  const form = $derived(request.mode === 'form' ? elicitationFields(request.requestedSchema) : { fields: [], unsupported: [] });
  // One block per request, so the starting values are read once.
  let values = $state<ElicitationValues>(untrack(() => initialElicitationValues(form.fields)));
  let errors = $state<Record<string, string>>({});
  let busy = $state(false);
  let openError = $state<string | null>(null);

  const urlHost = $derived.by(() => {
    try {
      return request.url ? new URL(request.url).host : '';
    } catch {
      return '';
    }
  });

  const resolvedLabel = $derived(
    action === 'accept' ? (request.mode === 'url' ? 'opened' : 'submitted')
      : action === 'decline' ? 'declined'
      : 'cancelled',
  );

  async function respond(response: McpElicitationResponse) {
    if (busy || resolved) return;
    busy = true;
    try {
      await messageStore.respondToElicitation(sessionId, requestId, response);
    } finally {
      busy = false;
    }
  }

  function submit() {
    const result = elicitationContent(form.fields, values);
    if ('errors' in result) {
      errors = result.errors;
      return;
    }
    errors = {};
    respond({ action: 'accept', content: result.content });
  }

  async function openPage() {
    if (!request.url) return;
    openError = null;
    try {
      await window.groveBench.openExternal(request.url);
    } catch {
      // Main only opens http(s) links
      openError = 'This link could not be opened. Only http and https links are allowed.';
      return;
    }
    // In URL mode, accepting means the user agreed to go to the page; the
    // server finishes the flow there.
    respond({ action: 'accept' });
  }

  function toggleChoice(key: string, value: string) {
    const current = Array.isArray(values[key]) ? (values[key] as string[]) : [];
    values[key] = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  }
</script>

<div class="py-1 my-1 border-l-4 {resolved ? 'border-border' : 'border-violet-400'} pl-3">
  <div class="flex items-center gap-2 text-xs">
    <span class="{resolved ? 'text-muted-foreground' : 'text-violet-400'} font-bold">mcp input</span>
    <span class="text-foreground font-medium font-mono">{request.serverName}</span>
    {#if request.title}
      <span class="text-muted-foreground truncate">{request.title}</span>
    {/if}
  </div>
  <p class="text-sm text-foreground mt-1 whitespace-pre-wrap break-words">{request.message}</p>

  {#if resolved}
    <div class="text-xs mt-2 text-muted-foreground">{resolvedLabel}</div>
  {:else if request.mode === 'url'}
    <div class="mt-2 text-xs">
      {#if request.url}
        <div class="text-muted-foreground">
          Opens <span class="text-foreground font-medium">{urlHost || request.url}</span> in your browser:
        </div>
        <div class="font-mono text-[11px] text-muted-foreground/80 break-all mt-0.5">{request.url}</div>
      {/if}
      {#if openError}
        <div class="text-destructive mt-1">{openError}</div>
      {/if}
      <div class="flex gap-2 mt-2">
        <Button variant="outline" size="sm" onclick={openPage} disabled={busy || !request.url} class="text-violet-400 border-violet-600 hover:bg-violet-900/30">
          Open page
        </Button>
        <Button variant="ghost" size="sm" onclick={() => respond({ action: 'decline' })} disabled={busy}>Decline</Button>
      </div>
    </div>
  {:else}
    <div class="mt-2 flex flex-col gap-2 max-w-md">
      {#each form.fields as field (field.key)}
        <div class="text-xs">
          {#if field.kind === 'boolean'}
            <label class="flex items-center gap-2 text-foreground">
              <input type="checkbox" bind:checked={values[field.key] as boolean} />
              <span>{field.label}{#if field.required}<span class="text-destructive"> *</span>{/if}</span>
            </label>
          {:else}
            <label class="block text-foreground mb-1" for="elicit-{requestId}-{field.key}">
              {field.label}{#if field.required}<span class="text-destructive"> *</span>{/if}
            </label>
            {#if field.kind === 'text'}
              <input
                id="elicit-{requestId}-{field.key}"
                type={field.inputType}
                bind:value={values[field.key] as string}
                maxlength={field.maxLength}
                class="w-full bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
              />
            {:else if field.kind === 'number'}
              <input
                id="elicit-{requestId}-{field.key}"
                type="number"
                step={field.integer ? 1 : 'any'}
                min={field.minimum}
                max={field.maximum}
                bind:value={values[field.key] as number | null}
                class="w-full bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
              />
            {:else if field.kind === 'select'}
              <select
                id="elicit-{requestId}-{field.key}"
                bind:value={values[field.key] as string}
                class="w-full bg-card border border-border px-2 py-1 text-foreground focus:outline-none focus:border-primary"
              >
                <option value="">Choose...</option>
                {#each field.options as opt (opt.value)}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            {:else if field.kind === 'multiselect'}
              <div class="flex flex-col gap-1" id="elicit-{requestId}-{field.key}">
                {#each field.options as opt (opt.value)}
                  <label class="flex items-center gap-2 text-foreground">
                    <input
                      type="checkbox"
                      checked={Array.isArray(values[field.key]) && (values[field.key] as string[]).includes(opt.value)}
                      onchange={() => toggleChoice(field.key, opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                {/each}
              </div>
            {/if}
          {/if}
          {#if field.description}
            <p class="text-muted-foreground/70 mt-0.5">{field.description}</p>
          {/if}
          {#if errors[field.key]}
            <p class="text-destructive mt-0.5">{errors[field.key]}</p>
          {/if}
        </div>
      {/each}

      {#if form.unsupported.length > 0}
        <p class="text-xs text-yellow-500">
          This form asks for fields Grove Bench can't show ({form.unsupported.join(', ')}). Decline it if you can't answer without them.
        </p>
      {/if}
      <p class="text-[11px] text-muted-foreground/70">
        Your answers go to {request.serverName}. Don't enter passwords or API keys here.
      </p>
      <div class="flex gap-2">
        <Button variant="outline" size="sm" onclick={submit} disabled={busy} class="text-violet-400 border-violet-600 hover:bg-violet-900/30">
          Submit
        </Button>
        <Button variant="ghost" size="sm" onclick={() => respond({ action: 'decline' })} disabled={busy}>Decline</Button>
        <Button variant="ghost" size="sm" onclick={() => respond({ action: 'cancel' })} disabled={busy} class="text-muted-foreground">Cancel</Button>
      </div>
    </div>
  {/if}
</div>
