<script lang="ts">
	import { onMount } from 'svelte';
	import { themeStore } from '$stores/theme.svelte';
	import { backendStore } from '$stores/backend.svelte';
	import '../app.css';

	let { children } = $props();
	let siteName = $state('tltv');

	onMount(async () => {
		themeStore.init();
		backendStore.init();
		try {
			const resp = await fetch('/.well-known/tltv');
			if (resp.ok) {
				const wk = await resp.json();
				if (wk.name) siteName = wk.name;
			}
		} catch {}
	});
</script>

<div class="shell">
	<nav class="nav">
		<a href="/" class="nav-brand">{siteName}</a>
		<span class="nav-spacer"></span>
		<a href="/control" class="nav-link">control</a>
	</nav>

	<main class="main">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		height: 44px;
		max-width: calc(1100px + 2rem);
		width: 100%;
		margin: 0 auto;
		padding: 0 1rem;
		border-bottom: 1px solid var(--rule);
	}

	.nav-brand {
		font-family: var(--font-brand);
		font-weight: 700;
		font-size: 1rem;
		color: var(--fg);
		text-decoration: none;
	}

	.nav-spacer { flex: 1; }

	.nav-link {
		color: var(--fg-dim);
		text-decoration: none;
		font-size: 0.75rem;

	}
	.nav-link:hover { color: var(--fg); }

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
</style>
