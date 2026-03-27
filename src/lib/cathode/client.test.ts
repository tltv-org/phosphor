import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CathodeClient, CathodeApiError } from './client';

function jsonResponse(data: unknown, status = 200) {
	return Promise.resolve({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: (h: string) => h === 'content-type' ? 'application/json' : null },
		json: () => Promise.resolve(data),
		text: () => Promise.resolve(JSON.stringify(data)),
	});
}

function errorResponse(status: number, body: unknown) {
	return Promise.resolve({
		ok: false,
		status,
		headers: { get: () => 'application/json' },
		json: () => Promise.resolve(body),
		text: () => Promise.resolve(JSON.stringify(body)),
	});
}

/** Create a connected client with a fresh mock, returning both. */
async function connectedClient(apiKey = 'key') {
	const mock = vi.fn();
	vi.stubGlobal('fetch', mock);
	const client = new CathodeClient();
	mock.mockReturnValue(jsonResponse({ version: '1.0' }));
	await client.connect('http://localhost:9888', apiKey);
	mock.mockClear(); // reset call history — connect calls don't count
	return { client, mock };
}

// ── connect ──

describe('CathodeClient.connect', () => {
	it('connects and returns server info', async () => {
		const mock = vi.fn().mockReturnValue(jsonResponse({ version: '0.5.0' }));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		const info = await client.connect('http://localhost:9888', 'test-key');
		expect(info).toEqual({ version: '0.5.0', backend: 'cathode' });
		expect(mock).toHaveBeenCalledWith('http://localhost:9888/api/status', expect.objectContaining({
			method: 'GET',
			headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
		}));
	});

	it('strips trailing slash from base URL', async () => {
		const mock = vi.fn().mockReturnValue(jsonResponse({ version: '0.5.0' }));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		await client.connect('http://localhost:9888/', 'key');
		expect(mock).toHaveBeenCalledWith('http://localhost:9888/api/status', expect.anything());
	});

	it('falls back to "unknown" version', async () => {
		const mock = vi.fn().mockReturnValue(jsonResponse({}));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		const info = await client.connect('http://localhost:9888', 'key');
		expect(info.version).toBe('unknown');
	});

	it('rejects non-JSON response (SPA fallback)', async () => {
		const mock = vi.fn().mockReturnValue(Promise.resolve({
			ok: true,
			status: 200,
			headers: { get: (h: string) => h === 'content-type' ? 'text/html' : null },
			text: () => Promise.resolve('<!doctype html><html>...</html>'),
		}));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		await expect(client.connect('http://localhost:9888', ''))
			.rejects.toThrow('No playout backend found at this address');
	});

	it('rejects gateway error as no backend', async () => {
		const mock = vi.fn().mockReturnValue(errorResponse(502, 'Bad Gateway'));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		await expect(client.connect('http://localhost:9888', ''))
			.rejects.toThrow('No playout backend found at this address');
	});

	it('throws CathodeApiError on auth failure', async () => {
		const mock = vi.fn().mockReturnValue(errorResponse(401, { detail: 'Unauthorized' }));
		vi.stubGlobal('fetch', mock);

		const client = new CathodeClient();
		await expect(client.connect('http://localhost:9888', 'bad-key'))
			.rejects.toThrow(CathodeApiError);
	});
});

// ── API key header ──

describe('CathodeClient request headers', () => {
	it('sends X-API-Key header on all requests', async () => {
		const { client, mock } = await connectedClient('my-secret');

		mock.mockReturnValue(jsonResponse({ source: 'test.mp4', index: 0, played: 10, ingest: false, mode: 'loop' }));
		await client.getNowPlaying();

		expect(mock.mock.calls[0][1].headers['X-API-Key']).toBe('my-secret');
	});
});

// ── Error handling ──

