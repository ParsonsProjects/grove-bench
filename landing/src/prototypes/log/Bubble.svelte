<script>
  /**
   * A speech bubble over an agent: a tool call ("Edit auth.ts +47"), a
   * question mark, a done tick or a short line of speech.
   * @type {{ b: { tool: string, detail?: string } | null | undefined, extra?: string }}
   */
  let { b, extra = '' } = $props();
  const tone = { Read: 't-read', Grep: 't-read', Glob: 't-read', Edit: 't-edit', Write: 't-write', Bash: 't-bash' };
</script>

{#if b?.tool === '?'}
  <span class="lg-bubble ask {extra}">?</span>
{:else if b?.tool === 'done'}
  <span class="lg-bubble {extra}"><span class="check" aria-hidden="true"></span>{b.detail}</span>
{:else if b?.tool === 'say'}
  <span class="lg-bubble say {extra}">{b.detail}</span>
{:else if b}
  <span class="lg-bubble {extra}"><b class={tone[b.tool] ?? ''}>{b.tool}</b>{b.detail ? ` ${b.detail}` : ''}</span>
{/if}
