import { describe, it, expect } from 'vitest';
import { parseTltvUri, hintToBaseUrl } from './uri';

// ── parseTltvUri ──

describe('parseTltvUri', () => {
	it('parses bare channel ID', () => {
		const result = parseTltvUri('tltv://TVabc123');
		expect(result).toEqual({ channelId: 'TVabc123', hints: [], token: null });
	});

	it('parses channel ID with @hint', () => {
		const result = parseTltvUri('tltv://TVabc123@example.com:9888');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['example.com:9888'],
			token: null,
		});
	});

	it('parses ?via= with single hint', () => {
		const result = parseTltvUri('tltv://TVabc123?via=node1.example.com');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['node1.example.com'],
			token: null,
		});
	});

	it('parses ?via= with multiple comma-separated hints', () => {
		const result = parseTltvUri('tltv://TVabc123?via=node1.com,node2.com:8080');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['node1.com', 'node2.com:8080'],
			token: null,
		});
	});

	it('combines @hint and ?via=', () => {
		const result = parseTltvUri('tltv://TVabc123@primary.com?via=backup.com');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['primary.com', 'backup.com'],
			token: null,
		});
	});

	it('parses ?token=', () => {
		const result = parseTltvUri('tltv://TVabc123?token=secret123');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: [],
			token: 'secret123',
		});
	});

	it('parses combined token + via', () => {
		const result = parseTltvUri('tltv://TVabc123@host.com?token=abc&via=peer.com');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['host.com', 'peer.com'],
			token: 'abc',
		});
	});

	it('trims whitespace', () => {
		const result = parseTltvUri('  tltv://TVabc123  ');
		expect(result).toEqual({ channelId: 'TVabc123', hints: [], token: null });
	});

	it('returns null for non-tltv:// URIs', () => {
		expect(parseTltvUri('http://example.com')).toBeNull();
		expect(parseTltvUri('https://example.com')).toBeNull();
		expect(parseTltvUri('tltv://')).toBeNull(); // empty channel ID
	});

	it('returns null for empty string', () => {
		expect(parseTltvUri('')).toBeNull();
	});

	it('returns null for just the scheme', () => {
		expect(parseTltvUri('tltv://')).toBeNull();
	});

	it('handles URL-encoded via hints', () => {
		const result = parseTltvUri('tltv://TVabc123?via=node%201.com');
		expect(result?.hints).toEqual(['node 1.com']);
	});

	it('ignores empty via values', () => {
		const result = parseTltvUri('tltv://TVabc123?via=');
		expect(result).toEqual({ channelId: 'TVabc123', hints: [], token: null });
	});

	it('ignores unknown query parameters', () => {
		const result = parseTltvUri('tltv://TVabc123?foo=bar&via=host.com');
		expect(result).toEqual({
			channelId: 'TVabc123',
			hints: ['host.com'],
			token: null,
		});
	});
});

// ── hintToBaseUrl ──

describe('hintToBaseUrl', () => {
	it('uses http for localhost', () => {
		expect(hintToBaseUrl('localhost:9888')).toBe('http://localhost:9888');
	});

	it('uses http for 127.0.0.1', () => {
		expect(hintToBaseUrl('127.0.0.1:9888')).toBe('http://127.0.0.1:9888');
	});

	it('uses https by default for remote hosts', () => {
		expect(hintToBaseUrl('example.com:9888')).toBe('https://example.com:9888');
	});

	it('uses http when current page is http (LAN/dev)', () => {
		expect(hintToBaseUrl('example.com:9888', 'http:')).toBe('http://example.com:9888');
	});

	it('uses https when current page is https', () => {
		expect(hintToBaseUrl('example.com:9888', 'https:')).toBe('https://example.com:9888');
	});

	it('always uses http for localhost even when page is https', () => {
		expect(hintToBaseUrl('localhost:9888', 'https:')).toBe('http://localhost:9888');
	});

	it('handles hint without port', () => {
		expect(hintToBaseUrl('example.com')).toBe('https://example.com');
	});
});
