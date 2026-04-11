// Types
export type {
	TltvUri,
	ChannelMetadata,
	ChannelSource,
	GuideDocument,
	GuideEntry,
	MigrationDocument,
	WellKnownResponse,
	WellKnownChannel,
	Peer,
	PeerExchangeResponse,
	ResolvedChannel,
} from './types';

// URI parsing and resolution
export { parseTltvUri, hintToBaseUrl, resolveChannel, determineSource } from './uri';

// Cryptography
export {
	b58decode,
	b58encode,
	extractPubkey,
	canonicalJson,
	verifySignature,
} from './crypto';

// Discovery
export {
	fetchWellKnown,
	fetchPeers,
	discoverChannels,
	fetchGuide,
	verifyGuide,
} from './discovery';
