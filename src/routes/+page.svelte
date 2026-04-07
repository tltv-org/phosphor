<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { playerStore } from '$stores/player.svelte';
	import { parseTltvUri, resolveChannel, discoverChannels, fetchWellKnown, verifyGuide, verifySignature } from '$tltv';
	import type { ChannelSource } from '$tltv';
	import type HlsType from 'hls.js';

	// hls.js loaded dynamically for code-splitting (540KB → separate chunk)
	const hlsReady = import('hls.js').then(m => m.default);
	let Hls: any = null;

	let videoEl = $state<HTMLVideoElement | null>(null);
	let playerWrapEl = $state<HTMLDivElement | null>(null);
	let guideViewportEl = $state<HTMLDivElement | null>(null);
	let hls: HlsType | null = null;
	let retryDelay = 2000;
	const MAX_RETRY_DELAY = 30000;
	let stallTimer: ReturnType<typeof setInterval> | null = null;
	let lastTime = -1;
	/** Home TLTV node — dev env override or current origin. */
	const homeNode = import.meta.env.VITE_TLTV_NODE || location.host;

	let channelInput = $state('');
	let tuning = $state(false);
	let showTuneInput = $state(false);
	let playerError = $state<string | null>(null);
	let copied = $state(false);
	let copiedTimer: ReturnType<typeof setTimeout> | null = null;
	let volume = $state(0.8);
	let pipSupported = $state(false);


	interface GuideChannel {
		id: string;
		name: string;
		source: ChannelSource;
		hints: string[];
		blocks: Array<{ startMin: number; endMin: number; title: string }>;
		guideVerified: boolean | null; // null = no guide fetched yet
	}
	let guideChannels = $state<GuideChannel[]>([]);
	let tunedGuideVerified = $state<boolean | null>(null);
	let epgEntries = $state<Array<{
		date: string; start: string; stop: string;
		title: string; category: string; type: string;
	}>>([]);

	let nowMinutes = $state(getNowMinutes());
	let clockDisplay = $state(formatClock());
	let clockTimer: ReturnType<typeof setInterval> | null = null;
	/** Channel IDs owned by the home node (from its .well-known/tltv channels[]). */
	let homeChannelIds = $state(new Set<string>());

	// ── Guide persistence ──
	function loadGuideChannels(): GuideChannel[] {
		try {
			const raw = localStorage.getItem('tltv_guide_channels');
			if (!raw) return [];
			const saved = JSON.parse(raw);
			if (!Array.isArray(saved)) return [];
			return saved.map((s: { id: string; name: string; source: string; hints: string[] }) => ({
				id: s.id, name: s.name, source: (s.source || 'peer') as ChannelSource,
				hints: s.hints || [], blocks: [], guideVerified: null,
			}));
		} catch { return []; }
	}
	function saveGuideChannels() {
		try {
			const toSave = guideChannels.map(({ id, name, source, hints }) => ({ id, name, source, hints }));
			localStorage.setItem('tltv_guide_channels', JSON.stringify(toSave));
		} catch {}
	}
	function removeChannelFromGuide(id: string) {
		guideChannels = guideChannels.filter(c => c.id !== id);
		saveGuideChannels();
	}
	/** Whether the currently tuned channel can be removed from the guide (not a home channel). */
	function canRemoveCurrentChannel(): boolean {
		const r = playerStore.resolved;
		if (!r) return false;
		return guideChannels.some(c => c.id === r.metadata.id) && !homeChannelIds.has(r.metadata.id);
	}
	function removeCurrentChannel() {
		const r = playerStore.resolved;
		if (!r) return;
		removeChannelFromGuide(r.metadata.id);
	}
	/** Guide channels sorted: home channels first, then the rest by source. */
	function sortedGuideChannels(): GuideChannel[] {
		return [...guideChannels].sort((a, b) => {
			const aHome = homeChannelIds.has(a.id) ? 0 : 1;
			const bHome = homeChannelIds.has(b.id) ? 0 : 1;
			return aHome - bHome;
		});
	}
	function parseTime(str: string): number {
		const p = str.split(':');
		return parseInt(p[0]) * 60 + parseInt(p[1]) + parseInt(p[2] || '0') / 60;
	}
	function pad2(n: number) { return n < 10 ? '0' + n : '' + n; }
	function getNowMinutes(): number {
		const now = new Date();
		return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
	}

	/** Convert a UTC ISO timestamp to local minutes since today's midnight.
	 *  Handles multi-day: tomorrow 1 AM → 1500 min if today started at 0. */
	function utcToLocalMinutes(iso: string): number {
		const d = new Date(iso);
		if (isNaN(d.getTime())) return 0;
		const todayMidnight = new Date();
		todayMidnight.setHours(0, 0, 0, 0);
		return (d.getTime() - todayMidnight.getTime()) / 60000;
	}

	function getTimezone(): string {
		try {
			return new Intl.DateTimeFormat('en', { timeZoneName: 'short' })
				.formatToParts(new Date())
				.find(p => p.type === 'timeZoneName')?.value || '';
		} catch { return ''; }
	}

	function formatClock(): string {
		const now = new Date();
		const h = now.getHours();
		const m = now.getMinutes();
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		const tz = getTimezone();
		return `${h12}:${pad2(m)} ${ampm}${tz ? ' ' + tz : ''}`;
	}

	// Guide config
	const PX_PER_MIN = 4;
	const SLOT_MIN = 30;

	// Timeline starts at the last 30-min mark, shows 24h forward
	function getGuideStart(): number {
		return Math.floor(nowMinutes / SLOT_MIN) * SLOT_MIN;
	}
	function getGuideEnd(): number {
		return getGuideStart() + 24 * 60;
	}
	function getGuideWidth(): number {
		return (getGuideEnd() - getGuideStart()) * PX_PER_MIN;
	}

	function getTimeSlots(): Array<{ min: number; label: string }> {
		const start = getGuideStart();
		const end = getGuideEnd();
		const slots: Array<{ min: number; label: string }> = [];
		for (let m = start; m < end; m += SLOT_MIN) {
			const displayMin = ((m % 1440) + 1440) % 1440; // wrap around midnight
			const h = Math.floor(displayMin / 60);
			const mm = displayMin % 60;
			const ampm = h >= 12 ? 'PM' : 'AM';
			const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
			slots.push({ min: m, label: `${h12}:${pad2(mm)} ${ampm}` });
		}
		return slots;
	}

	function scrollToNow() {
		if (!guideViewportEl) return;
		// Always start at the left edge
		guideViewportEl.scrollLeft = 0;
	}

	// ── HLS ──
	async function createPlayer() {
		playerError = null;
		try {
			if (!videoEl) return;
			if (!Hls) Hls = await hlsReady;
			if (!Hls.isSupported()) {
				if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
					// Safari native HLS fallback
					videoEl.src = playerStore.src;
					videoEl.addEventListener('loadedmetadata', () => { videoEl?.play().catch(() => {}); playerStore.setStatus('live', 'Live'); });
					return;
				}
				playerError = 'HLS playback is not supported in this browser.';
				playerStore.setStatus('error', playerError);
				return;
			}
			if (hls) { hls.destroy(); hls = null; }
			const h = new Hls({ liveSyncDurationCount: 2, liveMaxLatencyDurationCount: 4, liveDurationInfinity: true, enableWorker: true, lowLatencyMode: true });
			h.loadSource(playerStore.src);
			h.attachMedia(videoEl);
			h.on(Hls.Events.MANIFEST_PARSED, () => { videoEl?.play().catch(() => {}); playerStore.setStatus('live', 'Live'); playerError = null; retryDelay = 2000; });
			h.on(Hls.Events.ERROR, (_event: unknown, data: any) => {
				if (!data.fatal) return;
				if (data.type === Hls.ErrorTypes.MEDIA_ERROR) { playerStore.setStatus('buffering', 'Recovering...'); hls?.recoverMediaError(); }
				else { playerStore.setStatus('offline', 'Stream offline \u2014 retrying...'); setTimeout(createPlayer, retryDelay); retryDelay = Math.min(retryDelay * 1.5, MAX_RETRY_DELAY); }
			});
			hls = h;
			startStallWatch();
		} catch (e) {
			const msg = e instanceof Error ? e.message : 'Player failed to initialize';
			playerError = msg;
			playerStore.setStatus('error', msg);
		}
	}
	function startStallWatch() {
		if (stallTimer) clearInterval(stallTimer);
		stallTimer = setInterval(() => {
			if (videoEl && !videoEl.paused && videoEl.readyState >= 2) {
				if (videoEl.currentTime === lastTime) { playerStore.setStatus('buffering', 'Recovering...'); createPlayer(); }
				lastTime = videoEl.currentTime;
			}
		}, 8000);
	}
	function toggleFullscreen() {
		if (!playerWrapEl) return;
		if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
		else playerWrapEl.requestFullscreen().catch(() => {});
	}
	function toggleMute() {
		playerStore.toggleMute();
		if (!playerStore.muted && videoEl) {
			if (volume === 0) volume = 0.8;
			videoEl.volume = volume;
		}
	}
	function onVolumeInput(v: number) {
		volume = v;
		if (videoEl) videoEl.volume = v;
		if (v === 0 && !playerStore.muted) playerStore.muted = true;
		else if (v > 0 && playerStore.muted) playerStore.muted = false;
	}
	function togglePip() {
		if (!videoEl) return;
		if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
		else videoEl.requestPictureInPicture().catch(() => {});
	}

	// ── Federation ──
	async function tuneToChannel(uri: string) {
		tuning = true;
		const parsed = parseTltvUri(uri);
		if (!parsed) { playerStore.setStatus('error', 'Invalid tltv:// URI'); tuning = false; return; }
		const result = await resolveChannel(parsed, [homeNode], (msg) => { playerStore.setStatus('connecting', msg); }, location.protocol);
		if (!result) { tuning = false; return; }
	const fullUri = parsed.token
		? `tltv://${result.metadata.id}@${result.hint}?token=${encodeURIComponent(parsed.token)}`
		: `tltv://${result.metadata.id}@${result.hint}`;
	playerStore.setFederation(result, fullUri);
	document.title = `${result.metadata.name || 'tltv'} — tltv`;
	// Strip token from browser URL bar for privacy — keep it only in playerStore
	const displayUri = parsed.token
		? `tltv://${result.metadata.id}@${result.hint}`
		: fullUri;
	history.replaceState(history.state, '', `${location.pathname}?channel=${encodeURIComponent(displayUri)}`);
	try { localStorage.setItem('tltv_last_channel', displayUri); } catch {}
	channelInput = fullUri; showTuneInput = false; tuning = false;
	// Add to guide if not already present
	addChannelToGuide(result.metadata.id, result.metadata.name || result.metadata.id.substring(0, 12) + '...', result.hint, result.source || 'origin');
		createPlayer(); startFedGuidePoll();
	}
	function tuneToGuideChannel(ch: GuideChannel) {
		const hint = ch.hints[0] || homeNode;
		tuneToChannel(`tltv://${ch.id}@${hint}`);
	}

	/** Auto-tune to the home node's first channel on startup. */
	async function autoTuneHome() {
		playerStore.setStatus('connecting', 'Discovering home channel...');
		try {
			const wk = await fetchWellKnown(homeNode, location.protocol);
			if (!wk || !wk.channels?.length) {
				playerStore.setStatus('error', 'No channels found on home node');
				return;
			}
			const ch = wk.channels[0];
			await tuneToChannel(`tltv://${ch.id}@${homeNode}`);
		} catch {
			playerStore.setStatus('error', 'Failed to discover home channel');
		}
	}

	function copyUri() {
		if (!playerStore.currentUri) return;
		const flash = () => { copied = true; if (copiedTimer) clearTimeout(copiedTimer); copiedTimer = setTimeout(() => { copied = false; }, 1500); };
		if (navigator.clipboard) {
			navigator.clipboard.writeText(playerStore.currentUri).then(flash).catch(() => {});
		} else {
			// Fallback for non-secure contexts (HTTP dev)
			const ta = document.createElement('textarea');
			ta.value = playerStore.currentUri;
			ta.style.cssText = 'position:fixed;opacity:0';
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			document.body.removeChild(ta);
			flash();
		}
	}

	/** Add a channel to the guide list if not already present. */
	function addChannelToGuide(id: string, name: string, hint: string, source: ChannelSource) {
		if (guideChannels.some(c => c.id === id)) return;
		const ch: GuideChannel = { id, name, source, hints: [hint], blocks: [], guideVerified: null };
		guideChannels = [...guideChannels, ch];
		saveGuideChannels();
		fetchChannelGuide(ch);
	}

	// ── Discovery ──
	async function discoverGuideChannels() {
		try {
			const channels = await discoverChannels(homeNode, 20, location.protocol);
			let originIds = new Set<string>();
			let relayIds = new Set<string>();
			try {
				const wkResp = await fetch(`/.well-known/tltv`);
				if (wkResp.ok) {
					const wk = await wkResp.json();
					originIds = new Set((wk.channels || []).map((c: { id: string }) => c.id));
					relayIds = new Set((wk.relaying || []).map((c: { id: string }) => c.id));
					homeChannelIds = originIds;
				}
			} catch {}
			const getSource = (id: string, fallback: ChannelSource): ChannelSource =>
				originIds.has(id) ? 'origin' : relayIds.has(id) ? 'relay' : fallback;
			// Merge: update existing channels with fresh info, add newly discovered ones
			const existingIds = new Set(guideChannels.map(c => c.id));
			guideChannels = guideChannels.map(c => {
				const disc = channels.find(d => d.id === c.id);
				return disc ? { ...c, source: getSource(c.id, c.source), hints: disc.hints?.length ? disc.hints : c.hints, name: disc.name || c.name } : c;
			});
			for (const ch of channels) {
				if (!existingIds.has(ch.id)) {
					guideChannels = [...guideChannels, { id: ch.id, name: ch.name || ch.id.substring(0, 12) + '...', source: getSource(ch.id, 'peer'), hints: ch.hints || [], blocks: [], guideVerified: null }];
				}
			}
			saveGuideChannels();
			for (const ch of guideChannels) fetchChannelGuide(ch);
		} catch {
			// Discovery failure is non-fatal — guide may be empty.
		}
	}
	async function fetchChannelGuide(ch: GuideChannel) {
		const hint = ch.hints[0] || homeNode;
		const proto = location.protocol === 'http:' ? 'http' : 'https';
		const isLocal = hint.startsWith('localhost') || hint.startsWith('127.0.0.1');
		const baseUrl = isLocal ? `http://${hint}` : `${proto}://${hint}`;
		try {
			const resp = await fetch(`${baseUrl}/tltv/v1/channels/${ch.id}/guide.json`);
			if (!resp.ok) return;
			const data = await resp.json();
			if (!data?.entries) return;
			// Federation guide entries have full UTC ISO timestamps.
			// Convert to viewer's local minutes for guide grid positioning.
			const blocks = data.entries
				.filter((e: { start?: string; end?: string }) => e.start && e.end)
				.map((e: { start: string; end: string; title?: string }) => ({
					startMin: utcToLocalMinutes(e.start),
					endMin: utcToLocalMinutes(e.end),
					title: e.title || ch.name,
				}));
			guideChannels = guideChannels.map(c => c.id === ch.id ? { ...c, blocks } : c);
			verifyGuide(data).then(v => {
				guideChannels = guideChannels.map(c => c.id === ch.id ? { ...c, guideVerified: v } : c);
			});
		} catch {
			// Guide fetch failure for individual channel is non-fatal.
		}
	}

	// ── Polling ──
	let fedGuideTimer: ReturnType<typeof setInterval> | null = null;
	let metaRefreshTimer: ReturnType<typeof setInterval> | null = null;
	function startFedGuidePoll() {
		if (fedGuideTimer) clearInterval(fedGuideTimer);
		if (metaRefreshTimer) clearInterval(metaRefreshTimer);
		pollFedGuide();
		pollMetadataRefresh();
		fedGuideTimer = setInterval(pollFedGuide, 30000);
		metaRefreshTimer = setInterval(pollMetadataRefresh, 60000);
	}
	/** Refresh channel metadata per spec (~60s). Detects stream URL changes + migration. */
	function pollMetadataRefresh() {
		const r = playerStore.resolved; if (!r) return;
		let url = `${r.baseUrl}/tltv/v1/channels/${r.metadata.id}`;
		if (r.token) url += `?token=${encodeURIComponent(r.token)}`;
		fetch(url).then(resp => resp.ok ? resp.json() : null).then(async (doc) => {
			if (!doc) return;
			// Migration: server now returns a migration document
			if (doc.type === 'migration' && doc.to) {
				playerStore.setStatus('connecting', `Channel migrated to ${doc.to}`);
				tuneToChannel(`tltv://${doc.to}@${r.hint}`);
				return;
			}
			if (doc.v !== 1 || doc.id !== r.metadata.id) return;
			// Verify signature before trusting updated metadata
			const verified = await verifySignature(doc as Record<string, unknown>);
			if (verified === false) return;
			// Reject stale metadata (seq must not go backwards)
			if (doc.seq < r.metadata.seq) return;
			// Update stream URL if it changed
			const newStream = r.baseUrl + doc.stream + (r.token ? `?token=${encodeURIComponent(r.token)}` : '');
			if (newStream !== playerStore.src) {
				playerStore.src = newStream;
				createPlayer();
			}
			// Update display name if changed
			if (doc.name !== r.metadata.name) {
				playerStore.nowPlaying = doc.name || '';
				document.title = `${doc.name || 'TLTV'} — TLTV`;
			}
			// Store updated metadata
			playerStore.resolved = { ...r, metadata: doc, verified };
		}).catch(() => {});
	}
	function pollFedGuide() {
		const r = playerStore.resolved; if (!r) return;
		let url = `${r.baseUrl}/tltv/v1/channels/${r.metadata.id}/guide.json`;
		if (r.token) url += `?token=${encodeURIComponent(r.token)}`;
		fetch(url).then(resp => resp.ok ? resp.json() : null).then(data => {
			if (!data?.entries) return;
			verifyGuide(data).then(v => { tunedGuideVerified = v; });
			// Convert UTC timestamps to viewer's local time
			epgEntries = data.entries.map((e: { start?: string; end?: string; title?: string; category?: string }) => {
				const sd = e.start ? new Date(e.start) : null;
				const ed = e.end ? new Date(e.end) : null;
				return {
					date: sd ? `${sd.getFullYear()}-${pad2(sd.getMonth() + 1)}-${pad2(sd.getDate())}` : '',
					start: sd ? `${pad2(sd.getHours())}:${pad2(sd.getMinutes())}:${pad2(sd.getSeconds())}` : '',
					stop: ed ? `${pad2(ed.getHours())}:${pad2(ed.getMinutes())}:${pad2(ed.getSeconds())}` : '',
					title: e.title || '', category: e.category || '', type: e.category || 'playlist',
				};
			});
		}).catch(() => {});
	}

	// ── Lifecycle ──
	onMount(() => {
		// Restore saved guide channels before discovery
		const saved = loadGuideChannels();
		if (saved.length) {
			guideChannels = saved;
			for (const ch of saved) fetchChannelGuide(ch);
		}
		const params = new URLSearchParams(location.search);
		const channel = params.get('channel');
		if (channel) { channelInput = channel; tuneToChannel(channel); }
		else {
			// Priority: last tuned → configured default → auto-discover
			let lastCh = '';
			try { lastCh = localStorage.getItem('tltv_last_channel') || ''; } catch {}
			if (lastCh) { channelInput = lastCh; tuneToChannel(lastCh); }
			else {
				let defaultCh = '';
				try { defaultCh = localStorage.getItem('tltv_default_channel') || ''; } catch {}
				if (defaultCh) { channelInput = defaultCh; tuneToChannel(defaultCh); }
				else { autoTuneHome(); }
			}
		}
		discoverGuideChannels();
		pipSupported = !!document.pictureInPictureEnabled;
		if (videoEl) videoEl.volume = volume;
		clockTimer = setInterval(() => { nowMinutes = getNowMinutes(); clockDisplay = formatClock(); }, 5000);
		setTimeout(scrollToNow, 500);
		const onVis = () => { if (document.visibilityState === 'visible') createPlayer(); };
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});
	onDestroy(() => {
		if (hls) hls.destroy(); if (stallTimer) clearInterval(stallTimer);
		if (fedGuideTimer) clearInterval(fedGuideTimer); if (metaRefreshTimer) clearInterval(metaRefreshTimer);
		if (clockTimer) clearInterval(clockTimer);
	});

	function getCurrentChannelId(): string {
		if (playerStore.resolved) return playerStore.resolved.metadata.id;
		return guideChannels.find(c => c.source === 'origin')?.id || '';
	}
	/**
	 * Dot color class for a guide channel.
	 *   green  — origin + guide verified (or no guide yet)
	 *   yellow — relay, peer, or origin with failed guide sig
	 */
	function channelDotClass(ch: GuideChannel): string {
		if (ch.source === 'origin' && ch.guideVerified !== false) return 'dot-ok';
		return 'dot-warn';
	}
	/**
	 * Dot color class for the currently tuned channel (player overlay).
	 *   green  — origin + nothing explicitly failed
	 *   yellow — relay/peer, or verification explicitly failed
	 */
	function tunedDotClass(): string {
		const r = playerStore.resolved;
		if (!r) return 'dot-ok'; // local mode
		if (r.source === 'origin' && r.verified !== false && tunedGuideVerified !== false) return 'dot-ok';
		return 'dot-warn';
	}
	function getChannelName(): string {
		if (playerStore.resolved) return playerStore.resolved.metadata.name || 'Unknown';
		return guideChannels.find(c => c.source === 'origin')?.name || 'TLTV';
	}
	function formatMinutes(min: number): string {
		const wrapped = ((min % 1440) + 1440) % 1440;
		const h = Math.floor(wrapped / 60);
		const m = Math.round(wrapped % 60);
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		return `${h12}:${pad2(m)} ${ampm}`;
	}
	function getCurrentProgram(): string {
		const chId = getCurrentChannelId();
		const ch = guideChannels.find(c => c.id === chId);
		if (ch) {
			const block = ch.blocks.find(b => nowMinutes >= b.startMin && nowMinutes < b.endMin);
			if (block) return block.title;
		}
		for (const e of epgEntries) {
			const startMin = parseTime(e.start);
			const stopMin = parseTime(e.stop);
			if (nowMinutes >= startMin && nowMinutes < stopMin) return e.title;
		}
		return '';
	}