describe('CathodeApiError', () => {
	it('captures status and body', async () => {
		const { client, mock } = await connectedClient();

		mock.mockReturnValue(errorResponse(404, { detail: 'Not found' }));
		try {
			await client.getMedia();
			expect.unreachable('Should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(CathodeApiError);
			const err = e as CathodeApiError;
			expect(err.status).toBe(404);
			expect(err.body).toEqual({ detail: 'Not found' });
		}
	});
});

// ── Schedule dict->array transform ──

describe('CathodeClient.getSchedule', () => {
	it('transforms dict-keyed schedule to array', async () => {
		const { client, mock } = await connectedClient();

		mock.mockReturnValue(jsonResponse({
			schedule: { '2025-01-01': true, '2025-01-02': false, '2025-01-03': true },
			today: '2025-01-01',
			days_checked: 7,
		}));

		const result = await client.getSchedule();
		expect(result.schedule).toEqual([
			{ date: '2025-01-01', has_playlist: true },
			{ date: '2025-01-02', has_playlist: false },
			{ date: '2025-01-03', has_playlist: true },
		]);
		expect(result.today).toBe('2025-01-01');
		expect(result.days_checked).toBe(7);
	});

	it('passes days parameter to query string', async () => {
		const { client, mock } = await connectedClient();

		mock.mockReturnValue(jsonResponse({ schedule: {}, today: '2025-01-01', days_checked: 14 }));
		await client.getSchedule(14);

		expect(mock.mock.calls[0][0]).toContain('/api/schedule?days=14');
	});
});

// ── Programs dict->array transform ──

describe('CathodeClient.getPrograms', () => {
	it('transforms dict-keyed programs to array', async () => {
		const { client, mock } = await connectedClient();

		mock.mockReturnValue(jsonResponse({
			programs: { '2025-01-01': true, '2025-01-02': false },
			today: '2025-01-01',
			days_checked: 7,
		}));

		const result = await client.getPrograms();
		expect(result.programs).toEqual([
			{ date: '2025-01-01', has_program: true },
			{ date: '2025-01-02', has_program: false },
		]);
	});
});

// ── POST/PATCH/DELETE methods ──

describe('CathodeClient mutation methods', () => {
	let client: CathodeClient;
	let mock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const ctx = await connectedClient();
		client = ctx.client;
		mock = ctx.mock;
	});

	it('setPlaylist sends POST with files array', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.setPlaylist(['video1.mp4', 'video2.mp4']);

		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlist');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ files: ['video1.mp4', 'video2.mp4'] });
	});

	it('setPlaylist passes channel', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.setPlaylist(['video1.mp4'], 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlist?channel=ch2');
	});

	it('skip sends POST', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.skip();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/skip');
		expect(mock.mock.calls[0][1].method).toBe('POST');
	});

	it('skip passes channel and layer', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.skip('ch2', 'input_b');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/skip?channel=ch2&layer=input_b');
	});

	it('back sends POST', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.back();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/back');
	});

	it('back passes channel and layer', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.back('ch2', 'input_a');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/back?channel=ch2&layer=input_a');
	});

	it('deleteSchedule sends DELETE', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.deleteSchedule('2025-01-01');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/schedule/2025-01-01');
		expect(opts.method).toBe('DELETE');
	});

	it('setProgram sends POST with blocks', async () => {
		mock.mockReturnValue(jsonResponse(null));
		const blocks = [{ start: '00:00', end: '06:00', type: 'playlist' as const, title: 'Overnight' }];
		await client.setProgram('2025-01-01', blocks);

		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/program/2025-01-01');
		expect(JSON.parse(opts.body)).toEqual({ blocks });
	});

	it('addPeer sends POST to /api/peers with hint', async () => {
		mock.mockReturnValue(jsonResponse({ added: ['TVpeer1'], count: 1 }));
		const result = await client.addPeer('peer.com:9888');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/peers');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ hint: 'peer.com:9888' });
		expect(result.added).toEqual(['TVpeer1']);
	});

	it('addPeer includes optional channelId', async () => {
		mock.mockReturnValue(jsonResponse({ added: [], count: 0 }));
		await client.addPeer('peer.com:9888', 'TVspecific');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/peers');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
			hint: 'peer.com:9888',
			channel_id: 'TVspecific',
		});
	});

	it('addRelay sends POST to /api/relay with channel_id and hint', async () => {
		mock.mockReturnValue(jsonResponse({ added: 'TVrelay1', upstream: 'peer.com:9888', name: 'Relay' }));
		const result = await client.addRelay('TVrelay1', 'peer.com:9888');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/relay');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
			channel_id: 'TVrelay1',
			hint: 'peer.com:9888',
		});
		expect(result.added).toBe('TVrelay1');
	});

	it('createToken sends POST with name and optional expires', async () => {
		mock.mockReturnValue(jsonResponse({
			token: 'tok_secret', token_id: 'tid1', name: 'Test Token',
			created: '2025-01-01T00:00:00Z', channel_id: 'TVabc',
		}));
		const result = await client.createToken('TVabc', 'Test Token', '2026-01-01');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
			name: 'Test Token',
			expires: '2026-01-01',
		});
		expect(result.token).toBe('tok_secret');
	});

	it('setEncoding sends PATCH and returns outputs_updated', async () => {
		mock.mockReturnValue(jsonResponse({ outputs_updated: 2 }));
		const result = await client.setEncoding({ width: 1920, height: 1080 });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/encoding');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ width: 1920, height: 1080 });
		expect(result.outputs_updated).toBe(2);
	});

	it('setPlayoutMode sends POST with mode and optional day_start', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.setPlayoutMode('schedule', '06:00');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
			mode: 'schedule',
			day_start: '06:00',
		});
	});

	it('setChannelMetadata sends PATCH', async () => {
		mock.mockReturnValue(jsonResponse(null));
		await client.setChannelMetadata({ display_name: 'New Name' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/channel');
		expect(opts.method).toBe('PATCH');
	});

	it('createMigration sends POST with to and optional reason', async () => {
		mock.mockReturnValue(jsonResponse({
			migrated: true, from: 'TVold', to: 'TVnew', document: {},
		}));
		const result = await client.createMigration('TVnew', 'Moving servers');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({
			to: 'TVnew',
			reason: 'Moving servers',
		});
		expect(result.migrated).toBe(true);
	});
});

// ── Accessor-style methods (GET shortcuts) ──

