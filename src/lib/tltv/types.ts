/** Parsed tltv:// URI (PROTOCOL.md section 3). */
export interface TltvUri {
	channelId: string;
	hints: string[];
	token: string | null;
}

/** Signed channel metadata document (PROTOCOL.md section 5). */
export interface ChannelMetadata {
	v: number;
	seq: number;
	id: string;
	name: string;
	stream: string;
	updated: string;
	description?: string;
	language?: string;
	tags?: string[];
	icon?: string;
	access: 'public' | 'token';
	on_demand?: boolean;
	origins?: string[];
	timezone?: string;
	status?: 'active' | 'retired';
	guide?: string;
	/** Base58-encoded Ed25519 signature. */
	signature: string;
}

/** Signed guide document (PROTOCOL.md section 6). */
export interface GuideDocument {
	v: number;
	seq: number;
	id: string;
	from: string;
	until: string;
	entries: GuideEntry[];
	updated: string;
	signature: string;
}

/** Single guide entry. */
export interface GuideEntry {
	start: string;
	end: string;
	title: string;
	description?: string;
	category?: string;
	relay_from?: string;
}

/** Migration document (PROTOCOL.md section 5.14). Served at old channel's metadata endpoint. */
export interface MigrationDocument {
	v: number;
	seq: number;
	type: 'migration';
	from: string;
	to: string;
	reason?: string;
	migrated: string;
	signature: string;
}

/** Well-known discovery response (PROTOCOL.md section 8.1). */
export interface WellKnownResponse {
	protocol: 'tltv';
	versions: number[];
	channels: WellKnownChannel[];
	relaying: WellKnownChannel[];
}

/** Channel entry in .well-known/tltv response. */
export interface WellKnownChannel {
	id: string;
	name: string;
}

/** Peer entry from peer exchange (PROTOCOL.md section 9). */
export interface Peer {
	id: string;
	name: string;
	hints: string[];
	last_seen: string;
}

/** Peer exchange response. */
export interface PeerExchangeResponse {
	peers: Peer[];
}

/** How the channel relates to the node serving it. */
export type ChannelSource = 'origin' | 'relay' | 'peer';

/** Result of resolving a tltv:// URI. */
export interface ResolvedChannel {
	metadata: ChannelMetadata;
	streamUrl: string;
	baseUrl: string;
	/** true = valid, false = invalid, null = can't verify (no Ed25519 support / no signature). */
	verified: boolean | null;
	/** How this node relates to the channel (from signed origins field): origin, relay, or peer. */
	source: ChannelSource;
	/** What .well-known/tltv claimed before signed verification.
	 *  When claimedSource is 'origin' but source is 'relay', the node is
	 *  spoofing — a reverse proxy serving origin's .well-known but relay content. */
	claimedSource: ChannelSource;
	hint: string;
	token: string | null;
}
