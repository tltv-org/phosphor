<script lang="ts">
	import { onDestroy } from 'svelte';
	import { CathodeApiError } from '$cathode';
	import type { BackendAdapter, LogEntry } from '$cathode';

	interface Props {
		adapter: BackendAdapter | null;
	}

	let { adapter }: Props = $props();

	const LOG_SOURCES = ['', 'engine', 'scheduler', 'protocol', 'plugin', 'api', 'cathode'];
	// Less verbose to more verbose
	const LOG_LEVELS = ['CRITICAL', 'ERROR', 'WARNING', 'INFO', 'DEBUG', ''];
	const MAX_ENTRIES = 500;

	let entries = $state<LogEntry[]>([]);
	let loading = $state(false);
	let error = $state('');

	// ── Filters ──
	let filterLevel = $state('INFO');
	let filterSource = $state('');
	let limit = $state(100);

	// ── Streaming ──
	let streaming = $state(false);
	let streamHandle = $state<{ close: () => void } | null>(null);
	let autoScroll = $state(true);

	let logContainer = $state<HTMLDivElement>();

	function levelColor(level: string): string {
		switch (level.toUpperCase()) {
			case 'ERROR': case 'CRITICAL': return '#ef4444';
			case 'WARNING': return '#fbbf24';
			case 'INFO': return '#10b981';
			case 'DEBUG': return '#8888a0';
			default: return '#c0c0d0';
		}
	}

	function sourceColor(source: string): string {
		switch (source) {
			case 'engine': return '#818cf8';
			case 'scheduler': return '#a855f7';
			case 'protocol': return '#10b981';
			case 'plugin': return '#fbbf24';
			case 'api': return '#06b6d4';
			case 'cathode': return '#f97316';
			default: return '#8888a0';
		}
	}

	function fmtTimestamp(ts: string): string {
		try {
			const d = new Date(ts);
			return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
				+ '.' + d.getMilliseconds().toString().padStart(3, '0');
		} catch { return ts; }
	}

	async function fetchLogs() {
		if (!adapter) return;
		loading = true;
		error = '';
		try {
		const result = await adapter.getLogs({
			limit,
			level: filterLevel || undefined,
			source: filterSource || undefined,
		});
		// API returns newest-first; reverse to chronological (oldest top, newest bottom)
		entries = result.entries.reverse();
		scrollToBottom();
		} catch (e: unknown) {
			error = CathodeApiError.extractMessage(e, 'Failed to fetch logs');
		} finally { loading = false; }
	}

	function startStream() {
		if (!adapter || streaming) return;
		streaming = true;
		streamHandle = adapter.streamLogs(
			{ level: filterLevel || undefined, source: filterSource || undefined },
			(entry) => {
				entries = [...entries.slice(-MAX_ENTRIES), entry];
				if (autoScroll) scrollToBottom();
			}
		);
	}

	function stopStream() {
		if (streamHandle) {
			streamHandle.close();
			streamHandle = null;
		}
		streaming = false;
	}

	function toggleStream() {
		if (streaming) stopStream();
		else startStream();
	}

	function clearEntries() {
		entries = [];
	}

	function scrollToBottom() {
		requestAnimationFrame(() => {
			if (logContainer) logContainer.scrollTop = logContainer.scrollHeight;
		});
	}

	$effect(() => {
		if (adapter) fetchLogs();
	});

	onDestroy(() => { stopStream(); });
</script>

<h2>Logs</h2>
<p class="panel-desc">Real-time server log viewer. Use filters to narrow down entries.</p>

