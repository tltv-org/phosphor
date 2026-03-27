<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { BackendAdapter, PluginInfo } from '$cathode';

	interface Props {
		adapter: BackendAdapter | null;
		onNavigate: (section: string) => void;
	}

	let { adapter, onNavigate }: Props = $props();

	let plugins = $state<PluginInfo[]>([]);
	let loading = $state(false);
	let error = $state('');
	let actionError = $state('');
	let togglingPlugin = $state<string | null>(null);
	let restartNeeded = $state(false);

	// ── Counts from list response ──
	let totalCount = $state(0);
	let loadedCount = $state<number | undefined>(undefined);
	let disabledCount = $state<number | undefined>(undefined);

	// ── Add plugin (stub) ──
	let showAdd = $state(false);

	// ── Category collapse state ──
	const CATEGORY_ORDER: Array<{ key: string; label: string }> = [
		{ key: 'source', label: 'Source' },
		{ key: 'graphics', label: 'Graphics' },
		{ key: 'content', label: 'Content' },
		{ key: 'schedule', label: 'Schedule' },
		{ key: 'output', label: 'Output' },
		{ key: 'integration', label: 'Integration' },
		{ key: 'other', label: 'Other' },
	];

	const CATEGORY_COLORS: Record<string, string> = {
		source: '#6366f1',
		content: '#8b5cf6',
		schedule: '#3b82f6',
		graphics: '#ec4899',
		output: '#10b981',
		integration: '#f59e0b',
	};

	let collapsed = $state<Record<string, boolean>>({});

	$effect(() => {
		if (adapter) loadPlugins();
	});

	async function loadPlugins() {
		if (!adapter) return;
		loading = true;
		error = '';
		try {
			const result = await adapter.listPlugins();
			plugins = result.plugins;
			totalCount = result.count ?? result.plugins.length;
			loadedCount = result.loaded;
			disabledCount = result.disabled;
		} catch (e: unknown) {
			error = CathodeApiError.extractMessage(e, 'Failed to load plugins');
		} finally { loading = false; }
	}

	// ── Group plugins by category (supports comma-separated multi-category) ──
	function groupedPlugins(): Array<{ key: string; label: string; plugins: PluginInfo[] }> {
		const groups: Record<string, PluginInfo[]> = {};
		for (const cat of CATEGORY_ORDER) {
			groups[cat.key] = [];
		}
		for (const plugin of plugins) {
			const cats = plugin.category?.split(',').map(s => s.trim()).filter(Boolean) || ['other'];
			const primaryCat = cats[0]; // list under primary only
			if (!groups[primaryCat]) groups[primaryCat] = [];
			groups[primaryCat].push(plugin);
		}
		return CATEGORY_ORDER
			.filter(cat => groups[cat.key].length > 0)
			.map(cat => ({ key: cat.key, label: cat.label, plugins: groups[cat.key] }));
	}

	function toggleCategory(key: string) {
		collapsed[key] = !collapsed[key];
	}

	// ── Enable/disable toggle ──
	async function togglePlugin(plugin: PluginInfo) {
		if (!adapter) return;
		togglingPlugin = plugin.name;
		actionError = '';
		try {
			if (plugin.enabled === false) {
				await adapter.enablePlugin(plugin.name);
			} else {
				await adapter.disablePlugin(plugin.name);
			}
			restartNeeded = true;
			await loadPlugins();
		} catch (e: unknown) {
			actionError = CathodeApiError.extractMessage(e, `Failed to toggle ${plugin.name}`);
		} finally { togglingPlugin = null; }
	}

	// ── Format extensions for display ──
	function formatExtensions(extensions: Record<string, string[] | boolean>): Array<{ label: string; values: string[] }> {
		const labelMap: Record<string, string> = {
			source_types: 'Sources',
			output_types: 'Outputs',
			block_types: 'Block types',
			playlist_tools: 'Playlist tools',
			generators: 'Generators',
			overlays: 'Overlays',
		};
		return Object.entries(extensions)
			.filter(([, vals]) => Array.isArray(vals) && vals.length > 0)
			.map(([key, vals]) => ({ label: labelMap[key] || key, values: vals as string[] }));
	}
</script>