describe('CathodeClient GET accessors', () => {
	let client: CathodeClient;
	let mock: ReturnType<typeof vi.fn>;

	beforeEach(async () => {
		const ctx = await connectedClient();
		client = ctx.client;
		mock = ctx.mock;
	});

	const getCases: Array<[string, () => Promise<unknown>, string]> = [
		['getStatus', () => client.getStatus(), '/api/status'],
		['getNowPlaying', () => client.getNowPlaying(), '/api/now-playing'],
		['getSystemStats', () => client.getSystemStats(), '/api/system'],
		['getMedia', () => client.getMedia(), '/api/media'],
		['getGuideJson', () => client.getGuideJson(), '/api/guide.json'],
		['getPeers', () => client.getPeers(), '/api/peers'],
		['getRelays', () => client.getRelays(), '/api/relay'],
		['getPlayoutMode', () => client.getPlayoutMode(), '/api/playout/mode'],
		['getEncoding', () => client.getEncoding(), '/api/playout/encoding'],
		['getStorage', () => client.getStorage(), '/api/playout/storage'],
		['getChannelMetadata', () => client.getChannelMetadata(), '/api/channel'],
		['getMigrations', () => client.getMigrations(), '/api/migration'],
		['getPlaylists', () => client.getPlaylists(), '/api/playlists'],
		['getEngineHealth', () => client.getEngineHealth(), '/api/playout/health'],
		['getOverlayStatus', () => client.getOverlayStatus(), '/api/plugins/overlay/status'],
		['getRegistrySourceTypes', () => client.getRegistrySourceTypes(), '/api/plugins/registry/source-types'],
		['getRegistryOutputTypes', () => client.getRegistryOutputTypes(), '/api/plugins/registry/output-types'],
		['getRegistryBlockTypes', () => client.getRegistryBlockTypes(), '/api/plugins/registry/block-types'],
		['getRegistryPlaylistTools', () => client.getRegistryPlaylistTools(), '/api/plugins/registry/playlist-tools'],
	];

	it.each(getCases)('%s calls correct endpoint', async (_name, fn, path) => {
		mock.mockReturnValue(jsonResponse({}));
		await fn();
		expect(mock.mock.calls[0][0]).toBe(`http://localhost:9888${path}`);
		expect(mock.mock.calls[0][1].method).toBe('GET');
	});
});

// ── Named Playlists CRUD ──

describe('CathodeClient named playlists', () => {
	it('getPlaylist fetches by name', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ name: 'main', entries: [], created: '', updated: '' }));
		const result = await client.getPlaylist('main');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists/main');
		expect(result.name).toBe('main');
	});

	it('createPlaylist sends POST with files', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.createPlaylist('my-playlist', ['clip1.mp4', 'clip2.mp4']);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlists/my-playlist');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ files: ['clip1.mp4', 'clip2.mp4'] });
	});

	it('deletePlaylist sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.deletePlaylist('old-list');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlists/old-list');
		expect(opts.method).toBe('DELETE');
	});

	it('loadPlaylist sends POST with options', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.loadPlaylist('main', { layer: 'input_b', loop: false });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlists/main/load');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ layer: 'input_b', loop: false });
	});

	it('loadPlaylist sends empty object with no options', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.loadPlaylist('main');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({});
	});
});

// ── Media Management ──

describe('CathodeClient media management', () => {
	it('getMediaMetadata fetches by filename', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ filename: 'test.mp4', duration: 60, size: 1000 }));
		const result = await client.getMediaMetadata('test.mp4');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/media/test.mp4');
		expect(result.filename).toBe('test.mp4');
	});

	it('deleteMedia sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.deleteMedia('old.mp4');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/media/old.mp4');
		expect(opts.method).toBe('DELETE');
	});

	it('deleteMedia throws on 409 with references', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(errorResponse(409, {
			detail: 'File in use',
			references: [{ type: 'playlist', name: 'main', detail: 'entry 2' }],
		}));
		try {
			await client.deleteMedia('busy.mp4');
			expect.unreachable('Should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(CathodeApiError);
			const err = e as CathodeApiError;
			expect(err.status).toBe(409);
			expect((err.body as any).references).toHaveLength(1);
		}
	});

	it('uploadMedia sends multipart form data', async () => {
		const { client, mock } = await connectedClient('my-key');
		mock.mockReturnValue(jsonResponse({ filename: 'new.mp4', size: 5000, duration: 120 }));
		const file = new File(['content'], 'new.mp4', { type: 'video/mp4' });
		const result = await client.uploadMedia(file);

		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/media/upload');
		expect(opts.method).toBe('POST');
		expect(opts.headers['X-API-Key']).toBe('my-key');
		expect(opts.body).toBeInstanceOf(FormData);
		expect(result.filename).toBe('new.mp4');
		expect(result.duration).toBe(120);
	});
});

// ── Engine Start/Stop ──

describe('CathodeClient engine control', () => {
	it('startEngine sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));
		await client.startEngine();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/start');
		expect(opts.method).toBe('POST');
	});

	it('startEngine sends POST with options', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));
		await client.startEngine({ width: 1920, height: 1080 });
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ width: 1920, height: 1080 });
	});

	it('stopEngine sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));
		await client.stopEngine();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/stop');
		expect(opts.method).toBe('POST');
	});

	it('resyncSchedule sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));
		await client.resyncSchedule();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/schedule/resync');
		expect(opts.method).toBe('POST');
	});
});

// ── Overlay API ──

