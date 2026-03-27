<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { BackendAdapter, EngineHealth, OutputConfig, OutputHealth, RegistryOutputType } from '$cathode';

	interface Props {
		engineHealth: EngineHealth | null;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
		pluginOutputTypes?: RegistryOutputType[];
	}

	let { engineHealth, adapter, onRefresh, pluginOutputTypes = [] }: Props = $props();

	// Core output types
	const CORE_TYPES = [
		{ value: 'hls', label: 'HLS' },
		{ value: 'rtmp', label: 'RTMP' },
		{ value: 'file', label: 'File' },
		{ value: 'null', label: 'Null' },
	];

	// Merge core + plugin types for dropdown
	function getAllOutputTypes(): Array<{ value: string; label: string; plugin?: string; description?: string }> {
		const types: Array<{ value: string; label: string; plugin?: string; description?: string }> = [
			...CORE_TYPES,
		];
		for (const pt of pluginOutputTypes ?? []) {
			// Don't duplicate if a plugin overrides a core type
			if (!types.find(t => t.value === pt.name)) {
				types.push({ value: pt.name, label: pt.name.toUpperCase(), plugin: pt.plugin, description: pt.description });
			}
		}
		return types;
	}

	function isCoreType(type: string): boolean {
		return CORE_TYPES.some(t => t.value === type);
	}

	// ── Output list ──
	let outputs = $state<OutputHealth[]>([]);
	let loading = $state(false);
	let error = $state('');

	// ── Add output form ──
	let showAdd = $state(false);
	let addType = $state<string>('hls');
	let addName = $state('');
	let addRtmpUrl = $state('');
	let addFilePath = $state('');
	let addFileFormat = $state('mp4');
	let addHlsDir = $state('');
	let addVideoBitrate = $state<number | undefined>(undefined);
	let addAudioBitrate = $state<number | undefined>(undefined);
	let addKeyframeInterval = $state<number | undefined>(undefined);
	let addPreset = $state('');
	let addSegmentDuration = $state<number | undefined>(undefined);
	let addPlaylistLength = $state<number | undefined>(undefined);
	let addMaxDuration = $state<number | undefined>(undefined);
	let creating = $state(false);
	let createError = $state('');

	// ── Edit output form ──
	let editingOutput = $state<string | null>(null);
	let editVideoBitrate = $state<number | undefined>(undefined);
	let editAudioBitrate = $state<number | undefined>(undefined);
	let editKeyframeInterval = $state<number | undefined>(undefined);
	let editPreset = $state('');
	let editSegmentDuration = $state<number | undefined>(undefined);
	let editPlaylistLength = $state<number | undefined>(undefined);
	let editMaxDuration = $state<number | undefined>(undefined);
	let editRtmpUrl = $state('');
	let editFilePath = $state('');
	let editHlsDir = $state('');
	let editLoading = $state(false);
	let editError = $state('');

	// ── Per-output actions ──
	let actionLoading = $state<string | null>(null);
	let actionError = $state('');
	let actionSuccess = $state('');

	// ── Primary output double-confirm ──
	let confirmingDelete = $state<string | null>(null);

	function fmtUptime(s: number): string {
		if (s < 60) return `${Math.floor(s)}s`;
		if (s < 3600) return `${Math.floor(s / 60)}m ${Math.floor(s % 60)}s`;
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return `${h}h ${m}m`;
	}

	function stateColor(state: string): string {
		if (state === 'PLAYING') return 'badge-active';
		if (state === 'PAUSED' || state === 'NULL') return 'badge-muted';
		return 'badge-error';
	}

	async function refreshOutputs() {
		if (!adapter) return;
		loading = true;
		error = '';
		try {
			const result = await adapter.getOutputs();
			outputs = result.outputs;
		} catch (e: unknown) {
			// Fall back to engine health outputs if dedicated endpoint not available
			if (engineHealth?.outputs) {
				outputs = Object.values(engineHealth.outputs);
			} else {
				error = CathodeApiError.extractMessage(e, 'Failed to load outputs');
				outputs = [];
			}
		} finally { loading = false; }
	}

	async function handleCreate() {
		if (!adapter || !addName.trim()) return;
		creating = true;
		createError = '';
		try {
			const config: OutputConfig = {
				type: addType,
				name: addName.trim(),
			};
			if (addVideoBitrate) config.video_bitrate = addVideoBitrate;
			if (addAudioBitrate) config.audio_bitrate = addAudioBitrate;
			if (addKeyframeInterval) config.keyframe_interval = addKeyframeInterval;
			if (addPreset) config.preset = addPreset;
			if (addType === 'rtmp' && addRtmpUrl.trim()) config.rtmp_url = addRtmpUrl.trim();
			if (addType === 'file') {
				if (addFilePath.trim()) config.file_path = addFilePath.trim();
				config.file_format = addFileFormat;
				if (addMaxDuration) config.max_duration = addMaxDuration;
			}
			if (addType === 'hls') {
				if (addHlsDir.trim()) config.hls_dir = addHlsDir.trim();
				if (addSegmentDuration) config.segment_duration = addSegmentDuration;
				if (addPlaylistLength) config.playlist_length = addPlaylistLength;
			}

			await adapter.createOutput(config);
			actionSuccess = `Output "${addName.trim()}" created.`;
			setTimeout(() => { actionSuccess = ''; }, 3000);
			resetForm();
			await refreshOutputs();
			onRefresh();
		} catch (e: unknown) {
			createError = CathodeApiError.extractMessage(e, 'Failed to create output');
		} finally { creating = false; }
	}

	function resetForm() {
		showAdd = false;
		addName = '';
		addType = 'hls';
		addRtmpUrl = '';
		addFilePath = '';
		addFileFormat = 'mp4';
		addHlsDir = '';
		addVideoBitrate = undefined;
		addAudioBitrate = undefined;
		addKeyframeInterval = undefined;
		addPreset = '';
		addSegmentDuration = undefined;
		addPlaylistLength = undefined;
		addMaxDuration = undefined;
		createError = '';
	}

	async function handleStop(name: string) {
		if (!adapter) return;
		actionLoading = name;
		actionError = '';
		try {
			await adapter.stopOutput(name);
			await refreshOutputs();
		} catch (e: unknown) {
			actionError = CathodeApiError.extractMessage(e, `Failed to stop "${name}"`);
		} finally { actionLoading = null; }
	}

	async function handleStart(name: string) {
		if (!adapter) return;
		actionLoading = name;
		actionError = '';
		try {
			await adapter.startOutput(name);
			await refreshOutputs();
		} catch (e: unknown) {
			actionError = CathodeApiError.extractMessage(e, `Failed to start "${name}"`);
		} finally { actionLoading = null; }
	}

	async function handleDelete(name: string) {
		// Primary output requires double-confirm
		if (name === 'primary') {
			if (confirmingDelete !== name) {
				confirmingDelete = name;
				return;
			}
			// Second click — proceed with delete
			confirmingDelete = null;
		} else {
			if (!confirm(`Delete output "${name}"? This will stop and remove it.`)) return;
		}
		if (!adapter) return;
		actionLoading = name;
		actionError = '';
		try {
			await adapter.deleteOutput(name);
			actionSuccess = `Output "${name}" deleted.`;
			setTimeout(() => { actionSuccess = ''; }, 3000);
			await refreshOutputs();
			onRefresh();
		} catch (e: unknown) {
			actionError = CathodeApiError.extractMessage(e, `Failed to delete "${name}"`);
		} finally { actionLoading = null; }
	}

	function startEdit(output: OutputHealth) {
		editingOutput = output.name;
		confirmingDelete = null;
		editError = '';
		// Pre-fill from output config
		const cfg = output.config || {};
		editVideoBitrate = (cfg.video_bitrate as number) || undefined;
		editAudioBitrate = (cfg.audio_bitrate as number) || undefined;
		editKeyframeInterval = (cfg.keyframe_interval as number) || undefined;
		editPreset = (cfg.preset as string) || '';
		editSegmentDuration = (cfg.segment_duration as number) || undefined;
		editPlaylistLength = (cfg.playlist_length as number) || undefined;
		editMaxDuration = (cfg.max_duration as number) || undefined;
		editRtmpUrl = (cfg.rtmp_url as string) || '';
		editFilePath = (cfg.file_path as string) || '';
		editHlsDir = (cfg.hls_dir as string) || '';
	}

	function cancelEdit() {
		editingOutput = null;
		editError = '';
	}

	async function handleEditSave(output: OutputHealth) {
		if (!adapter || !editingOutput) return;
		editLoading = true;
		editError = '';
		try {
			const config: Partial<OutputConfig> = {};
			if (editVideoBitrate !== undefined) config.video_bitrate = editVideoBitrate;
			if (editAudioBitrate !== undefined) config.audio_bitrate = editAudioBitrate;
			if (editKeyframeInterval !== undefined) config.keyframe_interval = editKeyframeInterval;
			if (editPreset) config.preset = editPreset;
			if (output.type === 'rtmp' && editRtmpUrl.trim()) config.rtmp_url = editRtmpUrl.trim();
			if (output.type === 'file') {
				if (editFilePath.trim()) config.file_path = editFilePath.trim();
				if (editMaxDuration !== undefined) config.max_duration = editMaxDuration;
			}
			if (output.type === 'hls') {
				if (output.name !== 'primary' && editHlsDir.trim()) config.hls_dir = editHlsDir.trim();
				if (editSegmentDuration !== undefined) config.segment_duration = editSegmentDuration;
				if (editPlaylistLength !== undefined) config.playlist_length = editPlaylistLength;
			}

			await adapter.updateOutput(editingOutput, config);
			actionSuccess = `Output "${editingOutput}" updated.`;
			setTimeout(() => { actionSuccess = ''; }, 3000);
			editingOutput = null;
			await refreshOutputs();
			onRefresh();
		} catch (e: unknown) {
			editError = CathodeApiError.extractMessage(e, 'Failed to update output');
		} finally { editLoading = false; }
	}

	// ── Load on mount + when engine health changes ──
	$effect(() => {
		if (adapter) refreshOutputs();
	});
