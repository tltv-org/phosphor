/**
 * Cathode management API types.
 *
 * These mirror cathode's /api/* request and response shapes.
 * Pure data — no logic, no framework deps.
 */

// ── Backend adapter interface ──
// Any TLTV server management client implements this.
// Phosphor's dashboard code programs against this interface,
// not directly against cathode. When a second server appears,
// add a new adapter in lib/otherserver/ implementing the same interface.

export interface BackendAdapter {
	readonly id: string;
	readonly name: string;

	/** Test connectivity and auth. Returns server info or throws. */
	connect(baseUrl: string, apiKey: string): Promise<ServerInfo>;

	/** System status. */
	getStatus(): Promise<SystemStatus>;
	getNowPlaying(): Promise<NowPlaying>;
	getSystemStats(): Promise<SystemStats>;
	getMedia(): Promise<MediaList>;

	/** Media management. */
	getMediaMetadata(filename: string): Promise<MediaMetadata>;
	uploadMedia(file: File, folder?: string): Promise<{ filename: string; size: number; duration: number }>;
	deleteMedia(filename: string): Promise<void>;
	createMediaFolder(name: string): Promise<{ ok: boolean; folder: string }>;

	/** Playlist management (anonymous). */
	setPlaylist(files: string[], channel?: string): Promise<void>;
	skip(channel?: string, layer?: string): Promise<void>;
	back(channel?: string, layer?: string): Promise<void>;
	getSchedule(days?: number, channel?: string): Promise<Schedule>;
	getScheduleDate(date: string, channel?: string): Promise<ScheduleDay>;
	generateSchedule(req: GenerateScheduleRequest, channel?: string): Promise<void>;
	deleteSchedule(date: string, channel?: string): Promise<void>;

	/** Named playlists. */
	getPlaylists(channel?: string): Promise<PlaylistListResponse>;
	getPlaylist(name: string, channel?: string): Promise<PlaylistDetail>;
	createPlaylist(name: string, files: string[], channel?: string): Promise<void>;
	deletePlaylist(name: string, channel?: string): Promise<void>;
	loadPlaylist(name: string, req?: LoadPlaylistRequest, channel?: string): Promise<void>;

	/** Playlist tools (plugin-provided). */
	getPlaylistTools(name: string, channel?: string): Promise<PlaylistToolsResponse>;
	applyPlaylistTool(name: string, tool: string, params?: Record<string, unknown>, save?: boolean, channel?: string): Promise<PlaylistToolResult>;

	/** Program management. */
	getPrograms(days?: number, channel?: string): Promise<ProgramList>;
	getProgram(date: string, channel?: string): Promise<Program>;
	setProgram(date: string, blocks: ProgramBlock[], channel?: string): Promise<void>;
	deleteProgram(date: string, channel?: string): Promise<void>;

	/** Program block types (core + plugin). */
	getBlockTypes(channel?: string): Promise<BlockTypesResponse>;

	/** Outputs. */
	getOutputs(channel?: string): Promise<OutputListResponse>;
	createOutput(config: OutputConfig, channel?: string): Promise<OutputHealth>;
	getOutput(name: string, channel?: string): Promise<OutputHealth>;
	updateOutput(name: string, config: Partial<OutputConfig>, channel?: string): Promise<OutputHealth>;
	deleteOutput(name: string, channel?: string): Promise<void>;
	stopOutput(name: string, channel?: string): Promise<void>;
	startOutput(name: string, channel?: string): Promise<void>;

	/** Guide / EPG. */
	getGuideJson(): Promise<GuideEntry[]>;

	/** Peers. */
	getPeers(): Promise<PeerList>;
	addPeer(hint: string, channelId?: string): Promise<AddedPeers>;
	removePeer(channelId: string): Promise<void>;

	/** Relays. */
	getRelays(): Promise<RelayList>;
	addRelay(channelId: string, hint: string): Promise<AddedRelay>;
	removeRelay(channelId: string): Promise<void>;

	/** Tokens. */
	getTokens(channelId: string): Promise<TokenList>;
	createToken(channelId: string, name: string, expires?: string): Promise<CreatedToken>;
	revokeToken(channelId: string, tokenId: string): Promise<void>;

	/** Settings — playout. */
	getPlayoutMode(channel?: string): Promise<PlayoutMode>;
	setPlayoutMode(mode: string, dayStart?: string, channel?: string): Promise<void>;
	getEncoding(channel?: string): Promise<EncodingSettings>;
	setEncoding(settings: Partial<EncodingSettings>, channel?: string): Promise<{ outputs_updated: number }>;
	getStorage(channel?: string): Promise<StorageSettings>;
	setStorage(settings: Partial<StorageSettings>, channel?: string): Promise<void>;