</script>

<svelte:head><title>tltv</title></svelte:head>

<div class="viewer">
	<div class="player-block">
		<div class="player" bind:this={playerWrapEl}>
			<video bind:this={videoEl} playsinline muted={playerStore.muted}></video>
			{#if playerError}
				<div class="overlay overlay-error">
					<div class="overlay-msg">{playerError}</div>
					<button class="retry-btn" onclick={() => createPlayer()}>retry</button>
				</div>
			{:else if playerStore.status !== 'live'}
				<div class="overlay">
					{#if playerStore.status === 'connecting' || playerStore.status === 'buffering'}
						<div class="spinner"></div>
					{/if}
					<div class="overlay-msg">{playerStore.statusMessage}</div>
				</div>
			{/if}
		</div>

		<div class="controls-bar">
			<span class="bar-name">{getChannelName()}</span>
			{#if getCurrentProgram()}<span class="bar-sep">/</span><span class="bar-program">{getCurrentProgram()}</span>{/if}
			<span class="bar-spacer"></span>
			<button class="bar-btn" onclick={toggleMute} title={playerStore.muted ? 'Unmute' : 'Mute'}>
				{#if playerStore.muted}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
				{:else if volume < 0.5}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a3.5 3.5 0 0 1 0 7.07"></path></svg>
				{:else}
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
				{/if}
			</button>
			<input class="volume-slider" type="range" min="0" max="1" step="0.05"
				value={playerStore.muted ? 0 : volume}
				oninput={(e) => onVolumeInput(Number((e.target as HTMLInputElement).value))}
				title="Volume" />
			{#if pipSupported}
				<button class="bar-btn" onclick={togglePip} title="Picture in Picture">
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14"></rect><rect x="12" y="9" width="8" height="6" fill="currentColor" stroke="none" opacity="0.5"></rect></svg>
				</button>
			{/if}
			<button class="bar-btn" onclick={toggleFullscreen} title="Fullscreen">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
			</button>
		</div>
	</div>

	<div class="channel-bar">
		{#if playerStore.currentUri && !showTuneInput}
			<button class="uri-btn" class:copied onclick={copyUri} title="Click to copy">{#if copied}copied{:else}{playerStore.currentUri}{/if}</button>
			<span class="bar-spacer"></span>
			{#if canRemoveCurrentChannel()}
				<button class="text-btn" onclick={removeCurrentChannel}>remove</button>
			{/if}
			<button class="text-btn" onclick={() => { showTuneInput = true; channelInput = ''; }}>tune</button>
		{:else}
			<input class="tune-input" type="text" bind:value={channelInput} placeholder="tltv://" spellcheck="false"
				onkeydown={(e) => { if (e.key === 'Enter' && channelInput.trim()) tuneToChannel(channelInput.trim()); if (e.key === 'Escape') showTuneInput = false; }} />
			<button class="text-btn" disabled={tuning || !channelInput.trim()} onclick={() => tuneToChannel(channelInput.trim())}>{tuning ? '...' : 'go'}</button>
			{#if playerStore.currentUri}
				<button class="text-btn" onclick={() => showTuneInput = false}>cancel</button>
			{/if}
		{/if}
	</div>

	<div class="guide">
		<div class="guide-inner">
			<div class="guide-labels">
				<div class="guide-corner">{clockDisplay}</div>
				{#each sortedGuideChannels() as ch}
					<button class="guide-label" class:active={getCurrentChannelId() === ch.id} onclick={() => tuneToGuideChannel(ch)}>
						<span class="label-name truncate">{ch.name}</span>
					</button>
				{/each}
				{#if guideChannels.length === 0}
					<div class="guide-label empty">no channels</div>
				{/if}
			</div>

			<div class="guide-viewport" bind:this={guideViewportEl}>
				<div class="guide-timeline" style="width: {getGuideWidth()}px">
					<div class="time-header">
						{#each getTimeSlots() as slot}
							<div class="time-mark" style="left: {(slot.min - getGuideStart()) * PX_PER_MIN}px; width: {SLOT_MIN * PX_PER_MIN}px">{slot.label}</div>
						{/each}
					</div>

					{#each sortedGuideChannels() as ch}
						{@const guideStart = getGuideStart()}
						{@const guideEnd = getGuideEnd()}
						{@const hasSchedule = ch.blocks.length > 0}
						{@const blocks = hasSchedule ? ch.blocks : [{ startMin: guideStart, endMin: guideEnd, title: ch.name }]}
						<div class="guide-row" class:active={getCurrentChannelId() === ch.id}>
							{#each blocks as block}
								{@const clampStart = Math.max(block.startMin, guideStart)}
								{@const clampEnd = Math.min(block.endMin, guideEnd)}
								{#if clampEnd > clampStart}
									{@const left = (clampStart - guideStart) * PX_PER_MIN}
									{@const width = Math.max((clampEnd - clampStart) * PX_PER_MIN, 2)}
									{@const isNow = nowMinutes >= clampStart && nowMinutes < clampEnd}
									{@const progress = isNow && hasSchedule ? ((nowMinutes - clampStart) / (clampEnd - clampStart)) * 100 : 0}
									<div class="guide-cell" class:now={isNow && hasSchedule}
										style="left: {left}px; width: {width}px;{isNow && hasSchedule ? ` --progress: ${progress}%` : ''}"
										title={hasSchedule ? `${block.title} — ${formatMinutes(block.startMin)} to ${formatMinutes(block.endMin)}` : `${ch.name} — No schedule available`}
										role="button" tabindex="0"
										onclick={() => tuneToGuideChannel(ch)}
										onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tuneToGuideChannel(ch); } }}>
										{#if width > 50}<span class="cell-title truncate">{block.title}</span>{/if}
									</div>
								{/if}
							{/each}
						</div>
					{/each}

					{#if guideChannels.length === 0}
						<div class="guide-row">
							<div class="guide-cell" style="left: 0; width: {getGuideWidth()}px"><span class="cell-title">discovering channels...</span></div>
						</div>
					{/if}

					{#if (nowMinutes - getGuideStart()) * PX_PER_MIN >= 0}
						<div class="now-line" style="left: {(nowMinutes - getGuideStart()) * PX_PER_MIN}px"></div>
					{/if}
				</div>
			</div>
		</div>
	</div>

	<footer class="viewer-footer">
		<div class="footer-left">
			<a href="https://timelooptv.org" class="footer-mark" aria-label="timelooptv.org">
				<svg viewBox="0 0 491.3 349.8" fill="currentColor" aria-hidden="true">
					<g transform="translate(-0.18,349.81) scale(0.1,-0.1)"><path d="M2050 3493 c-881 -31 -1492 -102 -1671 -194 -95 -48 -171 -145 -214 -272 -98 -292 -154 -705 -162 -1192 -8 -497 27 -842 127 -1233 48 -187 74 -246 140 -316 96 -102 195 -137 505 -181 756 -105 1734 -133 2665 -75 330 21 800 78 959 117 195 47 311 159 370 358 52 179 98 442 128 735 24 242 24 784 0 1030 -40 397 -116 746 -191 874 -34 58 -117 133 -179 161 -243 111 -1187 198 -2092 193 -170 -1 -344 -3 -385 -5z m-246 -993 c33 -5 92 -25 132 -44 68 -32 101 -64 609 -571 296 -295 547 -543 559 -550 17 -11 80 -15 299 -15 392 -2 361 -37 365 410 3 365 0 389 -57 427 -33 23 -39 23 -303 23 -177 0 -277 -4 -291 -11 -12 -6 -95 -84 -185 -172 l-162 -162 -113 113 -112 112 170 170 c178 178 221 211 320 250 57 22 75 24 326 28 170 2 293 0 340 -7 193 -30 343 -175 378 -365 14 -76 15 -704 1 -777 -15 -79 -67 -177 -124 -235 -58 -57 -156 -109 -235 -124 -70 -13 -552 -13 -622 0 -30 5 -85 26 -124 45 -64 31 -111 75 -580 545 -280 282 -532 529 -558 551 l-49 39 -278 0 -278 0 -30 -25 c-52 -43 -53 -53 -50 -424 l3 -343 37 -34 c22 -20 49 -35 65 -35 100 -6 532 5 548 13 11 6 92 82 180 169 l160 159 113 -113 112 -113 -183 -182 c-262 -260 -269 -262 -677 -262 -141 0 -281 5 -311 10 -170 32 -310 164 -355 335 -10 37 -14 143 -14 423 0 351 1 376 21 434 52 156 176 269 332 303 75 16 530 20 621 5z"/></g>
				</svg>
			</a>
			<a href="https://spec.timelooptv.org">spec</a>
			<a href="https://github.com/tltv-org">github</a>
			<span class="footer-sep" aria-hidden="true">|</span>
			<a href="/control">control</a>
		</div>
		<a href="/license">MIT License</a>
	</footer>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 0 1rem;
		padding-top: 1.25rem;
		min-height: calc(100vh - 45px);
	}

	/* ── Player ── */
	.player-block {
		width: 100%;
		max-width: 1100px;
		overflow: hidden;
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--bg);
	}
	.player {
		position: relative;
		background: #000;
		aspect-ratio: 16 / 9;
	}
	video { width: 100%; height: 100%; display: block; object-fit: contain; }

	.overlay {
		position: absolute; inset: 0;
		background: rgba(0, 0, 0, 0.88);
		display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 0.75rem;
		z-index: 10;
	}
	.overlay-msg { font-size: 0.75rem; color: rgba(255, 255, 255, 0.5); }
	.overlay-error .overlay-msg { color: var(--accent); }
	.retry-btn {
		margin-top: 0.5rem; padding: 0.35rem 1rem;
		background: transparent; border: 1.5px solid rgba(255, 255, 255, 0.3);
		color: #fff; font-size: 0.75rem; cursor: pointer;
	}
	.retry-btn:hover { border-color: #fff; }
	.spinner {
		width: 14px; height: 14px;
		border: 1.5px solid rgba(255, 255, 255, 0.15); border-top-color: rgba(255, 255, 255, 0.5);
		border-radius: 50%; animation: spin 1s linear infinite;
	}

	/* Controls bar */
	.controls-bar {
		display: flex; align-items: center; gap: 0.5rem;
		height: 36px; padding: 0;
	}
	.bar-name {
		font-size: 0.85rem; font-weight: 600;
		color: var(--fg); white-space: nowrap;
	}
	.bar-sep { font-size: 0.8rem; color: var(--fg-faint); }
	.bar-program {
		font-size: 0.8rem; color: var(--fg-muted);
		overflow: hidden; text-overflow: ellipsis;
		white-space: nowrap; min-width: 0;
	}
	.bar-spacer { flex: 1; }
	.bar-btn {
		background: none; border: none; color: var(--fg);
		padding: 4px; display: flex; align-items: center; cursor: pointer;
		opacity: 0.7;
	}
	.bar-btn:hover { opacity: 1; }

	.volume-slider {
		width: 50px; height: 2px;
		-webkit-appearance: none; appearance: none;
		background: var(--rule);
		border: none; outline: none; cursor: pointer; padding: 0;
	}
	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 8px; height: 8px;
		background: var(--fg); cursor: pointer;
	}
	.volume-slider::-moz-range-thumb {
		width: 8px; height: 8px;
		background: var(--fg); border: none; cursor: pointer;
	}
	.volume-slider::-moz-range-track { background: var(--rule); height: 2px; border: none; }

	/* ── Channel bar ── */
	.channel-bar {
		width: 100%; max-width: 1100px;
		display: flex; align-items: center; gap: 0.5rem;
		padding: 0.6rem 0;
		font-size: 0.8rem;
	}
	.uri-btn {
		background: none; border: none; color: var(--fg-faint);
		font-size: 0.8rem; padding: 0; cursor: pointer;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
	}
	.uri-btn:hover { color: var(--fg); }
	.uri-btn.copied { color: var(--fg-muted); }
	.text-btn {
		background: none; border: none; color: var(--fg);
		font-size: 0.8rem; cursor: pointer; padding: 0;
	}
	.text-btn:hover:not(:disabled) { color: var(--fg-muted); }
	.text-btn:disabled { opacity: 0.3; }
	.tune-input {
		flex: 1; background: none; border: none; color: var(--fg);
		font-size: 0.8rem; outline: none; padding: 0;
	}
	.tune-input::placeholder { color: var(--fg-faint); }

	/* ── Guide ── */
	.guide {
		width: 100%; max-width: 1100px;
		border-top: 1px solid var(--rule);
		padding-top: 0.75rem;
	}
	.guide-inner { display: flex; }

	.guide-labels { flex-shrink: 0; width: 140px; }
	.guide-corner {
		height: 24px;
		display: flex; align-items: center;
		font-size: 0.75rem; color: var(--fg-faint);
		font-variant-numeric: tabular-nums;
	}

	.guide-label {
		height: 36px;
		display: flex; align-items: center;
		padding: 0;
		border: none;
		background: none; color: var(--fg-muted);
		font-size: 0.8rem; text-align: left; cursor: pointer;
		width: 100%; min-width: 0;
	}
	.guide-label:hover { color: var(--fg); }
	.guide-label.active { color: var(--fg); font-weight: 700; }
	.guide-label.empty { cursor: default; color: var(--fg-faint); }

	.label-name { min-width: 0; }

	/* Timeline */
	.guide-viewport {
		flex: 1; overflow-x: auto; overflow-y: hidden; min-width: 0;
	}
	.guide-timeline { position: relative; min-height: 100%; }
	.time-header { height: 24px; position: relative; }
	.time-mark {
		position: absolute; top: 0; height: 100%;
		display: flex; align-items: center; padding-left: 6px;
		font-size: 0.7rem; color: var(--fg-faint);
		border-left: 1px solid var(--rule); box-sizing: border-box;
		font-variant-numeric: tabular-nums;
	}

	.guide-row {
		position: relative; height: 36px;
		border-top: 1px solid var(--rule);
	}

	.guide-cell {
		position: absolute; top: 1px; height: calc(100% - 1px);
		display: flex; align-items: center; padding: 0 8px;
		cursor: pointer;
		box-sizing: border-box; overflow: hidden;
	}
	.guide-cell:hover .cell-title { color: var(--fg); }
	.guide-cell:focus-visible { outline: 1px solid var(--fg-muted); outline-offset: -1px; z-index: 5; }
	.guide-cell.now { border-left: 2px solid var(--fg); }
	.cell-title {
		font-size: 0.75rem; color: var(--fg-faint);
		min-width: 0; overflow: hidden;
		text-overflow: ellipsis; white-space: nowrap;
	}

	/* Now line */
	.now-line {
		position: absolute; top: 0; bottom: 0; width: 1px;
		background: var(--accent); z-index: 10; pointer-events: none;
	}

	/* ── Footer ── */
	.viewer-footer {
		width: 100%; max-width: 1100px;
		border-top: 1px solid var(--rule);
		margin-top: auto;
		padding: 2.5rem 2rem 4rem;
		display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap;
		font-size: 0.85rem;
		font-family: var(--font-sans);
		color: var(--fg-faint);
	}
	.footer-left {
		display: flex; align-items: center; gap: 1.5rem;
	}
	.footer-mark {
		display: flex; align-items: center;
		color: var(--fg-faint); opacity: 0.4;
		border-bottom: none;
	}
	.footer-mark:hover { opacity: 0.7; }
	.footer-mark svg { height: 14px; width: auto; }
	.footer-sep { color: var(--fg-faint); }
	.viewer-footer a {
		color: var(--fg-faint);
		text-decoration: none;
		border-bottom: 1px solid var(--rule);
	}
	.viewer-footer a:hover { color: var(--fg); }

	:global(:fullscreen) video { width: 100%; height: 100%; }

	@media (max-width: 640px) {
		.viewer { padding: 0 0.75rem; }
		.guide-labels { width: 90px; }
		.guide-label { height: 30px; font-size: 0.6rem; }
		.guide-row { height: 30px; }
		.guide-corner { height: 20px; font-size: 0.55rem; }
		.time-header { height: 20px; }
		.time-mark { font-size: 0.5rem; }
		.channel-bar { font-size: 0.65rem; }
		.controls-bar { height: 30px; }
		.bar-program { display: none; }
		.bar-sep { display: none; }
		.volume-slider { display: none; }
		.viewer-footer { margin-top: 1.5rem; padding: 1.5rem 1rem 2rem; font-size: 0.75rem; }
	}
</style>
