<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { MediaList, BackendAdapter, PlaylistSummary, PlaylistDetail, PlaylistTool } from '$cathode';

	interface Props {
		media: MediaList | null;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
		playlistTools?: PlaylistTool[];
	}

	let { media, adapter, onRefresh, playlistTools = [] }: Props = $props();

	// ── Saved playlists ──
	let savedPlaylists = $state<PlaylistSummary[]>([]);
	let playlistsLoading = $state(false);
	let playlistsError = $state('');

	// ── Delete state ──
	let deletingPlaylist = $state<string | null>(null);

	// ── Playlist builder ──
	let playlist = $state<string[]>([]);
	let playlistName = $state('');
	let saving = $state(false);
	let saveError = $state('');
	let saveSuccess = $state('');
	let filter = $state('');

	// ── Drag state ──
	let dragIdx = $state<number | null>(null);
	let dropIdx = $state<number | null>(null);

	// ── Editing state ──
	let editingName = $state<string | null>(null);

	// ── Tool state ──
	let toolLoading = $state<string | null>(null);
	let toolResult = $state<{ tool: string; count: number } | null>(null);
	let toolError = $state('');

	function fmtDurationShort(s: number) {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function fmtDuration(s: number) {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	function getFilteredMedia(): Array<{ filename: string; duration: number }> {
		if (!media) return [];
		if (!filter.trim()) return media.items;
		const q = filter.toLowerCase();
		return media.items.filter(i => i.filename.toLowerCase().includes(q));
	}

	// ── Folder grouping for media browser ──
	let collapsedMediaFolders = $state<Set<string>>(new Set());

	function toggleMediaFolder(folder: string) {
		const next = new Set(collapsedMediaFolders);
		if (next.has(folder)) next.delete(folder); else next.add(folder);
		collapsedMediaFolders = next;
	}

	function getGroupedMedia(): Array<{ folder: string; items: Array<{ filename: string; duration: number; basename: string }> }> {
		const filtered = getFilteredMedia();
		const groups = new Map<string, Array<{ filename: string; duration: number; basename: string }>>();
		for (const item of filtered) {
			const lastSlash = item.filename.lastIndexOf('/');
			const folder = lastSlash >= 0 ? item.filename.slice(0, lastSlash) : '';
			const basename = lastSlash >= 0 ? item.filename.slice(lastSlash + 1) : item.filename;
			if (!groups.has(folder)) groups.set(folder, []);
			groups.get(folder)!.push({ filename: item.filename, duration: item.duration, basename });
		}
		const entries = [...groups.entries()].sort((a, b) => {
			if (a[0] === '' && b[0] !== '') return -1;
			if (a[0] !== '' && b[0] === '') return 1;
			return a[0].localeCompare(b[0]);
		});
		return entries.map(([folder, items]) => ({ folder, items }));
	}

	function getPlaylistDuration(): number {
		if (!media) return 0;
		let total = 0;
		for (const f of playlist) {
			const basename = f.split('/').pop() || f;
			const item = media.items.find(i => i.filename === basename || i.filename === f);
			if (item) total += item.duration;
		}
		return total;
	}

	function getItemDuration(filename: string): number {
		if (!media) return 0;
		const basename = filename.split('/').pop() || filename;
		return media.items.find(i => i.filename === basename || i.filename === filename)?.duration || 0;
	}

	// ── Saved playlists CRUD ──

	async function refreshPlaylists() {
		if (!adapter) return;
		playlistsLoading = true;
		playlistsError = '';
		try {
			const resp = await adapter.getPlaylists();
			savedPlaylists = resp.playlists;
		} catch (e: unknown) {
			playlistsError = CathodeApiError.extractMessage(e, 'Failed to load playlists');
			savedPlaylists = [];
		} finally { playlistsLoading = false; }
	}

	async function handleDeletePlaylist(name: string) {
		if (!confirm(`Delete playlist "${name}"? This cannot be undone.`)) return;
		if (!adapter) return;
		deletingPlaylist = name;
		playlistsError = '';
		try {
			await adapter.deletePlaylist(name);
			// If we were editing this playlist, clear the builder
			if (editingName === name) {
				editingName = null;
				playlistName = '';
				playlist = [];
			}
			await refreshPlaylists();
		} catch (e: unknown) {
			playlistsError = CathodeApiError.extractMessage(e, `Failed to delete "${name}"`);
		} finally { deletingPlaylist = null; }
	}

	async function handleEditPlaylist(name: string) {
		if (!adapter) return;
		playlistsError = '';
		try {
			const detail: PlaylistDetail = await adapter.getPlaylist(name);
			playlistName = detail.name;
			playlist = detail.entries.map(e => e.source);
			editingName = name;
			toolResult = null;
			toolError = '';
		} catch (e: unknown) {
			playlistsError = CathodeApiError.extractMessage(e, `Failed to load "${name}" for editing`);
		}
	}

	// ── Playlist tools ──
	async function handleApplyTool(toolName: string, save: boolean) {
		if (!adapter || !editingName) return;
		toolLoading = toolName;
		toolError = '';
		toolResult = null;
		try {
			const result = await adapter.applyPlaylistTool(editingName, toolName, {}, save);
			// Update the builder with the result
			playlist = result.entries.map(e => e.source);
			toolResult = { tool: toolName, count: result.entries.length };
			if (save) {
				saveSuccess = `Tool "${toolName}" applied and saved (${result.entries.length} entries)`;
				setTimeout(() => { saveSuccess = ''; }, 3000);
				await refreshPlaylists();
			}
			setTimeout(() => { toolResult = null; }, 3000);
		} catch (e: unknown) {
			toolError = CathodeApiError.extractMessage(e, `Failed to apply tool "${toolName}"`);
		} finally { toolLoading = null; }
	}

	// ── Playlist manipulation ──
	function addToPlaylist(filename: string) {
		playlist = [...playlist, filename];
	}

	function removeFromPlaylist(idx: number) {
		playlist = playlist.filter((_, i) => i !== idx);
	}

	function moveUp(idx: number) {
		if (idx <= 0) return;
		const items = [...playlist];
		[items[idx - 1], items[idx]] = [items[idx], items[idx - 1]];
		playlist = items;
	}

	function moveDown(idx: number) {
		if (idx >= playlist.length - 1) return;
		const items = [...playlist];
		[items[idx], items[idx + 1]] = [items[idx + 1], items[idx]];
		playlist = items;
	}

	function clearPlaylist() {
		playlist = [];
		playlistName = '';
		editingName = null;
		toolResult = null;
		toolError = '';
	}

	function addAllMedia() {
		if (!media) return;
		playlist = [...playlist, ...media.items.map(i => i.filename)];
	}

	// ── Drag and drop ──
	function handleDragStart(idx: number) {
		dragIdx = idx;
	}

	function handleDragOver(e: DragEvent, idx: number) {
		e.preventDefault();
		dropIdx = idx;
	}

	function handleDrop(idx: number) {
		if (dragIdx === null || dragIdx === idx) { dragIdx = null; dropIdx = null; return; }
		const items = [...playlist];
		const [moved] = items.splice(dragIdx, 1);
		items.splice(idx, 0, moved);
		playlist = items;
		dragIdx = null;
		dropIdx = null;
	}

	function handleDragEnd() {
		dragIdx = null;
		dropIdx = null;
	}

	// ── Save ──
	async function handleSavePlaylist() {
		if (!adapter || playlist.length === 0 || !playlistName.trim()) return;
		saving = true;
		saveError = '';
		saveSuccess = '';
		try {
			await adapter.createPlaylist(playlistName.trim(), playlist);
			saveSuccess = `Saved "${playlistName.trim()}" (${playlist.length} files)`;
			editingName = null;
			setTimeout(() => { saveSuccess = ''; }, 3000);
			await refreshPlaylists();
		} catch (e: unknown) {
			saveError = CathodeApiError.extractMessage(e, 'Failed to save playlist');
		} finally { saving = false; }
	}

	// ── Load on mount ──
	$effect(() => {
		if (adapter) {
			refreshPlaylists();
		}
	});
</script>

<h2>Playlists</h2>

<!-- ── Saved Playlists ── -->
<div class="panel saved-playlists-panel">
	<h3>Saved Playlists {savedPlaylists.length > 0 ? `(${savedPlaylists.length})` : ''}</h3>

	{#if playlistsLoading}
		<p class="text-muted">Loading...</p>
	{:else if playlistsError}
		<div class="form-error">{playlistsError}</div>
	{:else if savedPlaylists.length === 0}
		<p class="text-muted">No saved playlists. Build one below and save it.</p>
	{:else}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Files</th><th>Duration</th><th>Updated</th><th></th></tr></thead>
				<tbody>
					{#each savedPlaylists as pl}
						<tr>
							<td class="mono">{pl.name}</td>
							<td>{pl.entry_count}</td>
							<td class="mono text-muted">{fmtDuration(pl.total_duration)}</td>
							<td class="mono text-muted">{pl.updated?.slice(0, 16) || '\u2014'}</td>
							<td class="row-actions">
								<button class="btn-surface btn-xs" onclick={() => handleEditPlaylist(pl.name)}
									title="Edit playlist">Edit</button>
								<button class="btn-danger btn-xs" onclick={() => handleDeletePlaylist(pl.name)}
									disabled={deletingPlaylist === pl.name}>
									{deletingPlaylist === pl.name ? '...' : 'Delete'}
								</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>

<!-- ── Playlist Builder ── -->
<div class="media-layout">
	<!-- Left: Media browser -->
	<div class="media-browser">
		<div class="panel">
			<h3>Media Library {media ? `(${media.count})` : ''}</h3>
			{#if media}
				<div class="media-filter">
					<input type="text" bind:value={filter} placeholder="Filter files..." class="input-sm" style="flex: 1" />
					<button class="btn-surface btn-xs" onclick={addAllMedia} title="Add all to playlist">Add All</button>
				</div>
				<div class="file-list">
					{#each getGroupedMedia() as group}
						{#if group.folder}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div class="media-folder-row" onclick={() => toggleMediaFolder(group.folder)}>
								<span class="media-folder-toggle">{collapsedMediaFolders.has(group.folder) ? '▸' : '▾'}</span>
								<span class="media-folder-name">{group.folder}</span>
								<span class="media-folder-count">{group.items.length}</span>
							</div>
						{/if}
						{#if !group.folder || !collapsedMediaFolders.has(group.folder)}
							{#each group.items as item}
								<!-- svelte-ignore a11y_click_events_have_key_events -->
								<!-- svelte-ignore a11y_no_static_element_interactions -->
								<div class="file-item" class:file-item-nested={!!group.folder}
									onclick={() => addToPlaylist(item.filename)}
									title="Click to add to playlist">
									<span class="file-name">{item.basename}</span>
									<span class="file-dur">{fmtDurationShort(item.duration)}</span>
								</div>
							{/each}
						{/if}
					{/each}
					{#if media.items.length === 0}
						<div class="file-item text-muted">No media files.</div>
					{:else if getFilteredMedia().length === 0}
						<div class="file-item text-muted">No matches.</div>
					{/if}
				</div>
				<div class="media-summary">
					{media.count} files &middot; {fmtDuration(media.total_duration)} total
				</div>
			{:else}
				<p class="text-muted">Loading...</p>
			{/if}
		</div>
	</div>

	<!-- Right: Playlist builder -->
	<div class="playlist-builder">
		<div class="panel">
			<div class="playlist-header">
				<h3>
					{#if editingName}
						Editing: {editingName}
					{:else}
						Playlist Builder ({playlist.length} items)
					{/if}
				</h3>
				<div class="playlist-header-actions">
					{#if playlist.length > 0}
						<span class="text-muted" style="font-size: 0.75rem">{fmtDuration(getPlaylistDuration())}</span>
						<button class="btn-surface btn-xs" onclick={clearPlaylist}>Clear</button>
					{/if}
				</div>
			</div>

			<div class="form-row" style="margin-bottom: 0.75rem">
				<label class="form-label" style="flex: 1">
					<span>Playlist Name</span>
					<input type="text" bind:value={playlistName} placeholder="e.g. main-loop"
						onkeydown={(e) => { if (e.key === 'Enter') handleSavePlaylist(); }} />
				</label>
			</div>

			{#if playlist.length > 0}
				<div class="playlist-list">
					{#each playlist as filename, idx}
						<div class="playlist-item"
							class:drag-over={dropIdx === idx}
							class:dragging={dragIdx === idx}
							draggable="true"
							ondragstart={() => handleDragStart(idx)}
							ondragover={(e) => handleDragOver(e, idx)}
							ondrop={() => handleDrop(idx)}
							ondragend={handleDragEnd}
							role="listitem">
							<span class="playlist-grip" title="Drag to reorder">::</span>
							<span class="playlist-idx">{idx + 1}</span>
							<span class="playlist-name truncate">{filename}</span>
							<span class="playlist-dur">{fmtDurationShort(getItemDuration(filename))}</span>
							<div class="playlist-item-actions">
								<button class="btn-surface btn-xs" onclick={() => moveUp(idx)}
									disabled={idx === 0} title="Move up">&#9650;</button>
								<button class="btn-surface btn-xs" onclick={() => moveDown(idx)}
									disabled={idx === playlist.length - 1} title="Move down">&#9660;</button>
								<button class="btn-danger btn-xs" onclick={() => removeFromPlaylist(idx)}
									title="Remove">&#10005;</button>
							</div>
						</div>
					{/each}
				</div>

				<!-- Playlist tools (shown when editing a saved playlist) -->
				{#if editingName && (playlistTools ?? []).length > 0}
					<div class="playlist-tools">
						<div class="playlist-tools-label">Tools</div>
						<div class="playlist-tools-buttons">
							{#each playlistTools ?? [] as tool}
								<div class="tool-group">
									<button class="btn-surface btn-xs"
										title={tool.description || tool.name}
										disabled={toolLoading === tool.name}
										onclick={() => handleApplyTool(tool.name, false)}>
										{toolLoading === tool.name ? '...' : tool.name}
									</button>
									<button class="btn-primary btn-xs tool-save-btn"
										title="Apply and save"
										disabled={toolLoading === tool.name}
										onclick={() => handleApplyTool(tool.name, true)}>
										Save
									</button>
								</div>
							{/each}
						</div>
						{#if toolResult}
							<div class="tool-result">
								Applied "{toolResult.tool}" &mdash; {toolResult.count} entries
							</div>
						{/if}
						{#if toolError}
							<div class="form-error" style="margin-top: 0.25rem">{toolError}</div>
						{/if}
					</div>
				{/if}

			<div class="form-actions" style="margin-top: 0.75rem">
				<button class="btn-primary btn-sm" onclick={handleSavePlaylist}
					disabled={saving || playlist.length === 0 || !playlistName.trim()}>
					{saving ? 'Saving...' : editingName ? 'Update Playlist' : 'Save Playlist'}
				</button>
			</div>

				{#if saveError}
					<div class="form-error">{saveError}</div>
				{/if}
				{#if saveSuccess}
					<div class="settings-success">{saveSuccess}</div>
				{/if}
			{:else}
			<div class="playlist-empty">
				<p class="text-muted">Build playlists from the media library. Save with a name, then load onto any layer or use in program schedule blocks.</p>
			</div>
			{/if}
		</div>
	</div>
</div>

<style>
	.saved-playlists-panel { margin-bottom: 1rem; }

	.media-layout {
		display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
		min-height: 400px;
	}
	.media-browser, .playlist-builder { min-width: 0; }
	.media-browser .panel, .playlist-builder .panel {
		height: 100%; display: flex; flex-direction: column;
	}

	.media-filter {
		display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: center;
	}
	.media-summary {
		padding-top: 0.4rem; margin-top: 0.4rem;
		border-top: 1px solid #1a1a2a;
		font-size: 0.75rem; color: #5a5a70;
	}

	.playlist-header {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 0.75rem;
	}
	.playlist-header h3 { margin-bottom: 0; }
	.playlist-header-actions { display: flex; align-items: center; gap: 0.5rem; }

	.playlist-list {
		flex: 1; overflow-y: auto; max-height: 400px;
		border: 1px solid #1a1a2a; border-radius: 4px; background: #0c0c18;
	}
	.playlist-item {
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0.35rem 0.5rem; font-size: 0.8rem;
		border-bottom: 1px solid #141420;
		transition: background 0.1s;
	}
	.playlist-item:last-child { border-bottom: none; }
	.playlist-item:hover { background: #141420; }
	.playlist-item.drag-over { border-top: 2px solid #818cf8; }
	.playlist-item.dragging { opacity: 0.4; }

	.playlist-grip {
		cursor: grab; color: #5a5a70; font-weight: 700;
		font-size: 0.7rem; padding: 0 0.1rem; user-select: none;
	}
	.playlist-idx {
		color: #5a5a70; font-size: 0.7rem; font-family: monospace;
		min-width: 1.5rem; text-align: right;
	}
	.playlist-name { flex: 1; font-family: monospace; }
	.playlist-dur { color: #5a5a70; font-size: 0.75rem; font-family: monospace; }
	.playlist-item-actions { display: flex; gap: 0.15rem; }
	.playlist-empty { padding: 2rem 1rem; text-align: center; }

	.playlist-tools {
		margin-top: 0.5rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid #1a1a2a;
		border-radius: 4px;
		background: #0e0e1c;
	}
	.playlist-tools-label {
		font-size: 0.7rem; color: #5a5a70;
		text-transform: uppercase; letter-spacing: 0.05em;
		margin-bottom: 0.35rem;
	}
	.playlist-tools-buttons {
		display: flex; flex-wrap: wrap; gap: 0.35rem;
	}
	.tool-group {
		display: flex; gap: 1px;
	}
	.tool-group .btn-surface { border-radius: 4px 0 0 4px; }
	.tool-save-btn {
		border-radius: 0 4px 4px 0;
		font-size: 0.65rem;
		padding: 0.15rem 0.35rem;
	}
	.tool-result {
		margin-top: 0.35rem;
		font-size: 0.75rem;
		color: #10b981;
	}

	.media-folder-row {
		display: flex; align-items: center; gap: 0.3rem;
		padding: 0.35rem 0.6rem; cursor: pointer;
		background: #0e0e1a; border-bottom: 1px solid #1a1a2a;
		font-size: 0.75rem; font-weight: 600;
	}
	.media-folder-row:hover { background: #1a1a28; }
	.media-folder-toggle { color: #5a5a70; font-size: 0.65rem; width: 0.8rem; }
	.media-folder-name { color: #8888a0; }
	.media-folder-count {
		margin-left: 0.25rem; font-size: 0.6rem; color: #5a5a70; font-weight: 400;
	}
	.media-folder-count::before { content: '('; }
	.media-folder-count::after { content: ')'; }
	.file-item-nested { padding-left: 1.4rem; }

	@media (max-width: 768px) {
		.media-layout { grid-template-columns: 1fr; }
	}
</style>