	/** Settings — channel metadata. */
	getChannelMetadata(): Promise<ChannelMetadata>;
	setChannelMetadata(settings: Partial<ChannelMetadata>): Promise<void>;

	/** Failover / slate config. */
	getFailoverConfig(channel?: string): Promise<SystemVideoConfig>;
	setFailoverConfig(config: Partial<SystemVideoConfig>, channel?: string): Promise<void>;
	regenerateFailover(channel?: string): Promise<void>;
	getSlateConfig(channel?: string): Promise<SystemVideoConfig>;
	setSlateConfig(config: Partial<SystemVideoConfig>, channel?: string): Promise<void>;
	regenerateSlate(channel?: string): Promise<void>;

	/** Overlay (plugin-provided — only available when overlay plugin loaded). */
	getOverlayStatus(channel?: string): Promise<OverlayStatus>;
	sendOverlayText(req: OverlayTextRequest, channel?: string): Promise<void>;
	clearOverlayText(channel?: string): Promise<void>;
	sendOverlayBug(req: OverlayBugRequest, channel?: string): Promise<void>;
	clearOverlayBug(channel?: string): Promise<void>;
	sendOverlaySvg(req: OverlaySvgRequest, channel?: string): Promise<void>;
	clearOverlaySvg(channel?: string): Promise<void>;

	/** Engine. */
	getEngineHealth(channel?: string): Promise<EngineHealth>;
	restartEngine(req?: RestartRequest, channel?: string): Promise<void>;
	startEngine(req?: EngineStartRequest, channel?: string): Promise<void>;
	stopEngine(channel?: string): Promise<void>;

	/** Schedule resync — clear manual overrides, re-dispatch current block. */
	resyncSchedule(channel?: string): Promise<void>;

	/** Layer control. */
	getLayerStatus(name: string, channel?: string): Promise<LayerStatus>;
	loadLayerSource(name: string, req: SourceRequest, channel?: string): Promise<void>;
	showLayer(name: string, alpha?: number, volume?: number, channel?: string): Promise<void>;
	hideLayer(name: string, channel?: string): Promise<void>;
	setLayerPosition(name: string, pos: PositionRequest, channel?: string): Promise<void>;
	resetLayerPosition(name: string, channel?: string): Promise<void>;

	/** Layer configuration (data-driven layers). */
	getLayerConfig(channel?: string): Promise<LayerConfigResponse>;
	setLayerConfig(config: LayerConfigRequest, channel?: string): Promise<void>;

	/** Migration. */
	getMigrations(): Promise<MigrationList>;
	createMigration(to: string, reason?: string): Promise<MigrationResult>;

	/** Channels. */
	listChannels(): Promise<ChannelListResponse>;
	createChannel(req: CreateChannelRequest): Promise<{ ok: boolean; id: string; channel_id: string }>;
	getChannel(id: string): Promise<Channel>;
	updateChannel(id: string, settings: Partial<CreateChannelRequest>): Promise<{ ok: boolean; id: string; updated: string[] }>;
	deleteChannel(id: string): Promise<void>;

	/** Plugins. */
	listPlugins(): Promise<PluginListResponse>;
	getPlugin(name: string): Promise<PluginInfo>;
	getPluginSettings(name: string): Promise<PluginSettings>;
	updatePluginSettings(name: string, settings: Record<string, unknown>): Promise<{ ok: boolean; name: string; settings: Record<string, PluginSettingValue> }>;
	enablePlugin(name: string): Promise<{ message: string }>;
	disablePlugin(name: string): Promise<{ message: string }>;

	/** Plugin registries. */
	getRegistrySourceTypes(): Promise<RegistrySourceTypesResponse>;
	getRegistryOutputTypes(): Promise<RegistryOutputTypesResponse>;
	getRegistryBlockTypes(): Promise<RegistryBlockTypesResponse>;
	getRegistryPlaylistTools(): Promise<RegistryPlaylistToolsResponse>;

	/** Plugin presets (generic CRUD for all plugins). */
	getPluginPresets(name: string): Promise<PluginPresetsResponse>;
	getPluginPreset(name: string, preset: string): Promise<PluginPresetDetail>;
	savePluginPreset(name: string, preset: string, data: Record<string, unknown>): Promise<{ ok: boolean; plugin: string; preset: string }>;
	deletePluginPreset(name: string, preset: string): Promise<{ ok: boolean; plugin: string; deleted: string }>;

