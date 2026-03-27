import type {
	BackendAdapter,
	ServerInfo,
	SystemStatus,
	NowPlaying,
	SystemStats,
	MediaList,
	MediaMetadata,
	Schedule,
	ScheduleDay,
	GenerateScheduleRequest,
	PlaylistListResponse,
	PlaylistDetail,
	LoadPlaylistRequest,
	PlaylistToolsResponse,
	PlaylistToolResult,
	ProgramList,
	Program,
	ProgramBlock,
	BlockTypesResponse,
	GuideEntry,
	PeerList,
	AddedPeers,
	RelayList,
	AddedRelay,
	TokenList,
	CreatedToken,
	MigrationList,
	MigrationResult,
	PlayoutMode,
	EncodingSettings,
	StorageSettings,
	ChannelMetadata,
	OverlayStatus,
	OverlayTextRequest,
	OverlayBugRequest,
	OverlaySvgRequest,
	EngineHealth,
	EngineChannelStatus,
	EngineStartRequest,
	SourceRequest,
	PositionRequest,
	RestartRequest,
	LayerStatus,
	LayerConfigResponse,
	LayerConfigRequest,
	ChannelListResponse,
	Channel,
	CreateChannelRequest,
	PluginListResponse,
	PluginInfo,
	PluginSettings,
	PluginSettingValue,
	OutputConfig,
	OutputHealth,
	OutputListResponse,
	RegistrySourceTypesResponse,
	RegistryOutputTypesResponse,
	RegistryBlockTypesResponse,
	RegistryPlaylistToolsResponse,
	PluginPresetsResponse,
	PluginPresetDetail,
	GenerateMediaRequest,
	GenerateMediaResponse,
	LogEntry,
	LogQueryParams,
	LogQueryResponse,
	RestoreResponse,
} from './types';

export class CathodeApiError extends Error {
	constructor(
		public status: number,
		public body: unknown,
		message?: string
	) {
		super(message ?? `Cathode API error ${status}`);
		this.name = 'CathodeApiError';
	}

	/** Extract a human-readable message from a caught error (CathodeApiError or generic). */
	static extractMessage(e: unknown, fallback: string): string {
		const err = e as { body?: { detail?: unknown }; message?: string };
		const detail = err?.body?.detail;
		if (typeof detail === 'string') return detail;
		if (Array.isArray(detail)) return detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join('; ');
		if (detail && typeof detail === 'object') return JSON.stringify(detail);
		return err?.message || fallback;
	}
}

export class CathodeClient implements BackendAdapter {
	readonly id = 'cathode';
	readonly name = 'Cathode';

	private baseUrl = '';
	private apiKey = '';

	private async request<T>(
		method: string,
		path: string,
		body?: unknown
	): Promise<T> {
		const headers: Record<string, string> = {};
		if (this.apiKey) headers['X-API-Key'] = this.apiKey;
		if (body !== undefined) headers['Content-Type'] = 'application/json';

		const resp = await fetch(`${this.baseUrl}${path}`, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
		});

		const text = await resp.text();

		if (!resp.ok) {
			let errBody: unknown = text;
			try { errBody = JSON.parse(text); } catch {}
			throw new CathodeApiError(resp.status, errBody);
		}

