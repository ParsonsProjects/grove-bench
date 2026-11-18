<script lang="ts">
  import { store } from '../stores/sessions.svelte.js';
  import Toast from './Toast.svelte';
</script>

<!-- Keyed so a new error gets the full time. -->
{#key store.error}
  {#if store.error}
    <Toast tone="danger" text={store.error} ondismiss={() => store.clearError()} />
  {/if}
{/key}