<h2>Plugins</h2>
<p class="panel-desc">
	Loaded plugins and their runtime settings. Click a plugin to configure it.
	{#if loadedCount !== undefined || disabledCount !== undefined}
		<span class="header-counts">
			{#if loadedCount !== undefined}<span class="count-item">{loadedCount} loaded</span>{/if}
			{#if disabledCount !== undefined && disabledCount > 0}<span class="count-item">{disabledCount} disabled</span>{/if}
			<span class="count-item">{totalCount} total</span>
		</span>
	{/if}
</p>

{#if error}
	<div class="form-error">{error}</div>
{/if}
{#if actionError}
	<div class="form-error">{actionError}</div>
{/if}
{#if restartNeeded}
	<div class="restart-banner">Engine restart required for plugin changes to take effect.</div>
{/if}

{#if loading}
	<p class="text-muted">Loading plugins...</p>
{:else if plugins.length === 0}
	<div class="panel">
		<p class="text-muted" style="margin: 0">No plugins loaded.</p>
	</div>
{:else}
	{#each groupedPlugins() as group}
		<div class="panel">
			<button class="panel-toggle" onclick={() => toggleCategory(group.key)}>
				<h3>{group.label} <span class="category-count">({group.plugins.length})</span></h3>
				<span class="toggle-arrow">{collapsed[group.key] ? '+' : '\u2212'}</span>
			</button>
			{#if !collapsed[group.key]}
				<div class="table-wrap">
					<table>
						<thead>
							<tr>
								<th>Name</th>
								<th>Category</th>
								<th>Status</th>
								<th>Provides</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each group.plugins as plugin}
								<tr class="plugin-row" onclick={() => onNavigate(`plugin:${plugin.name}`)}>
									<td>
										<span class="plugin-name">{plugin.name}</span>
									</td>
									<td>
										{#each (plugin.category?.split(',').map(s => s.trim()) || ['other']) as cat}
											<span class="badge" style="background: {CATEGORY_COLORS[cat] ?? '#6b7280'}20; color: {CATEGORY_COLORS[cat] ?? '#6b7280'}; font-size: 0.6rem; margin-right: 0.25rem">{cat}</span>
										{/each}
									</td>
									<td>
										<div class="status-cell">
											{#if plugin.loaded !== false}
												<span class="badge badge-active">Active</span>
											{:else if plugin.enabled === false}
												<span class="badge badge-disabled">Disabled</span>
											{:else}
												<span class="badge badge-error">Inactive</span>
											{/if}
										</div>
									</td>
									<td>
										{#if plugin.extensions}
											{@const exts = formatExtensions(plugin.extensions)}
											{#if exts.length > 0}
												<div class="extensions">
													{#each exts as ext}
														<span class="ext-line">{ext.label}: {ext.values.join(', ')}</span>
													{/each}
												</div>
											{:else}
												<span class="text-muted">—</span>
											{/if}
										{:else}
											<span class="text-muted">—</span>
										{/if}
									</td>
									<td class="row-actions" onclick={(e) => e.stopPropagation()}>
										<div class="action-btns">
											<button
												class="btn-surface btn-xs"
												class:btn-toggle-on={plugin.enabled !== false}
												class:btn-toggle-off={plugin.enabled === false}
												disabled={togglingPlugin === plugin.name}
												onclick={() => togglePlugin(plugin)}
											>
												{#if togglingPlugin === plugin.name}
													...
												{:else if plugin.enabled === false}
													Enable
												{:else}
													Disable
												{/if}
											</button>
											<button class="btn-surface btn-xs" onclick={() => onNavigate(`plugin:${plugin.name}`)}>
												Configure
											</button>
										</div>
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/each}
{/if}

<!-- Add Plugin (placeholder for future API) -->
<div class="panel">
	{#if showAdd}
		<h3>Add Plugin</h3>
		<p class="panel-desc text-muted">Plugin installation is not yet available via the API. Plugins are loaded from the server's plugin directory on startup.</p>
		<div class="form-actions">
			<button class="btn-surface btn-sm" onclick={() => showAdd = false}>Close</button>
		</div>
	{:else}
		<button class="btn-surface btn-sm" onclick={() => showAdd = true}>Add Plugin</button>
	{/if}
</div>

<style>
	.plugin-row { cursor: pointer; transition: background 0.1s; }
	.plugin-row:hover { background: #141420; }

	.header-counts {
		display: inline-flex; gap: 0.5rem; margin-left: 0.5rem;
	}
	.count-item {
		font-size: 0.75rem; color: #5a5a70;
	}
	.count-item + .count-item::before {
		content: '·'; margin-right: 0.5rem;
	}

	.restart-banner {
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.25);
		color: #fbbf24;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}

	.panel-toggle {
		display: flex; justify-content: space-between; align-items: center;
		width: 100%; background: none; border: none; color: inherit;
		cursor: pointer; padding: 0; margin-bottom: 0;
	}
	.panel-toggle h3 { margin-bottom: 0; }
	.toggle-arrow { font-size: 1.2rem; color: #5a5a70; }

	.category-count {
		font-weight: 400; color: #5a5a70; font-size: 0.8rem;
	}

	.plugin-name { font-weight: 600; }

	.status-cell { display: flex; align-items: center; gap: 0.5rem; }

	.extensions { display: flex; flex-direction: column; gap: 0.15rem; }
	.ext-line {
		font-size: 0.75rem; color: #8888a0; white-space: nowrap;
	}

	.action-btns { display: flex; gap: 0.35rem; justify-content: flex-end; }

	.btn-toggle-on { color: #ef4444 !important; }
	.btn-toggle-off { color: #10b981 !important; }

	:global(.badge-disabled) {
		background: rgba(88, 88, 112, 0.15); color: #5a5a70;
	}
</style>