		const contentType = resp.headers.get('content-type') || '';
		if (contentType.includes('application/json') && text) {
			return JSON.parse(text) as T;
		}
		return text as unknown as T;
	}

	private get = <T>(path: string) => this.request<T>('GET', path);
	private post = <T>(path: string, body?: unknown) => this.request<T>('POST', path, body);
	private patch = <T>(path: string, body: unknown) => this.request<T>('PATCH', path, body);
	private put = <T>(path: string, body: unknown) => this.request<T>('PUT', path, body);
	private del = <T>(path: string) => this.request<T>('DELETE', path);

	/** Build query string from non-undefined params. */
	private qs(params: Record<string, string | number | boolean | undefined>): string {
		const entries = Object.entries(params).filter(([, v]) => v !== undefined);
		if (entries.length === 0) return '';
		return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
	}

	// ── BackendAdapter implementation ──

	async connect(baseUrl: string, apiKey: string): Promise<ServerInfo> {
		this.baseUrl = baseUrl.replace(/\/$/, '');
		this.apiKey = apiKey;

		let status: SystemStatus;
		try {
			status = await this.get<SystemStatus>('/api/status');
		} catch (e) {
			// Gateway errors (502/503/504) mean the reverse proxy can't reach
			// the backend — same as no backend running.
			if (e instanceof CathodeApiError && e.status >= 502 && e.status <= 504) {
				throw new Error('No playout backend found at this address');
			}
			throw e;
		}

		// Validate response is a real status object — not an SPA fallback HTML page.
		// When no backend is running, sirv returns index.html (200, text/html) which
		// request() passes through as a raw string instead of a parsed object.
		if (typeof status !== 'object' || status === null) {
			throw new Error('No playout backend found at this address');
		}

		return {
			version: status.version || 'unknown',
			backend: 'cathode',
		};
	}

	// Status
	getStatus = () => this.get<SystemStatus>('/api/status');
	getNowPlaying = () => this.get<NowPlaying>('/api/now-playing');
	getSystemStats = () => this.get<SystemStats>('/api/system');
	getMedia = () => this.get<MediaList>('/api/media');

	// Media management
	// Filenames can be relative paths (e.g. "bumpers/clip.mp4")
	getMediaMetadata = (filename: string) => this.get<MediaMetadata>(`/api/media/${encodeURIComponent(filename).replace(/%2F/g, '/')}`);
	async uploadMedia(file: File, folder?: string): Promise<{ filename: string; size: number; duration: number }> {
		const formData = new FormData();
		formData.append('file', file);
		const headers: Record<string, string> = {};
		if (this.apiKey) headers['X-API-Key'] = this.apiKey;
		const url = folder
			? `${this.baseUrl}/api/media/upload?folder=${encodeURIComponent(folder)}`
			: `${this.baseUrl}/api/media/upload`;
		const resp = await fetch(url, {
			method: 'POST',
			headers,
			body: formData,
		});
		if (!resp.ok) {
			let errBody: unknown;
			try { errBody = await resp.json(); } catch { errBody = await resp.text(); }
			throw new CathodeApiError(resp.status, errBody);
		}
		return await resp.json();
	}
	async deleteMedia(filename: string): Promise<void> {
		await this.del(`/api/media/${encodeURIComponent(filename).replace(/%2F/g, '/')}`);
	}
	async createMediaFolder(name: string): Promise<{ ok: boolean; folder: string }> {
		return this.post(`/api/media/mkdir${this.qs({ name })}`);
	}

	// Playlist
	async setPlaylist(files: string[], channel?: string): Promise<void> {
		await this.post(`/api/playlist${this.qs({ channel })}`, { files });
	}
	async skip(channel?: string, layer?: string): Promise<void> {
		await this.post(`/api/skip${this.qs({ channel, layer })}`);
	}
	async back(channel?: string, layer?: string): Promise<void> {
		await this.post(`/api/back${this.qs({ channel, layer })}`);
	}
	async getSchedule(days = 7, channel?: string): Promise<Schedule> {
		// Cathode returns schedule as dict[str, bool]; transform to array
		const raw = await this.get<{ schedule: Record<string, boolean>; today: string; days_checked: number }>(
			`/api/schedule${this.qs({ days, channel })}`
		);
		return {
			schedule: Object.entries(raw.schedule).map(([date, has_playlist]) => ({ date, has_playlist })),
			today: raw.today,
			days_checked: raw.days_checked,
		};
	}
	getScheduleDate = (date: string, channel?: string) => this.get<ScheduleDay>(`/api/schedule/${date}${this.qs({ channel })}`);
	async generateSchedule(req: GenerateScheduleRequest, channel?: string): Promise<void> {
		await this.post(`/api/schedule/generate${this.qs({ channel })}`, req);
	}
	async deleteSchedule(date: string, channel?: string): Promise<void> {
		await this.del(`/api/schedule/${date}${this.qs({ channel })}`);
	}

	// Named playlists
	getPlaylists = (channel?: string) => this.get<PlaylistListResponse>(`/api/playlists${this.qs({ channel })}`);
	getPlaylist = (name: string, channel?: string) => this.get<PlaylistDetail>(`/api/playlists/${name}${this.qs({ channel })}`);
	async createPlaylist(name: string, files: string[], channel?: string): Promise<void> {
		await this.post(`/api/playlists/${name}${this.qs({ channel })}`, { files });
	}
	async deletePlaylist(name: string, channel?: string): Promise<void> {
		await this.del(`/api/playlists/${name}${this.qs({ channel })}`);
	}
	async loadPlaylist(name: string, req?: LoadPlaylistRequest, channel?: string): Promise<void> {
		await this.post(`/api/playlists/${name}/load${this.qs({ channel })}`, req ?? {});
	}

	// Playlist tools (plugin-provided)
	getPlaylistTools = (name: string, channel?: string) =>
		this.get<PlaylistToolsResponse>(`/api/playlists/${name}/tools${this.qs({ channel })}`);
	async applyPlaylistTool(name: string, tool: string, params?: Record<string, unknown>, save = false, channel?: string): Promise<PlaylistToolResult> {
		return this.post<PlaylistToolResult>(`/api/playlists/${name}/tools/${tool}${this.qs({ channel })}`, {
			params: params ?? {},
			save,
		});
	}

	// Program
	async getPrograms(days = 7, channel?: string): Promise<ProgramList> {
		// Cathode returns programs as dict[str, bool]; transform to array
		const raw = await this.get<{ programs: Record<string, boolean>; today: string; days_checked: number }>(
			`/api/program${this.qs({ days, channel })}`
		);
		return {
			programs: Object.entries(raw.programs).map(([date, has_program]) => ({ date, has_program })),
			today: raw.today,
			days_checked: raw.days_checked,
		};
	}
	getProgram = (date: string, channel?: string) => this.get<Program>(`/api/program/${date}${this.qs({ channel })}`);
	async setProgram(date: string, blocks: ProgramBlock[], channel?: string): Promise<void> {
		await this.post(`/api/program/${date}${this.qs({ channel })}`, { blocks });
	}
	async deleteProgram(date: string, channel?: string): Promise<void> {
		await this.del(`/api/program/${date}${this.qs({ channel })}`);
	}

	// Block types
	getBlockTypes = (channel?: string) => this.get<BlockTypesResponse>(`/api/program/block-types${this.qs({ channel })}`);

	// Outputs
	getOutputs = (channel?: string) => this.get<OutputListResponse>(`/api/outputs${this.qs({ channel })}`);
	async createOutput(config: OutputConfig, channel?: string): Promise<OutputHealth> {
		return this.post<OutputHealth>(`/api/outputs${this.qs({ channel })}`, config);
	}
	getOutput = (name: string, channel?: string) => this.get<OutputHealth>(`/api/outputs/${name}${this.qs({ channel })}`);
	async updateOutput(name: string, config: Partial<OutputConfig>, channel?: string): Promise<OutputHealth> {
		return this.patch<OutputHealth>(`/api/outputs/${name}${this.qs({ channel })}`, config);
	}
	async deleteOutput(name: string, channel?: string): Promise<void> {
		await this.del(`/api/outputs/${name}${this.qs({ channel })}`);
	}
	async stopOutput(name: string, channel?: string): Promise<void> {
		await this.post(`/api/outputs/${name}/stop${this.qs({ channel })}`);
	}
	async startOutput(name: string, channel?: string): Promise<void> {
		await this.post(`/api/outputs/${name}/start${this.qs({ channel })}`);
	}

	// Guide
	getGuideJson = () => this.get<GuideEntry[]>('/api/guide.json');

	// Peers
	getPeers = () => this.get<PeerList>('/api/peers');
	async addPeer(hint: string, channelId?: string): Promise<AddedPeers> {
		return this.post<AddedPeers>('/api/peers', {
			hint,
			...(channelId ? { channel_id: channelId } : {}),
		});
	}
	async removePeer(channelId: string): Promise<void> {
		await this.del(`/api/peers/${channelId}`);
	}

	// Relays
	getRelays = () => this.get<RelayList>('/api/relay');
	async addRelay(channelId: string, hint: string): Promise<AddedRelay> {
		return this.post<AddedRelay>('/api/relay', { channel_id: channelId, hint });
	}
	async removeRelay(channelId: string): Promise<void> {
		await this.del(`/api/relay/${channelId}`);
	}

	// Tokens
	getTokens = (channelId: string) => this.get<TokenList>(`/api/tokens/${channelId}`);
	async createToken(channelId: string, name: string, expires?: string): Promise<CreatedToken> {
		return this.post<CreatedToken>(`/api/tokens/${channelId}`, {
			name,
			...(expires ? { expires } : {}),
		});
	}
	async revokeToken(channelId: string, tokenId: string): Promise<void> {
		await this.del(`/api/tokens/${channelId}/${tokenId}`);
	}

	// Settings — playout
	getPlayoutMode = (channel?: string) => this.get<PlayoutMode>(`/api/playout/mode${this.qs({ channel })}`);
	async setPlayoutMode(mode: string, dayStart?: string, channel?: string): Promise<void> {
		await this.post(`/api/playout/mode${this.qs({ channel })}`, { mode, ...(dayStart ? { day_start: dayStart } : {}) });
	}
	getEncoding = (channel?: string) => this.get<EncodingSettings>(`/api/playout/encoding${this.qs({ channel })}`);
	async setEncoding(settings: Partial<EncodingSettings>, channel?: string): Promise<{ outputs_updated: number }> {
		return this.patch<{ outputs_updated: number }>(`/api/playout/encoding${this.qs({ channel })}`, settings);
	}
	getStorage = (channel?: string) => this.get<StorageSettings>(`/api/playout/storage${this.qs({ channel })}`);
	async setStorage(settings: Partial<StorageSettings>, channel?: string): Promise<void> {
		await this.patch(`/api/playout/storage${this.qs({ channel })}`, settings);
	}

	// Settings — channel metadata
	getChannelMetadata = () => this.get<ChannelMetadata>('/api/channel');
	async setChannelMetadata(settings: Partial<ChannelMetadata>): Promise<void> {
		await this.patch('/api/channel', settings);
	}

	// Failover / slate config
	getFailoverConfig = (channel?: string) => this.get<import('./types').SystemVideoConfig>(`/api/playout/failover${this.qs({ channel })}`);
	async setFailoverConfig(config: Partial<import('./types').SystemVideoConfig>, channel?: string): Promise<void> {
		await this.patch(`/api/playout/failover${this.qs({ channel })}`, config);
	}
	async regenerateFailover(channel?: string): Promise<void> {
		await this.post(`/api/playout/failover/regenerate${this.qs({ channel })}`);
	}
	getSlateConfig = (channel?: string) => this.get<import('./types').SystemVideoConfig>(`/api/playout/slate${this.qs({ channel })}`);
	async setSlateConfig(config: Partial<import('./types').SystemVideoConfig>, channel?: string): Promise<void> {
		await this.patch(`/api/playout/slate${this.qs({ channel })}`, config);
	}
	async regenerateSlate(channel?: string): Promise<void> {
		await this.post(`/api/playout/slate/regenerate${this.qs({ channel })}`);
	}

	// Overlay (plugin-provided — /api/plugins/overlay/*)
	// Overlay endpoints use query params, not JSON body.
	getOverlayStatus = (channel?: string) => this.get<OverlayStatus>(`/api/plugins/overlay/status${this.qs({ channel })}`);
	async sendOverlayText(req: OverlayTextRequest, channel?: string): Promise<void> {
		const params: Record<string, string | number | boolean | undefined> = {
			text: req.text,
			fontsize: req.fontsize,
			fontcolor: req.fontcolor,
			position: req.position,
			background: req.background,
			alpha: req.alpha,
			channel,
		};
		await this.post(`/api/plugins/overlay/text${this.qs(params)}`);
	}
	async clearOverlayText(channel?: string): Promise<void> {
		await this.del(`/api/plugins/overlay/text${this.qs({ channel })}`);
	}
	async sendOverlayBug(req: OverlayBugRequest, channel?: string): Promise<void> {
		const params: Record<string, string | number | boolean | undefined> = {
			path: req.path, x: req.x, y: req.y,
			width: req.width, height: req.height, alpha: req.alpha, channel,
		};
		await this.post(`/api/plugins/overlay/bug${this.qs(params)}`);
	}
	async clearOverlayBug(channel?: string): Promise<void> {
		await this.del(`/api/plugins/overlay/bug${this.qs({ channel })}`);
	}
	async sendOverlaySvg(req: OverlaySvgRequest, channel?: string): Promise<void> {
		const params: Record<string, string | number | boolean | undefined> = {
			data: req.data, path: req.path, channel,
		};
		await this.post(`/api/plugins/overlay/svg${this.qs(params)}`);
	}
	async clearOverlaySvg(channel?: string): Promise<void> {
		await this.del(`/api/plugins/overlay/svg${this.qs({ channel })}`);
	}

	// Engine
	getEngineHealth = (channel?: string) => this.get<EngineHealth>(`/api/playout/health${this.qs({ channel })}`);
	async restartEngine(req?: RestartRequest, channel?: string): Promise<void> {
		await this.post(`/api/playout/restart${this.qs({ channel })}`, req ?? null);
	}
	async startEngine(req?: EngineStartRequest, channel?: string): Promise<void> {
		await this.post(`/api/playout/start${this.qs({ channel })}`, req ?? {});
	}
	async stopEngine(channel?: string): Promise<void> {
		await this.post(`/api/playout/stop${this.qs({ channel })}`);
	}
	async resyncSchedule(channel?: string): Promise<void> {
		await this.post(`/api/playout/schedule/resync${this.qs({ channel })}`);
	}

	// Layer control
	getLayerStatus = (name: string, channel?: string) => this.get<LayerStatus>(`/api/playout/layers/${name}${this.qs({ channel })}`);
	async loadLayerSource(name: string, req: SourceRequest, channel?: string): Promise<void> {
		await this.post(`/api/playout/layers/${name}/source${this.qs({ channel })}`, req);
	}
	async showLayer(name: string, alpha = 1.0, volume = 1.0, channel?: string): Promise<void> {
		await this.post(`/api/playout/layers/${name}/show${this.qs({ channel })}`, { alpha, volume });
	}
	async hideLayer(name: string, channel?: string): Promise<void> {
		await this.post(`/api/playout/layers/${name}/hide${this.qs({ channel })}`);
	}
	async setLayerPosition(name: string, pos: PositionRequest, channel?: string): Promise<void> {
		await this.post(`/api/playout/layers/${name}/position${this.qs({ channel })}`, pos);
	}
	async resetLayerPosition(name: string, channel?: string): Promise<void> {
		await this.del(`/api/playout/layers/${name}/position${this.qs({ channel })}`);
	}

	// Layer configuration
	getLayerConfig = (channel?: string) => this.get<LayerConfigResponse>(`/api/playout/layers/config${this.qs({ channel })}`);
	async setLayerConfig(config: LayerConfigRequest, channel?: string): Promise<void> {
		await this.put(`/api/playout/layers/config${this.qs({ channel })}`, config);
	}

	// Migration
	getMigrations = () => this.get<MigrationList>('/api/migration');
	async createMigration(to: string, reason?: string): Promise<MigrationResult> {
		return this.post<MigrationResult>('/api/migration/create', {
			to,
			...(reason ? { reason } : {}),
		});
	}

	// Channels
	listChannels = () => this.get<ChannelListResponse>('/api/channels');
	async createChannel(req: CreateChannelRequest): Promise<{ ok: boolean; id: string; channel_id: string }> {
		return this.post('/api/channels', req);
	}
	getChannel = (id: string) => this.get<Channel>(`/api/channels/${id}`);
	async updateChannel(id: string, settings: Partial<CreateChannelRequest>): Promise<{ ok: boolean; id: string; updated: string[] }> {
		return this.patch(`/api/channels/${id}`, settings);
	}
	async deleteChannel(id: string): Promise<void> {
		await this.del(`/api/channels/${id}`);
	}

	// Plugins
	listPlugins = () => this.get<PluginListResponse>('/api/plugins');
	getPlugin = (name: string) => this.get<PluginInfo>(`/api/plugins/${name}`);
	getPluginSettings = (name: string) => this.get<PluginSettings>(`/api/plugins/${name}/settings`);
	async updatePluginSettings(name: string, settings: Record<string, unknown>): Promise<{ ok: boolean; name: string; settings: Record<string, PluginSettingValue> }> {
		return this.patch(`/api/plugins/${name}/settings`, { settings });
	}
	async enablePlugin(name: string): Promise<{ message: string }> {
		return this.post(`/api/plugins/${name}/enable`);
	}
	async disablePlugin(name: string): Promise<{ message: string }> {
		return this.post(`/api/plugins/${name}/disable`);
	}

	// Plugin registries
	// Cathode returns registries as dicts keyed by type name; transform to arrays.
	async getRegistrySourceTypes(): Promise<RegistrySourceTypesResponse> {
		const raw = await this.get<{ source_types: Record<string, { plugin: string; description?: string; params?: Record<string, unknown> }> }>('/api/plugins/registry/source-types');
		return {
			types: Object.entries(raw.source_types || {}).map(([name, info]) => ({
				name,
				plugin: info.plugin,
				description: info.description,
				params: info.params as RegistrySourceTypesResponse['types'][0]['params'],
			})),
		};
	}
	async getRegistryOutputTypes(): Promise<RegistryOutputTypesResponse> {
		const raw = await this.get<{ output_types: Record<string, { plugin: string; description?: string; params?: Record<string, unknown> }> }>('/api/plugins/registry/output-types');
		return {
			types: Object.entries(raw.output_types || {}).map(([name, info]) => ({
				name,
				plugin: info.plugin,
				description: info.description,
				params: info.params as RegistryOutputTypesResponse['types'][0]['params'],
			})),
		};
	}
	async getRegistryBlockTypes(): Promise<RegistryBlockTypesResponse> {
		const raw = await this.get<{ block_types: Record<string, { plugin: string; description?: string }> }>('/api/plugins/registry/block-types');
		return {
			types: Object.entries(raw.block_types || {}).map(([name, info]) => ({
				name,
				plugin: info.plugin,
				description: info.description,
			})),
		};
	}
	async getRegistryPlaylistTools(): Promise<RegistryPlaylistToolsResponse> {
		const raw = await this.get<{ playlist_tools: Record<string, { plugin: string; description?: string }> }>('/api/plugins/registry/playlist-tools');
		return {
			tools: Object.entries(raw.playlist_tools || {}).map(([name, info]) => ({
				name,
				plugin: info.plugin,
				description: info.description,
			})),
		};
	}

	// Plugin presets (generic CRUD for all plugins)
	getPluginPresets = (name: string) => this.get<PluginPresetsResponse>(`/api/plugins/${name}/presets`);
	getPluginPreset = (name: string, preset: string) => this.get<PluginPresetDetail>(`/api/plugins/${name}/presets/${preset}`);
	async savePluginPreset(name: string, preset: string, data: Record<string, unknown>): Promise<{ ok: boolean; plugin: string; preset: string }> {
		return this.put(`/api/plugins/${name}/presets/${preset}`, data);
	}
	async deletePluginPreset(name: string, preset: string): Promise<{ ok: boolean; plugin: string; deleted: string }> {
		return this.del(`/api/plugins/${name}/presets/${preset}`);
	}

	// Plugin media generation
	async generateMedia(pluginName: string, config: GenerateMediaRequest): Promise<GenerateMediaResponse> {
		return this.post(`/api/plugins/${pluginName}/generate`, config);
	}

	// Logs
	getLogs = (params?: LogQueryParams) =>
		this.get<LogQueryResponse>(`/api/logs${this.qs({ limit: params?.limit, level: params?.level, source: params?.source })}`);

	streamLogs(params?: LogQueryParams, onEntry?: (entry: LogEntry) => void): { close: () => void } {
		const controller = new AbortController();
		const qs = this.qs({ level: params?.level, source: params?.source });

		fetch(`${this.baseUrl}/api/logs/stream${qs}`, {
			headers: this.apiKey ? { 'X-API-Key': this.apiKey } : {},
			signal: controller.signal,
		}).then(async (resp) => {
			if (!resp.ok || !resp.body) return;
			const reader = resp.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });

				const lines = buffer.split('\n');
				buffer = lines.pop() || '';
				for (const line of lines) {
					if (line.startsWith('data: ')) {
						try {
							const entry = JSON.parse(line.slice(6)) as LogEntry;
							onEntry?.(entry);
						} catch { /* malformed SSE data */ }
					}
				}
			}
		}).catch(() => { /* stream closed or aborted */ });

		return { close: () => controller.abort() };
	}

	// Backup / restore
	async downloadBackup(): Promise<Blob> {
		const headers: Record<string, string> = {};
		if (this.apiKey) headers['X-API-Key'] = this.apiKey;
		const resp = await fetch(`${this.baseUrl}/api/backup`, {
			method: 'POST',
			headers,
		});
		if (!resp.ok) {
			let errBody: unknown;
			try { errBody = await resp.json(); } catch { errBody = await resp.text(); }
			throw new CathodeApiError(resp.status, errBody);
		}
		return resp.blob();
	}

	async uploadRestore(file: File): Promise<RestoreResponse> {
		const formData = new FormData();
		formData.append('file', file);
		const headers: Record<string, string> = {};
		if (this.apiKey) headers['X-API-Key'] = this.apiKey;
		const resp = await fetch(`${this.baseUrl}/api/restore`, {
			method: 'POST',
			headers,
			body: formData,
		});
		if (!resp.ok) {
			let errBody: unknown;
			try { errBody = await resp.json(); } catch { errBody = await resp.text(); }
			throw new CathodeApiError(resp.status, errBody);
		}
		return resp.json();
	}
}

// ── Layer helpers ──

/** Z-order priority for playout layer roles (override at top, safety at bottom). */
const ROLE_ORDER: Record<string, number> = { override: 0, content: 1, safety: 2, overlay: 3 };

/** Sort engine layers by z-order: override → content → safety → overlay. */
export function sortedLayers(channels: Record<string, EngineChannelStatus>): [string, EngineChannelStatus][] {
	return Object.entries(channels).sort(([, a], [, b]) => {
		const aOrder = ROLE_ORDER[a.role || 'content'] ?? 1;
		const bOrder = ROLE_ORDER[b.role || 'content'] ?? 1;
		return aOrder - bOrder;
	});
}