	/** Plugin media generation. */
	generateMedia(pluginName: string, config: GenerateMediaRequest): Promise<GenerateMediaResponse>;

	/** Logs. */
	getLogs(params?: LogQueryParams): Promise<LogQueryResponse>;
	streamLogs(params?: LogQueryParams, onEntry?: (entry: LogEntry) => void): { close: () => void };

	/** Backup / restore. */
	downloadBackup(): Promise<Blob>;
	uploadRestore(file: File): Promise<RestoreResponse>;
}

// ── Named playlist types ──

export interface PlaylistSummary {
	name: string;
	entry_count: number;
	total_duration: number;
	created: string;
	updated: string;
}

export interface PlaylistListResponse {
	playlists: PlaylistSummary[];
	count: number;
}

export interface PlaylistDetail {
	name: string;
	entries: Array<{ source: string; duration: number }>;
	created: string;
	updated: string;
}

export interface LoadPlaylistRequest {
	layer?: string;
	loop?: boolean;
}

// ── Playlist tools types ──

export interface PlaylistTool {
	name: string;
	description?: string;
	params?: Record<string, { type: string; default?: unknown; description?: string }>;
}

export interface PlaylistToolsResponse {
	tools: PlaylistTool[];
}

export interface PlaylistToolResult {
	entries: Array<{ source: string; duration: number }>;
	saved: boolean;
}

// ── Media metadata ──

export interface MediaMetadata {
	filename: string;
	duration: number;
	size: number;
	format: string;
	video_codec: string;
	width: number;
	height: number;
	fps: number;
	audio_codec: string;
	audio_channels: number;
	sample_rate: number;
}

export interface MediaDeleteError {
	detail: string;
	references: Array<{ type: string; name: string; detail: string }>;
}

// ── Engine start request ──

export interface EngineStartRequest {
	width?: number;
	height?: number;
	fps?: number;
	video_bitrate?: number;
	audio_bitrate?: number;
}

// ── Overlay types (plugin-provided) ──

export interface OverlayStatus {
	text?: { active: boolean; text?: string; position?: string };
	bug?: { active: boolean; path?: string };
	svg?: { active: boolean };
}

export interface OverlayTextRequest {
	text: string;
	fontsize?: number | string;
	fontcolor?: string;
	position?: 'top-left' | 'top-center' | 'top-right' | 'center' | 'bottom-left' | 'bottom-center' | 'bottom-right';
	background?: boolean;
	alpha?: number;
}

export interface OverlayBugRequest {
	path: string;
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	alpha?: number;
}

export interface OverlaySvgRequest {
	data?: string;
	path?: string;
}

// ── Response types ──

export interface ServerInfo {
	version: string;
	backend: string; // "cathode", "other-server", etc.
}

export interface SystemStatus {
	version: string;
	program: Record<string, unknown>;
	engine: Record<string, unknown> | null;
	backend: string;
}

export interface NowPlaying {
	source: string;
	index: number;
	played: number;
	duration: number;
	mode: string;
	backend: string;
}

export interface SystemStats {
	cpu: { load_1m: number; load_5m: number; load_15m: number };
	memory: { total_mb: number; used_mb: number; available_mb: number; percent: number };
	disk: { total_gb: number; used_gb: number; free_gb: number; percent: number };
}

export interface MediaItem {
	filename: string;
	duration: number;
}

export interface MediaList {
	media_dir: string;
	count: number;
	total_duration: number;
	items: MediaItem[];
}

export interface Schedule {
	schedule: Array<{ date: string; has_playlist: boolean }>;
	today: string;
	days_checked: number;
}

export interface ScheduleDay {
	[key: string]: unknown;
}

export interface GenerateScheduleRequest {
	date: string;
	files?: string[];
	playlist_name?: string;
}

export interface ProgramBlock {
	start: string;
	end: string;
	type: string;
	title: string;
	preset?: string;
	files?: string[];
	name?: string;
	params?: Record<string, unknown>;
	width?: number;
	height?: number;
	fps?: number;
	loop?: boolean;
	layer?: string;
	playlist_name?: string;
	file?: string;
	url?: string;
	video_pattern?: string;
	audio_wave?: string;
}

export interface ProgramList {
	programs: Array<{ date: string; has_program: boolean }>;
	today: string;
	days_checked: number;
}

export interface Program {
	date: string;
	blocks: ProgramBlock[];
	[key: string]: unknown;
}

// ── Block types response ──

