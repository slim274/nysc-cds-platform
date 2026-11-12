<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';
	import NotificationBell from '#lib/components/NotificationBell.svelte';
	import { page } from '$app/state';

	let { children }: LayoutProps = $props();

	// Scope shared mobile header rules to LGI routes only.
	$effect(() => {
		document.documentElement.classList.toggle('lgi-route', page.url.pathname.startsWith('/lgi'));
	});
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
	/* The shared LG identity + notification bell occupy one reserved lane. */
	:global(html.lgi-route .topbar) {
		padding-right: 132px !important;
	}
	/* Use the shared identity badge in place of module-specific avatars. */
	:global(html.lgi-route .topbar .avatar) {
		display: none !important;
	}
	@media (max-width: 760px) {
		/* Reserve one consistent control lane for the shared LG badge + bell. */
		:global(html.lgi-route .topbar) {
			box-sizing: border-box;
			gap: 9px;
			padding-right: 112px !important;
		}
		/* Local account/avatar blocks vary by module; the shared identity badge
		   is the single mobile identity treatment across every LGI screen. */
		:global(html.lgi-route .topbar .account),
		:global(html.lgi-route .topbar .account-copy),
		:global(html.lgi-route .topbar .account-details),
		:global(html.lgi-route .topbar .email),
		:global(html.lgi-route .topbar .avatar) {
			display: none !important;
		}
		:global(html.lgi-route .topbar > div) {
			min-width: 0;
			flex: 1 1 auto;
		}
		:global(html.lgi-route .topbar h1) {
			min-width: 0;
			max-width: 100%;
			overflow-wrap: anywhere;
			font-size: clamp(15px, 4.2vw, 19px);
		}
	}
</style>
