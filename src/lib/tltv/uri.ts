import type { TltvUri, ResolvedChannel, ChannelMetadata, MigrationDocument, ChannelSource, WellKnownResponse } from './types';
import { verifySignature } from './crypto';
import { fetchPeers, fetchWellKnown } from './discovery';

const MAX_MIGRATION_HOPS = 5;

/**
 * Determine channel source using the signed origins field.
 *
 * The `origins` array in channel metadata is part of the signed document —
 * unforgeable without the channel's private key. We compare the serving
 * node's hostname against this array to determine if it's an origin or relay.
 *
 * Comparison is hostname-only (port stripped) to avoid false negatives when
 * port formats differ (e.g. default port omitted vs explicit).
 *
 * @param hint - The node we're connected to (host:port).
 * @param metadata - Signed channel metadata.
 * @param fallback - Source to use if origins is absent or empty (default: 'relay').
 */
export function determineSource(
	hint: string,
	metadata: ChannelMetadata,
	fallback: ChannelSource = 'relay'
): ChannelSource {
	if (!metadata.origins || metadata.origins.length === 0) return fallback;

	const stripPort = (s: string): string => s.split(':')[0];
	const hintHost = stripPort(hint);

	return metadata.origins.some(o => stripPort(o) === hintHost) ? 'origin' : 'relay';
}

// Debug logging — stripped from production builds by Vite tree-shaking.
const DEBUG = typeof globalThis !== 'undefined' && 'window' in globalThis
	? /\bDEV\b/.test(String((globalThis as Record<string, unknown>).__TLTV_DEBUG)) || false
	: false;
function dbg(...args: unknown[]) {
	if (DEBUG || (typeof import.meta !== 'undefined' && import.meta.env?.DEV)) {
		console.log('[TLTV]', ...args);
	}
}

/**
 * Parse a tltv:// URI string.
 *
 * Format: tltv://<channelId>[@hint][?via=host1,host2&token=xxx]
 *
 * Returns null if the string is not a valid tltv:// URI.
 */
export function parseTltvUri(uri: string): TltvUri | null {
	uri = uri.trim();
	if (!uri.startsWith('tltv://')) return null;

	const rest = uri.substring(7);
	const hints: string[] = [];
	let token: string | null = null;

	// Split path from query string
	const qIdx = rest.indexOf('?');
	const pathPart = qIdx >= 0 ? rest.substring(0, qIdx) : rest;
	const queryPart = qIdx >= 0 ? rest.substring(qIdx + 1) : '';

	// Check for @hint in path
	let channelId: string;
	const atIdx = pathPart.indexOf('@');
	if (atIdx >= 0) {
		channelId = pathPart.substring(0, atIdx);
		const atHint = pathPart.substring(atIdx + 1);
		if (atHint) hints.push(atHint);
	} else {
		channelId = pathPart;
	}

	if (!channelId) return null;

	// Parse query parameters
	if (queryPart) {
		const params = queryPart.split('&');
		let viaHandled = false;
		for (const param of params) {
			const eqIdx = param.indexOf('=');
			const key = decodeURIComponent(eqIdx >= 0 ? param.substring(0, eqIdx) : param);
			const val = eqIdx >= 0 ? decodeURIComponent(param.substring(eqIdx + 1)) : '';
			// Spec: client MUST use first occurrence, ignore duplicates
			if (key === 'token' && token === null) token = val;
			if (key === 'via' && !viaHandled && val) {
				viaHandled = true;
				for (const h of val.split(',')) {
					const trimmed = h.trim();
					if (trimmed) hints.push(trimmed);
				}
			}
		}
	}

	return { channelId, hints, token };
}

/**
 * Convert a hint string (host:port) to a base URL.
 *
 * Protocol selection:
 * - If the current page is HTTP, use HTTP for all hints (dev/LAN).
 * - If the current page is HTTPS, use HTTPS (except localhost).
 * - If no current protocol provided, default to HTTPS for safety.
 */
export function hintToBaseUrl(hint: string, currentProtocol?: string): string {
	const isLocal = hint.startsWith('localhost') || hint.startsWith('127.0.0.1');
	let proto: string;
	if (isLocal) {
		proto = 'http';
	} else if (currentProtocol === 'http:') {
		proto = 'http';   // dev/LAN — page is already HTTP
	} else {
		proto = 'https';  // production default
	}
	return `${proto}://${hint}`;
}

