const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Decode a base58 string to bytes.
 */
export function b58decode(str: string): Uint8Array {
	let n = 0n;
	for (let i = 0; i < str.length; i++) {
		const idx = B58_ALPHABET.indexOf(str[i]);
		if (idx < 0) throw new Error(`Invalid base58 character: ${str[i]}`);
		n = n * 58n + BigInt(idx);
	}

	// Count leading '1's (zero bytes)
	let pad = 0;
	for (let i = 0; i < str.length && str[i] === '1'; i++) pad++;

	// Convert bigint to byte array (empty when n is zero — only pad bytes)
	let hex = n > 0n ? n.toString(16) : '';
	if (hex.length % 2) hex = '0' + hex;
	const bytes = new Uint8Array(pad + hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[pad + i / 2] = parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

/**
 * Encode bytes to a base58 string.
 */
export function b58encode(bytes: Uint8Array): string {
	let n = 0n;
	for (const b of bytes) n = n * 256n + BigInt(b);

	let str = '';
	while (n > 0n) {
		str = B58_ALPHABET[Number(n % 58n)] + str;
		n = n / 58n;
	}

	// Preserve leading zero bytes as '1'
	for (const b of bytes) {
		if (b === 0) str = '1' + str;
		else break;
	}

	return str || '1';
}

/**
 * Extract the 32-byte Ed25519 public key from a TLTV channel ID.
 *
 * Channel IDs are base58-encoded with a 2-byte prefix: [0x14, 0x33]
 * giving the "TV" prefix (PROTOCOL.md section 2).
 */
export function extractPubkey(channelId: string): Uint8Array | null {
	try {
		const raw = b58decode(channelId);
		if (raw.length !== 34) return null;
		if (raw[0] !== 0x14 || raw[1] !== 0x33) return null;
		return raw.slice(2);
	} catch {
		return null;
	}
}

/**
 * Canonical JSON serialisation (PROTOCOL.md section 7).
 *
 * Keys sorted recursively, no whitespace, deterministic output.
 * Used to produce the signing payload for metadata and guide documents.
 */
export function canonicalJson(obj: unknown): string {
	if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
	if (Array.isArray(obj)) {
		return '[' + obj.map(canonicalJson).join(',') + ']';
	}
	const keys = Object.keys(obj as Record<string, unknown>).sort();
	const parts: string[] = [];
	for (const key of keys) {
		parts.push(JSON.stringify(key) + ':' + canonicalJson((obj as Record<string, unknown>)[key]));
	}
	return '{' + parts.join(',') + '}';
}

/**
 * Verify an Ed25519 signature over a metadata/guide document.
 *
 * Cathode signs documents with the `signature` field and derives the
 * public key from the channel ID (no separate `pub` field).
 *
 * The canonical payload is the document with the `signature` field removed,
 * serialised as canonical JSON.
 *
 * @param document - The full document object (including `signature`).
 * @param sigField - Name of the signature field (default: 'signature').
 * @returns true if valid, false if invalid, null if verification is
 *          unsupported (no Ed25519 Web Crypto) or the document has no signature.
 */
export async function verifySignature(
	document: Record<string, unknown>,
	sigField: string = 'signature',
	identityField: string = 'id'
): Promise<boolean | null> {
	try {
		const sigStr = document[sigField] as string;
		if (!sigStr) return null; // no signature to verify

		// Extract public key from channel ID (or 'from' for migration docs)
		const channelId = document[identityField] as string;
		if (!channelId) return null;
		const pubkeyBytes = extractPubkey(channelId);
		if (!pubkeyBytes || pubkeyBytes.length !== 32) return null;

		// Build canonical payload — all fields except the signature
		const docCopy: Record<string, unknown> = {};
		for (const key of Object.keys(document)) {
			if (key !== sigField) {
				docCopy[key] = document[key];
			}
		}
		const payload = new TextEncoder().encode(canonicalJson(docCopy));

		// Decode signature
		const sigBytes = b58decode(sigStr);
		if (sigBytes.length !== 64) return false; // signature present but malformed

		// Verify via Web Crypto
		// Web Crypto accepts BufferSource; Uint8Array qualifies at runtime but
		// TS lib types are overly strict about SharedArrayBuffer, requiring a cast.
		const key = await crypto.subtle.importKey(
			'raw',
			pubkeyBytes as BufferSource,
			{ name: 'Ed25519' },
			false,
			['verify']
		);
		return await crypto.subtle.verify(
			'Ed25519', key,
			sigBytes as BufferSource,
			payload as BufferSource
		);
	} catch {
		// Ed25519 not supported in this browser's Web Crypto
		return null;
	}
}