</script>

<h2>Outputs</h2>
<p class="panel-desc">Output pipelines for this channel. The primary HLS output is created automatically when the engine starts.</p>

{#if actionSuccess}
	<div class="settings-success">{actionSuccess}</div>
{/if}
{#if actionError}
	<div class="form-error">{actionError}</div>
{/if}

{#if loading}
	<p class="text-muted">Loading outputs...</p>
{:else if error}
	<div class="form-error">{error}</div>
{:else}
	<!-- Output list -->
	<div class="panel">
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Type</th><th>State</th><th>Uptime</th><th>Errors</th><th></th></tr></thead>
				<tbody>
					{#each outputs as output}
						{@const isEditing = editingOutput === output.name}
						<tr>
							<td class="mono" style="font-weight: 600">
								{output.name}
								{#if output.name === 'primary'}
									<span class="primary-label">(primary)</span>
								{/if}
							</td>
							<td><span class="type-badge type-{output.type}">{output.type.toUpperCase()}</span></td>
							<td><span class="badge {stateColor(output.state)}">{output.state}</span></td>
							<td class="mono text-muted">{fmtUptime(output.uptime)}</td>
							<td>
								{#if output.errors > 0}
									<span class="badge badge-error">{output.errors}</span>
								{:else}
									<span class="text-muted">0</span>
								{/if}
							</td>
							<td class="row-actions">
								{#if output.state === 'PLAYING'}
									<button class="btn-surface btn-xs" onclick={() => handleStop(output.name)}
										disabled={actionLoading === output.name}>
										{actionLoading === output.name ? '...' : 'Stop'}
									</button>
								{:else}
									<button class="btn-primary btn-xs" onclick={() => handleStart(output.name)}
										disabled={actionLoading === output.name}>
										{actionLoading === output.name ? '...' : 'Start'}
									</button>
								{/if}
								{#if isEditing}
									<button class="btn-surface btn-xs" onclick={cancelEdit}>Cancel</button>
								{:else}
									<button class="btn-surface btn-xs" onclick={() => startEdit(output)}>Edit</button>
								{/if}
								{#if output.name === 'primary' && confirmingDelete === 'primary'}
									<button class="btn-danger btn-xs" onclick={() => handleDelete(output.name)}
										disabled={actionLoading === output.name}>Confirm?</button>
								{:else}
									<button class="btn-danger btn-xs" onclick={() => handleDelete(output.name)}
										disabled={actionLoading === output.name}>Del</button>
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
											<span>Video bitrate</span>
											<input type="number" bind:value={editVideoBitrate} placeholder="4000" />
										</label>
										<label class="form-label">
											<span>Audio bitrate</span>
											<input type="number" bind:value={editAudioBitrate} placeholder="128" />
										</label>
										<label class="form-label">
											<span>Keyframe interval</span>
											<input type="number" bind:value={editKeyframeInterval} placeholder="2" />
										</label>
										<label class="form-label">
											<span>Preset</span>
											<select bind:value={editPreset}>
												<option value="">Default</option>
												<option value="ultrafast">ultrafast</option>
												<option value="superfast">superfast</option>
												<option value="veryfast">veryfast</option>
												<option value="faster">faster</option>
												<option value="fast">fast</option>
												<option value="medium">medium</option>
												<option value="slow">slow</option>
											</select>
										</label>
									</div>
									<div class="edit-row" style="margin-top: 0.4rem">
										{#if output.type === 'rtmp'}
											<label class="form-label" style="flex: 1">
												<span>RTMP URL</span>
												<input type="text" bind:value={editRtmpUrl} placeholder="rtmp://live.twitch.tv/app/stream_key" />
											</label>
										{:else if output.type === 'file'}
											<label class="form-label" style="flex: 1">
												<span>File path</span>
												<input type="text" bind:value={editFilePath} placeholder="/recordings/output.mp4" />
											</label>
											<label class="form-label">
												<span>Max duration (s)</span>
												<input type="number" bind:value={editMaxDuration} placeholder="0" />
											</label>
										{:else if output.type === 'hls'}
											{#if output.name === 'primary'}
												<div class="form-label">
													<span>HLS directory</span>
													<span class="readonly-value">{editHlsDir || '(auto)'} <span class="text-muted hint">(tied to protocol path)</span></span>
												</div>
											{:else}
												<label class="form-label" style="flex: 1">
													<span>HLS directory</span>
													<input type="text" bind:value={editHlsDir} placeholder="Default: auto" />
												</label>
											{/if}
											<label class="form-label">
												<span>Segment duration</span>
												<input type="number" bind:value={editSegmentDuration} placeholder="6" />
											</label>
											<label class="form-label">
												<span>Playlist length</span>
												<input type="number" bind:value={editPlaylistLength} placeholder="5" />
											</label>
										{/if}

										<div class="edit-actions">
											<button class="btn-primary btn-xs" onclick={() => handleEditSave(output)}
												disabled={editLoading}>
												{editLoading ? '...' : 'Save'}
											</button>
										</div>
									</div>
									</div>
								</td>
							</tr>
						{/if}
						{#if output.last_error}
							<tr class="expanded-row">
								<td colspan="6">
									<div class="output-error-detail">
										<span class="text-muted" style="font-size: 0.7rem">Last error:</span>
										<span class="mono" style="font-size: 0.7rem; color: #ef4444">{output.last_error}</span>
									</div>
								</td>
							</tr>
						{/if}
					{/each}
					{#if outputs.length === 0}
						<tr><td colspan="6" class="text-muted">No outputs. Start the engine to create the primary HLS output.</td></tr>
					{/if}
				</tbody>
			</table>
		</div>
	</div>

	<!-- Add output -->
	<div class="panel">
		{#if showAdd}
			<h3>Add Output</h3>
			{#if createError}
				<div class="form-error">{createError}</div>
			{/if}
			<div class="form-grid">
				<label class="form-label">
					<span>Name</span>
					<input type="text" bind:value={addName} placeholder="e.g. twitch" />
				</label>
				<label class="form-label">
					<span>Type</span>
					<select bind:value={addType}>
						{#each getAllOutputTypes() as ot}
							<option value={ot.value}>{ot.label}{ot.plugin ? ` (${ot.plugin})` : ''}</option>
						{/each}
					</select>
				</label>
				<label class="form-label">
					<span>Video bitrate</span>
					<input type="number" bind:value={addVideoBitrate} placeholder="4000" />
				</label>
				<label class="form-label">
					<span>Audio bitrate</span>
					<input type="number" bind:value={addAudioBitrate} placeholder="128" />
				</label>
				<label class="form-label">
					<span>Keyframe interval</span>
					<input type="number" bind:value={addKeyframeInterval} placeholder="2" />
				</label>
				<label class="form-label">
					<span>Preset</span>
					<select bind:value={addPreset}>
						<option value="">Default</option>
						<option value="ultrafast">ultrafast</option>
						<option value="superfast">superfast</option>
						<option value="veryfast">veryfast</option>
						<option value="faster">faster</option>
						<option value="fast">fast</option>
						<option value="medium">medium</option>
						<option value="slow">slow</option>
					</select>
				</label>
			</div>

			{#if addType === 'rtmp'}
				<div class="form-grid" style="margin-top: 0.5rem">
					<label class="form-label" style="grid-column: 1 / -1">
						<span>RTMP URL</span>
						<input type="text" bind:value={addRtmpUrl} placeholder="rtmp://live.twitch.tv/app/stream_key" />
					</label>
				</div>
			{:else if addType === 'file'}
				<div class="form-grid" style="margin-top: 0.5rem">
					<label class="form-label" style="grid-column: 1 / -1">
						<span>File path</span>
						<input type="text" bind:value={addFilePath} placeholder="/recordings/output.mp4" />
					</label>
					<label class="form-label">
						<span>Format</span>
						<select bind:value={addFileFormat}>
							<option value="mp4">MP4</option>
							<option value="matroska">MKV</option>
						</select>
					</label>
					<label class="form-label">
						<span>Max duration (s)</span>
						<input type="number" bind:value={addMaxDuration} placeholder="0" />
					</label>
				</div>
			{:else if addType === 'hls'}
				<div class="form-grid" style="margin-top: 0.5rem">
					<label class="form-label" style="grid-column: 1 / -1">
						<span>HLS directory (optional)</span>
						<input type="text" bind:value={addHlsDir} placeholder="Default: auto" />
					</label>
					<label class="form-label">
						<span>Segment duration</span>
						<input type="number" bind:value={addSegmentDuration} placeholder="6" />
					</label>
					<label class="form-label">
						<span>Playlist length</span>
						<input type="number" bind:value={addPlaylistLength} placeholder="5" />
					</label>
				</div>
			{:else if !isCoreType(addType)}
				<div class="plugin-output-hint" style="margin-top: 0.5rem">
					<p class="text-muted">Plugin output &mdash; configure after creation.</p>
					{#if (pluginOutputTypes ?? []).find(t => t.name === addType)?.description}
						<p class="text-muted" style="font-size: 0.75rem">{(pluginOutputTypes ?? []).find(t => t.name === addType)?.description}</p>
					{/if}
				</div>
			{/if}

			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={handleCreate}
					disabled={creating || !addName.trim()}>
					{creating ? 'Creating...' : 'Create Output'}
				</button>
				<button class="btn-surface btn-sm" onclick={resetForm}>Cancel</button>
			</div>
		{:else}
			<button class="btn-surface btn-sm" onclick={() => showAdd = true}>Add Output</button>
		{/if}
	</div>
{/if}

<style>
	.output-error-detail {
		display: flex; flex-direction: column; gap: 0.2rem;
		padding: 0.5rem 0.75rem;
	}
	.type-hls { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.type-rtmp { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
	.type-file { background: rgba(251, 191, 36, 0.15); color: #fbbf24; }
	.type-null { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	:global(.badge-muted) { background: rgba(107, 114, 128, 0.15); color: #6b7280; }
	.primary-label {
		font-size: 0.65rem; font-weight: 400; color: #10b981;
		margin-left: 0.25rem;
	}
	.edit-panel { padding: 0.5rem 0.75rem; }
	.edit-row {
		display: flex; align-items: flex-end; gap: 0.5rem; flex-wrap: wrap;
	}
	.edit-row .form-label span { font-size: 0.7rem; }
	.edit-actions {
		display: flex; align-items: flex-end; padding-bottom: 0.1rem;
	}
	.readonly-value {
		font-size: 0.8rem; font-family: var(--font-mono, monospace);
		color: #a1a1aa; padding: 0.35rem 0;
	}
	.readonly-value .hint { font-size: 0.65rem; }
	.plugin-output-hint {
		padding: 0.75rem;
		border: 1px dashed #2a2a3a;
		border-radius: 4px;
		background: rgba(99, 102, 241, 0.05);
	}
	.plugin-output-hint p { margin: 0; }
</style>
