<script lang="ts">
  // Test fixture for ImageAttachments.svelte.test.ts: a thread pane with
  // rows of thumbnails sharing its lightbox, as OutputPanel draws them.
  import ImageAttachments from './ImageAttachments.svelte';
  import ImageLightbox from './ImageLightbox.svelte';
  import { provideThreadImages } from '$lib/thread-images.svelte.js';
  import type { ThreadImage } from '../stores/messages.svelte.js';

  let { sessionId, rows }: { sessionId: string; rows: ThreadImage[][] } = $props();

  const images = provideThreadImages();
</script>

{#each rows as row, i (i)}
  <ImageAttachments {sessionId} images={row} />
{/each}
<ImageLightbox {images} />