describe('CathodeClient overlay', () => {
	it('getOverlayStatus fetches /api/plugins/overlay/status', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ text: null, bug: null, svg: null }));
		const result = await client.getOverlayStatus();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/overlay/status');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.text).toBeNull();
	});

	it('getOverlayStatus passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ text: null, bug: null, svg: null }));
		await client.getOverlayStatus('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/overlay/status?channel=ch2');
	});

	it('sendOverlayText sends POST with query params', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.sendOverlayText({ text: 'BREAKING NEWS', fontsize: 48, position: 'top-center' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toContain('/api/plugins/overlay/text?');
		expect(url).toContain('text=BREAKING%20NEWS');
		expect(url).toContain('fontsize=48');
		expect(url).toContain('position=top-center');
		expect(opts.method).toBe('POST');
		expect(opts.body).toBeUndefined();
	});

	it('sendOverlayText passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.sendOverlayText({ text: 'Hello' }, 'ch2');
		expect(mock.mock.calls[0][0]).toContain('text=Hello');
		expect(mock.mock.calls[0][0]).toContain('channel=ch2');
	});

	it('clearOverlayText sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.clearOverlayText();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/overlay/text');
		expect(opts.method).toBe('DELETE');
	});

	it('clearOverlayText passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.clearOverlayText('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/overlay/text?channel=ch2');
	});

	it('sendOverlayBug sends POST with query params', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.sendOverlayBug({ path: '/media/logo.png', x: 10, y: 10, width: 200, height: 100, alpha: 0.8 });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toContain('/api/plugins/overlay/bug?');
		expect(url).toContain('path=%2Fmedia%2Flogo.png');
		expect(url).toContain('width=200');
		expect(opts.method).toBe('POST');
		expect(opts.body).toBeUndefined();
	});

	it('clearOverlayBug sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.clearOverlayBug();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/overlay/bug');
		expect(opts.method).toBe('DELETE');
	});

	it('sendOverlaySvg sends POST with svg data as query param', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.sendOverlaySvg({ data: '<svg>...</svg>' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toContain('/api/plugins/overlay/svg?');
		expect(url).toContain('data=');
		expect(opts.method).toBe('POST');
		expect(opts.body).toBeUndefined();
	});

	it('sendOverlaySvg sends POST with path as query param', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.sendOverlaySvg({ path: '/media/overlay.svg' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toContain('/api/plugins/overlay/svg?');
		expect(url).toContain('path=%2Fmedia%2Foverlay.svg');
	});

	it('clearOverlaySvg sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.clearOverlaySvg();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/overlay/svg');
		expect(opts.method).toBe('DELETE');
	});
});

// ── Layer Control ──

describe('CathodeClient layer control', () => {
	it('getLayerStatus fetches by name', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ source_type: 'playlist' }));
		const result = await client.getLayerStatus('input_a');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/input_a');
		expect(result.source_type).toBe('playlist');
	});

	it('loadLayerSource sends POST with source request', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.loadLayerSource('blinder', { type: 'image', path: '/media/logo.png' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/layers/blinder/source');
		expect(JSON.parse(opts.body)).toEqual({ type: 'image', path: '/media/logo.png' });
	});

	it('showLayer sends POST with alpha and volume', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.showLayer('input_b');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/layers/input_b/show');
		expect(JSON.parse(opts.body)).toEqual({ alpha: 1, volume: 1 });
	});

	it('hideLayer sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.hideLayer('failover');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/failover/hide');
	});

	it('setLayerPosition sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setLayerPosition('input_a', { x: 100, y: 100, width: 640, height: 480 });
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ x: 100, y: 100, width: 640, height: 480 });
	});

	it('resetLayerPosition sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.resetLayerPosition('input_a');
		expect(mock.mock.calls[0][1].method).toBe('DELETE');
	});
});

// ── Layer Configuration ──

describe('CathodeClient layer config', () => {
	it('getLayerConfig fetches /api/playout/layers/config', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			presets: ['default', 'minimal'],
			layers: [{ name: 'failover', role: 'safety' }, { name: 'input_a', role: 'content' }],
		}));
		const result = await client.getLayerConfig();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/config');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.presets).toContain('default');
		expect(result.layers).toHaveLength(2);
	});

	it('getLayerConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ presets: ['default'], layers: [] }));
		await client.getLayerConfig('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/config?channel=ch2');
	});

	it('setLayerConfig sends PUT with preset', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setLayerConfig({ preset: 'minimal' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/layers/config');
		expect(opts.method).toBe('PUT');
		expect(JSON.parse(opts.body)).toEqual({ preset: 'minimal' });
	});

	it('setLayerConfig sends PUT with custom layers', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		const layers = [{ name: 'bg', role: 'safety' }, { name: 'fg', role: 'content' }];
		await client.setLayerConfig({ layers });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/layers/config');
		expect(opts.method).toBe('PUT');
		expect(JSON.parse(opts.body)).toEqual({ layers });
	});

	it('setLayerConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setLayerConfig({ preset: 'minimal' }, 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/config?channel=ch2');
	});
});

// ── Block Types ──

describe('CathodeClient block types', () => {
	it('getBlockTypes fetches /api/program/block-types', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			core: { playlist: { name: 'playlist', description: 'Playlist block' }, canvas: { name: 'canvas', description: 'Canvas block' } },
			plugin: {},
			all: ['playlist', 'canvas'],
		}));
		const result = await client.getBlockTypes();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/program/block-types');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.all).toEqual(['playlist', 'canvas']);
	});

	it('getBlockTypes passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ core: {}, plugin: {}, all: [] }));
		await client.getBlockTypes('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/program/block-types?channel=ch2');
	});
});

