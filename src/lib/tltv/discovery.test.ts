import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWellKnown, fetchPeers, discoverChannels, fetchGuide } from './discovery';
import type { WellKnownResponse, PeerExchangeResponse, GuideDocument } from './types';

// ── Mock fetch globally ──

const mockFetch = vi.fn();

beforeEach(() => {
	vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => {
	vi.restoreAllMocks();
});

function jsonResponse(data: unknown, status = 200) {
	return Promise.resolve({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(data),
	});
}

function failResponse(status = 500) {
	return Promise.resolve({ ok: false, status, json: () => Promise.reject() });
}

// ── fetchWellKnown ──

describe('fetchWellKnown', () => {
	it('returns well-known data on success', async () => {
		const wk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [{ id: 'TVabc', name: 'Test Channel' }],
			relaying: [],
		};
		mockFetch.mockReturnValue(jsonResponse(wk));

		const result = await fetchWellKnown('example.com:9888', 'http:');
		expect(result).toEqual(wk);
		expect(mockFetch).toHaveBeenCalledWith('http://example.com:9888/.well-known/tltv');
	});

	it('returns null on non-ok response', async () => {
		mockFetch.mockReturnValue(failResponse(404));
		expect(await fetchWellKnown('example.com:9888', 'http:')).toBeNull();
	});

	it('returns null on network error', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));
		expect(await fetchWellKnown('example.com:9888', 'http:')).toBeNull();
	});
});

// ── fetchPeers ──

describe('fetchPeers', () => {
	it('returns peer list on success', async () => {
		const data: PeerExchangeResponse = {
			peers: [
				{ id: 'TVpeer1', name: 'Peer One', hints: ['peer1.com:9888'], last_seen: '2025-01-01T00:00:00Z' },
			],
		};
		mockFetch.mockReturnValue(jsonResponse(data));

		const result = await fetchPeers('example.com:9888', 'http:');
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('Peer One');
	});

	it('returns empty array on failure', async () => {
		mockFetch.mockReturnValue(failResponse(500));
		expect(await fetchPeers('example.com:9888', 'http:')).toEqual([]);
	});

	it('returns empty array on network error', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));
		expect(await fetchPeers('example.com:9888', 'http:')).toEqual([]);
	});

	it('returns empty array when peers field is absent', async () => {
		mockFetch.mockReturnValue(jsonResponse({}));
		const result = await fetchPeers('example.com:9888', 'http:');
		expect(result).toEqual([]);
	});
});

// ── discoverChannels ──

describe('discoverChannels', () => {
	it('aggregates channels from local node and peers', async () => {
		const localWk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [{ id: 'TVlocal', name: 'Local Channel' }],
			relaying: [],
		};

		const peerExchange: PeerExchangeResponse = {
			peers: [
				{ id: 'p1', name: 'Peer1', hints: ['peer1.com:9888'], last_seen: '2025-01-01T00:00:00Z' },
			],
		};

		const peerWk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [{ id: 'TVremote', name: 'Remote Channel' }],
			relaying: [{ id: 'TVrelayed', name: 'Relayed Channel' }],
		};

		mockFetch.mockImplementation((url: string) => {
			if (url === 'http://start.com:9888/.well-known/tltv') return jsonResponse(localWk);
			if (url === 'http://start.com:9888/tltv/v1/peers') return jsonResponse(peerExchange);
			if (url === 'http://peer1.com:9888/.well-known/tltv') return jsonResponse(peerWk);
			return failResponse(404);
		});

		const channels = await discoverChannels('start.com:9888', 20, 'http:');
		const ids = channels.map(c => c.id);

		expect(ids).toContain('TVlocal');
		expect(ids).toContain('TVremote');
		expect(ids).toContain('TVrelayed');
		expect(channels).toHaveLength(3);
	});

	it('deduplicates channels seen on multiple nodes', async () => {
		const sharedChannel = { id: 'TVshared', name: 'Shared' };
		const localWk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [sharedChannel],
			relaying: [],
		};
		const peerWk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [sharedChannel],
			relaying: [],
		};
		const peerExchange: PeerExchangeResponse = {
			peers: [{ id: 'p1', name: 'Peer1', hints: ['peer1.com:9888'], last_seen: '2025-01-01T00:00:00Z' }],
		};

		mockFetch.mockImplementation((url: string) => {
			if (url === 'http://start.com:9888/.well-known/tltv') return jsonResponse(localWk);
			if (url === 'http://start.com:9888/tltv/v1/peers') return jsonResponse(peerExchange);
			if (url === 'http://peer1.com:9888/.well-known/tltv') return jsonResponse(peerWk);
			return failResponse(404);
		});

		const channels = await discoverChannels('start.com:9888', 20, 'http:');
		expect(channels).toHaveLength(1);
		expect(channels[0].hints).toContain('start.com:9888');
		expect(channels[0].hints).toContain('peer1.com:9888');
	});

	it('returns local channels when peer exchange fails', async () => {
		const localWk: WellKnownResponse = {
			protocol: 'tltv',
			versions: [1],
			channels: [{ id: 'TVlocal', name: 'Local' }],
			relaying: [],
		};

		mockFetch.mockImplementation((url: string) => {
			if (url === 'http://start.com:9888/.well-known/tltv') return jsonResponse(localWk);
			return failResponse(500);
		});

		const channels = await discoverChannels('start.com:9888', 20, 'http:');
		expect(channels).toHaveLength(1);
		expect(channels[0].id).toBe('TVlocal');
	});

	it('returns empty when everything fails', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));
		const channels = await discoverChannels('dead.com:9888', 20, 'http:');
		expect(channels).toEqual([]);
	});
});

// ── fetchGuide ──

describe('fetchGuide', () => {
	it('fetches guide document', async () => {
		const guide: GuideDocument = {
			v: 1,
			seq: 1,
			id: 'TVabc',
			from: '2025-01-01T00:00:00Z',
			until: '2025-01-02T00:00:00Z',
			entries: [{ start: '2025-01-01T10:00:00Z', end: '2025-01-01T11:00:00Z', title: 'Test Show' }],
			updated: '2025-01-01T00:00:00Z',
			signature: 'fakesig',
		};
		mockFetch.mockReturnValue(jsonResponse(guide));

		const result = await fetchGuide('http://example.com:9888', 'TVabc');
		expect(result).toEqual(guide);
		expect(mockFetch).toHaveBeenCalledWith('http://example.com:9888/tltv/v1/channels/TVabc/guide.json');
	});

	it('appends token to URL when provided', async () => {
		mockFetch.mockReturnValue(jsonResponse({}));
		await fetchGuide('http://example.com:9888', 'TVabc', 'mytoken');
		expect(mockFetch).toHaveBeenCalledWith(
			'http://example.com:9888/tltv/v1/channels/TVabc/guide.json?token=mytoken'
		);
	});

	it('returns null on failure', async () => {
		mockFetch.mockReturnValue(failResponse(404));
		expect(await fetchGuide('http://example.com:9888', 'TVabc')).toBeNull();
	});

	it('returns null on network error', async () => {
		mockFetch.mockRejectedValue(new Error('Network error'));
		expect(await fetchGuide('http://example.com:9888', 'TVabc')).toBeNull();
	});
});
