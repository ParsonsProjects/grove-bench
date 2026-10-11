<script lang="ts">
	// Test fixture for ui-kit.svelte.test.ts: the compound components, which
	// need markup to test.
	import * as Tabs from "./tabs/index.js";
	import * as Segmented from "./segmented/index.js";

	let { tab = $bindable("thread"), view = $bindable("unified") }: { tab?: string; view?: string } = $props();
</script>

<Tabs.Root bind:value={tab}>
	<Tabs.List aria-label="Workspace">
		<Tabs.Trigger value="thread">Thread</Tabs.Trigger>
		<Tabs.Trigger value="changes">Changes</Tabs.Trigger>
	</Tabs.List>
	<Tabs.Content value="thread">Thread content</Tabs.Content>
	<Tabs.Content value="changes">Changes content</Tabs.Content>
</Tabs.Root>

<Segmented.Root bind:value={view} aria-label="Diff view">
	<Segmented.Item value="unified">Unified</Segmented.Item>
	<Segmented.Item value="split">Split</Segmented.Item>
</Segmented.Root>
