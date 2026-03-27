<script lang="ts">
	import { onMount } from 'svelte';
	import { themeStore } from '$stores/theme.svelte';
	import { backendStore } from '$stores/backend.svelte';
	import '../app.css';

	let { children } = $props();
	let siteName = $state('TLTV');

	onMount(async () => {
		themeStore.init();
		backendStore.init();
		try {
			const resp = await fetch('/.well-known/tltv');
			if (resp.ok) {
				const wk = await resp.json();
				// Use node name when cathode supports it
				if (wk.name) siteName = wk.name;
			}
		} catch {}
	});
</script>

<div class="shell">
	<nav class="nav">
		<div class="nav-inner">
			<a href="/" class="nav-brand">{siteName}</a>
			<span class="nav-spacer"></span>
			<a href="/control" class="nav-link">Control</a>
		</div>
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
		height: 40px;
		background: var(--bg-surface);
		border-bottom: 1px solid var(--border-default);
	}
	.nav-inner {
		display: flex;
		align-items: center;
		gap: 1.25rem;
		height: 100%;
		max-width: calc(1100px + 2rem);
		margin: 0 auto;
		padding: 0 1rem;
	}

	.nav-brand {
		text-decoration: none;
		color: var(--text-primary);
		font-weight: 700;
		font-size: 0.85rem;
		letter-spacing: 0.05em;
	}
	.nav-brand:hover { color: var(--accent); }

	.nav-spacer { flex: 1; }

	.nav-link {
		color: var(--text-secondary);
		text-decoration: none;
		font-size: 0.8rem;
	}
	.nav-link:hover {
		color: var(--text-primary);
	}

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
</style>