// ── Playlist Tools ──

describe('CathodeClient playlist tools', () => {
	it('getPlaylistTools fetches /api/playlists/{name}/tools', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			tools: [{ name: 'shuffle', label: 'Shuffle', description: 'Randomize order', params: [] }],
			count: 1,
		}));
		const result = await client.getPlaylistTools('main');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists/main/tools');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.tools[0].name).toBe('shuffle');
	});

	it('getPlaylistTools passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ tools: [], count: 0 }));
		await client.getPlaylistTools('main', 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists/main/tools?channel=ch2');
	});

	it('applyPlaylistTool sends POST with params and save=false', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ entries: ['a.mp4', 'b.mp4'], saved: false }));
		const result = await client.applyPlaylistTool('main', 'shuffle', {}, false);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlists/main/tools/shuffle');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ params: {}, save: false });
		expect(result.saved).toBe(false);
	});

	it('applyPlaylistTool sends POST with save=true', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ entries: ['b.mp4', 'a.mp4'], saved: true }));
		const result = await client.applyPlaylistTool('main', 'shuffle', {}, true);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playlists/main/tools/shuffle');
		expect(JSON.parse(opts.body)).toEqual({ params: {}, save: true });
		expect(result.saved).toBe(true);
	});

	it('applyPlaylistTool passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ entries: [], saved: false }));
		await client.applyPlaylistTool('main', 'shuffle', {}, false, 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists/main/tools/shuffle?channel=ch2');
	});
});

// ── Channel parameter routing ──

describe('CathodeClient channel parameter', () => {
	it('appends ?channel= to per-channel GET methods', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({}));

		await client.getEngineHealth('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/health?channel=ch2');
	});

	it('omits ?channel= when not provided', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({}));

		await client.getEngineHealth();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/health');
	});

	it('passes channel on getPlayoutMode', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ mode: 'loop', day_start: '06:00', length: '24h' }));

		await client.getPlayoutMode('ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
	});

	it('passes channel on setPlayoutMode', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.setPlayoutMode('schedule', '06:00', 'ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
	});

	it('passes channel on getEncoding', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({}));

		await client.getEncoding('ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
	});

	it('passes channel on getPlaylists', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ playlists: [], count: 0 }));

		await client.getPlaylists('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists?channel=ch2');
	});

	it('passes channel on loadPlaylist', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.loadPlaylist('main', { layer: 'input_a' }, 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playlists/main/load?channel=ch2');
	});

	it('passes channel on getSchedule alongside days param', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ schedule: {}, today: '2025-01-01', days_checked: 14 }));

		await client.getSchedule(14, 'ch2');
		expect(mock.mock.calls[0][0]).toContain('days=14');
		expect(mock.mock.calls[0][0]).toContain('channel=ch2');
	});

	it('passes channel on getProgram', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ date: '2025-01-01', blocks: [] }));

		await client.getProgram('2025-01-01', 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/program/2025-01-01?channel=ch2');
	});

	it('passes channel on getLayerStatus', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ source_type: 'playlist' }));

		await client.getLayerStatus('input_a', 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/layers/input_a?channel=ch2');
	});

	it('passes channel on showLayer', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.showLayer('input_a', 0.8, 0.5, 'ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
		expect(JSON.parse(mock.mock.calls[0][1].body)).toEqual({ alpha: 0.8, volume: 0.5 });
	});

	it('passes channel on startEngine', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));

		await client.startEngine({}, 'ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
	});

	it('passes channel on stopEngine', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true }));

		await client.stopEngine('ch2');
		expect(mock.mock.calls[0][0]).toContain('?channel=ch2');
	});
});

// ── Channel CRUD ──

describe('CathodeClient channels', () => {
	it('listChannels fetches /api/channels', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			channels: [{ id: 'main', channel_id: 'TVmain', display_name: 'Main', status: 'active', has_engine: true }],
			count: 1,
		}));

		const result = await client.listChannels();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/channels');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.channels).toHaveLength(1);
		expect(result.channels[0].id).toBe('main');
	});

	it('createChannel sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true, id: 'news', channel_id: 'TVnews' }));

		const result = await client.createChannel({ id: 'news', display_name: 'News Channel' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/channels');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ id: 'news', display_name: 'News Channel' });
		expect(result.channel_id).toBe('TVnews');
	});

	it('getChannel fetches by id', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			id: 'main', channel_id: 'TVmain', display_name: 'Main',
			status: 'active', has_engine: true,
		}));

		const result = await client.getChannel('main');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/channels/main');
		expect(result.display_name).toBe('Main');
	});

	it('updateChannel sends PATCH', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true, id: 'main', updated: ['display_name'] }));

		const result = await client.updateChannel('main', { display_name: 'Main HD' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/channels/main');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ display_name: 'Main HD' });
		expect(result.updated).toContain('display_name');
	});

	it('deleteChannel sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.deleteChannel('old-channel');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/channels/old-channel');
		expect(opts.method).toBe('DELETE');
	});

	it('deleteChannel throws 409 for last channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(errorResponse(409, { detail: 'Cannot delete last channel' }));

		try {
			await client.deleteChannel('only-channel');
			expect.unreachable('Should have thrown');
		} catch (e) {
			expect(e).toBeInstanceOf(CathodeApiError);
			expect((e as CathodeApiError).status).toBe(409);
		}
	});
});