<!-- Filters -->
<div class="log-toolbar">
	<label class="form-label form-label-inline">
		<span>Level</span>
		<select bind:value={filterLevel} onchange={() => { if (!streaming) fetchLogs(); }}>
			{#each LOG_LEVELS as lvl}
				<option value={lvl}>{lvl || 'All levels'}</option>
			{/each}
		</select>
	</label>
	<label class="form-label form-label-inline">
		<span>Source</span>
		<select bind:value={filterSource} onchange={() => { if (!streaming) fetchLogs(); }}>
			{#each LOG_SOURCES as src}
				<option value={src}>{src || 'All'}</option>
			{/each}
		</select>
	</label>
	<label class="form-label form-label-inline">
		<span>Limit</span>
		<input type="number" bind:value={limit} min="10" max="1000" style="width: 70px"
			onchange={() => { if (!streaming) fetchLogs(); }} />
	</label>
	<div class="toolbar-spacer"></div>
	<button class="btn-sm" class:btn-primary={!streaming} class:btn-danger={streaming}
		onclick={toggleStream}>
		{streaming ? 'Stop Stream' : 'Stream Live'}
	</button>
	<button class="btn-surface btn-sm" onclick={() => { if (!streaming) fetchLogs(); }}
		disabled={streaming || loading}>Refresh</button>
	<button class="btn-surface btn-sm" onclick={clearEntries}>Clear</button>
	<label class="form-label form-label-inline" style="font-size: 0.7rem">
		<input type="checkbox" bind:checked={autoScroll} style="accent-color: #818cf8" />
		<span>Auto-scroll</span>
	</label>
</div>

{#if error}
	<div class="form-error">{error}</div>
{/if}

<!-- Log output -->
<div class="log-container" bind:this={logContainer}>
	{#if loading && entries.length === 0}
		<div class="log-empty">Loading...</div>
	{:else if entries.length === 0}
		<div class="log-empty">No log entries.</div>
	{:else}
		{#each entries as entry}
			<div class="log-line">
				<span class="log-ts">{fmtTimestamp(entry.timestamp)}</span>
				<span class="log-level" style="color: {levelColor(entry.level)}">{entry.level.padEnd(8)}</span>
				<span class="log-source" style="color: {sourceColor(entry.source)}">{entry.source.padEnd(10)}</span>
				<span class="log-msg">{entry.message}</span>
			</div>
		{/each}
	{/if}
</div>

<div class="log-status-bar">
	<span class="text-muted" style="font-size: 0.7rem">{entries.length} entries</span>
	{#if streaming}
		<span class="badge badge-live" style="font-size: 0.6rem"><span class="dot"></span> Streaming</span>
	{/if}
</div>

<style>
	.log-toolbar {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
		margin-bottom: 0.75rem; padding: 0.5rem 0.75rem;
		background: #141420; border: 1px solid #1a1a2a; border-radius: 6px;
	}
	.form-label-inline {
		display: flex; flex-direction: row; align-items: center; gap: 0.35rem;
	}
	.form-label-inline span { font-size: 0.7rem; color: #8a8aa0; white-space: nowrap; }
	.form-label-inline select, .form-label-inline input {
		font-size: 0.75rem; padding: 0.2rem 0.3rem;
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		border-radius: 4px; font-family: inherit; outline: none;
	}
	.form-label-inline select:focus, .form-label-inline input:focus { border-color: #5a5a7a; }
	.toolbar-spacer { flex: 1; }

	.log-container {
		background: #0a0a12; border: 1px solid #1a1a2a; border-radius: 6px;
		font-family: monospace; font-size: 0.72rem; line-height: 1.5;
		max-height: 520px; overflow-y: auto; padding: 0.5rem;
	}
	/* persistent scrollbar */
	.log-container::-webkit-scrollbar { width: 6px; }
	.log-container::-webkit-scrollbar-track { background: #0a0a12; }
	.log-container::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }

	.log-line {
		display: flex; gap: 0.5rem; padding: 0.1rem 0.25rem;
		white-space: nowrap;
	}
	.log-line:hover { background: #141420; }

	.log-ts { color: #5a5a70; flex-shrink: 0; }
	.log-level { flex-shrink: 0; font-weight: 600; }
	.log-source { flex-shrink: 0; }
	.log-msg { color: #c0c0d0; white-space: pre-wrap; word-break: break-all; min-width: 0; }

	.log-empty {
		color: #5a5a70; text-align: center; padding: 2rem;
		font-family: inherit; font-size: 0.8rem;
	}

	.log-status-bar {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.35rem 0.5rem; margin-top: 0.25rem;
	}

	:global(.btn-danger) {
		background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);
	}
</style>
