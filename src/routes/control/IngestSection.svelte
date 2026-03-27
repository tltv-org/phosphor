<script lang="ts">
	import { CathodeApiError, sortedLayers } from '$cathode';
	import type {
		BackendAdapter, EngineHealth, EngineChannelStatus,
		PlayoutMode, SystemVideoConfig, PlaylistSummary, MediaItem,
	} from '$cathode';

	interface Props {
		engineHealth: EngineHealth | null;
		adapter: BackendAdapter | null;
		playoutMode: PlayoutMode | null;
		onRefresh: () => void;
		onPlayoutModeChanged: (mode: PlayoutMode) => void;
	}

	let { engineHealth, adapter, playoutMode, onRefresh, onPlayoutModeChanged }: Props = $props();

	// ── Playout mode ──
	let editMode = $state<'loop' | 'schedule'>('loop');
	let editDayStart = $state('00:00:00');
	let modeSaving = $state(false);
	let modeError = $state('');

	// ── Loop source setup (shown when switching to loop) ──
	let loopSourceType = $state<'playlist' | 'file'>('playlist');
	let loopPlaylists = $state<PlaylistSummary[]>([]);
	let loopMediaFiles = $state<MediaItem[]>([]);
	let loopPlaylist = $state('');
	let loopFile = $state('');
	let loopLayer = $state('');
	let loopDataLoading = $state(false);

	// Track whether the user has touched the mode toggle
	let modeEdited = $state(false);

	// True when the user is actively switching TO loop from a different mode
	let switchingToLoop = $derived(editMode === 'loop' && playoutMode?.mode !== 'loop');

	async function fetchLoopSourceData() {
		if (!adapter) return;
		loopDataLoading = true;
		try {
			const [pl, md] = await Promise.allSettled([
				adapter.getPlaylists(),
				adapter.getMedia(),
			]);
			if (pl.status === 'fulfilled') {
				loopPlaylists = pl.value.playlists;
				if (!loopPlaylist && pl.value.playlists.length > 0) loopPlaylist = pl.value.playlists[0].name;
			}
			if (md.status === 'fulfilled') {
				loopMediaFiles = md.value.items;
				if (!loopFile && md.value.items.length > 0) loopFile = md.value.items[0].filename;
			}
		} catch {}
		finally { loopDataLoading = false; }
	}

	$effect(() => {
		if (playoutMode && !modeEdited) {
			editMode = playoutMode.mode;
			editDayStart = playoutMode.day_start;
		}
	});

	$effect(() => {
		if (switchingToLoop && adapter) fetchLoopSourceData();
	});

	// Pre-select active layer for loop target
	$effect(() => {
		if (engineHealth && !loopLayer) {
			loopLayer = engineHealth.active_channel || Object.keys(engineHealth.channels)[0] || '';
		}
	});

	// ── Engine start/stop/restart ──
	let restarting = $state(false);
	let starting = $state(false);
	let stopping = $state(false);
	let restartError = $state('');

	// ── Layer position (PIP) ──
	let pipLayerName = $state('');
	let pipX = $state(0);
	let pipY = $state(0);
	let pipW = $state(0);
	let pipH = $state(0);
	let pipLoading = $state(false);
	let pipError = $state('');

	// ── Collapsible sections (persisted across page navigation) ──
	function loadPanel(key: string, fallback: boolean): boolean {
		try { const v = sessionStorage.getItem(`playout_${key}`); return v !== null ? v === '1' : fallback; }
		catch { return fallback; }
	}
	function savePanel(key: string, val: boolean) { try { sessionStorage.setItem(`playout_${key}`, val ? '1' : '0'); } catch {} }

	let showEngine = $state(loadPanel('engine', true));
	let showMode = $state(loadPanel('mode', false));
	let showPip = $state(loadPanel('pip', false));
	let showFailover = $state(loadPanel('failover', false));

	$effect(() => { savePanel('engine', showEngine); });
	$effect(() => { savePanel('mode', showMode); });
	$effect(() => { savePanel('pip', showPip); });
	$effect(() => { savePanel('failover', showFailover); });

	// ── Layer visibility ──
	let layerError = $state('');

	async function saveMode() {
		if (!adapter) return;
		modeSaving = true;
		modeError = '';
		try {
			// When switching to loop, load the selected source first
			if (switchingToLoop && loopLayer) {
				if (loopSourceType === 'playlist' && loopPlaylist) {
					await adapter.loadPlaylist(loopPlaylist, { layer: loopLayer, loop: true });
				} else if (loopSourceType === 'file' && loopFile) {
					await adapter.loadLayerSource(loopLayer, { type: 'file_loop', path: loopFile });
				}
			}
			await adapter.setPlayoutMode(editMode, editDayStart !== playoutMode?.day_start ? editDayStart : undefined);
			const updated = await adapter.getPlayoutMode();
			modeEdited = false;
			onPlayoutModeChanged(updated);
			await onRefresh();
		} catch (e: unknown) {
			modeError = CathodeApiError.extractMessage(e, 'Failed to update playout mode');
		} finally { modeSaving = false; }
	}

	function getSourceFilename(source: string): string {
		if (!source) return '\u2014';
		return source.split('/').pop() || source;
	}

	function fmtDurationShort(s: number) {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}

	// ── Engine start/stop/restart ──
	async function handleStart() {
		if (!adapter) return;
		starting = true;
		restartError = '';
		try {
			await adapter.startEngine();
			setTimeout(onRefresh, 1000);
		} catch (e: unknown) {
			restartError = CathodeApiError.extractMessage(e, 'Start failed');
		} finally { starting = false; }
	}

	async function handleStop() {
		if (!adapter || !confirm('Stop the playout engine? The stream will go down.')) return;
		stopping = true;
		restartError = '';
		try {
			await adapter.stopEngine();
			setTimeout(onRefresh, 1000);
		} catch (e: unknown) {
			restartError = CathodeApiError.extractMessage(e, 'Stop failed');
		} finally { stopping = false; }
	}

	async function handleRestart() {
		if (!adapter || !confirm('Restart the playout engine? This will briefly interrupt the stream.')) return;
		restarting = true;
		restartError = '';
		try {
			await adapter.restartEngine();
			setTimeout(onRefresh, 1000);
		} catch (e: unknown) {
			restartError = CathodeApiError.extractMessage(e, 'Restart failed');
		} finally { restarting = false; }
	}

	let resyncing = $state(false);
	async function handleResyncSchedule() {
		if (!adapter) return;
		resyncing = true;
		restartError = '';
		try {
			await adapter.resyncSchedule();
			setTimeout(onRefresh, 500);
		} catch (e: unknown) {
			restartError = CathodeApiError.extractMessage(e, 'Resync failed');
		} finally { resyncing = false; }
	}

	async function toggleLayerVisibility(name: string, currentlyVisible: boolean) {
		if (!adapter) return;
		layerError = '';
		try {
			if (currentlyVisible) await adapter.hideLayer(name);
			else await adapter.showLayer(name);
			setTimeout(onRefresh, 300);
		} catch (e: unknown) {
			layerError = CathodeApiError.extractMessage(e, `Failed to ${currentlyVisible ? 'hide' : 'show'} layer ${name}`);
		}
	}

	// ── PIP position ──
	async function handleSetPosition() {
		if (!adapter || !pipLayerName) return;
		pipLoading = true;
		pipError = '';
		try {
			await adapter.setLayerPosition(pipLayerName, { x: pipX, y: pipY, width: pipW, height: pipH });
			setTimeout(onRefresh, 300);
		} catch (e: unknown) {
			pipError = CathodeApiError.extractMessage(e, 'Failed to set position');
		} finally { pipLoading = false; }
	}

	async function handleResetPosition(name: string) {
		if (!adapter) return;
		pipError = '';
		try {
			await adapter.resetLayerPosition(name);
			setTimeout(onRefresh, 300);
		} catch (e: unknown) {
			pipError = CathodeApiError.extractMessage(e, 'Failed to reset position');
		}
	}

	// ── Failover & Slate config ──
	let failoverConfig = $state<SystemVideoConfig | null>(null);
	let slateConfig = $state<SystemVideoConfig | null>(null);
	let foTitle = $state('');
	let foSubtitle = $state('');
	let foDuration = $state(60);
	let foPattern = $state('smpte');
	let foSaving = $state(false);
	let foRegenerating = $state(false);
	let foError = $state('');
	let foSuccess = $state('');
	let slTitle = $state('');
	let slSubtitle = $state('');
	let slDuration = $state(60);
	let slPattern = $state('smpte');
	let slSaving = $state(false);
	let slRegenerating = $state(false);
	let slError = $state('');
	let slSuccess = $state('');

	function applyFailoverConfig(c: SystemVideoConfig) {
		failoverConfig = c;
		foTitle = c.title;
		foSubtitle = c.subtitle;
		foDuration = c.duration;
		foPattern = c.pattern;
	}

	function applySlateConfig(c: SystemVideoConfig) {
		slateConfig = c;
		slTitle = c.title;
		slSubtitle = c.subtitle;
		slDuration = c.duration;
		slPattern = c.pattern;
	}

	async function loadFailoverSlateConfigs() {
		if (!adapter) return;
		adapter.getFailoverConfig().then(c => { applyFailoverConfig(c); }).catch(() => {});
		adapter.getSlateConfig().then(c => { applySlateConfig(c); }).catch(() => {});
	}

	async function saveFailoverConfig() {
		if (!adapter) return;
		foSaving = true;
		foError = '';
		foSuccess = '';
		try {
			await adapter.setFailoverConfig({ title: foTitle, subtitle: foSubtitle, duration: foDuration, pattern: foPattern });
			foSuccess = 'Failover config saved.';
			setTimeout(() => { foSuccess = ''; }, 3000);
			const c = await adapter.getFailoverConfig();
			applyFailoverConfig(c);
		} catch (e: unknown) {
			foError = CathodeApiError.extractMessage(e, 'Failed to save failover config');
		} finally { foSaving = false; }
	}

	async function regenerateFailover() {
		if (!adapter) return;
		foRegenerating = true;
		foError = '';
		foSuccess = '';
		try {
			await adapter.regenerateFailover();
			foSuccess = 'Failover clip regenerated.';
			setTimeout(() => { foSuccess = ''; }, 3000);
		} catch (e: unknown) {
			foError = CathodeApiError.extractMessage(e, 'Failed to regenerate failover');
		} finally { foRegenerating = false; }
	}

	async function saveSlateConfig() {
		if (!adapter) return;
		slSaving = true;
		slError = '';
		slSuccess = '';
		try {
			await adapter.setSlateConfig({ title: slTitle, subtitle: slSubtitle, duration: slDuration, pattern: slPattern });
			slSuccess = 'Slate config saved.';
			setTimeout(() => { slSuccess = ''; }, 3000);
			const c = await adapter.getSlateConfig();
			applySlateConfig(c);
		} catch (e: unknown) {
			slError = CathodeApiError.extractMessage(e, 'Failed to save slate config');
		} finally { slSaving = false; }
	}

	async function regenerateSlate() {
		if (!adapter) return;
		slRegenerating = true;
		slError = '';
		slSuccess = '';
		try {
			await adapter.regenerateSlate();
			slSuccess = 'Slate clip regenerated.';
			setTimeout(() => { slSuccess = ''; }, 3000);
		} catch (e: unknown) {
			slError = CathodeApiError.extractMessage(e, 'Failed to regenerate slate');
		} finally { slRegenerating = false; }
	}

	// ── Current playlist per layer ──
	let currentPlaylist = $state<Record<string, { entries: Array<{source: string; duration: number}>; current_index: number; loop: boolean; total: number } | null>>({});

	$effect(() => {
		if (adapter && engineHealth) {
			for (const name of Object.keys(engineHealth.channels)) {
				adapter.getLayerStatus(name).then(status => {
					const raw = status as unknown as Record<string, unknown>;
					if (raw.playlist) {
						currentPlaylist = { ...currentPlaylist, [name]: raw.playlist as { entries: Array<{source: string; duration: number}>; current_index: number; loop: boolean; total: number } };
					}
				}).catch(() => {});
			}
		}
	});

	// Populate PIP layer dropdown when engine health loads
	$effect(() => {
		if (engineHealth) {
			const names = Object.keys(engineHealth.channels);
			if (names.length > 0 && !pipLayerName) pipLayerName = names[0];
		}
	});

	// Load failover & slate configs on mount
	$effect(() => {
		if (adapter) loadFailoverSlateConfigs();
	});
