import type {
	WellKnownResponse,
	WellKnownChannel,
	Peer,
	PeerExchangeResponse,
	GuideDocument,
} from './types';
import { hintToBaseUrl } from './uri';
import { verifySignature } from './crypto';

/**
 * Fetch .well-known/tltv from a node.
 *
 * Returns the discovery document listing originated and relayed channels.
 */
export async function fetchWellKnown(
	hint: string,
	currentProtocol?: string
): Promise<WellKnownResponse | null> {
	try {
		const baseUrl = hintToBaseUrl(hint, currentProtocol);
		const resp = await fetch(`${baseUrl}/.well-known/tltv`);
		if (!resp.ok) return null;
		return await resp.json();
	} catch {
		return null;
	}
}

/**
 * Fetch the peer list from a node.
 */
export async function fetchPeers(
	hint: string,
	currentProtocol?: string
): Promise<Peer[]> {
	try {
		const baseUrl = hintToBaseUrl(hint, currentProtocol);
		const resp = await fetch(`${baseUrl}/tltv/v1/peers`);
		if (!resp.ok) return [];
		const data: PeerExchangeResponse = await resp.json();
		return data.peers || [];
	} catch {
		return [];
	}
}

/**
 * Discover all channels reachable from a starting node via peer exchange.
 *
 * Walks one hop: fetches peers from the starting node, then fetches
 * .well-known/tltv from each peer to collect all visible channels.
 *
 * @param startHint - The starting node (host:port).
 * @param maxPeers - Maximum peers to query (default 20).
 * @returns Deduplicated list of channels with their source hints.
 */
export async function discoverChannels(
	startHint: string,
	maxPeers: number = 20,
	currentProtocol?: string
): Promise<Array<WellKnownChannel & { hints: string[] }>> {
	const channelMap = new Map<string, WellKnownChannel & { hints: string[] }>();

	// Start with the local node
	const local = await fetchWellKnown(startHint, currentProtocol);
	if (local) {
		for (const ch of [...(local.channels || []), ...(local.relaying || [])]) {
			channelMap.set(ch.id, { ...ch, hints: [startHint] });
		}
	}

	// Fetch peers and query each
	const peers = await fetchPeers(startHint, currentProtocol);
	const queries = peers.slice(0, maxPeers).map(async (peer) => {
		for (const hint of peer.hints) {
			const wk = await fetchWellKnown(hint, currentProtocol);
			if (!wk) continue;
			for (const ch of [...(wk.channels || []), ...(wk.relaying || [])]) {
				const existing = channelMap.get(ch.id);
				if (existing) {
					if (!existing.hints.includes(hint)) existing.hints.push(hint);
				} else {
					channelMap.set(ch.id, { ...ch, hints: [hint] });
				}
			}
			break; // first working hint is enough
		}
	});

	await Promise.allSettled(queries);
	return Array.from(channelMap.values());
}

/**
 * Fetch a channel's signed guide document.
 */
export async function fetchGuide(
	baseUrl: string,
	channelId: string,
	token?: string | null
): Promise<GuideDocument | null> {
	try {
		let url = `${baseUrl}/tltv/v1/channels/${channelId}/guide.json`;
		if (token) url += `?token=${encodeURIComponent(token)}`;
		const resp = await fetch(url);
		if (!resp.ok) return null;
		return await resp.json();
	} catch {
		return null;
	}
}

/**
 * Verify the Ed25519 signature of a guide document.
 *
 * Best-effort — returns false if Web Crypto doesn't support Ed25519,
 * or if the signature/channel ID is invalid.
 */
export async function verifyGuide(guide: GuideDocument): Promise<boolean | null> {
	return verifySignature(guide as unknown as Record<string, unknown>);
}
