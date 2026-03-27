<script lang="ts">
	import { CathodeApiError, sortedLayers } from '$cathode';
	import type {
		BackendAdapter, EngineHealth, EngineChannelStatus, SourceRequest,
		MediaItem, PlaylistSummary, RegistrySourceType, PluginPresetSummary,
	} from '$cathode';

	interface Props {
		engineHealth: EngineHealth | null;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
		pluginSourceTypes?: RegistrySourceType[];
	}

	let { engineHealth, adapter, onRefresh, pluginSourceTypes = [] }: Props = $props();

	const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];

	// Core source types (cathode built-ins). 'rtmp' removed in v2.
	const CORE_SOURCE_TYPES: Array<{ value: string; label: string; desc?: string }> = [
		{ value: 'test', label: 'Test Pattern' },
		{ value: 'file_loop', label: 'File Loop' },
		{ value: 'image', label: 'Image' },
		{ value: 'playlist', label: 'Playlist' },
		{ value: 'hls', label: 'HLS' },
		{ value: 'failover_file', label: 'Failover File', desc: 'Loads the filler clip (cathode/failover.mp4)' },
		{ value: 'failover_debug', label: 'Failover Debug', desc: 'Live SMPTE debug pattern with channel name/ID' },
		{ value: 'disconnect', label: 'Disconnect', desc: 'Clears the source on this layer' },
	];

	// Merge core + plugin source types for the dropdown
	let allSourceTypes = $derived([
		...CORE_SOURCE_TYPES,
		...pluginSourceTypes.map(p => ({
			value: p.name,
			label: p.name.charAt(0).toUpperCase() + p.name.slice(1),
			desc: p.description,
			plugin: p.plugin,
			params: p.params,
		})),
	]);

	// Look up a plugin source type definition by name
	function getPluginSourceType(name: string): RegistrySourceType | undefined {
		return pluginSourceTypes.find(p => p.name === name);
	}

	// Is this type a plugin-provided source type?
	function isPluginType(type: string): boolean {
		return !CORE_SOURCE_TYPES.some(c => c.value === type);
	}

	// ── Media + playlist data for pickers ──
	let mediaFiles = $state<MediaItem[]>([]);
	let playlists = $state<PlaylistSummary[]>([]);
	let mediaDir = $state('');

	// ── Track applied source detail per layer (API doesn't return this) ──
	const DETAIL_KEY = 'phosphor_input_detail';
	let appliedDetail = $state<Record<string, string>>(
		(() => { try { return JSON.parse(localStorage.getItem(DETAIL_KEY) || '{}'); } catch { return {}; } })()
	);

	$effect(() => {
		localStorage.setItem(DETAIL_KEY, JSON.stringify(appliedDetail));
	});

	// ── Inline edit state ──
	let editingLayer = $state<string | null>(null);
	let editType = $state<string>('test');
	let editPattern = $state('smpte');
	let editFile = $state('');
	let editUrl = $state('');
	let editPlaylist = $state('');
	let editLoop = $state(true);
	let editLoading = $state(false);
	let editError = $state('');
	let actionSuccess = $state('');

	// Plugin-specific edit fields
	let editPreset = $state('');
	let pluginPresets = $state<PluginPresetSummary[]>([]);
	let presetsLoading = $state(false);

	function getSourceFilename(source: string): string {
		if (!source) return '\u2014';
		return source.split('/').pop() || source;
	}

	function fmtDuration(s: number) {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	function sourceTypeLabel(type: string): string {
		return allSourceTypes.find(t => t.value === type)?.label || type;
	}

	function isImage(filename: string): boolean {
		const lower = filename.toLowerCase();
		return IMAGE_EXTS.some(ext => lower.endsWith(ext));
	}

	let videoFiles = $derived(mediaFiles.filter(f => !isImage(f.filename)));
	let imageFiles = $derived(mediaFiles.filter(f => isImage(f.filename)));

	/** What to show in the Source column — includes detail if we tracked it */
	function sourceDisplay(name: string, layer: EngineChannelStatus): { label: string; detail: string } {
		const label = layer.source_type ? sourceTypeLabel(layer.source_type) : 'none';
		const detail = appliedDetail[name] || '';
		return { label, detail };
	}

	async function fetchPickerData() {
		if (!adapter) return;
		try {
			const [mediaResult, playlistResult] = await Promise.allSettled([
				adapter.getMedia(),
				adapter.getPlaylists(),
			]);
			if (mediaResult.status === 'fulfilled') {
				mediaFiles = mediaResult.value.items;
				mediaDir = mediaResult.value.media_dir;
			}
			if (playlistResult.status === 'fulfilled') {
				playlists = playlistResult.value.playlists;
			}
		} catch { /* non-fatal */ }
	}

	function startEdit(name: string, layer: EngineChannelStatus) {
		editingLayer = name;
		editType = (layer.source_type as string) || 'test';
		editPattern = 'smpte';
		editFile = '';
		editUrl = '';
		editPlaylist = '';
		editError = '';
		editPreset = '';
		// Pre-select first available option for pickers
		if (editType === 'playlist' && playlists.length > 0) editPlaylist = playlists[0].name;
		if (isPluginType(editType)) fetchPluginPresets(editType);
	}

	function cancelEdit() {
		editingLayer = null;
		editError = '';
	}

	async function applySource() {
		if (!adapter || !editingLayer) return;
		editLoading = true;
		editError = '';
		try {
			let detail = '';

			if (editType === 'playlist') {
				// Playlists use a dedicated API endpoint, not loadLayerSource
				await adapter.loadPlaylist(editPlaylist, { layer: editingLayer, loop: editLoop });
				detail = `${editPlaylist}${editLoop ? '' : ' (no loop)'}`;
			} else {
				const req: SourceRequest = { type: editType };

				if (editType === 'test') {
					req.pattern = editPattern;
					detail = editPattern.toUpperCase();
				} else if (editType === 'file_loop') {
					const path = editFile.includes('/') ? editFile : `${mediaDir}/${editFile}`;
					req.path = path;
					detail = editFile.split('/').pop() || editFile;
				} else if (editType === 'image') {
					const path = editFile.includes('/') ? editFile : `${mediaDir}/${editFile}`;
					req.path = path;
					detail = editFile.split('/').pop() || editFile;
				} else if (editType === 'hls') {
					req.url = editUrl;
					detail = editUrl;
				} else if (editType === 'failover_file') {
					detail = 'failover file';
				} else if (editType === 'failover_debug') {
					detail = 'debug pattern';
				} else if (isPluginType(editType)) {
					if (editPreset.trim()) req.preset = editPreset.trim();
					detail = editPreset.trim() || editType;
				}
				// disconnect needs no extra fields

				await adapter.loadLayerSource(editingLayer, req);
			}

			if (detail) appliedDetail[editingLayer] = detail;
			else delete appliedDetail[editingLayer];
			appliedDetail = { ...appliedDetail };

			actionSuccess = `Loaded ${sourceTypeLabel(editType)} on ${editingLayer}`;
			setTimeout(() => { actionSuccess = ''; }, 3000);
			editingLayer = null;
			setTimeout(onRefresh, 500);
		} catch (e: unknown) {
			editError = CathodeApiError.extractMessage(e, 'Failed to load source');
		} finally { editLoading = false; }
	}

	async function fetchPluginPresets(sourceType: string) {
		const pst = getPluginSourceType(sourceType);
		if (!pst || !adapter) { pluginPresets = []; return; }
		presetsLoading = true;
		try {
			const result = await adapter.getPluginPresets(pst.plugin);
			pluginPresets = result.presets;
			// Pre-select first preset if available
			if (pluginPresets.length > 0 && !editPreset) editPreset = pluginPresets[0].name;
		} catch { pluginPresets = []; }
		finally { presetsLoading = false; }
	}

	$effect(() => {
		if (adapter) fetchPickerData();
	});
</script>

<h2>Inputs</h2>
<p class="panel-desc">Input sources feeding each playout layer. Layers shown top-to-bottom in stack order.</p>

{#if actionSuccess}
	<div class="settings-success">{actionSuccess}</div>
{/if}

{#if engineHealth && Object.keys(engineHealth.channels).length > 0}
	<div class="panel">
		<div class="table-wrap">
			<table>
				<thead><tr><th>Layer</th><th>Source</th><th>Now Playing</th><th>Progress</th><th>Playlist</th><th></th></tr></thead>
				<tbody>
					{#each sortedLayers(engineHealth.channels) as [name, layer]}
						{@const isActive = name === engineHealth.active_channel}
						{@const isEditing = editingLayer === name}
						{@const src = sourceDisplay(name, layer)}
						<tr>
							<td>
								<span class="mono" style="font-weight: 600" class:layer-on-air={isActive}>{name}</span>
							</td>
							<td>
								{#if layer.source_type}
									<span class="source-badge source-{layer.source_type}">{src.label}</span>
									{#if src.detail}
										<span class="source-detail mono">{src.detail}</span>
									{/if}
								{:else}
									<span class="text-muted">none</span>
								{/if}
							</td>
							<td>
								{#if layer.now_playing}
									<span class="mono truncate" style="font-size: 0.75rem">{getSourceFilename(layer.now_playing.source)}</span>
								{:else}
									<span class="text-muted">&mdash;</span>
								{/if}
							</td>
							<td>
								{#if layer.now_playing && layer.now_playing.duration > 0}
									<div class="progress-cell">
										<div class="progress-bar"><div class="progress-fill" style="width: {Math.min((layer.now_playing.played / layer.now_playing.duration) * 100, 100)}%"></div></div>
										<span class="progress-time">{fmtDuration(layer.now_playing.played)}/{fmtDuration(layer.now_playing.duration)}</span>
									</div>
								{:else}
									<span class="text-muted">&mdash;</span>
								{/if}
							</td>
							<td>
								{#if layer.playlist_name}
									<span class="mono" style="color: #818cf8; font-size: 0.75rem">{layer.playlist_name}</span>
								{:else}
									<span class="text-muted">&mdash;</span>
								{/if}
							</td>
							<td class="row-actions">
								{#if isEditing}
									<button class="btn-surface btn-xs" onclick={cancelEdit}>Cancel</button>
								{:else}
									<button class="btn-surface btn-xs" onclick={() => startEdit(name, layer)}>Edit</button>
								{/if}
							</td>
						</tr>
						{#if isEditing}
							<tr class="expanded-row">
								<td colspan="6">
									<div class="edit-panel">
										{#if editError}
											<div class="form-error">{editError}</div>
										{/if}
										<div class="edit-row">
											<label class="form-label">
												<span>Source type</span>
												<select bind:value={editType} onchange={() => { if (isPluginType(editType)) fetchPluginPresets(editType); }}>
													{#each allSourceTypes as st}
														<option value={st.value}>{st.label}{('plugin' in st && st.plugin) ? ` (${st.plugin})` : ''}</option>
													{/each}
												</select>
											</label>

											{#if editType === 'test'}
												<label class="form-label">
													<span>Pattern</span>
													<select bind:value={editPattern}>
														<option value="smpte">SMPTE</option>
														<option value="black">Black</option>
														<option value="snow">Snow</option>
														<option value="ball">Ball</option>
													</select>
												</label>

											{:else if editType === 'file_loop'}
												<label class="form-label" style="flex: 1">
													<span>File</span>
													{#if videoFiles.length > 0}
														<select bind:value={editFile}>
															<option value="">Select a file...</option>
															{#each videoFiles as file}
																<option value={file.filename}>{file.filename} ({fmtDuration(file.duration)})</option>
															{/each}
														</select>
													{:else}
														<span class="text-muted" style="font-size: 0.75rem">No media files. Upload files in Library.</span>
													{/if}
												</label>

											{:else if editType === 'image'}
												<label class="form-label" style="flex: 1">
													<span>Image</span>
													{#if imageFiles.length > 0}
														<select bind:value={editFile}>
															<option value="">Select an image...</option>
															{#each imageFiles as file}
																<option value={file.filename}>{file.filename}</option>
															{/each}
														</select>
													{:else}
														<span class="text-muted" style="font-size: 0.75rem">No image files. Upload images in Library.</span>
													{/if}
												</label>

											{:else if editType === 'playlist'}
												<label class="form-label" style="flex: 1">
													<span>Playlist</span>
													{#if playlists.length > 0}
														<select bind:value={editPlaylist}>
															{#each playlists as pl}
																<option value={pl.name}>{pl.name} ({pl.entry_count} items)</option>
															{/each}
														</select>
													{:else}
														<span class="text-muted" style="font-size: 0.75rem">No playlists. Create one in Playlists.</span>
													{/if}
												</label>
												<label class="form-label">
													<span>Loop</span>
													<select bind:value={editLoop}>
														<option value={true}>Yes</option>
														<option value={false}>No</option>
													</select>
												</label>

											{:else if editType === 'hls'}
												<label class="form-label" style="flex: 1">
													<span>HLS URL</span>
													<input type="text" bind:value={editUrl} placeholder="https://example.com/stream.m3u8" />
												</label>

											{:else if isPluginType(editType)}
												<label class="form-label" style="flex: 1">
													<span>Preset</span>
													{#if presetsLoading}
														<span class="text-muted" style="font-size: 0.75rem">Loading presets...</span>
													{:else if pluginPresets.length > 0}
														<select bind:value={editPreset}>
															{#each pluginPresets as p}
																<option value={p.name}>{p.name}{p.description ? ` — ${p.description}` : ''}</option>
															{/each}
														</select>
													{:else}
														<span class="text-muted" style="font-size: 0.75rem">No presets available. Configure in Plugins settings.</span>
													{/if}
												</label>
											{/if}

											{#if editType === 'disconnect' || editType === 'failover_file' || editType === 'failover_debug' || isPluginType(editType)}
												{@const st = allSourceTypes.find(t => t.value === editType)}
												{#if st?.desc}
													<span class="edit-hint text-muted">{st.desc}</span>
												{/if}
											{/if}

											<div class="edit-actions">
												<button class="btn-primary btn-xs" onclick={applySource}
													disabled={editLoading
														|| (editType === 'file_loop' && !editFile)
														|| (editType === 'image' && !editFile)
														|| (editType === 'playlist' && !editPlaylist)
														|| (editType === 'hls' && !editUrl.trim())
														|| (isPluginType(editType) && !editPreset)}>
													{editLoading ? '...' : 'Apply'}
												</button>
											</div>
										</div>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{:else}
	<div class="panel">
		<p class="text-muted" style="margin: 0">Engine not running. Start the engine in Playout to see input sources.</p>
	</div>
{/if}



<style>
	.progress-cell {
		display: flex; align-items: center; gap: 0.4rem; min-width: 120px;
	}
	.progress-time {
		font-size: 0.65rem; color: #5a5a70; font-family: monospace; white-space: nowrap;
	}

	.source-badge {
		font-size: 0.65rem; font-weight: 600; padding: 0.1rem 0.4rem;
		border-radius: 3px; display: inline-block; white-space: nowrap;
	}
	.source-detail {
		font-size: 0.65rem; color: #8888a0; margin-left: 0.35rem;
	}
	.source-test { background: rgba(107, 114, 128, 0.2); color: #9ca3af; }
	.source-playlist { background: rgba(129, 140, 248, 0.15); color: #818cf8; }
	.source-file_loop { background: rgba(129, 140, 248, 0.15); color: #818cf8; }
	.source-image { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
	.source-hls { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.source-failover_file { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
	.source-failover_debug { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
	.source-disconnect { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.source-plugin { background: rgba(236, 72, 153, 0.15); color: #ec4899; }

	.layer-on-air { color: #ef4444; border-left: 3px solid #ef4444; padding-left: 0.35rem; }

	.edit-panel { padding: 0.5rem 0.75rem; }
	.edit-row {
		display: flex; align-items: flex-end; gap: 0.5rem; flex-wrap: wrap;
	}
	.edit-row .form-label span { font-size: 0.7rem; }
	.edit-actions {
		display: flex; align-items: flex-end; padding-bottom: 0.1rem;
	}
	.edit-hint {
		font-size: 0.7rem; align-self: center; padding-bottom: 0.15rem;
	}


</style>
