<script lang="ts">
	import { sortedLayers } from '$cathode';
	import type {
		NowPlaying, SystemStats, MediaList, PeerList, RelayList,
		PlayoutMode, EngineHealth, ChannelMetadata, EngineChannelStatus,
		OutputHealth,
	} from '$cathode';

	interface Props {
		nowPlaying: NowPlaying | null;
		systemStats: SystemStats | null;
		media: MediaList | null;
		peers: PeerList | null;
		relays: RelayList | null;
		playoutMode: PlayoutMode | null;
		engineHealth: EngineHealth | null;
		channelMetadata: ChannelMetadata | null;
		channels: Array<{ id: string; name: string }>;
		outputs: OutputHealth[];
		activeLayerStatus: Record<string, unknown> | null;
		skipLoading: boolean;
		backLoading: boolean;
		onSkip: () => void;
		onBack: () => void;
	}

	let { nowPlaying, systemStats, media, peers, relays, playoutMode,
		engineHealth, channelMetadata, channels, outputs = [],
		activeLayerStatus,
		skipLoading, backLoading, onSkip, onBack }: Props = $props();

	function fmtPercent(n: number | undefined) { return n != null ? n.toFixed(1) + '%' : '\u2014'; }
	function fmtDuration(s: number) {
		const h = Math.floor(s / 3600);
		const m = Math.floor((s % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}
	function fmtDurationShort(s: number) {
		const m = Math.floor(s / 60);
		const sec = Math.floor(s % 60);
		return `${m}:${sec.toString().padStart(2, '0')}`;
	}
	function fmtBytes(gb: number) {
		if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
		return `${gb.toFixed(1)} GB`;
	}

	function getEngineStateBadge(state: string): string {
		if (state === 'running' || state === 'playing') return 'badge-active';
		if (state === 'error' || state === 'stopped') return 'badge-error';
		return 'badge-playlist';
	}

	function getSourceFilename(source: string): string {
		if (!source) return '\u2014';
		return source.split('/').pop() || source;
	}

	function getRoleBadgeClass(role: string): string {
		switch (role) {
			case 'safety': return 'role-safety';
			case 'override': return 'role-override';
			case 'overlay': return 'role-overlay';
			default: return 'role-content';
		}
	}

	function getOutputStateBadge(state: string): string {
		const s = state.toUpperCase();
		return s === 'PLAYING' ? 'badge-active' : s === 'PAUSED' || s === 'NULL' ? 'badge-playlist' : 'badge-error';
	}

</script>

<h2>Overview</h2>

<!-- 1. Station identity -->
{#if channelMetadata}
	<div class="station-header">
		<div class="station-name">{channelMetadata.display_name || 'Untitled Station'}</div>
		<div class="station-meta">
			{#if channelMetadata.description}
				<span>{channelMetadata.description}</span>
			{/if}
			<span class="station-badges">
				<span class="badge" class:badge-active={channelMetadata.status === 'active'}
					class:badge-error={channelMetadata.status === 'retired'}>
					{channelMetadata.status}
				</span>
				<span class="badge badge-playlist">{channelMetadata.access}</span>
			{#if channelMetadata.language}
				<span class="badge badge-playlist">{channelMetadata.language.toUpperCase()}</span>
			{/if}
			</span>
		</div>
	</div>
{/if}

<!-- 2. Engine + Now Playing row -->
<div class="overview-top">
	<!-- Engine status -->
	<div class="card overview-engine">
		<div class="card-title">Engine</div>
		{#if engineHealth}
			<div class="engine-header">
				<span class="badge {getEngineStateBadge(engineHealth.state)}">{engineHealth.state}</span>
				<span class="text-muted" style="font-size: 0.75rem">Active: <span class="mono">{engineHealth.active_channel}</span></span>
			</div>
			{#if playoutMode}
				<div class="stat-row" style="margin-top: 0.5rem">
					<span>Mode</span>
					<span>
						{#if playoutMode.mode === 'loop'}
							<span class="badge badge-loop">Loop</span>
						{:else}
							<span class="badge badge-playlist">Schedule</span>
							<span class="text-muted" style="font-size: 0.7rem; margin-left: 0.25rem">from {playoutMode.day_start}</span>
						{/if}
					</span>
				</div>
			{/if}
		{:else}
			<div class="card-value text-muted">&mdash;</div>
		{/if}
	</div>

	<!-- Now Playing -->
	<div class="card overview-now-playing">
		<div class="card-title">Now Playing</div>
		{#if nowPlaying}
			<div class="now-playing-source truncate">
				{getSourceFilename(nowPlaying.source)}
			</div>
			{#if nowPlaying.duration > 0}
				<div class="progress-row">
					<div class="progress-bar"><div class="progress-fill" style="width: {Math.min((nowPlaying.played / nowPlaying.duration) * 100, 100)}%"></div></div>
					<span class="progress-time">{fmtDurationShort(nowPlaying.played)} / {fmtDurationShort(nowPlaying.duration)}</span>
				</div>
			{/if}
			<div class="now-playing-controls">
				<div class="card-badges">
					<span class="badge badge-playlist">Playlist</span>
					{#if nowPlaying.index > 0}
						<span class="text-muted" style="font-size: 0.7rem">#{nowPlaying.index}</span>
					{/if}
				</div>
				<div class="card-actions" style="margin-top: 0">
					<button class="btn-surface btn-xs" onclick={onBack} disabled={backLoading}>
						{backLoading ? '...' : 'Back'}
					</button>
					<button class="btn-surface btn-xs" onclick={onSkip} disabled={skipLoading}>
						{skipLoading ? '...' : 'Skip'}
					</button>
				</div>
			</div>
			{#if activeLayerStatus?.playlist}
				{@const pl = activeLayerStatus.playlist as { entries: Array<{source: string; duration: number}>; total: number; loop: boolean; current_index: number }}
				<div class="now-playing-playlist">
					<span class="text-muted" style="font-size: 0.75rem">
						Playlist: {pl.total} files {pl.loop ? '(looping)' : '(once)'} — playing #{pl.current_index + 1}
					</span>
				</div>
			{/if}
		{:else}
			<div class="card-value text-muted">&mdash;</div>
		{/if}
	</div>
</div>

<!-- 3. Inputs summary -->
{#if engineHealth && Object.keys(engineHealth.channels).length > 0}
	<div class="panel" style="margin-top: 1rem">
		<h3>Inputs</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Layer</th><th>Role</th><th>Source</th><th>Status</th></tr></thead>
				<tbody>
					{#each sortedLayers(engineHealth.channels) as [name, ch]}
						{@const layer = ch as EngineChannelStatus}
						<tr>
							<td class="mono">{name}</td>
							<td>
								{#if layer.role}
									<span class="badge {getRoleBadgeClass(layer.role)}">{layer.role}</span>
								{:else}
									<span class="text-muted">&mdash;</span>
								{/if}
							</td>
							<td class="mono">
								{#if layer.role === 'safety' && !layer.visible}
									Standby
								{:else}
									{layer.source_type || 'none'}
								{/if}
							</td>
							<td class="mono truncate" style="max-width: 280px">{layer.now_playing ? getSourceFilename(layer.now_playing.source) : '\u2014'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<!-- 4. Outputs summary -->
{#if outputs.length > 0}
	<div class="panel" style="margin-top: 1rem">
		<h3>Outputs</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Type</th><th>State</th><th>Errors</th></tr></thead>
				<tbody>
					{#each outputs as out}
						<tr>
							<td class="mono">{out.name}</td>
							<td><span class="badge badge-playlist">{out.type}</span></td>
							<td><span class="badge {getOutputStateBadge(out.state)}">{out.state}</span></td>
							<td>
								{#if out.errors > 0}
									<span class="error-count">{out.errors}</span>
								{:else}
									0
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<!-- 5. Stats row -->
<div class="card-grid" style="margin-top: 1rem; grid-template-columns: repeat(4, 1fr)">
	<!-- System -->
	<div class="card">
		<div class="card-title">System</div>
		{#if systemStats}
			<div class="stat-row"><span>CPU load</span><span>{systemStats.cpu.load_1m.toFixed(2)}</span></div>
			<div class="stat-row"><span>Memory</span><span>{fmtPercent(systemStats.memory.percent)}</span></div>
			<div class="stat-row">
				<span>Disk</span>
				<span>{fmtPercent(systemStats.disk.percent)}
					<span class="text-muted" style="font-size: 0.65rem; margin-left: 0.25rem">
						{fmtBytes(systemStats.disk.used_gb)} / {fmtBytes(systemStats.disk.total_gb)}
					</span>
				</span>
			</div>
		{:else}
			<div class="card-value text-muted">&mdash;</div>
		{/if}
	</div>

	<!-- Media Library -->
	<div class="card">
		<div class="card-title">Media Library</div>
		{#if media}
			<div class="card-value">{media.count} files</div>
			<div class="card-detail">{fmtDuration(media.total_duration)} total</div>
		{:else}
			<div class="card-value text-muted">&mdash;</div>
		{/if}
	</div>

	<!-- Federation -->
	<div class="card">
		<div class="card-title">Federation</div>
		<div class="stat-row"><span>Peers</span><span>{peers?.count ?? '\u2014'}</span></div>
		<div class="stat-row"><span>Relays</span><span>{relays?.count ?? '\u2014'}</span></div>
	</div>

	<!-- Channels -->
	<div class="card">
		<div class="card-title">Channels</div>
		{#if channels.length > 0}
			<div class="card-value">{channels.length}</div>
			<div class="card-detail">{channelMetadata?.display_name || 'Station'}</div>
		{:else}
			<div class="card-value">0</div>
			<div class="card-detail">No channels</div>
		{/if}
	</div>
</div>

<!-- 6. Station Channels table -->
{#if channels.length > 0}
	<div class="panel" style="margin-top: 1rem">
		<h3>Station Channels</h3>
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Channel ID</th></tr></thead>
				<tbody>
					{#each channels as ch}
						<tr>
							<td>{ch.name || '\u2014'}</td>
							<td class="mono" style="font-size: 0.7rem">{ch.id}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	</div>
{/if}

<style>
	.station-header {
		margin-bottom: 1rem; padding-bottom: 0.75rem;
		border-bottom: 1px solid #1a1a2a;
	}
	.station-name { font-size: 1.3rem; font-weight: 700; margin-bottom: 0.25rem; }
	.station-meta {
		display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap;
		font-size: 0.8rem; color: #8888a0;
	}
	.station-badges { display: flex; align-items: center; gap: 0.35rem; }

	.overview-top {
		display: grid; grid-template-columns: 1fr 1.5fr; gap: 1rem;
	}
	.overview-engine, .overview-now-playing { min-height: 100px; }
	.engine-header {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
	}

	.now-playing-source {
		font-size: 1.1rem; font-weight: 600; font-family: monospace;
		margin-bottom: 0.25rem;
	}
	.now-playing-controls {
		display: flex; justify-content: space-between; align-items: center;
		margin-top: 0.5rem;
	}
	.now-playing-playlist {
		margin-top: 0.4rem;
		padding-top: 0.4rem;
		border-top: 1px solid #1a1a2a;
	}

	.error-count { color: #f87171; font-weight: 600; }

	/* Role badge colors */
	.role-safety { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	.role-content { background: rgba(107, 114, 128, 0.15); color: #a1a1aa; }
	.role-override { background: rgba(239, 68, 68, 0.15); color: #f87171; }
	.role-overlay { background: rgba(99, 102, 241, 0.15); color: #818cf8; }

	@media (max-width: 768px) {
		.overview-top { grid-template-columns: 1fr; }
	}
</style>