export interface BlockTypeInfo {
	description?: string;
	fields?: Record<string, string>;
	source?: string;
}

export interface BlockTypesResponse {
	core: Record<string, BlockTypeInfo>;
	plugin: Record<string, BlockTypeInfo>;
	all: string[];
}

export interface GuideEntry {
	date: string;
	start: string;
	stop: string;
	title: string;
	category: string;
	type: string;
}

export interface PeerInfo {
	id: string;
	name?: string;
	hints: string[];
	last_seen?: string;
}

export interface PeerList {
	peers: PeerInfo[];
	count: number;
}

export interface AddedPeers {
	added: string[];  // channel IDs
	count: number;
}

export interface RelayInfo {
	channel_id: string;
	name?: string;
	upstream_hints?: string[];
	active?: boolean;
	metadata_name?: string;
	cached_segments?: number;
	current_upstream?: string;
	error?: string | null;
}

export interface RelayList {
	relays: RelayInfo[];
	count: number;
}

export interface AddedRelay {
	added: string;
	upstream: string;
	name: string;
}

export interface TokenInfo {
	token_id: string;
	name: string;
	created: string;
	expires?: string;
}

export interface TokenList {
	channel_id: string;
	tokens: TokenInfo[];
	count: number;
}

export interface CreatedToken {
	token: string;
	token_id: string;
	name: string;
	created: string;
	expires?: string;
	channel_id: string;
}

export interface MigrationInfo {
	channel_id: string;
	migrated: boolean;
	to?: string;
	reason?: string;
	timestamp?: string;
}

export interface MigrationList {
	channels: MigrationInfo[];
}

export interface MigrationResult {
	migrated: boolean;
	from: string;
	to: string;
	document: Record<string, unknown>;
}

// ── Settings types ──

export interface PlayoutMode {
	mode: 'loop' | 'schedule';
	day_start: string;
	length: string;
}

export interface EncodingSettings {
	width: number;
	height: number;
	fps: number;
	bitrate: string;
	preset: string;
	audio_bitrate: string;
	volume?: number;
}

export interface StorageSettings {
	filler: string;
	shuffle: boolean;
	extensions: string[];
}

export interface ChannelMetadata {
	id: string;
	channel_id: string;
	display_name: string;
	description: string;
	language: string;
	tags: string[];
	access: string;
	origins: string[];
	timezone: string;
	on_demand: boolean;
	status: string;
}

// ── System video config (failover / slate) ──

export interface SystemVideoConfig {
	title: string;
	subtitle: string;
	duration: number;
	pattern: string;
}

// ── Engine types ──

export interface EngineChannelStatus {
	source_type: string;
	visible: boolean;
	alpha: number;
	volume: number;
	role?: string;
	playlist_name?: string;
	now_playing?: {
		source: string;
		index: number;
		played: number;
		duration: number;
	};
}

export interface EngineHealth {
	state: string;
	active_channel: string;
	channels: Record<string, EngineChannelStatus>;
	layer_preset?: string;
	outputs?: Record<string, OutputHealth>;
}

// ── Output types ──

export interface OutputConfig {
	type: string;
	name: string;
	video_bitrate?: number;
	audio_bitrate?: number;
	keyframe_interval?: number;
	preset?: string;
	// HLS
	hls_dir?: string;
	segment_duration?: number;
	playlist_length?: number;
	// RTMP
	rtmp_url?: string;
	// File
	file_path?: string;
	file_format?: string;
	max_duration?: number;
	// Plugin-specific fields
	[key: string]: unknown;
}

export interface OutputHealth {
	name: string;
	type: string;
	state: string;
	uptime: number;
	errors: number;
	last_error: string | null;
	config: Record<string, unknown>;
}

export interface OutputListResponse {
	outputs: OutputHealth[];
}

// ── Layer control types ──

export interface SourceRequest {
	type: string;
	pattern?: string;
	wave?: number;
	path?: string;
	entries?: Array<{ source: string; duration?: number }>;
	loop?: boolean;
	url?: string;
	// Plugin source type fields
	location?: string;
	html?: string;
	preset?: string;
	video_pattern?: string;
	audio_wave?: string;
	[key: string]: unknown;
}

