import { describe, it, expect } from 'vitest';
import { b58decode, b58encode, extractPubkey, canonicalJson } from './crypto';

// ── Base58 ──

describe('b58encode / b58decode', () => {
	it('round-trips arbitrary bytes', () => {
		const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
		const encoded = b58encode(bytes);
		expect(b58decode(encoded)).toEqual(bytes);
	});

	it('preserves leading zero bytes', () => {
		const bytes = new Uint8Array([0, 0, 0x01]);
		const encoded = b58encode(bytes);
		expect(encoded.startsWith('11')).toBe(true); // two '1's for two zero bytes
		expect(b58decode(encoded)).toEqual(bytes);
	});

	it('encodes empty-ish input to "1"', () => {
		const bytes = new Uint8Array([0]);
		expect(b58encode(bytes)).toBe('1');
	});

	it('decodes known base58 value', () => {
		// "1" in base58 = one leading zero byte
		const decoded = b58decode('1');
		expect(decoded).toEqual(new Uint8Array([0]));
	});

	it('rejects invalid base58 characters', () => {
		expect(() => b58decode('0OIl')).toThrow('Invalid base58 character');
	});

	it('round-trips 32-byte key-length data', () => {
		const key = new Uint8Array(32);
		for (let i = 0; i < 32; i++) key[i] = i * 7 + 3;
		expect(b58decode(b58encode(key))).toEqual(key);
	});
});

// ── extractPubkey ──

describe('extractPubkey', () => {
	it('extracts 32-byte pubkey from valid channel ID (TV prefix)', () => {
		// Build a valid channel ID: 2-byte prefix [0x14, 0x33] + 32-byte key
		const pubkey = new Uint8Array(32);
		for (let i = 0; i < 32; i++) pubkey[i] = i + 1;

		const raw = new Uint8Array(34);
		raw[0] = 0x14;
		raw[1] = 0x33;
		raw.set(pubkey, 2);

		const channelId = b58encode(raw);
		const extracted = extractPubkey(channelId);
		expect(extracted).toEqual(pubkey);
	});

	it('returns null for wrong prefix', () => {
		const raw = new Uint8Array(34);
		raw[0] = 0x00;
		raw[1] = 0x00;
		const channelId = b58encode(raw);
		expect(extractPubkey(channelId)).toBeNull();
	});

	it('returns null for wrong length (too short)', () => {
		const raw = new Uint8Array(20);
		raw[0] = 0x14;
		raw[1] = 0x33;
		const channelId = b58encode(raw);
		expect(extractPubkey(channelId)).toBeNull();
	});

	it('returns null for invalid base58', () => {
		expect(extractPubkey('!!!invalid!!!')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(extractPubkey('')).toBeNull();
	});
});

// ── canonicalJson ──

describe('canonicalJson', () => {
	it('sorts object keys', () => {
		expect(canonicalJson({ z: 1, a: 2, m: 3 })).toBe('{"a":2,"m":3,"z":1}');
	});

	it('sorts keys recursively', () => {
		expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 }))
			.toBe('{"a":3,"b":{"c":2,"d":1}}');
	});

	it('preserves array order (no sorting)', () => {
		expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
	});

	it('handles arrays of objects', () => {
		expect(canonicalJson([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
	});

	it('handles null', () => {
		expect(canonicalJson(null)).toBe('null');
	});

	it('handles strings', () => {
		expect(canonicalJson('hello')).toBe('"hello"');
	});

	it('handles numbers', () => {
		expect(canonicalJson(42)).toBe('42');
	});

	it('handles booleans', () => {
		expect(canonicalJson(true)).toBe('true');
		expect(canonicalJson(false)).toBe('false');
	});

	it('handles empty object', () => {
		expect(canonicalJson({})).toBe('{}');
	});

	it('handles empty array', () => {
		expect(canonicalJson([])).toBe('[]');
	});

	it('produces no whitespace', () => {
		const result = canonicalJson({ foo: 'bar', baz: [1, 2, { x: 'y' }] });
		expect(result).not.toMatch(/\s/);
	});

	it('produces deterministic output regardless of insertion order', () => {
		const a: Record<string, number> = {};
		a['z'] = 1; a['a'] = 2;
		const b: Record<string, number> = {};
		b['a'] = 2; b['z'] = 1;
		expect(canonicalJson(a)).toBe(canonicalJson(b));
	});
});
