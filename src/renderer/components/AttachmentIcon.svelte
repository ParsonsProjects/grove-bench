<script lang="ts">
  /** The icon on an attached file's chip: a PDF, audio, or any other file
   *  (text files too). */
  let { mediaType = '' }: { mediaType?: string } = $props();
</script>

{#if mediaType === 'application/pdf'}
  <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
    <path d="M3.5 1.5h6l3 3v10h-9z" stroke-linejoin="round" />
    <path d="M5.5 5.5h2M5.5 8.5h5M5.5 11h5" stroke-linecap="round" />
  </svg>
{:else if mediaType.startsWith('audio/')}
  <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
    <path d="M6 12.5V3.5l7-1.5v9" stroke-linejoin="round" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="11" r="1.5" />
  </svg>
{:else}
  <svg class="w-3 h-3 shrink-0" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M3.5 1A1.5 1.5 0 002 2.5v11A1.5 1.5 0 003.5 15h9a1.5 1.5 0 001.5-1.5V5.621a1 1 0 00-.293-.707l-3.621-3.621A1 1 0 009.379 1H3.5z"/>
  </svg>
{/if}