// ── Plugins ──

describe('CathodeClient plugins', () => {
	it('listPlugins fetches /api/plugins', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			plugins: [{ name: 'stats', services: ['http'], settings: {}, has_shutdown: false, has_tasks: true }],
			count: 1,
		}));

		const result = await client.listPlugins();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins');
		expect(result.plugins[0].name).toBe('stats');
	});

	it('getPlugin fetches by name', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			name: 'stats', loaded: true, services: ['http'], settings: {},
			has_shutdown: false, has_tasks: true,
		}));

		const result = await client.getPlugin('stats');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/stats');
		expect(result.loaded).toBe(true);
	});

	it('getPluginSettings fetches settings', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			name: 'stats',
			settings: {
				port: { type: 'int', value: 8080, description: 'HTTP port' },
			},
		}));

		const result = await client.getPluginSettings('stats');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/stats/settings');
		expect(result.settings.port.type).toBe('int');
		expect(result.settings.port.value).toBe(8080);
	});

	it('updatePluginSettings sends PATCH with settings object', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			ok: true, name: 'stats',
			settings: { port: { type: 'int', value: 9090, description: 'HTTP port' } },
		}));

		const result = await client.updatePluginSettings('stats', { port: 9090 });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/stats/settings');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ settings: { port: 9090 } });
		expect(result.ok).toBe(true);
	});

	it('enablePlugin sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ message: 'Plugin overlay enabled' }));

		const result = await client.enablePlugin('overlay');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/overlay/enable');
		expect(opts.method).toBe('POST');
		expect(result.message).toBe('Plugin overlay enabled');
	});

	it('disablePlugin sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ message: 'Plugin overlay disabled' }));

		const result = await client.disablePlugin('overlay');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/overlay/disable');
		expect(opts.method).toBe('POST');
		expect(result.message).toBe('Plugin overlay disabled');
	});
});

// ── Plugin Registries ──

describe('CathodeClient plugin registries', () => {
	it('getRegistrySourceTypes transforms dict to array', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			source_types: {
				generator: { plugin: 'gstreamer-source', description: 'GStreamer patterns', params: { preset: { type: 'str' } } },
				html: { plugin: 'html-source', description: 'HTML rendering' },
			},
		}));

		const result = await client.getRegistrySourceTypes();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/registry/source-types');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.types).toHaveLength(2);
		expect(result.types[0].name).toBe('generator');
		expect(result.types[0].plugin).toBe('gstreamer-source');
		expect(result.types[1].name).toBe('html');
	});

	it('getRegistrySourceTypes handles empty response', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ source_types: {} }));
		const result = await client.getRegistrySourceTypes();
		expect(result.types).toHaveLength(0);
	});

	it('getRegistryOutputTypes transforms dict to array', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			output_types: {
				srt: { plugin: 'srt-output', description: 'SRT Output' },
			},
		}));

		const result = await client.getRegistryOutputTypes();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/registry/output-types');
		expect(result.types[0].name).toBe('srt');
		expect(result.types[0].plugin).toBe('srt-output');
	});

	it('getRegistryBlockTypes transforms dict to array', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			block_types: {
				live: { plugin: 'live-source', description: 'Live Input' },
			},
		}));

		const result = await client.getRegistryBlockTypes();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/registry/block-types');
		expect(result.types[0].name).toBe('live');
	});

	it('getRegistryPlaylistTools transforms dict to array', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			playlist_tools: {
				shuffle: { plugin: 'utils', description: 'Randomize order' },
			},
		}));

		const result = await client.getRegistryPlaylistTools();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/registry/playlist-tools');
		expect(result.tools[0].name).toBe('shuffle');
	});
});

// ── Outputs ──

describe('CathodeClient outputs', () => {
	it('getOutputs fetches /api/outputs', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			outputs: [{ name: 'primary', type: 'hls', state: 'PLAYING', uptime: 123.4, errors: 0, last_error: null, config: {} }],
		}));

		const result = await client.getOutputs();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/outputs');
		expect(result.outputs[0].name).toBe('primary');
	});

	it('getOutputs passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ outputs: [] }));

		await client.getOutputs('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/outputs?channel=ch2');
	});

	it('createOutput sends POST with config', async () => {
		const { client, mock } = await connectedClient();
		const output = { name: 'twitch', type: 'rtmp' as const, rtmp_url: 'rtmp://twitch.tv/live/key' };
		mock.mockReturnValue(jsonResponse({ ...output, state: 'PLAYING', uptime: 0, errors: 0, last_error: null, config: {} }));

		const result = await client.createOutput(output);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/outputs');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual(output);
		expect(result.name).toBe('twitch');
	});

	it('getOutput fetches by name', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ name: 'primary', type: 'hls', state: 'PLAYING', uptime: 100, errors: 0, last_error: null, config: {} }));

		const result = await client.getOutput('primary');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/outputs/primary');
		expect(result.state).toBe('PLAYING');
	});

	it('updateOutput sends PATCH', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ name: 'primary', type: 'hls', state: 'PLAYING', uptime: 0, errors: 0, last_error: null, config: {} }));

		await client.updateOutput('primary', { video_bitrate: 5000 });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/outputs/primary');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ video_bitrate: 5000 });
	});

	it('deleteOutput sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.deleteOutput('twitch');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/outputs/twitch');
		expect(opts.method).toBe('DELETE');
	});

	it('stopOutput sends POST to stop endpoint', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.stopOutput('primary');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/outputs/primary/stop');
		expect(opts.method).toBe('POST');
	});

	it('startOutput sends POST to start endpoint', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.startOutput('primary');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/outputs/primary/start');
		expect(opts.method).toBe('POST');
	});

	it('stopOutput passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));

		await client.stopOutput('primary', 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/outputs/primary/stop?channel=ch2');
	});
});

