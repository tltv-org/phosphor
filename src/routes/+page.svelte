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

	function formatClock(): string {
		const now = new Date();
		const h = now.getHours();
		const m = now.getMinutes();
		const ampm = h >= 12 ? 'PM' : 'AM';
		const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
		return `${h12}:${pad2(m)} ${ampm}`;
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
		// Now line is at (nowMinutes - guideStart) * PX_PER_MIN in the timeline
		// Scroll so it sits ~80px from the left
		const nowPos = (nowMinutes - getGuideStart()) * PX_PER_MIN;
		guideViewportEl.scrollLeft = Math.max(0, nowPos - 80);
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
	document.title = `${result.metadata.name || 'TLTV'} — TLTV`;
	// Strip token from browser URL bar for privacy — keep it only in playerStore
	const displayUri = parsed.token
		? `tltv://${result.metadata.id}@${result.hint}`
		: fullUri;
	history.replaceState(null, '', `${location.pathname}?channel=${encodeURIComponent(displayUri)}`);
	channelInput = fullUri; showTuneInput = false; tuning = false;
		createPlayer(); startFedGuidePoll();
	}
	function tuneToGuideChannel(ch: GuideChannel) { tuneToChannel(`tltv://${ch.id}`); }

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

	// ── Discovery ──
	async function discoverGuideChannels() {
		try {
			const channels = await discoverChannels(homeNode, 20, location.protocol);
			guideChannels = channels.map(ch => ({ id: ch.id, name: ch.name || ch.id.substring(0, 12) + '...', source: 'origin' as ChannelSource, hints: ch.hints || [], blocks: [], guideVerified: null }));
			const wkResp = await fetch(`/.well-known/tltv`);
			if (wkResp.ok) {
				const wk = await wkResp.json();
				const originIds = new Set((wk.channels || []).map((c: { id: string }) => c.id));
				const relayIds = new Set((wk.relaying || []).map((c: { id: string }) => c.id));
				guideChannels = guideChannels.map(ch => ({ ...ch, source: originIds.has(ch.id) ? 'origin' as ChannelSource : relayIds.has(ch.id) ? 'relay' as ChannelSource : 'peer' as ChannelSource }));
			}
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
		const params = new URLSearchParams(location.search);
		const channel = params.get('channel');
		if (channel) { channelInput = channel; tuneToChannel(channel); }
		else {
			// Check for a default channel set in Client settings
			let defaultCh = '';
			try { defaultCh = localStorage.getItem('tltv_default_channel') || ''; } catch {}
			if (defaultCh) { channelInput = defaultCh; tuneToChannel(defaultCh); }
			else { autoTuneHome(); }
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

<svelte:head><title>TLTV</title></svelte:head>

<div class="viewer">
	<!-- Block 1: Player + controls -->
	<div class="player-block">
		<div class="player" bind:this={playerWrapEl}>
			<video bind:this={videoEl} playsinline muted={playerStore.muted}></video>
			{#if playerError}
				<div class="overlay overlay-error">
					<div class="overlay-brand">TLTV</div>
					<div class="overlay-msg">{playerError}</div>
					<button class="retry-btn" onclick={() => createPlayer()}>Retry</button>
				</div>
			{:else if playerStore.status !== 'live'}
				<div class="overlay">
					<div class="overlay-brand">TLTV</div>
					{#if playerStore.status === 'connecting' || playerStore.status === 'buffering'}
						<div class="spinner"></div>
					{/if}
					<div class="overlay-msg">{playerStore.statusMessage}</div>
				</div>
			{/if}
			<!-- Source dot in top-left corner -->
			<div class="source-dot {tunedDotClass()}"></div>
		</div>
		<div class="controls-bar">
			<span class="bar-name">{getChannelName()}</span>
			{#if getCurrentProgram()}<span class="bar-program">{getCurrentProgram()}</span>{/if}
			<span class="bar-spacer"></span>
			<button class="bar-btn" onclick={toggleMute} title={playerStore.muted ? 'Unmute' : 'Mute'}>
				{#if playerStore.muted}
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
				{:else if volume < 0.5}
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a3.5 3.5 0 0 1 0 7.07"></path></svg>
				{:else}
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>
				{/if}
			</button>
			<input class="volume-slider" type="range" min="0" max="1" step="0.05"
				value={playerStore.muted ? 0 : volume}
				oninput={(e) => onVolumeInput(Number((e.target as HTMLInputElement).value))}
				title="Volume" />
			{#if pipSupported}
				<button class="bar-btn" onclick={togglePip} title="Picture in Picture">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"></rect><rect x="12" y="9" width="8" height="6" rx="1" fill="currentColor" stroke="none" opacity="0.6"></rect></svg>
				</button>
			{/if}
			<button class="bar-btn" onclick={toggleFullscreen} title="Fullscreen">
				<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
			</button>
		</div>
	</div>

	<!-- Block 2: Channel bar + guide -->
	<div class="guide-block">
		<!-- Channel bar -->
		<div class="channel-bar">
			{#if playerStore.currentUri && !showTuneInput}
				<button class="uri-btn mono" class:copied onclick={copyUri} title="Click to copy">{#if copied}Copied!{:else}{playerStore.currentUri}{/if}</button>
				<span class="bar-spacer"></span>
				<button class="text-btn" onclick={() => { showTuneInput = true; channelInput = ''; }}>Tune</button>
			{:else}
				<input class="tune-input mono" type="text" bind:value={channelInput} placeholder="tltv://" spellcheck="false"
					onkeydown={(e) => { if (e.key === 'Enter' && channelInput.trim()) tuneToChannel(channelInput.trim()); if (e.key === 'Escape') showTuneInput = false; }} />
				<button class="text-btn" disabled={tuning || !channelInput.trim()} onclick={() => tuneToChannel(channelInput.trim())}>{tuning ? '...' : 'Go'}</button>
				{#if playerStore.currentUri}
					<button class="text-btn" onclick={() => showTuneInput = false}>Cancel</button>
				{/if}
			{/if}
		</div>

		<!-- Guide -->
		<div class="guide">
			<div class="guide-inner">
				<div class="guide-labels">
					<div class="guide-corner">{clockDisplay}</div>
					{#each guideChannels as ch}
						<button class="guide-label" class:active={getCurrentChannelId() === ch.id} onclick={() => tuneToGuideChannel(ch)}>
							<span class="label-dot {channelDotClass(ch)}"></span>
							<span class="label-name truncate">{ch.name}</span>
						</button>
					{/each}
					{#if guideChannels.length === 0}
						<div class="guide-label empty">No channels</div>
					{/if}
				</div>

				<div class="guide-viewport" bind:this={guideViewportEl}>
					<div class="guide-timeline" style="width: {getGuideWidth()}px">
						<!-- Time header -->
						<div class="time-header">
							{#each getTimeSlots() as slot}
								<div class="time-mark" style="left: {(slot.min - getGuideStart()) * PX_PER_MIN}px; width: {SLOT_MIN * PX_PER_MIN}px">{slot.label}</div>
							{/each}
						</div>

						<!-- Channel rows -->
						{#each guideChannels as ch}
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
								<div class="guide-cell" style="left: 0; width: {getGuideWidth()}px"><span class="cell-title">Discovering channels...</span></div>
							</div>
						{/if}

						<!-- Red now line — inside the timeline, scrolls with content -->
						{#if (nowMinutes - getGuideStart()) * PX_PER_MIN >= 0}
							<div class="now-line" style="left: {(nowMinutes - getGuideStart()) * PX_PER_MIN}px"></div>
						{/if}
					</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.viewer {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 1rem;
		gap: 0.5rem;
		background: var(--bg-base);
	}

	/* ── Block 1: Player ── */
	.player-block {
		width: 100%;
		max-width: 1100px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-surface);
		position: sticky;
		top: 0;
		z-index: 20;
	}
	.player {
		position: relative;
		background: var(--player-bg);
		aspect-ratio: 16 / 9;
	}
	video { width: 100%; height: 100%; display: block; object-fit: contain; }

	.overlay {
		position: absolute; inset: 0;
		background: var(--bg-overlay);
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.75rem;
		z-index: 10;
	}
	.overlay-brand { font-size: 1.2rem; font-weight: 700; letter-spacing: 0.15em; color: var(--text-secondary); }
	.overlay-msg { font-size: 0.8rem; color: var(--text-muted); }
	.overlay-error .overlay-msg { color: #ef4444; }
	.retry-btn {
		margin-top: 0.75rem; padding: 0.35rem 1rem; background: rgba(255,255,255,0.1);
		border: 1px solid rgba(255,255,255,0.2); color: var(--text-primary); border-radius: 4px;
		font-size: 0.8rem; cursor: pointer;
	}
	.retry-btn:hover { background: rgba(255,255,255,0.15); }
	.spinner { width: 18px; height: 18px; border: 2px solid var(--border-default); border-top-color: var(--text-secondary); border-radius: 50%; animation: spin 1s linear infinite; }

	/* Source dot — top-left of player */
	.source-dot {
		position: absolute;
		top: 10px;
		left: 10px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		z-index: 15;
	}
	.dot-ok { background: #4ade80; box-shadow: 0 0 4px rgba(74, 222, 128, 0.5); }
	.dot-warn { background: #fbbf24; box-shadow: 0 0 4px rgba(251, 191, 36, 0.5); }

	/* Controls bar */
	.controls-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 36px;
		padding: 0 0.75rem;
		border-top: 1px solid var(--border-default);
	}
	.bar-name { font-size: 0.8rem; font-weight: 600; color: var(--text-primary); white-space: nowrap; }
	.bar-program { font-size: 0.75rem; color: var(--text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
	.bar-spacer { flex: 1; }
	.bar-btn {
		background: none; border: none; color: var(--text-secondary);
		padding: 4px; display: flex; align-items: center; cursor: pointer;
	}
	.bar-btn:hover { color: var(--text-primary); }

	/* Volume slider */
	.volume-slider {
		width: 60px;
		height: 4px;
		-webkit-appearance: none;
		appearance: none;
		background: var(--border-default);
		border: none;
		border-radius: 2px;
		outline: none;
		cursor: pointer;
		padding: 0;
	}
	.volume-slider::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-secondary);
		cursor: pointer;
	}
	.volume-slider::-webkit-slider-thumb:hover { background: var(--text-primary); }
	.volume-slider::-moz-range-thumb {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: var(--text-secondary);
		border: none;
		cursor: pointer;
	}
	.volume-slider::-moz-range-thumb:hover { background: var(--text-primary); }
	.volume-slider::-moz-range-track { background: var(--border-default); height: 4px; border-radius: 2px; border: none; }

	/* ── Block 2: Guide ── */
	.guide-block {
		width: 100%;
		max-width: 1100px;
		border: 1px solid var(--border-default);
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--bg-surface);
	}

	/* Channel bar */
	.channel-bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		height: 32px;
		padding: 0 0.75rem;
		border-bottom: 1px solid var(--border-subtle);
		font-size: 0.75rem;
	}
	.uri-btn {
		background: none; border: none; color: var(--text-muted);
		font-size: 0.8rem; padding: 0; cursor: pointer;
		overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
	}
	.uri-btn:hover { color: var(--text-primary); }
	.uri-btn.copied { color: var(--accent); }
	.text-btn {
		background: none; border: none; color: var(--text-secondary);
		font-size: 0.75rem; cursor: pointer; padding: 2px 6px;
	}
	.text-btn:hover:not(:disabled) { color: var(--accent); }
	.text-btn:disabled { opacity: 0.3; }
	.tune-input {
		flex: 1; background: none; border: none; color: var(--text-primary);
		font-size: 0.8rem; outline: none; padding: 0;
	}
	.tune-input::placeholder { color: var(--text-muted); }

	/* Guide */
	.guide { background: var(--epg-bg); padding-bottom: 4px; }
	.guide-inner { display: flex; }

	.guide-labels {
		flex-shrink: 0;
		width: 140px;
		border-right: 1px solid var(--border-default);
		padding-bottom: 10px;
	}
	.guide-corner {
		height: 32px;
		display: flex; align-items: center; justify-content: center; gap: 0.3rem;
		font-size: 0.7rem; color: var(--text-secondary);
		border-bottom: 1px solid var(--border-default);
	}

	.guide-label {
		height: 48px;
		display: flex; align-items: center; gap: 0.4rem;
		padding: 0 0.5rem;
		border: none; border-bottom: 1px solid var(--border-subtle);
		background: none; color: var(--text-secondary);
		font-size: 0.75rem; text-align: left; cursor: pointer; width: 100%; min-width: 0;
	}
	.guide-label:hover { color: var(--text-primary); background: var(--bg-surface-raised); }
	.guide-label.active { color: var(--accent); background: var(--bg-surface); }
	.guide-label.empty { cursor: default; color: var(--text-muted); justify-content: center; font-style: italic; }

	/* Colored dot in guide labels */
	.label-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.label-name { min-width: 0; }

	/* Timeline */
	.guide-viewport {
		flex: 1; overflow-x: auto; overflow-y: hidden; min-width: 0;
		scrollbar-width: thin;
		scrollbar-color: var(--border-focus) transparent;
	}
	.guide-viewport::-webkit-scrollbar { height: 6px; }
	.guide-viewport::-webkit-scrollbar-track { background: transparent; }
	.guide-viewport::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }
	.guide-viewport::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
	.guide-timeline { position: relative; min-height: 100%; padding-bottom: 10px; }
	.time-header { height: 32px; position: relative; border-bottom: 1px solid var(--border-default); }
	.time-mark {
		position: absolute; top: 0; height: 100%;
		display: flex; align-items: center; padding-left: 6px;
		font-size: 0.65rem; color: var(--text-muted);
		border-left: 1px solid var(--border-subtle); box-sizing: border-box;
	}

	.guide-row { position: relative; height: 48px; border-bottom: 1px solid var(--border-subtle); }
	.guide-row.active { background: var(--bg-surface); }

	.guide-cell {
		position: absolute; top: 3px; height: calc(100% - 6px);
		display: flex; align-items: center; padding: 0 8px;
		cursor: pointer; background: var(--epg-block-playlist);
		border-right: 1px solid var(--epg-bg); border-radius: var(--radius-sm);
		box-sizing: border-box; transition: filter 0.1s;
		overflow: hidden;
	}
	.guide-cell:hover { filter: brightness(1.3); }
	.guide-cell:focus-visible { outline: 2px solid var(--border-focus); outline-offset: -2px; z-index: 5; }
	.guide-cell.now { border-left: 3px solid var(--epg-now-marker); }
	.guide-cell.now::before {
		content: '';
		position: absolute;
		left: 0; top: 0; bottom: 0;
		width: var(--progress, 0%);
		background: rgba(255, 255, 255, 0.06);
		pointer-events: none;
	}
	.cell-title { font-size: 0.7rem; color: var(--epg-text); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

	/* Now line — inside the scrollable timeline, moves with content */
	.now-line {
		position: absolute; top: 0; bottom: 0; width: 2px;
		background: var(--epg-now-marker); z-index: 10; pointer-events: none;
	}

	:global(:fullscreen) video { width: 100%; height: 100%; }

	@media (max-width: 640px) {
		.viewer { padding: 0; gap: 0; }
		.player-block { border-radius: 0; border-left: none; border-right: none; }
		.guide-block { border-radius: 0; border-left: none; border-right: none; }
		.guide-labels { width: 90px; padding-bottom: 6px; }
		.guide-label { height: 40px; font-size: 0.68rem; padding: 0 0.35rem; }
		.guide-row { height: 40px; }
		.guide-corner { height: 26px; font-size: 0.65rem; }
		.time-header { height: 26px; }
		.time-mark { font-size: 0.55rem; }
		.channel-bar { height: 28px; }
		.controls-bar { height: 32px; }
		.label-dot { display: none; }
		.bar-program { display: none; }
		.volume-slider { display: none; }
	}
</style>