export interface PositionRequest {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RestartRequest {
	width?: number;
	height?: number;
	fps?: number;
	video_bitrate?: number;
	audio_bitrate?: number;
}

export interface LayerStatus {
	layer?: string;
	source_type: string;
	visible: boolean;
	alpha: number;
	volume: number;
	role?: string;
	played?: number;
	playlist_name?: string;
	playlist?: Array<{ source: string; duration?: number }>;
	now_playing?: {
		source: string;
		index: number;
		played: number;
		duration: number;
	};
	playlist_length?: number;
	playlist_loop?: boolean;
}

// ── Layer configuration types ──

export interface LayerConfigEntry {
	name: string;
	role: 'safety' | 'content' | 'override' | 'overlay';
	zorder?: number;
}

export interface LayerConfigResponse {
	layers: LayerConfigEntry[];
	presets: string[];
}

export interface LayerConfigRequest {
	preset?: string;
	layers?: Array<{ name: string; role: string }>;
}

// ── Channel types ──

export interface ChannelSummary {
	id: string;
	channel_id: string;
	display_name: string;
	status: string;
	has_engine: boolean;
	encoding?: Partial<EncodingSettings>;
}

export interface ChannelListResponse {
	channels: ChannelSummary[];
	count: number;
}

export interface Channel extends ChannelSummary {
	description?: string;
	language?: string;
	tags?: string[];
	access?: string;
	origins?: string[];
	timezone?: string;
	on_demand?: boolean;
	playout_mode?: PlayoutMode;
}

export interface CreateChannelRequest {
	id: string;
	display_name: string;
	description?: string;
	language?: string;
	tags?: string[];
}

// ── Plugin types ──

export interface PluginInfo {
	name: string;
	loaded?: boolean;
	enabled?: boolean;
	/** Can be comma-separated, e.g. "source,content". */
	category?: string;
	/** Extension registry entries. Values can be string[] or boolean (has_presets, has_generate). */
	extensions?: Record<string, string[] | boolean>;
	settings: Record<string, PluginSettingValue>;
	has_shutdown: boolean;
	has_tasks: boolean;
	system_deps?: string[];
}

export interface PluginListResponse {
	plugins: PluginInfo[];
	count?: number;
	loaded?: number;
	disabled?: number;
}

export interface PluginSettingValue {
	type: 'str' | 'int' | 'float' | 'bool';
	value: unknown;
	description: string;
}

export interface PluginSettings {
	name: string;
	settings: Record<string, PluginSettingValue>;
}

// ── Plugin registry types ──

export interface RegistryParamInfo {
	type: string;
	description?: string;
	default?: unknown;
	required?: boolean;
	options?: string[];
}

export interface RegistrySourceType {
	name: string;
	plugin: string;
	description?: string;
	params?: Record<string, RegistryParamInfo>;
}

export interface RegistrySourceTypesResponse {
	types: RegistrySourceType[];
}

export interface RegistryOutputType {
	name: string;
	plugin: string;
	description?: string;
	params?: Record<string, RegistryParamInfo>;
}

export interface RegistryOutputTypesResponse {
	types: RegistryOutputType[];
}

export interface RegistryBlockType {
	name: string;
	plugin: string;
	description?: string;
}

export interface RegistryBlockTypesResponse {
	types: RegistryBlockType[];
}

export interface RegistryPlaylistTool {
	name: string;
	plugin: string;
	description?: string;
}

export interface RegistryPlaylistToolsResponse {
	tools: RegistryPlaylistTool[];
}

// ── Plugin preset types (generic CRUD for all plugins) ──

export interface PluginPresetSummary {
	name: string;
	description?: string;
	category?: string;
	params?: Record<string, unknown>;
}

export interface PluginPresetsResponse {
	plugin: string;
	presets: PluginPresetSummary[];
}

export interface PluginPresetDetail {
	plugin: string;
	preset: {
		name: string;
		description?: string;
		content?: string;
		config?: Record<string, unknown>;
		[key: string]: unknown;
	};
}

// ── Plugin media generation types ──

export interface GenerateMediaRequest {
	preset?: string;
	duration: number;
	filename?: string;
	width?: number;
	height?: number;
	fps?: number;
	[key: string]: unknown;
}

export interface GenerateMediaResponse {
	ok: boolean;
	plugin: string;
	filename: string;
	path: string;
	duration: number;
}

// ── Log types ──

export interface LogEntry {
	timestamp: string;
	level: string;
	source: string;
	logger: string;
	message: string;
	module: string;
	lineno: number;
}

export interface LogQueryParams {
	limit?: number;
	level?: string;
	source?: string;
}

export interface LogQueryResponse {
	count: number;
	entries: LogEntry[];
}

// ── Backup / restore types ──

export interface RestoreResponse {
	ok: boolean;
	restored: string[];
	engine_restarted: boolean;
}