// ── Logs ──

describe('CathodeClient logs', () => {
	it('getLogs fetches /api/logs', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			count: 2,
			entries: [
				{ timestamp: '2025-01-01T00:00:00Z', level: 'INFO', source: 'engine', logger: 'main', message: 'Started', module: 'engine', lineno: 10 },
				{ timestamp: '2025-01-01T00:00:01Z', level: 'DEBUG', source: 'api', logger: 'http', message: 'GET /status', module: 'api', lineno: 20 },
			],
		}));

		const result = await client.getLogs();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/logs');
		expect(result.count).toBe(2);
		expect(result.entries[0].source).toBe('engine');
	});

	it('getLogs passes filter params', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ count: 0, entries: [] }));

		await client.getLogs({ limit: 50, level: 'ERROR', source: 'engine' });
		expect(mock.mock.calls[0][0]).toContain('limit=50');
		expect(mock.mock.calls[0][0]).toContain('level=ERROR');
		expect(mock.mock.calls[0][0]).toContain('source=engine');
	});

	it('getLogs omits undefined params', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ count: 0, entries: [] }));

		await client.getLogs({ limit: 100 });
		const url = mock.mock.calls[0][0];
		expect(url).toContain('limit=100');
		expect(url).not.toContain('level=');
		expect(url).not.toContain('source=');
	});
});

// ── Backup / Restore ──

describe('CathodeClient backup/restore', () => {
	it('downloadBackup sends POST and returns blob', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const client = new CathodeClient();
		mock.mockReturnValue(jsonResponse({ version: '1.0' }));
		await client.connect('http://localhost:9888', 'key');
		mock.mockClear();

		const blobData = new Blob(['backup-data'], { type: 'application/gzip' });
		mock.mockReturnValue(Promise.resolve({
			ok: true,
			status: 200,
			blob: () => Promise.resolve(blobData),
		}));

		const result = await client.downloadBackup();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/backup');
		expect(opts.method).toBe('POST');
		expect(result).toBe(blobData);
	});

	it('uploadRestore sends POST with multipart form', async () => {
		const mock = vi.fn();
		vi.stubGlobal('fetch', mock);
		const client = new CathodeClient();
		mock.mockReturnValue(jsonResponse({ version: '1.0' }));
		await client.connect('http://localhost:9888', 'key');
		mock.mockClear();

		mock.mockReturnValue(Promise.resolve({
			ok: true,
			status: 200,
			json: () => Promise.resolve({ ok: true, restored: ['config', 'playlists'], engine_restarted: true }),
		}));

		const file = new File(['archive'], 'backup.tar.gz', { type: 'application/gzip' });
		const result = await client.uploadRestore(file);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/restore');
		expect(opts.method).toBe('POST');
		expect(opts.body).toBeInstanceOf(FormData);
		expect(result.ok).toBe(true);
		expect(result.restored).toContain('config');
		expect(result.engine_restarted).toBe(true);
	});
});

// ── Plugin Presets ──

describe('CathodeClient plugin presets', () => {
	it('getPluginPresets fetches /api/plugins/{name}/presets', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			plugin: 'gstreamer-source',
			presets: [{ name: 'smpte', description: 'Test' }],
		}));

		const result = await client.getPluginPresets('gstreamer-source');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/gstreamer-source/presets');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.plugin).toBe('gstreamer-source');
		expect(result.presets[0].name).toBe('smpte');
	});

	it('getPluginPreset fetches /api/plugins/{name}/presets/{preset}', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			plugin: 'gstreamer-source',
			preset: { name: 'smpte', config: {} },
		}));

		const result = await client.getPluginPreset('gstreamer-source', 'smpte');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/plugins/gstreamer-source/presets/smpte');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.plugin).toBe('gstreamer-source');
		expect(result.preset.name).toBe('smpte');
	});

	it('savePluginPreset sends PUT with data', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true, plugin: 'gstreamer-source', preset: 'smpte' }));

		const data = { pattern: 'smpte', width: 1920 };
		const result = await client.savePluginPreset('gstreamer-source', 'smpte', data);
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/gstreamer-source/presets/smpte');
		expect(opts.method).toBe('PUT');
		expect(JSON.parse(opts.body)).toEqual(data);
		expect(result.ok).toBe(true);
		expect(result.plugin).toBe('gstreamer-source');
		expect(result.preset).toBe('smpte');
	});

	it('deletePluginPreset sends DELETE', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true, plugin: 'gstreamer-source', deleted: 'smpte' }));

		const result = await client.deletePluginPreset('gstreamer-source', 'smpte');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/gstreamer-source/presets/smpte');
		expect(opts.method).toBe('DELETE');
		expect(result.ok).toBe(true);
		expect(result.plugin).toBe('gstreamer-source');
		expect(result.deleted).toBe('smpte');
	});
});

