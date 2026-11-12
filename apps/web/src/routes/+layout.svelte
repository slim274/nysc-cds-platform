<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import NotificationBell from '#lib/components/NotificationBell.svelte';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
<NotificationBell />

<style>
	/* Keep legacy LGI page headers pinned while the page content scrolls. */
	:global(body) {
		overflow-x: clip !important;
	}
	:global(.topbar) {
		position: sticky !important;
		top: 0 !important;
		z-index: 1500 !important;
		flex-shrink: 0;
		background: #fff;
		padding-right: 84px !important;
	}
	@media (max-width: 760px) {
		:global(.topbar) { padding-right: 68px !important; }
	}
</style>
