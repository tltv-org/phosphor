<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { backendStore } from '$stores/backend.svelte';
	import { themeStore } from '$stores/theme.svelte';
	import { THEME_TOKENS } from '$themes';
	import type {
		SystemStatus, NowPlaying, SystemStats, MediaList,
		MediaMetadata,
		ProgramList,
		PeerList, RelayList,
		EngineHealth, PlayoutMode, ChannelMetadata,
		ChannelSummary, CreateChannelRequest,
		OutputHealth,
		BlockTypesResponse,
		RegistrySourceType,
		RegistryOutputType,
		PlaylistTool,
	} from '$cathode';

	import OverviewSection from './OverviewSection.svelte';
	import PlaylistSection from './PlaylistSection.svelte';
	import ProgramSection from './ProgramSection.svelte';
	import IngestSection from './IngestSection.svelte';
	import InputsSection from './InputsSection.svelte';
	import OutputsSection from './OutputsSection.svelte';
	import PeersSection from './PeersSection.svelte';
	import RelaysSection from './RelaysSection.svelte';
	import TokensSection from './TokensSection.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import PluginsSection from './PluginsSection.svelte';
	import PluginPage from './PluginPage.svelte';
	import LogsSection from './LogsSection.svelte';

	// ── Connection form ──
	let connectUrl = $state('');
	let connectKey = $state('');
	let connecting = $state(false);

	// ── Dashboard data ──
	let status = $state<SystemStatus | null>(null);
	let nowPlaying = $state<NowPlaying | null>(null);
	let systemStats = $state<SystemStats | null>(null);
	let media = $state<MediaList | null>(null);
	let programs = $state<ProgramList | null>(null);
	let peers = $state<PeerList | null>(null);
	let relays = $state<RelayList | null>(null);
	let engineHealth = $state<EngineHealth | null>(null);
	let playoutMode = $state<PlayoutMode | null>(null);
	let channelMetadata = $state<ChannelMetadata | null>(null);
	let activeLayerStatus = $state<Record<string, unknown> | null>(null);
	let outputs = $state<OutputHealth[]>([]);

	// ── Channel editing ──
	let editChannel = $state<Partial<ChannelMetadata>>({});
	let channelSaving = $state(false);
	let channelError = $state('');
	let channelSuccess = $state('');

	// ── Channel discovery ──
	let channels = $state<Array<{ id: string; name: string }>>([]);

	// ── Managed channels (multi-channel CRUD) ──
	let managedChannels = $state<ChannelSummary[]>([]);
	let showCreateChannel = $state(false);
	let creatingChannel = $state(false);
	let newChannel = $state<CreateChannelRequest>({ id: '', display_name: '' });
	let createChannelError = $state('');
	let editingManagedChannel = $state<string | null>(null);
	let managedChannelEdit = $state<Partial<CreateChannelRequest>>({});
	let channelEncoding = $state<Partial<import('$cathode').EncodingSettings>>({});
	let channelEncodingLoading = $state(false);

	const ENCODING_PRESETS: Array<{ label: string; width: number; height: number; fps: number; bitrate: string; audio_bitrate: string; preset: string }> = [
		{ label: '1080p30', width: 1920, height: 1080, fps: 30, bitrate: '4000k', audio_bitrate: '128k', preset: 'medium' },
		{ label: '1080p60', width: 1920, height: 1080, fps: 60, bitrate: '6000k', audio_bitrate: '192k', preset: 'fast' },
		{ label: '720p30', width: 1280, height: 720, fps: 30, bitrate: '2500k', audio_bitrate: '128k', preset: 'medium' },
		{ label: '720p60', width: 1280, height: 720, fps: 60, bitrate: '4000k', audio_bitrate: '128k', preset: 'fast' },
		{ label: '480p30', width: 854, height: 480, fps: 30, bitrate: '1500k', audio_bitrate: '96k', preset: 'medium' },
	];

	function applyEncodingPreset(preset: typeof ENCODING_PRESETS[0]) {
		channelEncoding = {
			...channelEncoding,
			width: preset.width,
			height: preset.height,
			fps: preset.fps,
			bitrate: preset.bitrate,
			audio_bitrate: preset.audio_bitrate,
			preset: preset.preset,
		};
	}
	let managedChannelError = $state('');
	let managedChannelSuccess = $state('');

	// ── Loaded plugins (for sidebar) ──
	let loadedPlugins = $state<import('$cathode').PluginInfo[]>([]);

	// ── Plugin registry data (for dynamic dropdowns) ──
	let pluginSourceTypes = $state<RegistrySourceType[]>([]);
	let pluginOutputTypes = $state<RegistryOutputType[]>([]);
	let blockTypes = $state<BlockTypesResponse | null>(null);
	let playlistTools = $state<PlaylistTool[]>([]);
	let layerNames = $state<string[]>([]);

	// ── Channel selector (for per-channel scoping) ──
	let selectedChannel = $state<string | undefined>(undefined);

	function initChannelSelector() {
		try {
			const saved = sessionStorage.getItem('control_selected_channel');
			if (saved) selectedChannel = saved;
		} catch {}
	}

	function selectChannel(id: string | undefined) {
		selectedChannel = id;
		try {
			if (id) sessionStorage.setItem('control_selected_channel', id);
			else sessionStorage.removeItem('control_selected_channel');
		} catch {}
	}

	// ── Connection health ──
	let connectionLost = $state(false);
	let connectionLostCount = $state(0);

	// ── Active section ──
	let section = $state<string>('overview');

	// ── Overview actions ──
	let skipLoading = $state(false);
	let backLoading = $state(false);

	// ── Settings ref ──
	let settingsRef = $state<SettingsSection>();

	// ── Media upload / delete / metadata ──
	let fileInput = $state<HTMLInputElement>();
	let uploading = $state(false);
	let uploadProgress = $state('');
	let uploadQueue = $state(0);
	let uploadDone = $state(0);
	let uploadError = $state('');
	let uploadSuccess = $state('');
	let deletingMedia = $state<string | null>(null);
	let deleteMediaError = $state('');
	let selectedFile = $state<string | null>(null);
	let fileMetadata = $state<MediaMetadata | null>(null);
	let metadataLoading = $state(false);
	let mediaFilter = $state('');
	let selectedUploadFolder = $state('');

	function getMediaFolders(): string[] {
		return getGroupedLibrary().filter(g => g.folder).map(g => g.folder);
	}

	async function handleUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !backendStore.adapter) return;
		const files = Array.from(input.files);
		uploading = true;
		uploadError = '';
		uploadSuccess = '';
		uploadQueue = files.length;
		uploadDone = 0;
		const results: string[] = [];
		const errors: string[] = [];
		for (const file of files) {
			uploadProgress = `${file.name} (${uploadDone + 1}/${uploadQueue})`;
			try {
				const result = await backendStore.adapter!.uploadMedia(file, selectedUploadFolder || undefined);
				results.push(result.filename);
			} catch (err: unknown) {
				const e = err as { body?: { detail?: string }; message?: string };
				errors.push(`${file.name}: ${e?.body?.detail || e?.message || 'failed'}`);
			}
			uploadDone++;
		}
		if (results.length > 0) {
			uploadSuccess = results.length === 1
				? `Uploaded ${results[0]}`
				: `Uploaded ${results.length} files`;
			setTimeout(() => { uploadSuccess = ''; }, 5000);
		}
		if (errors.length > 0) uploadError = errors.join('; ');
		uploading = false;
		uploadProgress = '';
		uploadQueue = 0;
		uploadDone = 0;
		input.value = '';
		await refreshAll();
	}

	async function createFolder() {
		const name = prompt('Folder name:');
		if (!name?.trim() || !backendStore.adapter) return;
		try {
			await backendStore.adapter.createMediaFolder(name.trim());
			refreshAll();
		} catch (e: unknown) {
			const err = e as { body?: { detail?: string }; message?: string };
			alert(err?.body?.detail || err?.message || 'Failed to create folder');
		}
	}

	function getFilteredLibrary() {
		if (!media) return [];
		if (!mediaFilter.trim()) return media.items;
		const q = mediaFilter.toLowerCase();
		return media.items.filter(i => i.filename.toLowerCase().includes(q));
	}

	let collapsedFolders = $state<Set<string>>(new Set());

	function toggleFolder(folder: string) {
		const next = new Set(collapsedFolders);
		if (next.has(folder)) next.delete(folder); else next.add(folder);
		collapsedFolders = next;
	}

	function getGroupedLibrary(): Array<{ folder: string; items: Array<{ filename: string; duration: number; basename: string; ext: string }> }> {
		const filtered = getFilteredLibrary();
		const groups = new Map<string, Array<{ filename: string; duration: number; basename: string; ext: string }>>();
		for (const item of filtered) {
			const lastSlash = item.filename.lastIndexOf('/');
			const folder = lastSlash >= 0 ? item.filename.slice(0, lastSlash) : '';
			const basename = lastSlash >= 0 ? item.filename.slice(lastSlash + 1) : item.filename;
			const dotIdx = basename.lastIndexOf('.');
			const ext = dotIdx >= 0 ? basename.slice(dotIdx + 1).toLowerCase() : '';
			if (!groups.has(folder)) groups.set(folder, []);
			groups.get(folder)!.push({ filename: item.filename, duration: item.duration, basename, ext });
		}
		// Sort folders: root first, then alphabetically
		const entries = [...groups.entries()].sort((a, b) => {
			if (a[0] === '' && b[0] !== '') return -1;
			if (a[0] !== '' && b[0] === '') return 1;
			return a[0].localeCompare(b[0]);
		});
		return entries.map(([folder, items]) => ({ folder, items }));
	}

	async function handleDeleteMedia(filename: string) {
		if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
		if (!backendStore.adapter) return;
		deletingMedia = filename;
		deleteMediaError = '';
		try {
			await backendStore.adapter.deleteMedia(filename);
			if (selectedFile === filename) { selectedFile = null; fileMetadata = null; }
			await refreshAll();
		} catch (err: unknown) {
			const e = err as { body?: { detail?: string; references?: Array<{type: string; name: string}> }; message?: string };
			if (e?.body?.references) {
				deleteMediaError = `Cannot delete: referenced by ${e.body.references.map(r => `${r.type} "${r.name}"`).join(', ')}`;
			} else {
				deleteMediaError = e?.body?.detail || e?.message || 'Delete failed';
			}
		} finally { deletingMedia = null; }
	}

	async function showMetadata(filename: string) {
		if (selectedFile === filename) { selectedFile = null; return; }
		selectedFile = filename;
		metadataLoading = true;
		try {
			fileMetadata = await backendStore.adapter!.getMediaMetadata(filename);
		} catch { fileMetadata = null; }
		finally { metadataLoading = false; }
	}

	// ── Theme ──
	let importJson = $state('');
	let importError = $state('');
	const themePlaceholder = '{"id": "my-theme", "name": "My Theme", "vars": {"accent": "#ff6600"}}';

	// ── Client settings ──
	let defaultChannel = $state('');

	function initClientSettings() {
		try {
			defaultChannel = localStorage.getItem('tltv_default_channel') || '';
		} catch {}
	}

	function saveDefaultChannel() {
		try {
			if (defaultChannel.trim()) {
				localStorage.setItem('tltv_default_channel', defaultChannel.trim());
			} else {
				localStorage.removeItem('tltv_default_channel');
			}
		} catch {}
	}

	// ── Sidebar ──
	interface SidebarGroup { label: string; items: Array<{ id: string; label: string }>; }
	const staticGroups: SidebarGroup[] = [
		{
			label: 'Station',
			items: [
				{ id: 'overview', label: 'Overview' },
				{ id: 'inputs', label: 'Inputs' },
				{ id: 'playout', label: 'Playout' },
				{ id: 'outputs', label: 'Outputs' },
				{ id: 'channels', label: 'Channels' },
				{ id: 'schedule', label: 'Schedule' },
			],
		},
		{
			label: 'Content',
			items: [
				{ id: 'playlist', label: 'Playlists' },
				{ id: 'media', label: 'Library' },
			],
		},
		{
			label: 'Network',
			items: [
				{ id: 'peers', label: 'Peers' },
				{ id: 'relays', label: 'Relays' },
				{ id: 'tokens', label: 'Tokens' },
				{ id: 'iptv', label: 'IPTV' },
			],
		},
		{
			label: 'Settings',
			items: [
				{ id: 'settings', label: 'Server' },
				{ id: 'plugins', label: 'Plugins' },
				{ id: 'logs', label: 'Logs' },
				{ id: 'client', label: 'Client' },
			],
		},
	];

	let sidebarGroups = $derived.by(() => {
		const groups = [...staticGroups];
		if (loadedPlugins.length > 0) {
			// Insert plugin entries before Settings
			groups.splice(3, 0, {
				label: 'Plugins',
				items: loadedPlugins.map(p => ({ id: `plugin:${p.name}`, label: p.name })),
			});
		}
		return groups;
	});

	// ── Polling ──
	let fastPoll: ReturnType<typeof setInterval> | null = null;
	let slowPoll: ReturnType<typeof setInterval> | null = null;

	function startPolling() {
		stopPolling();
		fastPoll = setInterval(refreshNowPlaying, 3000);
		slowPoll = setInterval(refreshAll, 15000);
	}
	function stopPolling() {
		if (fastPoll) { clearInterval(fastPoll); fastPoll = null; }
		if (slowPoll) { clearInterval(slowPoll); slowPoll = null; }
	}

	// ── Connection ──
	async function handleConnect() {
		connecting = true;
		await backendStore.connect('cathode', connectUrl, connectKey);
		connecting = false;
		if (backendStore.state === 'connected') {
			initChannelSelector();
			await Promise.all([refreshAll(), discoverChannels(), refreshManagedChannels(), refreshPlugins(), refreshRegistries(), settingsRef?.loadSettings()]);
			startPolling();
		}
	}

	async function refreshManagedChannels() {
		try {
			const result = await backendStore.adapter!.listChannels();
			managedChannels = result.channels;
			// Validate selected channel still exists
			if (selectedChannel && !result.channels.some(c => c.id === selectedChannel)) {
				selectChannel(undefined);
			}
		} catch { /* multi-channel might not be available */ }
	}

	async function handleCreateChannel() {
		if (!backendStore.adapter || !newChannel.id.trim() || !newChannel.display_name.trim()) return;
		creatingChannel = true;
		createChannelError = '';
		try {
			await backendStore.adapter.createChannel(newChannel);
			newChannel = { id: '', display_name: '' };
			managedChannelSuccess = 'Channel created.';
			setTimeout(() => { managedChannelSuccess = ''; }, 3000);
			await refreshManagedChannels();
			await discoverChannels();
		} catch (e: unknown) {
			const err = e as { body?: { detail?: string }; message?: string };
			createChannelError = err?.body?.detail || err?.message || 'Failed to create channel';
		} finally { creatingChannel = false; }
	}

	async function startEditChannel(id: string, displayName: string) {
		editingManagedChannel = id;
		managedChannelEdit = { display_name: displayName };
		channelEncodingLoading = true;
		try {
			channelEncoding = await backendStore.adapter!.getEncoding(id);
		} catch { channelEncoding = {}; }
		finally { channelEncodingLoading = false; }
	}

	async function handleUpdateManagedChannel(id: string) {
		if (!backendStore.adapter) return;
		managedChannelError = '';
		try {
			await backendStore.adapter.updateChannel(id, managedChannelEdit);
			// Save encoding separately if we have values
			if (Object.keys(channelEncoding).length > 0) {
				await backendStore.adapter.setEncoding(channelEncoding, id);
			}
			editingManagedChannel = null;
			managedChannelSuccess = 'Channel updated.';
			setTimeout(() => { managedChannelSuccess = ''; }, 3000);
			await refreshManagedChannels();
			await discoverChannels();
			await refreshAll();
		} catch (e: unknown) {
			const err = e as { body?: { detail?: string }; message?: string };
			managedChannelError = err?.body?.detail || err?.message || 'Failed to update channel';
		}
	}

	async function refreshPlugins() {
		try {
			const result = await backendStore.adapter!.listPlugins();
			loadedPlugins = result.plugins;
		} catch { loadedPlugins = []; }
	}

	async function refreshRegistries() {
		const a = backendStore.adapter;
		if (!a) return;
		const [src, out, bt, lc, pt] = await Promise.allSettled([
			a.getRegistrySourceTypes(),
			a.getRegistryOutputTypes(),
			a.getBlockTypes(),
			a.getLayerConfig(),
			a.getRegistryPlaylistTools(),
		]);
		if (src.status === 'fulfilled') pluginSourceTypes = src.value.types;
		if (out.status === 'fulfilled') pluginOutputTypes = out.value.types;
		if (bt.status === 'fulfilled') blockTypes = bt.value;
		if (lc.status === 'fulfilled') layerNames = lc.value.layers.map(l => l.name);
		if (pt.status === 'fulfilled') playlistTools = pt.value.tools;
	}

	async function handleDeleteManagedChannel(id: string) {
		if (!backendStore.adapter || !confirm(`Delete channel "${id}"? This cannot be undone.`)) return;
		managedChannelError = '';
		try {
			await backendStore.adapter.deleteChannel(id);
			managedChannelSuccess = 'Channel deleted.';
			setTimeout(() => { managedChannelSuccess = ''; }, 3000);
			if (selectedChannel === id) selectChannel(undefined);
			await refreshManagedChannels();
			await discoverChannels();
			await refreshAll();
		} catch (e: unknown) {
			const err = e as { body?: { detail?: string }; message?: string };
			if ((e as { status?: number })?.status === 409) {
				managedChannelError = 'Cannot delete the last channel.';
			} else {
				managedChannelError = err?.body?.detail || err?.message || 'Failed to delete channel';
			}
		}
	}

	async function discoverChannels() {
		try {
			const resp = await fetch(`${backendStore.baseUrl}/.well-known/tltv`);
			if (resp.ok) {
				const data = await resp.json();
				channels = data.channels || [];
			}
		} catch {
			// Channel discovery is optional
		}
	}

	async function refreshNowPlaying() {
		const a = backendStore.adapter;
		if (!a) return;
		const [np, st] = await Promise.allSettled([a.getNowPlaying(), a.getStatus()]);
		if (np.status === 'rejected' && st.status === 'rejected') {
			connectionLostCount++;
			if (connectionLostCount >= 2) connectionLost = true;
		} else {
			connectionLostCount = 0;
			connectionLost = false;
		}
		if (np.status === 'fulfilled') nowPlaying = np.value;
		if (st.status === 'fulfilled') status = st.value;
	}

	async function refreshAll() {
		const a = backendStore.adapter;
		if (!a) return;
		const ch = selectedChannel;
		try {
		const results = await Promise.allSettled([
			a.getStatus(), a.getNowPlaying(), a.getSystemStats(), a.getMedia(),
			a.getPrograms(7, ch),
			a.getPeers(), a.getRelays(), a.getEngineHealth(ch),
			a.getChannelMetadata(), a.getPlayoutMode(ch),
			a.getOutputs(ch),
		]);
			const allRejected = results.every(r => r.status === 'rejected');
			if (allRejected) {
				connectionLostCount++;
				if (connectionLostCount >= 2) connectionLost = true;
			} else {
				connectionLostCount = 0;
				connectionLost = false;
			}
			if (results[0].status === 'fulfilled') status = results[0].value;
			if (results[1].status === 'fulfilled') nowPlaying = results[1].value;
			if (results[2].status === 'fulfilled') systemStats = results[2].value;
			if (results[3].status === 'fulfilled') media = results[3].value;
			if (results[4].status === 'fulfilled') programs = results[4].value;
			if (results[5].status === 'fulfilled') peers = results[5].value;
			if (results[6].status === 'fulfilled') relays = results[6].value;
			if (results[7].status === 'fulfilled') engineHealth = results[7].value;
			if (results[8].status === 'fulfilled') {
				channelMetadata = results[8].value;
				editChannel = { ...results[8].value };
			}
			if (results[9].status === 'fulfilled') playoutMode = results[9].value;
			if (results[10].status === 'fulfilled') outputs = results[10].value.outputs;

			// Fetch active layer status for playlist info
			if (engineHealth?.active_channel) {
				try {
					const ls = await backendStore.adapter!.getLayerStatus(engineHealth.active_channel, ch);
					activeLayerStatus = ls as unknown as Record<string, unknown>;
				} catch {}
			}
		} catch {
			// allSettled itself shouldn't throw
		}
	}

	function handlePlayoutModeChanged(mode: PlayoutMode) {
		playoutMode = mode;
	}

	// ── Channel editing ──
	async function saveChannel() {
		if (!backendStore.adapter || !channelMetadata) return;
		channelSaving = true;
		channelError = '';
		try {
			const changes: Record<string, unknown> = {};
			const fields = ['display_name', 'description', 'language', 'timezone', 'access', 'on_demand', 'status'] as const;
			for (const f of fields) {
				if (editChannel[f] !== channelMetadata[f]) changes[f] = editChannel[f];
			}
			if (JSON.stringify(editChannel.tags) !== JSON.stringify(channelMetadata.tags)) changes.tags = editChannel.tags;
			if (JSON.stringify(editChannel.origins) !== JSON.stringify(channelMetadata.origins)) changes.origins = editChannel.origins;
			if (Object.keys(changes).length === 0) { channelSaving = false; return; }
			await backendStore.adapter.setChannelMetadata(changes as Partial<ChannelMetadata>);
			channelSuccess = 'Channel updated.';
			setTimeout(() => { channelSuccess = ''; }, 3000);
			await refreshAll();
			await discoverChannels();
		} catch (e: unknown) {
			const err = e as { body?: { detail?: string }; message?: string };
			channelError = err?.body?.detail || err?.message || 'Failed to update';
		} finally { channelSaving = false; }
	}

	// ── Overview actions ──
	async function handleSkip() {
		skipLoading = true;
		try {
			const layer = engineHealth?.active_channel;
			await backendStore.adapter?.skip(selectedChannel, layer);
			setTimeout(refreshNowPlaying, 500);
		}
		finally { skipLoading = false; }
	}
	async function handleBack() {
		backLoading = true;
		try {
			const layer = engineHealth?.active_channel;
			await backendStore.adapter?.back(selectedChannel, layer);
			setTimeout(refreshNowPlaying, 500);
		}
		finally { backLoading = false; }
	}

	// ── Theme ──
	function handleImportTheme() {
		importError = '';
		try {
			const parsed = JSON.parse(importJson);
			if (!parsed.id || !parsed.name || !parsed.vars) {
				importError = 'Theme JSON must have id, name, and vars fields.';
				return;
			}
			// Validate theme var keys against allowlist
			const allowedKeys = new Set<string>(THEME_TOKENS);
			const invalidKeys = Object.keys(parsed.vars).filter((k: string) => !allowedKeys.has(k));
			if (invalidKeys.length > 0) {
				importError = `Unknown theme tokens: ${invalidKeys.join(', ')}. Only standard theme tokens are allowed.`;
				return;
			}
			// Sanitize theme var values — reject dangerous CSS patterns
			const dangerousPatterns = /url\s*\(|expression\s*\(|javascript:|@import|@charset|behavior\s*:/i;
			for (const [key, value] of Object.entries(parsed.vars)) {
				if (typeof value !== 'string') {
					importError = `Theme token "${key}" must be a string value.`;
					return;
				}
				if (dangerousPatterns.test(value as string)) {
					importError = `Theme token "${key}" contains a disallowed CSS pattern.`;
					return;
				}
			}
			themeStore.addCustom(parsed, true);
			importJson = '';
		} catch { importError = 'Invalid JSON.'; }
	}

	function getExportJson(): string {
		return JSON.stringify({
			id: themeStore.current.id,
			name: themeStore.current.name,
			vars: themeStore.current.vars,
		}, null, 2);
	}

	// ── Load settings when navigating to settings section ──
	$effect(() => {
		if (section === 'settings' && settingsRef && backendStore.state === 'connected') {
			settingsRef.loadSettings();
		}
		if (section === 'client') {
			initClientSettings();
		}
	});

	// ── Lifecycle ──
	onMount(() => {
		initChannelSelector();
		initClientSettings();
		if (backendStore.state === 'connected') {
			refreshAll();
			discoverChannels();
			refreshManagedChannels();
			refreshPlugins();
			refreshRegistries();
			settingsRef?.loadSettings();
			startPolling();
		}
		if (!connectUrl) connectUrl = window.location.origin;
	});

	onDestroy(() => { stopPolling(); });
</script>

<svelte:head>
	<title>Control — TLTV</title>
</svelte:head>

<div class="manage">
	{#if backendStore.state !== 'connected'}
		<div class="connect-panel">
			<div class="connect-brand">tltv</div>
			<div class="connect-title">control</div>
			<form class="connect-form" onsubmit={(e) => { e.preventDefault(); handleConnect(); }}>
				<label>
					<span>server</span>
					<input type="url" bind:value={connectUrl} placeholder="https://your-server:8888" />
				</label>
				<label>
					<span>api key</span>
					<input type="password" bind:value={connectKey} placeholder="" />
				</label>
				<button type="submit" class="connect-btn" disabled={connecting || !connectUrl.trim()}>
					{connecting ? 'connecting...' : 'connect'}
				</button>
			</form>
			{#if backendStore.error}
				<div class="connect-error">{backendStore.error}</div>
			{/if}
		</div>
	{:else}
		<div class="dashboard">
			<aside class="sidebar">
				<nav class="sidebar-nav">
					{#each sidebarGroups as group}
						<div class="sidebar-group">
							<div class="sidebar-group-label">{group.label}</div>
							{#each group.items as s}
								<button class="sidebar-item" class:active={section === s.id}
									onclick={() => section = s.id}>{s.label}</button>
							{/each}
						</div>
					{/each}
				</nav>
				<div class="sidebar-footer">
					<span class="sidebar-server-url mono">{backendStore.baseUrl.replace(/^https?:\/\//, '')}</span>
					<span class="sidebar-server-info">{backendStore.serverInfo?.backend} v{backendStore.serverInfo?.version}</span>
					<button class="sidebar-disconnect" onclick={() => { stopPolling(); backendStore.disconnect(); }}>
						Disconnect
					</button>
				</div>
			</aside>

			<div class="content">
				{#if connectionLost}
					<div class="connection-lost-banner">
						Connection lost — server is not responding. Retrying...
					</div>
				{/if}

				{#snippet channelBar()}
					{#if managedChannels.length > 1}
						<div class="channel-bar">
							<span class="channel-bar-label">Channel:</span>
							<select class="channel-bar-select" value={selectedChannel ?? ''} onchange={(e) => { selectChannel((e.target as HTMLSelectElement).value || undefined); refreshAll(); }}>
								<option value="">Default</option>
								{#each managedChannels as ch}
									<option value={ch.id}>{ch.display_name || ch.id}</option>
								{/each}
							</select>
						</div>
					{/if}
				{/snippet}

			{#if section === 'overview'}
				{@render channelBar()}
				<OverviewSection {nowPlaying} {systemStats} {media} {peers} {relays}
					{playoutMode} {engineHealth} {channelMetadata} {channels}
					{outputs} {activeLayerStatus}
					{skipLoading} {backLoading}
					onSkip={handleSkip} onBack={handleBack} />

			{:else if section === 'channels'}
				<h2>Channels</h2>
				<p class="panel-desc">Manage station channels. Each channel has its own playout engine, schedule, and playlists.</p>

				{#if managedChannelError}
					<div class="form-error">{managedChannelError}</div>
				{/if}
				{#if managedChannelSuccess}
					<div class="settings-success">{managedChannelSuccess}</div>
				{/if}

				<!-- Channel list -->
				<div class="panel">
					<div class="table-wrap">
						<table>
							<thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Engine</th><th>Encoding</th><th></th></tr></thead>
							<tbody>
								{#each managedChannels as ch}
									<tr>
										<td class="mono" style="font-size: 0.75rem">{ch.id}</td>
										<td style="font-weight: 600">{ch.display_name || 'Untitled'}</td>
										<td><span class="badge" class:badge-active={ch.status === 'active'} class:badge-error={ch.status === 'retired'}>{ch.status}</span></td>
										<td>
											{#if ch.has_engine}
												<span class="badge badge-active">Running</span>
											{:else}
												<span class="text-muted">—</span>
											{/if}
										</td>
										<td class="mono" style="font-size: 0.7rem">
											{#if ch.encoding}
												{ch.encoding.width}x{ch.encoding.height}
											{:else}
												<span class="text-muted">—</span>
											{/if}
										</td>
										<td class="row-actions">
											<button class="btn-surface btn-xs" onclick={() => {
												if (editingManagedChannel === ch.id) { editingManagedChannel = null; }
												else { startEditChannel(ch.id, ch.display_name); }
											}}>
												{editingManagedChannel === ch.id ? 'Cancel' : 'Edit'}
											</button>
											<button class="btn-danger btn-xs" onclick={() => handleDeleteManagedChannel(ch.id)}>Del</button>
										</td>
									</tr>
									{#if editingManagedChannel === ch.id}
										<tr class="expanded-row">
											<td colspan="6">
												<div style="padding: 0.75rem">
													<div class="form-grid">
														<label class="form-label" style="grid-column: 1 / -1">
															<span>Display name</span>
															<input type="text" bind:value={managedChannelEdit.display_name} />
														</label>
														<label class="form-label" style="grid-column: 1 / -1">
															<span>Description</span>
															<input type="text" bind:value={managedChannelEdit.description} placeholder="Channel description" />
														</label>
														<label class="form-label">
															<span>Language</span>
															<input type="text" bind:value={managedChannelEdit.language} placeholder="en" />
														</label>
													</div>
													{#if channelEncodingLoading}
														<p class="text-muted" style="margin-top: 0.5rem; font-size: 0.75rem">Loading encoding...</p>
													{:else}
														<h4 style="font-size: 0.8rem; margin-top: 1rem; margin-bottom: 0.5rem; color: #8888a0">Encoding</h4>
														<div class="preset-row" style="margin-bottom: 0.5rem; display: flex; gap: 0.35rem; flex-wrap: wrap">
															{#each ENCODING_PRESETS as ep}
																<button class="btn-surface btn-xs" onclick={() => applyEncodingPreset(ep)}>{ep.label}</button>
															{/each}
														</div>
														<div class="form-grid">
															<label class="form-label">
																<span>Width</span>
																<input type="number" bind:value={channelEncoding.width} min="0" />
															</label>
															<label class="form-label">
																<span>Height</span>
																<input type="number" bind:value={channelEncoding.height} min="0" />
															</label>
															<label class="form-label">
																<span>FPS</span>
																<input type="number" bind:value={channelEncoding.fps} min="0" />
															</label>
															<label class="form-label">
																<span>Bitrate</span>
																<input type="text" bind:value={channelEncoding.bitrate} placeholder="4000k" />
															</label>
															<label class="form-label">
																<span>Preset</span>
																<input type="text" bind:value={channelEncoding.preset} placeholder="medium" />
															</label>
															<label class="form-label">
																<span>Audio bitrate</span>
																<input type="text" bind:value={channelEncoding.audio_bitrate} placeholder="128k" />
															</label>
														</div>
													{/if}
													<div class="form-actions">
														<button class="btn-primary btn-sm" onclick={() => handleUpdateManagedChannel(ch.id)}>Save</button>
														<button class="btn-surface btn-sm" onclick={() => editingManagedChannel = null}>Cancel</button>
													</div>
												</div>
											</td>
										</tr>
									{/if}
								{/each}
								{#if managedChannels.length === 0}
									<tr><td colspan="6" class="text-muted">No channels found. Loading...</td></tr>
								{/if}
							</tbody>
							<tfoot>
								<tr>
									<td colspan="6" style="text-align: center; padding: 0.5rem">
										{#if showCreateChannel}
											<div style="text-align: left; padding: 0.5rem 0">
												{#if createChannelError}
													<div class="form-error">{createChannelError}</div>
												{/if}
												<div class="form-grid">
													<label class="form-label">
														<span>ID (slug)</span>
														<input type="text" bind:value={newChannel.id} placeholder="e.g. news" />
													</label>
													<label class="form-label">
														<span>Display name</span>
														<input type="text" bind:value={newChannel.display_name} placeholder="News Channel" />
													</label>
													<label class="form-label" style="grid-column: 1 / -1">
														<span>Description</span>
														<input type="text" bind:value={newChannel.description} placeholder="Optional description" />
													</label>
													<label class="form-label">
														<span>Language</span>
														<input type="text" bind:value={newChannel.language} placeholder="en" />
													</label>
												</div>
												<div class="form-actions">
													<button class="btn-primary btn-sm" onclick={handleCreateChannel}
														disabled={creatingChannel || !newChannel.id.trim() || !newChannel.display_name.trim()}>
														{creatingChannel ? 'Creating...' : 'Create'}
													</button>
													<button class="btn-surface btn-sm" onclick={() => { showCreateChannel = false; createChannelError = ''; }}>Cancel</button>
												</div>
											</div>
										{:else}
											<button class="btn-surface btn-sm" onclick={() => showCreateChannel = true}>Add Channel</button>
										{/if}
									</td>
								</tr>
							</tfoot>
						</table>
					</div>
				</div>

			{:else if section === 'playlist'}
			<PlaylistSection {media}
				adapter={backendStore.adapter} onRefresh={refreshAll} {playlistTools} />

			{:else if section === 'media'}
				<h2>Library</h2>
				<p class="panel-desc">Media files available on the server. Browse and manage your content library.</p>

				<div class="panel">
					<h3>Upload Media</h3>
					<p class="panel-desc">Upload media files to the server. Select multiple files at once.</p>
					<div class="upload-area">
						<input type="file" accept="video/*,audio/*,image/*" multiple onchange={handleUpload} bind:this={fileInput} style="display:none" />
						{#if getMediaFolders().length > 0}
							<div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.25rem">
								<label class="form-label" style="flex-direction: row; align-items: center; gap: 0.4rem; margin: 0">
									<span style="font-size: 0.75rem; white-space: nowrap">Upload to:</span>
									<select bind:value={selectedUploadFolder}
										style="background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
											padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-family: inherit; outline: none; cursor: pointer;">
										<option value="">Root</option>
										{#each getMediaFolders() as f}
											<option value={f}>{f}/</option>
										{/each}
									</select>
								</label>
							</div>
						{/if}
						<div style="display: flex; gap: 0.5rem; align-items: center">
							<button class="btn-primary btn-sm" onclick={() => fileInput?.click()} disabled={uploading}>
								{uploading ? `Uploading ${uploadProgress}...` : 'Choose Files'}
							</button>
							<button class="btn-surface btn-sm" onclick={createFolder}>New Folder</button>
						</div>
						{#if uploading && uploadQueue > 1}
							<div class="upload-progress-bar" style="margin-top: 0.5rem">
								<div class="progress-bar"><div class="progress-fill" style="width: {(uploadDone / uploadQueue) * 100}%"></div></div>
								<span class="text-muted" style="font-size: 0.7rem">{uploadDone}/{uploadQueue}</span>
							</div>
						{/if}
						{#if uploadError}
							<div class="form-error">{uploadError}</div>
						{/if}
						{#if uploadSuccess}
							<div class="settings-success">{uploadSuccess}</div>
						{/if}
					</div>
				</div>

				{#if media}
					<div class="panel">
						<div class="media-summary-row">
							<span class="badge badge-active">{media.count} files</span>
							<span class="text-muted" style="font-size: 0.8rem">
								{Math.floor(media.total_duration / 3600)}h {Math.floor((media.total_duration % 3600) / 60)}m total
							</span>
							<input type="text" bind:value={mediaFilter} placeholder="Search files..."
								style="margin-left: auto; max-width: 200px; font-size: 0.75rem; padding: 0.25rem 0.5rem;
									background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0; border-radius: 4px; outline: none;" />
						</div>
						{#if deleteMediaError}
							<div class="form-error" style="margin-top: 0.5rem">{deleteMediaError}</div>
						{/if}
						<div class="table-wrap" style="margin-top: 0.75rem">
							<table>
								<thead><tr><th>Filename</th><th>Duration</th><th></th></tr></thead>
								<tbody>
									{#each getGroupedLibrary() as group}
										{#if group.folder}
											<tr class="folder-row" onclick={() => toggleFolder(group.folder)}>
												<td colspan="3">
													<span class="folder-toggle">{collapsedFolders.has(group.folder) ? '▸' : '▾'}</span>
													<span class="folder-name">{group.folder}</span>
													<span class="folder-count">{group.items.length}</span>
												</td>
											</tr>
										{/if}
										{#if !group.folder || !collapsedFolders.has(group.folder)}
											{#each group.items as item}
												<tr>
													<td class="mono clickable" style="font-size: 0.8rem" onclick={() => showMetadata(item.filename)}>
														{#if group.folder}
															<span style="padding-left: 1rem">{item.basename}</span>
														{:else}
															{item.basename}
														{/if}
														<span class="ext-badge">{item.ext}</span>
														{#if selectedFile === item.filename}
															<span class="text-muted" style="font-size: 0.7rem; margin-left: 0.3rem">{metadataLoading ? '...' : '▾'}</span>
														{/if}
													</td>
													<td class="mono text-muted">{item.duration > 0 ? `${Math.floor(item.duration / 60)}:${Math.floor(item.duration % 60).toString().padStart(2, '0')}` : '--'}</td>
													<td class="row-actions">
														<button class="btn-danger btn-xs"
															onclick={() => handleDeleteMedia(item.filename)}
															disabled={deletingMedia === item.filename}>
															{deletingMedia === item.filename ? '...' : 'Del'}
														</button>
													</td>
												</tr>
												{#if selectedFile === item.filename && fileMetadata}
													<tr class="expanded-row">
														<td colspan="3">
															<div class="file-metadata-detail">
																<div class="stat-row"><span>Format</span><span class="mono">{fileMetadata.format}</span></div>
																<div class="stat-row"><span>Size</span><span>{(fileMetadata.size / 1048576).toFixed(1)} MB</span></div>
																<div class="stat-row"><span>Duration</span><span>{Math.floor(fileMetadata.duration / 60)}m {Math.floor(fileMetadata.duration % 60)}s</span></div>
																{#if fileMetadata.video_codec}
																	<div class="stat-row"><span>Video</span><span class="mono">{fileMetadata.video_codec} {fileMetadata.width}x{fileMetadata.height} @{fileMetadata.fps}fps</span></div>
																{/if}
																{#if fileMetadata.audio_codec}
																	<div class="stat-row"><span>Audio</span><span class="mono">{fileMetadata.audio_codec} {fileMetadata.audio_channels}ch {fileMetadata.sample_rate}Hz</span></div>
																{/if}
															</div>
														</td>
													</tr>
												{/if}
											{/each}
										{/if}
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				{:else}
					<p class="text-muted">Loading...</p>
				{/if}

				{:else if section === 'schedule'}
				{@render channelBar()}
				<ProgramSection {media} {programs} adapter={backendStore.adapter} onRefresh={refreshAll} timezone={channelMetadata?.timezone} {playoutMode} {layerNames} {blockTypes} {pluginSourceTypes} />

			{:else if section === 'playout'}
			{@render channelBar()}
			<IngestSection {engineHealth} {playoutMode} adapter={backendStore.adapter} onRefresh={refreshAll} onPlayoutModeChanged={handlePlayoutModeChanged} />

			{:else if section === 'inputs'}
			{@render channelBar()}
			<InputsSection {engineHealth} adapter={backendStore.adapter} onRefresh={refreshAll} {pluginSourceTypes} />

			{:else if section === 'outputs'}
			{@render channelBar()}
			<OutputsSection {engineHealth} adapter={backendStore.adapter} onRefresh={refreshAll} {pluginOutputTypes} />

				{:else if section === 'peers'}
					<PeersSection {peers} {channelMetadata} {channels}
						adapter={backendStore.adapter} onRefresh={refreshAll} />

				{:else if section === 'relays'}
					<RelaysSection {relays} {channelMetadata} {channels}
						adapter={backendStore.adapter} onRefresh={refreshAll} />

				{:else if section === 'tokens'}
					<TokensSection {channels} adapter={backendStore.adapter} />

				{:else if section === 'settings'}
				<SettingsSection bind:this={settingsRef} adapter={backendStore.adapter}
					onRefresh={refreshAll} />

				{:else if section === 'iptv'}
					<h2>IPTV Endpoints</h2>
					<p class="section-desc">Use these URLs in external IPTV players (VLC, Kodi, Tivimate, etc.)</p>

					{#if channels.length === 0}
						<div class="panel">
							<p class="section-desc" style="margin-bottom: 0;">Connect to a server and discover channels first.</p>
						</div>
					{:else}
						<div class="iptv-section">
							<div class="panel">
								<h3>All Channels</h3>
								<div class="iptv-row">
									<span class="iptv-label">Stream:</span>
									<code class="iptv-url">{backendStore.baseUrl}/api/playlist.m3u</code>
									<button class="btn-surface btn-xs" onclick={() => navigator.clipboard?.writeText(`${backendStore.baseUrl}/api/playlist.m3u`)}>Copy</button>
								</div>
								<div class="iptv-row">
									<span class="iptv-label">Guide:</span>
									<code class="iptv-url">{backendStore.baseUrl}/api/guide.xml</code>
									<button class="btn-surface btn-xs" onclick={() => navigator.clipboard?.writeText(`${backendStore.baseUrl}/api/guide.xml`)}>Copy</button>
								</div>
							</div>

							<div class="panel">
								<h3>Per Channel</h3>
								{#each channels as ch}
									<div class="iptv-channel">
										<div class="iptv-channel-header">
											<span class="iptv-channel-name">{ch.name || ch.id}</span>
											<span class="iptv-channel-id mono">{ch.id}</span>
										</div>
										<div class="iptv-row">
											<span class="iptv-label">Stream:</span>
											<code class="iptv-url">{backendStore.baseUrl}/tltv/v1/channels/{ch.id}/stream.m3u8</code>
											<button class="btn-surface btn-xs" onclick={() => navigator.clipboard?.writeText(`${backendStore.baseUrl}/tltv/v1/channels/${ch.id}/stream.m3u8`)}>Copy</button>
										</div>
										<div class="iptv-row">
											<span class="iptv-label">Guide:</span>
											<code class="iptv-url">{backendStore.baseUrl}/tltv/v1/channels/{ch.id}/guide.xml</code>
											<button class="btn-surface btn-xs" onclick={() => navigator.clipboard?.writeText(`${backendStore.baseUrl}/tltv/v1/channels/${ch.id}/guide.xml`)}>Copy</button>
										</div>
									</div>
								{/each}
							</div>
						</div>
					{/if}

			{:else if section === 'plugins'}
			<PluginsSection adapter={backendStore.adapter} onNavigate={(s) => section = s} />

			{:else if section === 'logs'}
			<LogsSection adapter={backendStore.adapter} />

			{:else if section.startsWith('plugin:')}
				{@const pluginName = section.slice(7)}
				{@const pluginInfo = loadedPlugins.find(p => p.name === pluginName) ?? null}
				<PluginPage name={pluginName} adapter={backendStore.adapter} {pluginInfo} />

			{:else if section === 'client'}
				<h2>Client Settings</h2>
				<p class="section-desc">Settings stored in this browser. These do not affect the server or other clients.</p>

				<!-- Default channel -->
				<div class="panel">
					<h3>Default Channel</h3>
					<p class="panel-desc">Channel to tune to on first load. Leave empty to auto-discover the home node's first channel.</p>
					<div class="form-row">
						<label class="form-label" style="flex: 1">
							<span>Channel URI</span>
							<input type="text" bind:value={defaultChannel} placeholder="tltv://ChannelID@host:port" />
						</label>
						<div class="form-btn">
							<button class="btn-primary btn-sm" onclick={saveDefaultChannel}>Save</button>
						</div>
					</div>
					{#if defaultChannel.trim()}
						<div class="settings-info">
							<span class="text-muted" style="font-size: 0.75rem">Viewer will tune to this channel on startup instead of auto-discovering.</span>
						</div>
					{/if}
				</div>

				<!-- Viewer theme -->
				<div class="panel">
					<h3>Viewer Theme</h3>
					<p class="panel-desc">Appearance settings for the public viewer only. These do not affect the control panel.</p>
				</div>

				<div class="theme-grid">
					{#each themeStore.all as theme}
						<button class="theme-card" class:active={themeStore.current.id === theme.id}
							onclick={() => themeStore.set(theme.id)}>
							<div class="theme-preview" style="background: {theme.vars['bg-base']}; border-color: {theme.vars['border-default']};">
								<div class="preview-accent" style="background: {theme.vars['accent']}"></div>
								<div class="preview-text" style="color: {theme.vars['text-primary']}">Aa</div>
							</div>
							<span class="theme-name">{theme.name}</span>
							{#if themeStore.current.id === theme.id}
								<span class="theme-active-badge">Active</span>
							{/if}
						</button>
					{/each}
				</div>

				<div class="theme-import-section">
					<h3>Import Custom Theme</h3>
					<p class="section-desc">Paste a theme JSON object with <code>id</code>, <code>name</code>, and <code>vars</code> fields.</p>
					<div class="import-form">
						<textarea bind:value={importJson} placeholder={themePlaceholder} rows="4"></textarea>
						<button class="btn-primary btn-sm" onclick={handleImportTheme} disabled={!importJson.trim()}>Import &amp; Apply</button>
						{#if importError}
							<div class="import-error">{importError}</div>
						{/if}
					</div>
				</div>

				<div class="theme-import-section">
					<h3>Export Current Theme</h3>
					<p class="section-desc">Copy this JSON to share the theme or back it up.</p>
					<textarea readonly value={getExportJson()} rows="6"></textarea>
				</div>
			{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.manage { flex: 1; display: flex; flex-direction: column; background: #000; }

	/*
	 * Admin dashboard — fixed dark palette, NOT themed.
	 * Hardcoded colors so admin stays consistent regardless of viewer theme.
	 */

	/* ── Connect panel ── */
	.connect-panel {
		max-width: 400px; margin: 0 auto; padding: 1.5rem;
		display: flex; flex-direction: column;
		padding-top: 20vh;
	}
	.connect-brand {
		font-family: 'Space Grotesk', sans-serif;
		font-weight: 700; font-size: 2.5rem;
		color: #fff;
	}
	.connect-title {
		font-size: 0.85rem; color: rgba(255, 255, 255, 0.35);
		margin-top: 0.5rem;
		margin-bottom: 4rem;
	}
	.connect-form { display: flex; flex-direction: column; gap: 2rem; }
	.connect-form label {
		display: flex; flex-direction: column; gap: 0.4rem;
		font-size: 0.75rem; color: rgba(255, 255, 255, 0.3);
	}
	.connect-form input {
		background: transparent; border: none;
		border-bottom: 1px solid rgba(255, 255, 255, 0.15);
		color: #fff; padding: 0.6rem 0;
		font-family: inherit; font-size: 0.9rem; outline: none;
		width: 100%;
	}
	.connect-form input:focus { border-bottom-color: rgba(255, 255, 255, 0.5); }
	.connect-form input::placeholder { color: rgba(255, 255, 255, 0.1); }
	.connect-btn {
		margin-top: 1.5rem; padding: 0.7rem 0;
		background: transparent; border: 1.5px solid rgba(255, 255, 255, 0.25);
		color: #fff; font-family: inherit; font-size: 0.85rem;
		cursor: pointer; width: 100%;
	}
	.connect-btn:hover:not(:disabled) { border-color: #fff; }
	.connect-btn:disabled { opacity: 0.25; cursor: not-allowed; }
	.connect-error {
		margin-top: 1.5rem; padding: 0.75rem 0;
		border-top: 1px solid rgba(239, 68, 68, 0.3);
		color: #ef4444; font-size: 0.75rem;
	}

	/* ── Dashboard layout ── */
	.dashboard {
		flex: 1; display: flex; background: #0a0a14; color: #e0e0f0;
		max-width: calc(1100px + 2rem); width: 100%; margin: 0 auto;
		padding: 1rem;
		gap: 1rem;
	}
	.sidebar {
		width: 160px; flex-shrink: 0;
		padding: 0.5rem 0; display: flex; flex-direction: column;
	}
	.sidebar-footer {
		padding: 0.5rem 0.75rem; border-top: 1px solid #1a1a2a; margin-top: 0.5rem;
		display: flex; flex-direction: column; gap: 0.25rem;
	}
	.sidebar-server-url { font-size: 0.65rem; color: #8888a0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.sidebar-server-info { font-size: 0.6rem; color: #5a5a70; text-transform: capitalize; }
	.sidebar-nav { display: flex; flex-direction: column; flex: 1; }
	.sidebar-group { display: flex; flex-direction: column; }
	.sidebar-group + .sidebar-group { border-top: 1px solid #1a1a2a; margin-top: 0.25rem; padding-top: 0.25rem; }
	.sidebar-group-label {
		padding: 0.4rem 0.75rem 0.2rem; font-size: 0.6rem; font-weight: 700;
		text-transform: uppercase; letter-spacing: 0.08em; color: #4a4a60;
	}
	.sidebar-item {
		text-align: left; padding: 0.35rem 0.75rem 0.35rem 1rem; font-size: 0.8rem;
		color: #8888a0; background: none; border-radius: 0 4px 4px 0; transition: background 0.15s, color 0.15s;
	}
	.sidebar-item:hover { background: #141420; color: #e0e0f0; }
	.sidebar-item.active {
		color: #818cf8; background: #141420;
		border-left: 2px solid #818cf8; padding-left: calc(1rem - 2px);
	}
	.sidebar-disconnect {
		background: none; border: none; color: #5a5a70; font-size: 0.65rem;
		padding: 0.2rem 0; cursor: pointer; text-align: left; width: fit-content;
	}
	.sidebar-disconnect:hover { color: #ef4444; }
	.channel-bar {
		display: flex; align-items: center; gap: 0.5rem;
		margin-bottom: 1rem; padding: 0.5rem 0.75rem;
		background: #141420; border: 1px solid #1a1a2a; border-radius: 6px;
	}
	.channel-bar-label {
		font-size: 0.75rem; font-weight: 600; color: #8888a0; flex-shrink: 0;
	}
	:global(.channel-bar-select) {
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.3rem 0.5rem; border-radius: 4px; font-size: 0.8rem;
		font-family: inherit; outline: none; cursor: pointer;
	}
	:global(.channel-bar-select):focus { border-color: #5a5a7a; }

	.content {
		flex: 1; padding: 0.5rem 0; overflow-y: auto;
		min-width: 0; /* prevent flex overflow */
	}
	.content :global(h2) { margin-bottom: 1rem; }

	/* ── Buttons ── */
	.btn-primary {
		background: #818cf8; color: #0a0a14; border: none; padding: 0.5rem 1rem;
		border-radius: 4px; font-weight: 600; font-size: 0.8rem; cursor: pointer;
	}
	.btn-primary:hover { background: #6366f1; }
	.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
	:global(.btn-surface) {
		background: #1a1a2a; color: #c0c0d0; border: 1px solid #2a2a3a;
		padding: 0.4rem 0.75rem; border-radius: 4px; font-size: 0.8rem; cursor: pointer;
	}
	:global(.btn-surface):hover { background: #242438; }
	.btn-sm { padding: 0.35rem 0.75rem; font-size: 0.8rem; }

	/* ── Global child component styles ── */
	:global(.card-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 1rem; }
	:global(.card) { background: #141420; border: 1px solid #1a1a2a; border-radius: 8px; padding: 1rem; }
	:global(.card-title) {
		font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
		color: #5a5a70; margin-bottom: 0.5rem;
	}
	:global(.card-value) { font-size: 1.25rem; font-weight: 600; }
	:global(.card-detail) { font-size: 0.8rem; color: #8888a0; margin-top: 0.25rem; }
	:global(.card-actions) { display: flex; gap: 0.5rem; margin-top: 0.75rem; }
	:global(.card-badges) { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.5rem; }
	:global(.progress-row) { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.4rem; }
	:global(.progress-bar) { flex: 1; height: 4px; background: #1a1a2a; border-radius: 2px; overflow: hidden; }
	:global(.progress-fill) { height: 100%; background: #818cf8; border-radius: 2px; transition: width 0.5s linear; }
	:global(.progress-time) { font-size: 0.7rem; color: #8888a0; font-family: monospace; white-space: nowrap; }
	:global(.stat-row) {
		display: flex; justify-content: space-between; padding: 0.3rem 0;
		font-size: 0.8rem; border-bottom: 1px solid #1a1a2a;
	}
	:global(.stat-row):last-child { border-bottom: none; }
	:global(.stat-row) span:first-child { color: #8888a0; }

	/* Tables */
	:global(.table-wrap) { overflow-x: auto; }
	:global(table) { width: 100%; border-collapse: collapse; font-size: 0.8rem; }
	:global(thead) { background: #1a1a28; }
	:global(th) {
		text-align: left; padding: 0.5rem 0.75rem; font-size: 0.7rem;
		text-transform: uppercase; letter-spacing: 0.06em; color: #5a5a70; font-weight: 600;
	}
	:global(td) { padding: 0.5rem 0.75rem; border-bottom: 1px solid #1a1a2a; }
	:global(tbody tr:nth-child(even)) { background: #0e0e1a; }
	:global(.row-actions) { text-align: right; white-space: nowrap; }
	:global(.clickable) { cursor: pointer; }
	:global(.clickable):hover { background: #1a1a28 !important; }

	/* Badges */
	:global(.badge) {
		display: inline-flex; align-items: center; gap: 0.3rem;
		padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; font-weight: 600;
	}
	:global(.badge .dot) { width: 6px; height: 6px; border-radius: 50%; }
	:global(.badge-playlist) { background: rgba(99, 102, 241, 0.15); color: #818cf8; }
	:global(.badge-playlist .dot) { background: #818cf8; }
	:global(.badge-live) { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
	:global(.badge-live .dot) { background: #ef4444; }
	:global(.badge-active) { background: rgba(16, 185, 129, 0.15); color: #10b981; }
	:global(.badge-active .dot) { background: #10b981; }
	:global(.badge-error) { background: rgba(239, 68, 68, 0.15); color: #ef4444; padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.7rem; }
	:global(.badge-loop) { background: rgba(168, 85, 247, 0.15); color: #a855f7; }
	:global(.type-badge) {
		display: inline-block; padding: 0.1rem 0.4rem; border-radius: 3px;
		font-size: 0.7rem; font-weight: 600; color: #fff;
	}

	/* Action bar */
	:global(.action-bar) { display: flex; gap: 0.5rem; margin-bottom: 1rem; align-items: center; }
	:global(.action-bar) input, :global(.input-sm) {
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.35rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-family: inherit; outline: none;
	}
	:global(.action-bar) input:focus, :global(.input-sm):focus { border-color: #5a5a7a; }

	/* Settings */
	:global(.mode-toggle) { display: flex; gap: 0; border: 1px solid #2a2a3a; border-radius: 4px; overflow: hidden; width: fit-content; }
	:global(.toggle-btn) {
		padding: 0.4rem 1.25rem; font-size: 0.8rem; font-weight: 600;
		background: #0c0c18; color: #8888a0; border: none; cursor: pointer; transition: all 0.15s;
	}
	:global(.toggle-btn):hover { background: #1a1a2a; color: #e0e0f0; }
	:global(.toggle-btn.active) { background: #818cf8; color: #0a0a14; }
	:global(.toggle-btn + .toggle-btn) { border-left: 1px solid #2a2a3a; }
	:global(.panel-desc) { font-size: 0.8rem; color: #5a5a70; margin-bottom: 0.75rem; }
	:global(.panel-compact) { flex: 1; min-width: 200px; }
	:global(.settings-row) { display: flex; gap: 1rem; flex-wrap: wrap; }
	:global(.settings-success) {
		padding: 0.4rem 0.6rem; margin-bottom: 0.75rem;
		background: rgba(16, 185, 129, 0.1); border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 4px; color: #10b981; font-size: 0.8rem;
	}
	:global(.settings-info) {
		margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #1a1a2a;
		font-size: 0.75rem; display: flex; align-items: center; gap: 0.5rem;
	}
	:global(.settings-info) code { font-size: 0.7rem; color: #8888a0; word-break: break-all; }

	/* Mode banner */
	:global(.mode-banner) {
		padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem;
		font-size: 0.85rem;
	}
	:global(.mode-loop) { background: rgba(168, 85, 247, 0.08); border: 1px solid rgba(168, 85, 247, 0.25); color: #c4b5fd; }
	:global(.mode-schedule) { background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); color: #a5b4fc; }
	:global(.mode-badge-row) { display: flex; align-items: center; gap: 0.5rem; }

	/* Panels & Forms */
	:global(.panel) {
		background: #141420; border: 1px solid #1a1a2a; border-radius: 8px;
		padding: 1rem; margin-bottom: 1rem;
	}
	:global(.panel) h3 { font-size: 0.9rem; margin-bottom: 0.75rem; }
	:global(.form-row) { display: flex; gap: 0.75rem; align-items: flex-end; flex-wrap: wrap; }
	:global(.form-grid) { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 0.75rem; }
	:global(.form-label) { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.75rem; color: #8888a0; }
	:global(.form-label input), :global(.form-label select) {
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.8rem; font-family: inherit; outline: none;
	}
	:global(.form-label input:focus), :global(.form-label select:focus) { border-color: #5a5a7a; }
	:global(.form-label select) { cursor: pointer; }
	:global(.form-btn) { align-self: flex-end; }
	:global(.form-error) {
		padding: 0.4rem 0.6rem; margin: 0.5rem 0;
		background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3);
		border-radius: 4px; color: #ef4444; font-size: 0.8rem;
	}
	:global(.form-actions) { display: flex; gap: 0.5rem; margin-top: 0.75rem; }

	/* File picker */
	:global(.file-picker) { margin-top: 0.75rem; }
	:global(.file-picker-header) {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.75rem; color: #8888a0; margin-bottom: 0.4rem;
	}
	:global(.file-list) {
		max-height: 240px; overflow-y: auto; border: 1px solid #1a1a2a;
		border-radius: 4px; background: #0c0c18;
	}
	:global(.file-item) {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.3rem 0.6rem; font-size: 0.8rem; cursor: pointer;
		border-bottom: 1px solid #141420;
	}
	:global(.file-item):last-child { border-bottom: none; }
	:global(.file-item):hover { background: #141420; }
	:global(.file-item input[type="checkbox"]) { accent-color: #818cf8; }
	:global(.file-name) { flex: 1; font-family: monospace; }
	:global(.file-dur) { color: #5a5a70; font-size: 0.75rem; font-family: monospace; }

	/* Schedule detail */
	:global(.expanded-row td) { background: #0e0e1a !important; padding: 0; }
	:global(.schedule-detail) { padding: 0.5rem 0.75rem; }
	:global(.detail-clip) {
		display: flex; justify-content: space-between; padding: 0.2rem 0;
		font-size: 0.75rem; border-bottom: 1px solid #141420;
	}
	:global(.detail-clip):last-child { border-bottom: none; }
	:global(.detail-raw) { font-size: 0.7rem; overflow: auto; max-height: 200px; color: #8888a0; }

	/* Timeline */
	:global(.timeline-wrap) { margin-bottom: 1rem; }
	:global(.timeline-bar) {
		position: relative; height: 32px;
		background: #141420; border: 1px solid #1a1a2a; border-radius: 4px;
		overflow: hidden;
	}
	:global(.timeline-block) {
		position: absolute; top: 2px; height: 28px; border-radius: 3px;
		display: flex; align-items: center; overflow: hidden;
	}
	:global(.timeline-block-label) {
		padding: 0 0.3rem; font-size: 0.65rem; font-weight: 600;
		color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	:global(.timeline-hours) {
		position: relative; height: 16px; font-size: 0.6rem; color: #5a5a70; margin-top: 2px;
	}
	:global(.timeline-hours) span {
		position: absolute; transform: translateX(-50%); font-family: monospace;
	}

	/* Token display */
	:global(.token-created) {
		padding: 0.75rem; margin-bottom: 1rem;
		background: rgba(16, 185, 129, 0.08); border: 1px solid rgba(16, 185, 129, 0.3);
		border-radius: 6px;
	}
	:global(.token-label) { font-size: 0.8rem; color: #10b981; margin-bottom: 0.4rem; font-weight: 500; }
	:global(.token-value) {
		display: flex; align-items: center; gap: 0.5rem;
		background: #0c0c18; padding: 0.4rem 0.6rem; border-radius: 4px; overflow-x: auto;
	}
	:global(.token-value) code {
		font-family: monospace; font-size: 0.75rem; color: #e0e0f0;
		word-break: break-all; flex: 1;
	}

	/* Buttons (global for child components) */
	:global(.btn-primary) {
		background: #818cf8; color: #0a0a14; border: none; padding: 0.5rem 1rem;
		border-radius: 4px; font-weight: 600; font-size: 0.8rem; cursor: pointer;
	}
	:global(.btn-primary):hover { background: #6366f1; }
	:global(.btn-primary):disabled { opacity: 0.5; cursor: not-allowed; }
	:global(.btn-danger) {
		background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);
		padding: 0.3rem 0.6rem; border-radius: 4px; font-size: 0.75rem; cursor: pointer;
	}
	:global(.btn-danger):hover { background: rgba(239, 68, 68, 0.25); }
	:global(.btn-danger):disabled { opacity: 0.5; cursor: not-allowed; }
	:global(.btn-sm) { padding: 0.35rem 0.75rem; font-size: 0.8rem; }
	:global(.btn-xs) { padding: 0.2rem 0.5rem; font-size: 0.7rem; }

	/* Shared */
	:global(.text-muted) { color: #5a5a70; }
	:global(.mono) { font-family: monospace; }
	:global(.truncate) { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Theme section */
	.section-desc { color: #8888a0; font-size: 0.85rem; margin-bottom: 1rem; }
	.section-desc code {
		background: #1a1a28; padding: 0.1rem 0.3rem; border-radius: 3px;
		font-size: 0.8rem; color: #c0c0d0;
	}
	.theme-grid {
		display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.75rem; margin-bottom: 2rem;
	}
	.theme-card {
		display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
		padding: 0.75rem; background: #141420; border: 2px solid #2a2a3a;
		border-radius: 8px; cursor: pointer; transition: border-color 0.15s; color: #e0e0f0;
	}
	.theme-card:hover { border-color: #5a5a7a; }
	.theme-card.active { border-color: #818cf8; }
	.theme-preview {
		width: 100%; height: 48px; border-radius: 4px; border: 1px solid;
		display: flex; align-items: center; justify-content: space-between; padding: 0 0.5rem;
	}
	.preview-accent { width: 12px; height: 12px; border-radius: 50%; }
	.preview-text { font-weight: 700; font-size: 0.9rem; }
	.theme-name { font-size: 0.8rem; font-weight: 500; }
	.theme-active-badge { font-size: 0.6rem; color: #818cf8; text-transform: uppercase; letter-spacing: 0.06em; }
	.theme-import-section { margin-bottom: 1.5rem; padding-top: 1rem; border-top: 1px solid #1a1a2a; }
	.theme-import-section h3 { margin-bottom: 0.25rem; }
	.import-form { display: flex; flex-direction: column; gap: 0.5rem; }
	.content textarea {
		width: 100%; font-family: monospace; font-size: 0.75rem; resize: vertical;
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.5rem; border-radius: 4px; outline: none;
	}
	.content textarea:focus { border-color: #5a5a7a; }
	.import-error { color: #ef4444; font-size: 0.8rem; }

	/* Connection lost banner */
	.connection-lost-banner {
		padding: 0.5rem 0.75rem;
		margin-bottom: 1rem;
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.3);
		border-radius: 4px;
		color: #fbbf24;
		font-size: 0.8rem;
	}

	/* Media library section */
	.media-summary-row {
		display: flex; align-items: center; gap: 0.75rem;
	}
	.upload-area {
		display: flex; flex-direction: column; gap: 0.5rem;
	}
	.folder-row {
		cursor: pointer; background: #0e0e1a;
	}
	.folder-row:hover { background: #1a1a28 !important; }
	.folder-row td {
		padding: 0.4rem 0.75rem; font-size: 0.8rem; font-weight: 600;
		color: #8888a0; border-bottom: 1px solid #1a1a2a;
	}
	.folder-toggle {
		display: inline-block; width: 1rem; color: #5a5a70; font-size: 0.7rem;
	}
	.folder-name { color: #8888a0; }
	.folder-count {
		margin-left: 0.4rem; font-size: 0.65rem; color: #5a5a70;
		font-weight: 400;
	}
	.folder-count::before { content: '('; }
	.folder-count::after { content: ')'; }
	.ext-badge {
		display: inline-block; margin-left: 0.4rem;
		padding: 0.05rem 0.3rem; border-radius: 3px;
		font-size: 0.6rem; font-weight: 600; font-family: monospace;
		background: #1a1a2a; color: #5a5a70;
		text-transform: uppercase; vertical-align: middle;
	}
	.file-metadata-detail {
		padding: 0.5rem 0.75rem; font-size: 0.8rem;
	}

	/* IPTV section */
	.iptv-section { display: flex; flex-direction: column; gap: 1rem; }
	.iptv-row {
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.3rem 0;
	}
	.iptv-url {
		flex: 1; font-size: 0.75rem; color: #c0c0d0; word-break: break-all;
		background: #0c0c18; padding: 0.35rem 0.5rem; border-radius: 4px;
		border: 1px solid #1a1a2a;
	}
	.iptv-label { font-size: 0.75rem; color: #8888a0; flex-shrink: 0; }
	.iptv-channel {
		padding: 0.75rem 0;
		border-bottom: 1px solid #1a1a2a;
	}
	.iptv-channel:last-child { border-bottom: none; }
	.iptv-channel-header {
		display: flex; align-items: baseline; gap: 0.5rem;
		margin-bottom: 0.4rem;
	}
	.iptv-channel-name { font-size: 0.85rem; font-weight: 600; color: #e0e0f0; }
	.iptv-channel-id { font-size: 0.7rem; color: #5a5a70; }

	/* Responsive */
	@media (max-width: 768px) {
		.dashboard { flex-direction: column; padding: 0; gap: 0; }
		.sidebar {
			width: 100%; flex-direction: row; overflow-x: auto;
			border-bottom: 1px solid #1a1a2a; padding: 0;
		}
		.sidebar-nav { flex-direction: row; }
		.sidebar-group { flex-direction: row; }
		.sidebar-group + .sidebar-group {
			border-top: none; border-left: 1px solid #1a1a2a;
			margin-top: 0; padding-top: 0; margin-left: 0.25rem; padding-left: 0.25rem;
		}
		.sidebar-group-label { display: none; }
		.sidebar-item { white-space: nowrap; padding: 0.5rem 0.75rem; border-radius: 0; }
		.sidebar-disconnect { display: none; }
		.content { padding: 0.75rem; }
		:global(.form-row) { flex-direction: column; }
		:global(.form-grid) { grid-template-columns: 1fr; }
	}
</style>