/**
 * Resolve a parsed tltv:// URI to a playable stream.
 *
 * Walks the hint list, fetching .well-known/tltv and channel metadata
 * from each node until one succeeds with a valid signature.
 *
 * @param parsed - Parsed URI from parseTltvUri().
 * @param defaultHints - Fallback hints if the URI has none (e.g. current host).
 * @param onStatus - Optional callback for progress updates.
 * @param currentProtocol - Current page protocol (e.g. location.protocol).
 * @returns Resolved channel info, or null if resolution failed.
 */
export async function resolveChannel(
	parsed: TltvUri,
	defaultHints: string[] = [],
	onStatus?: (msg: string) => void,
	currentProtocol?: string,
	migrationHops: number = 0
): Promise<ResolvedChannel | null> {
	const hints = parsed.hints.length > 0 ? parsed.hints : defaultHints;

	for (const hint of hints) {
		const baseUrl = hintToBaseUrl(hint, currentProtocol);
		dbg('Trying hint:', hint, '→', baseUrl);
		onStatus?.(`Trying ${hint}...`);

		try {
			// Determine channel source from .well-known/tltv (unsigned, advisory only)
			let claimedSource: ChannelSource = 'peer';

			if (!parsed.token) {
				const wkUrl = `${baseUrl}/.well-known/tltv`;
				dbg('Fetching well-known:', wkUrl);
				const wkResp = await fetch(wkUrl);
				dbg('Well-known response:', wkResp.status);
				if (!wkResp.ok) { dbg('Well-known failed, skipping hint'); continue; }
				const wk: WellKnownResponse = await wkResp.json();

				const originIds = (wk.channels || []).map(c => c.id);
				const relayIds = (wk.relaying || []).map(c => c.id);
				dbg('Origin IDs:', originIds, 'Relay IDs:', relayIds);
				dbg('Looking for:', parsed.channelId);

				if (originIds.includes(parsed.channelId)) {
					claimedSource = 'origin';
				} else if (relayIds.includes(parsed.channelId)) {
					claimedSource = 'relay';
				} else {
					dbg('Channel not found at this hint');
					continue;
				}
				dbg('Claimed source:', claimedSource);
			}

			// Fetch channel metadata
			let metaUrl = `${baseUrl}/tltv/v1/channels/${parsed.channelId}`;
			if (parsed.token) metaUrl += `?token=${encodeURIComponent(parsed.token)}`;
			dbg('Fetching metadata:', metaUrl);

			const metaResp = await fetch(metaUrl);
			dbg('Metadata response:', metaResp.status);
			if (metaResp.status === 401 || metaResp.status === 403) {
				onStatus?.('Access denied — check token');
				return null;
			}
			if (!metaResp.ok) continue;

			const rawDoc = await metaResp.json();
			dbg('Response document:', rawDoc);

			// Check for migration document (PROTOCOL.md section 5.14)
			if (rawDoc.type === 'migration') {
				const migration = rawDoc as unknown as MigrationDocument;
				if (migration.from !== parsed.channelId) {
					dbg('Migration identity binding failed:', migration.from, '!==', parsed.channelId);
					continue;
				}
				const migVerified = await verifySignature(
					rawDoc as Record<string, unknown>, 'signature', 'from'
				);
				if (migVerified === false) { dbg('Migration signature invalid'); continue; }
				dbg('Channel migrated to:', migration.to);
				onStatus?.(`Channel migrated to ${migration.to}`);
				// Follow migration by resolving the new channel ID (spec: max 5 hops)
				if (migrationHops >= MAX_MIGRATION_HOPS) {
					dbg('Migration chain too long, aborting');
					onStatus?.('Migration chain too long');
					return null;
				}
				const newParsed = { channelId: migration.to, hints: [hint], token: parsed.token };
				return resolveChannel(newParsed, defaultHints, onStatus, currentProtocol, migrationHops + 1);
			}

			const metadata: ChannelMetadata = rawDoc as ChannelMetadata;

			// Identity binding check
			if (metadata.id !== parsed.channelId) {
				dbg('Identity binding failed:', metadata.id, '!==', parsed.channelId);
				continue;
			}

			// Verify signature — reject if invalid, allow if valid or unsupported
			const verified = await verifySignature(
				metadata as unknown as Record<string, unknown>
			);
			dbg('Signature verified:', verified);
			if (verified === false) {
				dbg('Signature verification FAILED — discarding metadata');
				onStatus?.('Invalid signature — metadata rejected');
				continue;
			}

			// Reject unsupported protocol versions
			if (metadata.v !== 1) {
				dbg('Unsupported protocol version:', metadata.v);
				continue;
			}

			// Override source using signed origins field (unforgeable).
			// The .well-known/tltv source is advisory only — origins in
			// signed metadata is the authoritative signal.
			const source = determineSource(hint, metadata, claimedSource);
			dbg('Source after origins check:', source, '(claimed:', claimedSource + ')');

			// Resolve stream URL
			if (!metadata.stream) { dbg('No stream field in metadata'); continue; }
			let streamUrl = baseUrl + metadata.stream;
			if (parsed.token) streamUrl += `?token=${encodeURIComponent(parsed.token)}`;
			dbg('Resolved stream:', streamUrl);

			return {
				metadata,
				streamUrl,
				baseUrl,
				verified,
				source,
				claimedSource,
				hint,
				token: parsed.token,
			};
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			dbg('Hint', hint, 'failed:', e);
			onStatus?.(`Hint ${hint} failed: ${msg}`);
			continue;
		}
	}

	// ── Peer discovery fallback ──
	// Direct hints failed. Walk the peer list from each default hint
	// looking for a node that carries this channel.
	if (defaultHints.length > 0) {
		dbg('Direct hints exhausted, trying peer discovery...');
		onStatus?.('Searching peers...');

		for (const startHint of defaultHints) {
			const peers = await fetchPeers(startHint, currentProtocol);
			dbg('Got', peers.length, 'peers from', startHint);

			for (const peer of peers.slice(0, 20)) {
				for (const peerHint of peer.hints) {
					dbg('Checking peer hint:', peerHint);
					const wk = await fetchWellKnown(peerHint, currentProtocol);
					if (!wk) continue;

					const allIds = [
						...(wk.channels || []).map(c => c.id),
						...(wk.relaying || []).map(c => c.id),
					];
					if (!allIds.includes(parsed.channelId)) continue;

					// Found it — resolve from this peer
					dbg('Channel found at peer:', peerHint);
					onStatus?.(`Found at peer ${peerHint}...`);

					const peerBaseUrl = hintToBaseUrl(peerHint, currentProtocol);
					try {
						let metaUrl = `${peerBaseUrl}/tltv/v1/channels/${parsed.channelId}`;
						if (parsed.token) metaUrl += `?token=${encodeURIComponent(parsed.token)}`;

						const metaResp = await fetch(metaUrl);
						if (!metaResp.ok) continue;

						const metadata: ChannelMetadata = await metaResp.json();
						if (metadata.id !== parsed.channelId) continue;

						const verified = await verifySignature(
							metadata as unknown as Record<string, unknown>
						);
						if (verified === false) { dbg('Peer metadata signature invalid'); continue; }
						if (metadata.v !== 1) { dbg('Peer metadata unsupported version:', metadata.v); continue; }

					if (!metadata.stream) continue;
					let streamUrl = peerBaseUrl + metadata.stream;
					if (parsed.token) streamUrl += `?token=${encodeURIComponent(parsed.token)}`;

				// Use signed origins to refine source — peer may actually be an origin or relay
				const peerSource = determineSource(peerHint, metadata, 'peer');
				dbg('Resolved via peer discovery:', streamUrl, 'source:', peerSource);
				return {
					metadata,
					streamUrl,
					baseUrl: peerBaseUrl,
					verified,
					source: peerSource,
					claimedSource: 'peer',
					hint: peerHint,
					token: parsed.token,
				};
					} catch (e) {
						dbg('Peer', peerHint, 'metadata fetch failed:', e);
						continue;
					}
				}
			}
		}
	}

	dbg('All hints and peers exhausted');
	onStatus?.('Channel not found at any hint or peer');
	return null;
}