// ── Failover / Slate Config ──

describe('CathodeClient failover/slate config', () => {
	it('getFailoverConfig fetches /api/playout/failover', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ title: 'Off Air', subtitle: '', duration: 10, pattern: 'smpte' }));
		const result = await client.getFailoverConfig();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/failover');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.title).toBe('Off Air');
		expect(result.pattern).toBe('smpte');
	});

	it('getFailoverConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ title: 'Off Air', subtitle: '', duration: 10, pattern: 'smpte' }));
		await client.getFailoverConfig('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/failover?channel=ch2');
	});

	it('setFailoverConfig sends PATCH with body', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setFailoverConfig({ title: 'Technical difficulties', pattern: 'black' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/failover');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ title: 'Technical difficulties', pattern: 'black' });
	});

	it('setFailoverConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setFailoverConfig({ pattern: 'black' }, 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/failover?channel=ch2');
	});

	it('regenerateFailover sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.regenerateFailover();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/failover/regenerate');
		expect(opts.method).toBe('POST');
	});

	it('regenerateFailover passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.regenerateFailover('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/failover/regenerate?channel=ch2');
	});

	it('getSlateConfig fetches /api/playout/slate', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ title: 'Please Stand By', subtitle: '', duration: 5, pattern: 'smpte' }));
		const result = await client.getSlateConfig();
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/slate');
		expect(mock.mock.calls[0][1].method).toBe('GET');
		expect(result.title).toBe('Please Stand By');
	});

	it('getSlateConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ title: 'Please Stand By', subtitle: '', duration: 5, pattern: 'smpte' }));
		await client.getSlateConfig('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/slate?channel=ch2');
	});

	it('setSlateConfig sends PATCH with body', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setSlateConfig({ title: 'BRB', pattern: 'smpte' });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/slate');
		expect(opts.method).toBe('PATCH');
		expect(JSON.parse(opts.body)).toEqual({ title: 'BRB', pattern: 'smpte' });
	});

	it('setSlateConfig passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.setSlateConfig({ pattern: 'smpte' }, 'ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/slate?channel=ch2');
	});

	it('regenerateSlate sends POST', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.regenerateSlate();
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/playout/slate/regenerate');
		expect(opts.method).toBe('POST');
	});

	it('regenerateSlate passes channel', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.regenerateSlate('ch2');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/playout/slate/regenerate?channel=ch2');
	});
});

// ── Media Folder ──

describe('CathodeClient media folders', () => {
	it('createMediaFolder sends POST with name query param', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ ok: true, folder: 'bumpers' }));
		const result = await client.createMediaFolder('bumpers');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/media/mkdir?name=bumpers');
		expect(opts.method).toBe('POST');
		expect(result.ok).toBe(true);
		expect(result.folder).toBe('bumpers');
	});
});

// ── Media with paths ──

describe('CathodeClient media with paths', () => {
	it('getMediaMetadata with path preserves slashes', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({ filename: 'cathode/failover.mp4', duration: 30, size: 5000 }));
		const result = await client.getMediaMetadata('cathode/failover.mp4');
		expect(mock.mock.calls[0][0]).toBe('http://localhost:9888/api/media/cathode/failover.mp4');
		expect(result.filename).toBe('cathode/failover.mp4');
	});

	it('deleteMedia with path preserves slashes', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse(null));
		await client.deleteMedia('bumpers/clip.mp4');
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/media/bumpers/clip.mp4');
		expect(opts.method).toBe('DELETE');
	});

	it('uploadMedia with folder passes folder query param', async () => {
		const { client, mock } = await connectedClient('my-key');
		mock.mockReturnValue(jsonResponse({ filename: 'bumpers/new.mp4', size: 5000, duration: 120 }));
		const file = new File(['content'], 'new.mp4', { type: 'video/mp4' });
		const result = await client.uploadMedia(file, 'bumpers');

		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/media/upload?folder=bumpers');
		expect(opts.method).toBe('POST');
		expect(opts.body).toBeInstanceOf(FormData);
		expect(result.filename).toBe('bumpers/new.mp4');
	});
});

// ── Media Generation ──

describe('CathodeClient media generation', () => {
	it('generateMedia sends POST with config', async () => {
		const { client, mock } = await connectedClient();
		mock.mockReturnValue(jsonResponse({
			ok: true, plugin: 'gstreamer-source', filename: 'smpte.mp4',
			path: '/media/smpte.mp4', duration: 60,
		}));

		const result = await client.generateMedia('gstreamer-source', { preset: 'smpte', duration: 60 });
		const [url, opts] = mock.mock.calls[0];
		expect(url).toBe('http://localhost:9888/api/plugins/gstreamer-source/generate');
		expect(opts.method).toBe('POST');
		expect(JSON.parse(opts.body)).toEqual({ preset: 'smpte', duration: 60 });
		expect(result.ok).toBe(true);
		expect(result.plugin).toBe('gstreamer-source');
		expect(result.filename).toBe('smpte.mp4');
		expect(result.path).toBe('/media/smpte.mp4');
		expect(result.duration).toBe(60);
	});
});