</script>

<h2>Playout</h2>

<!-- Engine status + controls (always shown first) -->
{#if engineHealth}
	<div class="panel">
		<button class="panel-toggle" onclick={() => showEngine = !showEngine}>
			<h3>Engine</h3>
			<span class="toggle-arrow">{showEngine ? '\u2212' : '+'}</span>
		</button>
		{#if showEngine}
		<div class="engine-header-row">
			<div class="engine-header-right">
				<span class="badge {engineHealth.state === 'running' || engineHealth.state === 'playing' ? 'badge-active' : 'badge-error'}">{engineHealth.state}</span>
				{#if engineHealth.state === 'running' || engineHealth.state === 'playing' || engineHealth.state === 'PLAYING'}
					<button class="btn-surface btn-xs" onclick={handleStop} disabled={stopping}>
						{stopping ? '...' : 'Stop'}
					</button>
					<button class="btn-danger btn-xs" onclick={handleRestart} disabled={restarting}>
						{restarting ? '...' : 'Restart'}
					</button>
					{#if playoutMode?.mode === 'schedule'}
						<button class="btn-surface btn-xs" onclick={handleResyncSchedule} disabled={resyncing}
							title="Clear manual overrides, resume scheduled programming">
							{resyncing ? '...' : 'Return to Schedule'}
						</button>
					{/if}
				{:else}
					<button class="btn-primary btn-xs" onclick={handleStart} disabled={starting}>
						{starting ? '...' : 'Start'}
					</button>
				{/if}
			</div>
		</div>
			{#if restartError}
				<div class="form-error">{restartError}</div>
			{/if}

			<!-- Per-layer cards -->
			<div class="layers-grid" style="grid-template-columns: repeat({Math.min(Object.keys(engineHealth.channels).length, 4)}, 1fr)">
				{#each sortedLayers(engineHealth.channels) as [name, ch]}
					{@const isOnAir = name === engineHealth.active_channel}
					{@const layer = ch as EngineChannelStatus}
					<div class="layer-card" class:layer-active={isOnAir} class:layer-on-air={isOnAir}>
						<div class="layer-header-row">
							<span class="layer-name mono">{name}</span>
							{#if isOnAir}
								<span class="badge badge-live"><span class="dot"></span> On Air</span>
							{/if}
						</div>
						{#if layer.role}
							<div class="layer-role text-muted">{layer.role}</div>
						{/if}
						<div class="layer-source mono">{layer.source_type || 'none'}</div>
						{#if layer.alpha !== undefined && layer.alpha !== 1.0}
							<div class="layer-meta text-muted">Alpha: {layer.alpha.toFixed(2)}</div>
						{/if}
						{#if layer.volume !== undefined && layer.volume !== 1.0}
							<div class="layer-meta text-muted">Vol: {layer.volume.toFixed(2)}</div>
						{/if}
						{#if layer.playlist_name}
							<div class="layer-meta mono" style="color: #818cf8">Playing: {layer.playlist_name}</div>
						{/if}
						{#if layer.now_playing}
							<div class="layer-np truncate mono">{getSourceFilename(layer.now_playing.source)}</div>
							{#if layer.now_playing.duration > 0}
								<div class="progress-row">
									<div class="progress-bar"><div class="progress-fill" style="width: {Math.min((layer.now_playing.played / layer.now_playing.duration) * 100, 100)}%"></div></div>
									<span class="progress-time">{fmtDurationShort(layer.now_playing.played)} / {fmtDurationShort(layer.now_playing.duration)}</span>
								</div>
							{/if}
						{/if}
						{#if currentPlaylist[name]}
							{@const pl = currentPlaylist[name]}
							<div class="layer-playlist-info">
								<span class="text-muted" style="font-size: 0.6rem">
									Playlist: {pl.total} files {pl.loop ? '(loop)' : '(once)'} — #{pl.current_index + 1}
								</span>
							</div>
						{/if}
						<div class="layer-action">
							{#if isOnAir}
								<button class="btn-surface btn-xs layer-btn" onclick={() => toggleLayerVisibility(name, true)}>Cut</button>
							{:else}
								<button class="btn-primary btn-xs layer-btn" onclick={() => toggleLayerVisibility(name, false)}>Take</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>
			{#if layerError}
				<div class="form-error">{layerError}</div>
			{/if}
		{/if}
	</div>
{/if}

<!-- Playout Mode (collapsed) -->
<div class="panel">
	<button class="panel-toggle" onclick={() => showMode = !showMode}>
		<h3>Playout Mode</h3>
		<span class="toggle-arrow">{showMode ? '\u2212' : '+'}</span>
	</button>
	{#if showMode}
		<p class="panel-desc" style="margin-top: 0.75rem">Controls whether the server loops all media or follows day-based schedules.</p>
		<div class="mode-toggle">
			<button class="toggle-btn" class:active={editMode === 'loop'} onclick={() => { editMode = 'loop'; modeEdited = true; }}>Loop</button>
			<button class="toggle-btn" class:active={editMode === 'schedule'} onclick={() => { editMode = 'schedule'; modeEdited = true; }}>Schedule</button>
		</div>
		{#if editMode === 'schedule'}
			<div class="form-row" style="margin-top: 0.75rem">
				<label class="form-label">
					<span>Day start</span>
					<input type="time" step="1" bind:value={editDayStart} />
				</label>
			</div>
		{/if}
		{#if switchingToLoop}
			<div class="loop-setup" style="margin-top: 0.75rem">
				<p class="panel-desc" style="margin-bottom: 0.5rem">Set up what to loop:</p>
				<div class="form-row">
					<label class="form-label">
						<span>Source</span>
						<select bind:value={loopSourceType}>
							<option value="playlist">Playlist</option>
							<option value="file">Media file</option>
						</select>
					</label>
					{#if loopSourceType === 'playlist'}
						<label class="form-label" style="flex: 1">
							<span>Playlist</span>
							{#if loopDataLoading}
								<span class="text-muted" style="font-size: 0.75rem">Loading...</span>
							{:else if loopPlaylists.length > 0}
								<select bind:value={loopPlaylist}>
									{#each loopPlaylists as pl}
										<option value={pl.name}>{pl.name} ({pl.entry_count} files)</option>
									{/each}
								</select>
							{:else}
								<span class="text-muted" style="font-size: 0.75rem">No playlists. Create one in Playlists first.</span>
							{/if}
						</label>
					{:else}
						<label class="form-label" style="flex: 1">
							<span>File</span>
							{#if loopDataLoading}
								<span class="text-muted" style="font-size: 0.75rem">Loading...</span>
							{:else if loopMediaFiles.length > 0}
								<select bind:value={loopFile}>
									{#each loopMediaFiles as f}
										<option value={f.filename}>{f.filename}</option>
									{/each}
								</select>
							{:else}
								<span class="text-muted" style="font-size: 0.75rem">No media files. Upload in Library first.</span>
							{/if}
						</label>
					{/if}
					{#if engineHealth && Object.keys(engineHealth.channels).length > 0}
						<label class="form-label">
							<span>Layer</span>
							<select bind:value={loopLayer}>
								{#each Object.keys(engineHealth.channels) as name}
									<option value={name}>{name}</option>
								{/each}
							</select>
						</label>
					{/if}
				</div>
			</div>
		{/if}
		{#if editMode !== playoutMode?.mode || (editMode === 'schedule' && editDayStart !== playoutMode?.day_start)}
			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={saveMode}
					disabled={modeSaving
						|| (switchingToLoop && loopSourceType === 'playlist' && !loopPlaylist)
						|| (switchingToLoop && loopSourceType === 'file' && !loopFile)}>
					{modeSaving ? 'Applying...' : switchingToLoop ? 'Load Source & Switch to Loop' : 'Apply'}
				</button>
			</div>
		{/if}
		{#if modeError}
			<div class="form-error">{modeError}</div>
		{/if}
	{/if}
</div>

<!-- PIP positioning -->
{#if engineHealth && Object.keys(engineHealth.channels).length > 0}
	<div class="panel">
		<button class="panel-toggle" onclick={() => showPip = !showPip}>
			<h3>PIP Position</h3>
			<span class="toggle-arrow">{showPip ? '\u2212' : '+'}</span>
		</button>
		{#if showPip}
			<p class="panel-desc" style="margin-top: 0.75rem">Set position and size for picture-in-picture. Set width/height to 0 to reset to full-screen.</p>
			<div class="form-row">
				<label class="form-label">
					<span>Layer</span>
					<select bind:value={pipLayerName}>
						{#each Object.keys(engineHealth.channels) as name}
							<option value={name}>{name}</option>
						{/each}
					</select>
				</label>
				<label class="form-label">
					<span>X</span>
					<input type="number" bind:value={pipX} min="0" style="width: 80px" />
				</label>
				<label class="form-label">
					<span>Y</span>
					<input type="number" bind:value={pipY} min="0" style="width: 80px" />
				</label>
				<label class="form-label">
					<span>Width</span>
					<input type="number" bind:value={pipW} min="0" style="width: 80px" />
				</label>
				<label class="form-label">
					<span>Height</span>
					<input type="number" bind:value={pipH} min="0" style="width: 80px" />
				</label>
			</div>
			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={handleSetPosition}
					disabled={pipLoading || !pipLayerName}>
					{pipLoading ? 'Applying...' : 'Set Position'}
				</button>
			</div>
			{#if pipError}
				<div class="form-error">{pipError}</div>
			{/if}
		{/if}
	</div>
{/if}

<!-- Failover & Slate -->
<div class="panel">
	<button class="panel-toggle" onclick={() => showFailover = !showFailover}>
		<h3>Failover &amp; Slate</h3>
		<span class="toggle-arrow">{showFailover ? '\u2212' : '+'}</span>
	</button>
	{#if showFailover}
		<p class="panel-desc" style="margin-top: 0.75rem">Configure the failover and slate clips generated by cathode. Changes require regeneration to take effect.</p>

		<!-- Failover config -->
		<div class="fo-slate-section">
			<h4 class="fo-slate-title">Failover</h4>
			{#if foError}<div class="form-error">{foError}</div>{/if}
			{#if foSuccess}<div class="settings-success">{foSuccess}</div>{/if}
			<div class="form-row">
				<label class="form-label" style="flex: 1">
					<span>Title</span>
					<input type="text" bind:value={foTitle} placeholder="Channel name" />
				</label>
				<label class="form-label" style="flex: 1">
					<span>Subtitle</span>
					<input type="text" bind:value={foSubtitle} placeholder="" />
				</label>
			</div>
			<div class="form-row">
				<label class="form-label">
					<span>Duration</span>
					<input type="number" bind:value={foDuration} min="10" max="3600" style="width: 100px" />
				</label>
				<label class="form-label">
					<span>Pattern</span>
					<select bind:value={foPattern}>
						<option value="smpte">SMPTE</option>
						<option value="black">Black</option>
						<option value="white">White</option>
						<option value="snow">Snow</option>
						<option value="red">Red</option>
						<option value="green">Green</option>
						<option value="blue">Blue</option>
					</select>
				</label>
			</div>
			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={saveFailoverConfig} disabled={foSaving}>
					{foSaving ? 'Saving...' : 'Save'}
				</button>
				<button class="btn-surface btn-sm" onclick={regenerateFailover} disabled={foRegenerating}>
					{foRegenerating ? 'Regenerating...' : 'Regenerate'}
				</button>
			</div>
		</div>

		<!-- Slate config -->
		<div class="fo-slate-section">
			<h4 class="fo-slate-title">Slate</h4>
			{#if slError}<div class="form-error">{slError}</div>{/if}
			{#if slSuccess}<div class="settings-success">{slSuccess}</div>{/if}
			<div class="form-row">
				<label class="form-label" style="flex: 1">
					<span>Title</span>
					<input type="text" bind:value={slTitle} placeholder="Channel name" />
				</label>
				<label class="form-label" style="flex: 1">
					<span>Subtitle</span>
					<input type="text" bind:value={slSubtitle} placeholder="" />
				</label>
			</div>
			<div class="form-row">
				<label class="form-label">
					<span>Duration</span>
					<input type="number" bind:value={slDuration} min="10" max="3600" style="width: 100px" />
				</label>
				<label class="form-label">
					<span>Pattern</span>
					<select bind:value={slPattern}>
						<option value="smpte">SMPTE</option>
						<option value="black">Black</option>
						<option value="white">White</option>
						<option value="snow">Snow</option>
						<option value="red">Red</option>
						<option value="green">Green</option>
						<option value="blue">Blue</option>
					</select>
				</label>
			</div>
			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={saveSlateConfig} disabled={slSaving}>
					{slSaving ? 'Saving...' : 'Save'}
				</button>
				<button class="btn-surface btn-sm" onclick={regenerateSlate} disabled={slRegenerating}>
					{slRegenerating ? 'Regenerating...' : 'Regenerate'}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.engine-header-row {
		display: flex; justify-content: flex-end; align-items: center;
		margin-top: 0.75rem; margin-bottom: 0.75rem;
	}
	.engine-header-right { display: flex; align-items: center; gap: 0.5rem; }

	.layers-grid {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.5rem;
	}
	.layer-card {
		background: #0c0c18; border: 1px solid #1a1a2a; border-radius: 6px;
		padding: 0.5rem 0.6rem;
		display: flex; flex-direction: column; gap: 0.3rem;
		min-width: 0;
	}
	.layer-card.layer-active { border-color: #818cf8; }
	.layer-card.layer-on-air { border-color: #818cf8; }

	.layer-header-row {
		display: flex; justify-content: space-between; align-items: center;
	}
	.layer-name { font-weight: 700; font-size: 0.75rem; }
	.layer-role { font-size: 0.6rem; font-style: italic; }
	.layer-source { font-size: 0.65rem; color: #5a5a70; }
	.layer-meta { font-size: 0.6rem; }
	.layer-np {
		font-size: 0.65rem; color: #8888a0;
	}
	.layer-playlist-info { margin-top: 0.2rem; }
	.layer-action { margin-top: auto; padding-top: 0.3rem; }
	.layer-btn { width: 100%; }

	.panel-toggle {
		display: flex; justify-content: space-between; align-items: center;
		width: 100%; background: none; border: none; color: inherit;
		cursor: pointer; padding: 0; margin-bottom: 0;
	}
	.panel-toggle h3 { margin-bottom: 0; }
	.toggle-arrow { font-size: 1.2rem; color: #5a5a70; }

	/* Failover & Slate */
	.fo-slate-section {
		margin-top: 0.75rem; padding-top: 0.75rem;
		border-top: 1px solid #1a1a2a;
	}
	.fo-slate-title {
		font-size: 0.85rem; margin-bottom: 0.5rem; color: #8888a0;
	}
</style>
