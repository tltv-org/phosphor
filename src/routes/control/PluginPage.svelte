<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type {
		BackendAdapter, PluginInfo, PluginSettingValue,
		PluginPresetSummary, PluginPresetDetail, GenerateMediaResponse,
		OverlayTextRequest, OverlayStatus, OverlayBugRequest, OverlaySvgRequest,
	} from '$cathode';

	interface Props {
		name: string;
		adapter: BackendAdapter | null;
		/** Plugin info from the list endpoint (has full extensions). */
		pluginInfo?: PluginInfo | null;
	}

	let { name, adapter, pluginInfo = null }: Props = $props();

	let plugin = $state<PluginInfo | null>(null);
	let loading = $state(true);
	let error = $state('');
	let settings = $state<Record<string, PluginSettingValue>>({});
	let editedValues = $state<Record<string, unknown>>({});
	let saving = $state(false);
	let saveError = $state('');
	let saveSuccess = $state('');

	// ── Enable/disable ──
	let toggling = $state(false);
	let toggleError = $state('');
	let restartRequired = $state(false);

	// ── Presets (generic plugin presets) ──
	let presets = $state<PluginPresetSummary[]>([]);
	let presetsLoading = $state(false);
	let selectedPreset = $state<string | null>(null);
	let presetDetail = $state<PluginPresetDetail | null>(null);
	let presetDetailLoading = $state(false);
	let presetEditContent = $state('');
	let presetSaving = $state(false);
	let presetDeleting = $state('');
	let presetError = $state('');
	let presetSuccess = $state('');
	let newPresetName = $state('');
	let newPresetContent = $state('');
	let newPresetCreating = $state(false);

	// ── Generate media ──
	let genPreset = $state('');
	let genDuration = $state(60);
	let genFilename = $state('');
	let genWidth = $state<number | undefined>(undefined);
	let genHeight = $state<number | undefined>(undefined);
	let genFps = $state<number | undefined>(undefined);
	let generating = $state(false);
	let genError = $state('');
	let genResult = $state<GenerateMediaResponse | null>(null);

	// ── Overlay controls ──
	let overlayStatus = $state<OverlayStatus | null>(null);
	let overlayError = $state('');
	// Text overlay
	let ovTextInput = $state('');
	let ovTextFontsize = $state(32);
	let ovTextFontcolor = $state('');
	let ovTextPosition = $state<string>('bottom-center');
	let ovTextBackground = $state(false);
	let ovTextAlpha = $state(1.0);
	let ovTextSending = $state(false);
	// Image bug overlay
	let ovBugPath = $state('');
	let ovBugX = $state(0);
	let ovBugY = $state(0);
	let ovBugWidth = $state(0);
	let ovBugHeight = $state(0);
	let ovBugAlpha = $state(1.0);
	let ovBugSending = $state(false);
	// SVG overlay
	let ovSvgData = $state('');
	let ovSvgPath = $state('');
	let ovSvgSending = $state(false);
	// Media files for overlay pickers
	let overlayMediaFiles = $state<string[]>([]);

	const HIDDEN_SETTINGS = ['preset_dir', 'presets_dir', 'preset_path'];

	const CATEGORY_COLORS: Record<string, string> = {
		source: '#6366f1',
		content: '#8b5cf6',
		schedule: '#3b82f6',
		graphics: '#ec4899',
		output: '#10b981',
		integration: '#f59e0b',
	};

	$effect(() => {
		if (adapter && name) loadPlugin();
	});

	async function loadPlugin() {
		if (!adapter) return;
		loading = true;
		error = '';
		restartRequired = false;
		// Reset all preset/generate/overlay state from previous plugin
		selectedPreset = null;
		presetDetail = null;
		presetEditContent = '';
		presetError = '';
		presetSuccess = '';
		presets = [];
		newPresetName = '';
		newPresetContent = '';
		genPreset = '';
		genError = '';
		genResult = null;
		overlayStatus = null;
		overlayError = '';
		try {
			plugin = await adapter.getPlugin(name);
			// The single-plugin endpoint may return empty extensions.
			// Merge with pluginInfo from the list endpoint if available.
			if (pluginInfo?.extensions && (!plugin.extensions || Object.keys(plugin.extensions).length === 0)) {
				plugin = { ...plugin, extensions: pluginInfo.extensions };
			}
			const result = await adapter.getPluginSettings(name);
			settings = result.settings;
			editedValues = {};
			for (const [key, setting] of Object.entries(result.settings)) {
				editedValues[key] = setting.value;
			}
			// Load presets if plugin supports them
			if (plugin.extensions?.has_presets === true) {
				await loadPresets();
			}
			if (name === 'overlay') {
				refreshOverlayStatus();
				try {
					const m = await adapter.getMedia();
					overlayMediaFiles = m.items.map(i => i.filename);
				} catch { overlayMediaFiles = []; }
			}
		} catch (e: unknown) {
			error = CathodeApiError.extractMessage(e, 'Failed to load plugin');
		} finally { loading = false; }
	}

	async function togglePlugin() {
		if (!adapter || !plugin) return;
		toggling = true;
		toggleError = '';
		try {
			if (plugin.enabled === false) {
				await adapter.enablePlugin(name);
			} else {
				await adapter.disablePlugin(name);
			}
			// Refresh plugin info to get new state
			plugin = await adapter.getPlugin(name);
			restartRequired = true;
		} catch (e: unknown) {
			toggleError = CathodeApiError.extractMessage(e, 'Failed to toggle plugin');
		} finally { toggling = false; }
	}

	// ── Presets ──
	async function loadPresets() {
		if (!adapter) return;
		presetsLoading = true;
		presetError = '';
		try {
			const result = await adapter.getPluginPresets(name);
			presets = result.presets;
		} catch (e: unknown) {
			presets = [];
			presetError = CathodeApiError.extractMessage(e, 'Failed to load presets');
		} finally { presetsLoading = false; }
	}

	async function viewPreset(presetName: string) {
		if (!adapter) return;
		selectedPreset = presetName;
		presetDetailLoading = true;
		presetError = '';
		try {
			const detail = await adapter.getPluginPreset(name, presetName);
			presetDetail = detail;
			// Determine edit content: text content or JSON config
			if (typeof detail.preset.content === 'string') {
				presetEditContent = detail.preset.content;
			} else if (detail.preset.config) {
				presetEditContent = JSON.stringify(detail.preset.config, null, 2);
			} else {
				// Fallback: serialize the whole preset object
				presetEditContent = JSON.stringify(detail.preset, null, 2);
			}
		} catch (e: unknown) {
			presetError = CathodeApiError.extractMessage(e, 'Failed to load preset');
			selectedPreset = null;
			presetDetail = null;
		} finally { presetDetailLoading = false; }
	}

	async function savePreset() {
		if (!adapter || !selectedPreset) return;
		presetSaving = true;
		presetError = '';
		presetSuccess = '';
		try {
			let data: Record<string, unknown>;
			// Try parsing as JSON; if it fails, treat as text content
			try {
				data = JSON.parse(presetEditContent);
			} catch {
				data = { content: presetEditContent };
			}
			await adapter.savePluginPreset(name, selectedPreset, data);
			presetSuccess = `Preset "${selectedPreset}" saved.`;
			setTimeout(() => { presetSuccess = ''; }, 3000);
			// Refresh detail
			await viewPreset(selectedPreset);
			await loadPresets();
		} catch (e: unknown) {
			presetError = CathodeApiError.extractMessage(e, 'Failed to save preset');
		} finally { presetSaving = false; }
	}

	async function deletePreset(presetName: string) {
		if (!adapter || !confirm(`Delete preset "${presetName}"?`)) return;
		presetDeleting = presetName;
		presetError = '';
		try {
			await adapter.deletePluginPreset(name, presetName);
			presetSuccess = `Deleted "${presetName}".`;
			setTimeout(() => { presetSuccess = ''; }, 3000);
			// If we were viewing this preset, go back to list
			if (selectedPreset === presetName) {
				selectedPreset = null;
				presetDetail = null;
			}
			await loadPresets();
		} catch (e: unknown) {
			presetError = CathodeApiError.extractMessage(e, 'Failed to delete preset');
		} finally { presetDeleting = ''; }
	}

	async function createPreset() {
		if (!adapter || !newPresetName.trim()) return;
		newPresetCreating = true;
		presetError = '';
		try {
			let data: Record<string, unknown>;
			try { data = JSON.parse(newPresetContent); }
			catch { data = { content: newPresetContent }; }
			await adapter.savePluginPreset(name, newPresetName.trim(), data);
			presetSuccess = `Created "${newPresetName.trim()}"`;
			setTimeout(() => { presetSuccess = ''; }, 3000);
			newPresetName = '';
			newPresetContent = '';
			await loadPresets();
		} catch (e: unknown) {
			presetError = CathodeApiError.extractMessage(e, 'Failed to create preset');
		} finally { newPresetCreating = false; }
	}

	// ── Generate media ──
	async function handleGenerate() {
		if (!adapter) return;
		generating = true;
		genError = '';
		genResult = null;
		try {
			genResult = await adapter.generateMedia(name, {
				preset: genPreset || undefined,
				duration: genDuration,
				filename: genFilename || undefined,
				width: genWidth,
				height: genHeight,
				fps: genFps,
			});
		} catch (e: unknown) {
			genError = CathodeApiError.extractMessage(e, 'Failed to generate media');
		} finally { generating = false; }
	}

	// ── Overlay helpers ──
	function refreshOverlayStatus() {
		if (!adapter) return;
		adapter.getOverlayStatus().then(s => { overlayStatus = s; }).catch(() => { overlayStatus = null; });
	}

	async function handleSendOverlayText() {
		if (!adapter || !ovTextInput.trim()) return;
		ovTextSending = true;
		overlayError = '';
		try {
			const req: OverlayTextRequest = {
				text: ovTextInput.trim(),
				fontsize: ovTextFontsize || undefined,
				fontcolor: ovTextFontcolor || undefined,
				position: ovTextPosition as OverlayTextRequest['position'],
				background: ovTextBackground || undefined,
				alpha: ovTextAlpha < 1 ? ovTextAlpha : undefined,
			};
			await adapter.sendOverlayText(req);
			refreshOverlayStatus();
		} catch (e: unknown) {
			overlayError = CathodeApiError.extractMessage(e, 'Failed to send overlay text');
		} finally { ovTextSending = false; }
	}

	async function handleClearOverlayText() {
		if (!adapter) return;
		overlayError = '';
		try {
			await adapter.clearOverlayText();
			refreshOverlayStatus();
		} catch (e: unknown) { overlayError = CathodeApiError.extractMessage(e, 'Failed to clear overlay text'); }
	}

	async function handleSendOverlayBug() {
		if (!adapter || !ovBugPath.trim()) return;
		ovBugSending = true;
		overlayError = '';
		try {
			const req: OverlayBugRequest = {
				path: ovBugPath.trim(),
				x: ovBugX || undefined,
				y: ovBugY || undefined,
				width: ovBugWidth || undefined,
				height: ovBugHeight || undefined,
				alpha: ovBugAlpha < 1 ? ovBugAlpha : undefined,
			};
			await adapter.sendOverlayBug(req);
			refreshOverlayStatus();
		} catch (e: unknown) {
			overlayError = CathodeApiError.extractMessage(e, 'Failed to send overlay bug');
		} finally { ovBugSending = false; }
	}

	async function handleClearOverlayBug() {
		if (!adapter) return;
		overlayError = '';
		try {
			await adapter.clearOverlayBug();
			refreshOverlayStatus();
		} catch (e: unknown) { overlayError = CathodeApiError.extractMessage(e, 'Failed to clear overlay bug'); }
	}

	async function handleSendOverlaySvg() {
		if (!adapter || (!ovSvgData.trim() && !ovSvgPath.trim())) return;
		ovSvgSending = true;
		overlayError = '';
		try {
			const req: OverlaySvgRequest = {};
			if (ovSvgData.trim()) req.data = ovSvgData.trim();
			else if (ovSvgPath.trim()) req.path = ovSvgPath.trim();
			await adapter.sendOverlaySvg(req);
			refreshOverlayStatus();
		} catch (e: unknown) {
			overlayError = CathodeApiError.extractMessage(e, 'Failed to send overlay SVG');
		} finally { ovSvgSending = false; }
	}

	async function handleClearOverlaySvg() {
		if (!adapter) return;
		overlayError = '';
		try {
			await adapter.clearOverlaySvg();
			refreshOverlayStatus();
		} catch (e: unknown) { overlayError = CathodeApiError.extractMessage(e, 'Failed to clear overlay SVG'); }
	}

	// ── Settings ──
	async function saveSettings() {
		if (!adapter) return;
		saving = true;
		saveError = '';
		saveSuccess = '';
		try {
			const changes: Record<string, unknown> = {};
			for (const [key, setting] of Object.entries(settings)) {
				if (editedValues[key] !== setting.value) {
					changes[key] = coerceValue(editedValues[key], setting.type);
				}
			}
			if (Object.keys(changes).length === 0) { saving = false; return; }
			await adapter.updatePluginSettings(name, changes);
			saveSuccess = 'Settings saved.';
			setTimeout(() => { saveSuccess = ''; }, 3000);
			const result = await adapter.getPluginSettings(name);
			settings = result.settings;
			editedValues = {};
			for (const [key, setting] of Object.entries(result.settings)) {
				editedValues[key] = setting.value;
			}
		} catch (e: unknown) {
			saveError = CathodeApiError.extractMessage(e, 'Failed to save');
		} finally { saving = false; }
	}

	function coerceValue(value: unknown, type: string): unknown {
		if (type === 'int') return parseInt(String(value), 10);
		if (type === 'float') return parseFloat(String(value));
		if (type === 'bool') return value === true || value === 'true';
		return String(value);
	}

	function hasChanges(): boolean {
		for (const [key, setting] of Object.entries(settings)) {
			if (editedValues[key] !== setting.value) return true;
		}
		return false;
	}

	/** Readable label for extension registry keys. */
	function extensionLabel(key: string): string {
		return key
			.replace(/_/g, ' ')
			.replace(/\b\w/g, c => c.toUpperCase());
	}
</script>

<h2>{name}</h2>

{#if loading}
	<p class="text-muted">Loading plugin...</p>
{:else if error}
	<div class="form-error">{error}</div>
{:else if plugin}
	<!-- Restart required banner -->
	{#if restartRequired}
		<div class="restart-banner">
			Engine restart required for changes to take effect.
		</div>
	{/if}

	<!-- Plugin info -->
	<div class="panel">
		<h3>Plugin Info</h3>
		<div class="stat-row"><span>Name</span><span class="mono">{plugin.name}</span></div>
		{#if plugin.category}
			<div class="stat-row">
				<span>Category</span>
				<span>
					{#each plugin.category.split(',').map(s => s.trim()) as cat}
						<span class="badge category-badge" style="background: {CATEGORY_COLORS[cat] ?? '#6b7280'}20; color: {CATEGORY_COLORS[cat] ?? '#6b7280'}">{cat}</span>
					{/each}
				</span>
			</div>
		{/if}
		<div class="stat-row">
			<span>Status</span>
			<span class="status-controls">
				{#if plugin.loaded}
					<span class="badge badge-active">Loaded</span>
				{:else}
					<span class="badge badge-error">Not loaded</span>
				{/if}
				{#if plugin.enabled !== false}
					<span class="badge badge-active">Enabled</span>
				{:else}
					<span class="badge badge-error">Disabled</span>
				{/if}
				{#if toggleError}
					<span class="text-muted" style="font-size: 0.75rem; color: #ef4444">{toggleError}</span>
				{/if}
				<button
					class="btn-sm {plugin.enabled === false ? 'btn-primary' : 'btn-danger'}"
					onclick={togglePlugin}
					disabled={toggling}
				>
					{#if toggling}
						...
					{:else if plugin.enabled === false}
						Enable
					{:else}
						Disable
					{/if}
				</button>
			</span>
		</div>
		{#if plugin.extensions && Object.keys(plugin.extensions).length > 0}
			{@const arrayExtensions = Object.entries(plugin.extensions).filter(([, v]) => Array.isArray(v)) as [string, string[]][]}
			{#if arrayExtensions.length > 0}
				<div class="stat-row extensions-row">
					<span>Extensions</span>
					<div class="extensions-list">
						{#each arrayExtensions as [key, values]}
							<div class="extension-group">
								<span class="extension-key">{extensionLabel(key)}</span>
								<span class="extension-values">
									{#each values as val}
										<span class="badge badge-playlist">{val}</span>
									{/each}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		{/if}
	</div>

	<!-- ── Overlay Controls (only for overlay plugin) ── -->
	{#if name === 'overlay'}
		<div class="panel">
			<h3>Overlay Controls</h3>

			<!-- Overlay status -->
			{#if overlayStatus}
				<div class="overlay-status">
					<div class="overlay-status-row">
						<span class="overlay-status-label">Text</span>
						<span class="badge {overlayStatus.text?.active ? 'badge-active' : 'badge-dim'}">
							{overlayStatus.text?.active ? 'Active' : 'Off'}
						</span>
						{#if overlayStatus.text?.active && overlayStatus.text.text}
							<span class="overlay-status-detail truncate mono">{overlayStatus.text.text}</span>
						{/if}
					</div>
					<div class="overlay-status-row">
						<span class="overlay-status-label">Bug</span>
						<span class="badge {overlayStatus.bug?.active ? 'badge-active' : 'badge-dim'}">
							{overlayStatus.bug?.active ? 'Active' : 'Off'}
						</span>
						{#if overlayStatus.bug?.active && overlayStatus.bug.path}
							<span class="overlay-status-detail truncate mono">{overlayStatus.bug.path}</span>
						{/if}
					</div>
					<div class="overlay-status-row">
						<span class="overlay-status-label">SVG</span>
						<span class="badge {overlayStatus.svg?.active ? 'badge-active' : 'badge-dim'}">
							{overlayStatus.svg?.active ? 'Active' : 'Off'}
						</span>
					</div>
				</div>
			{/if}

			{#if overlayError}
				<div class="form-error">{overlayError}</div>
			{/if}

			<!-- Text overlay -->
			<div class="overlay-section">
				<h4 class="overlay-section-title">Text Overlay</h4>
				<div class="form-row">
					<label class="form-label" style="flex: 1">
						<span>Text</span>
						<input type="text" bind:value={ovTextInput} placeholder="Breaking news..."
							onkeydown={(e) => { if (e.key === 'Enter') handleSendOverlayText(); }} />
					</label>
				</div>
				<div class="form-row">
					<label class="form-label">
						<span>Size</span>
						<input type="number" bind:value={ovTextFontsize} style="width: 70px" min="8" max="128" />
					</label>
					<label class="form-label">
						<span>Color</span>
						<select bind:value={ovTextFontcolor}>
							<option value="">Default</option>
							<option value="white">White</option>
							<option value="black">Black</option>
							<option value="red">Red</option>
							<option value="green">Green</option>
							<option value="blue">Blue</option>
							<option value="yellow">Yellow</option>
							<option value="cyan">Cyan</option>
							<option value="magenta">Magenta</option>
						</select>
					</label>
					<label class="form-label">
						<span>Alpha</span>
						<input type="range" bind:value={ovTextAlpha} min="0" max="1" step="0.1" style="width: 70px" />
						<span class="text-muted" style="font-size: 0.65rem">{ovTextAlpha.toFixed(1)}</span>
					</label>
					<label class="form-label">
						<span>Position</span>
						<select bind:value={ovTextPosition}>
							<option value="top-left">Top Left</option>
							<option value="top-center">Top Center</option>
							<option value="top-right">Top Right</option>
							<option value="center">Center</option>
							<option value="bottom-left">Bottom Left</option>
							<option value="bottom-center">Bottom Center</option>
							<option value="bottom-right">Bottom Right</option>
						</select>
					</label>
					<label class="form-label">
						<span>Background</span>
						<select bind:value={ovTextBackground}>
							<option value={false}>No</option>
							<option value={true}>Yes</option>
						</select>
					</label>
				</div>
				<div class="form-actions">
					<button class="btn-primary btn-sm" onclick={handleSendOverlayText}
						disabled={ovTextSending || !ovTextInput.trim()}>
						{ovTextSending ? '...' : 'Send'}
					</button>
					<button class="btn-surface btn-sm" onclick={handleClearOverlayText}>Clear</button>
				</div>
			</div>

			<!-- Image bug overlay -->
			<div class="overlay-section">
				<h4 class="overlay-section-title">Image Bug</h4>
				<div class="form-row">
					<label class="form-label" style="flex: 1">
						<span>Image</span>
						<select bind:value={ovBugPath}>
							<option value="">-- Select image --</option>
							{#each overlayMediaFiles.filter(f => /\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i.test(f)) as f}
								<option value={f}>{f}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="form-row">
					<label class="form-label">
						<span>X</span>
						<input type="number" bind:value={ovBugX} min="0" style="width: 80px" />
					</label>
					<label class="form-label">
						<span>Y</span>
						<input type="number" bind:value={ovBugY} min="0" style="width: 80px" />
					</label>
					<label class="form-label">
						<span>Width</span>
						<input type="number" bind:value={ovBugWidth} min="0" style="width: 80px" />
					</label>
					<label class="form-label">
						<span>Height</span>
						<input type="number" bind:value={ovBugHeight} min="0" style="width: 80px" />
					</label>
					<label class="form-label">
						<span>Alpha</span>
						<input type="range" bind:value={ovBugAlpha} min="0" max="1" step="0.1" style="width: 70px" />
						<span class="text-muted" style="font-size: 0.65rem">{ovBugAlpha.toFixed(1)}</span>
					</label>
				</div>
				<div class="form-actions">
					<button class="btn-primary btn-sm" onclick={handleSendOverlayBug}
						disabled={ovBugSending || !ovBugPath.trim()}>
						{ovBugSending ? '...' : 'Show'}
					</button>
					<button class="btn-surface btn-sm" onclick={handleClearOverlayBug}>Hide</button>
				</div>
			</div>

			<!-- SVG overlay -->
			<div class="overlay-section">
				<h4 class="overlay-section-title">SVG Overlay</h4>
				<div class="form-row">
					<label class="form-label" style="flex: 1">
						<span>SVG File</span>
						<select bind:value={ovSvgPath}>
							<option value="">-- Select SVG --</option>
							{#each overlayMediaFiles.filter(f => /\.svg$/i.test(f)) as f}
								<option value={f}>{f}</option>
							{/each}
						</select>
					</label>
				</div>
				<div class="form-row">
					<label class="form-label" style="flex: 1">
						<span>SVG Data</span>
						<textarea bind:value={ovSvgData} rows="4" placeholder="<svg ...>...</svg>"
							style="font-family: monospace; font-size: 0.75rem; resize: vertical"></textarea>
					</label>
				</div>
				<div class="form-actions">
					<button class="btn-primary btn-sm" onclick={handleSendOverlaySvg}
						disabled={ovSvgSending || (!ovSvgData.trim() && !ovSvgPath.trim())}>
						{ovSvgSending ? '...' : 'Show'}
					</button>
					<button class="btn-surface btn-sm" onclick={handleClearOverlaySvg}>Hide</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- ── Presets (generic plugin presets) ── -->
	{#if plugin.extensions?.has_presets === true}
		<div class="panel">
			<h3>Presets</h3>

			{#if presetError}<div class="form-error">{presetError}</div>{/if}
			{#if presetSuccess}<div class="settings-success">{presetSuccess}</div>{/if}

			{#if selectedPreset && presetDetail}
				<!-- Preset detail view -->
				<div class="preset-detail">
					<div class="preset-detail-header">
						<button class="btn-surface btn-xs" onclick={() => { selectedPreset = null; presetDetail = null; }}>
							&larr; Back
						</button>
						<span class="mono" style="font-weight: 600; font-size: 0.9rem">{selectedPreset}</span>
					</div>
					{#if presetDetailLoading}
						<p class="text-muted">Loading...</p>
					{:else}
						{#if presetDetail.preset.description}
							<p class="text-muted" style="font-size: 0.8rem; margin-bottom: 0.5rem">{presetDetail.preset.description}</p>
						{/if}
						<label class="form-label" style="margin-bottom: 0.75rem">
							<span>Content</span>
							<textarea bind:value={presetEditContent} rows="12" class="script-editor"></textarea>
						</label>
						<div class="form-actions">
							<button class="btn-primary btn-sm" onclick={savePreset} disabled={presetSaving}>
								{presetSaving ? 'Saving...' : 'Save'}
							</button>
							<button class="btn-danger btn-sm" onclick={() => deletePreset(selectedPreset!)}
								disabled={presetDeleting === selectedPreset}>
								{presetDeleting === selectedPreset ? '...' : 'Delete'}
							</button>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Preset list -->
				{#if presetsLoading}
					<p class="text-muted">Loading presets...</p>
				{:else if presets.length > 0}
					<div class="table-wrap">
						<table>
							<thead><tr><th>Name</th><th>Description</th><th></th></tr></thead>
							<tbody>
								{#each presets as preset}
									<tr class="preset-row" onclick={() => viewPreset(preset.name)}>
										<td class="mono" style="font-weight: 600">{preset.name}</td>
										<td class="text-muted" style="font-size: 0.8rem">{preset.description || '\u2014'}</td>
										<td class="row-actions" onclick={(e) => e.stopPropagation()}>
											<button class="btn-danger btn-xs" onclick={() => deletePreset(preset.name)}
												disabled={presetDeleting === preset.name}>
												{presetDeleting === preset.name ? '...' : 'Delete'}
											</button>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="text-muted" style="font-size: 0.8rem">No presets available.</p>
				{/if}

				<!-- Create new preset -->
				<div class="create-preset" style="margin-top: 1rem; border-top: 1px solid #1e1e2e; padding-top: 0.75rem">
					<h4 style="font-size: 0.85rem; margin-bottom: 0.5rem">New Preset</h4>
					<div class="form-grid" style="margin-bottom: 0.5rem">
						<label class="form-label">
							<span>Name</span>
							<input type="text" bind:value={newPresetName} placeholder="my-preset" />
						</label>
					</div>
					<label class="form-label" style="margin-bottom: 0.5rem">
						<span>Content</span>
						<textarea bind:value={newPresetContent} rows="6" class="script-editor" placeholder="JSON config or text content"></textarea>
					</label>
					<button class="btn-primary btn-sm" onclick={createPreset} disabled={newPresetCreating || !newPresetName.trim()}>
						{newPresetCreating ? 'Creating...' : 'Create'}
					</button>
				</div>
			{/if}
		</div>
	{/if}

	<!-- ── Generate Media ── -->
	{#if plugin.extensions?.has_generate === true}
		<div class="panel">
			<h3>Generate Media</h3>
			<p class="panel-desc">Generate media files using this plugin. Select a preset and configure output parameters.</p>

			{#if genError}<div class="form-error">{genError}</div>{/if}

			<div class="form-grid" style="margin-bottom: 0.5rem">
				<label class="form-label">
					<span>Preset</span>
					<select bind:value={genPreset}>
						<option value="">None</option>
						{#each presets as preset}
							<option value={preset.name}>{preset.name}</option>
						{/each}
					</select>
				</label>
				<label class="form-label">
					<span>Duration (s)</span>
					<input type="number" bind:value={genDuration} min="1" step="1" />
				</label>
				<label class="form-label">
					<span>Filename (optional)</span>
					<input type="text" bind:value={genFilename} placeholder="output.mp4" />
				</label>
			</div>
			<div class="form-grid" style="margin-bottom: 0.75rem">
				<label class="form-label">
					<span>Width</span>
					<input type="number" bind:value={genWidth} placeholder="auto" min="1" />
				</label>
				<label class="form-label">
					<span>Height</span>
					<input type="number" bind:value={genHeight} placeholder="auto" min="1" />
				</label>
				<label class="form-label">
					<span>FPS</span>
					<input type="number" bind:value={genFps} placeholder="auto" min="1" />
				</label>
			</div>

			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={handleGenerate} disabled={generating}>
					{generating ? 'Generating...' : 'Generate'}
				</button>
			</div>

			{#if genResult}
				<div class="gen-result" style="margin-top: 0.75rem">
					<div class="stat-row"><span>Filename</span><span class="mono">{genResult.filename}</span></div>
					<div class="stat-row"><span>Path</span><span class="mono">{genResult.path}</span></div>
					<div class="stat-row"><span>Duration</span><span>{genResult.duration.toFixed(1)}s</span></div>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Settings -->
	<div class="panel">
		<h3>Settings</h3>
		{#if saveError}<div class="form-error">{saveError}</div>{/if}
		{#if saveSuccess}<div class="settings-success">{saveSuccess}</div>{/if}

		{#if Object.entries(settings).filter(([k]) => !HIDDEN_SETTINGS.includes(k)).length === 0}
			<p class="text-muted">No configurable settings for this plugin.</p>
		{:else}
			<div class="settings-list">
				{#each Object.entries(settings).filter(([k]) => !HIDDEN_SETTINGS.includes(k)) as [key, setting]}
					<div class="setting-row">
						<div class="setting-info">
							<div class="setting-key-row">
								<span class="setting-key mono">{key}</span>
								<span class="badge badge-playlist setting-type">{setting.type}</span>
							</div>
							{#if setting.description}
								<div class="setting-desc text-muted">{setting.description}</div>
							{/if}
						</div>
						<div class="setting-control">
							{#if setting.type === 'bool'}
								<select bind:value={editedValues[key]}>
									<option value={true}>true</option>
									<option value={false}>false</option>
								</select>
							{:else if setting.type === 'int' || setting.type === 'float'}
								<input type="number" bind:value={editedValues[key]}
									step={setting.type === 'float' ? '0.1' : '1'} />
							{:else}
								<input type="text" bind:value={editedValues[key]} />
							{/if}
						</div>
					</div>
				{/each}
			</div>
			{#if hasChanges()}
				<div class="form-actions" style="margin-top: 1rem">
					<button class="btn-primary btn-sm" onclick={saveSettings} disabled={saving}>
						{saving ? 'Saving...' : 'Save Settings'}
					</button>
					<button class="btn-surface btn-sm" onclick={loadPlugin}>Reset</button>
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.restart-banner {
		padding: 0.6rem 1rem; border-radius: 6px; margin-bottom: 1rem;
		font-size: 0.8rem; font-weight: 600;
		background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3);
		color: #fbbf24;
	}

	.status-controls {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
	}

	.category-badge { text-transform: capitalize; }

	.extensions-row { align-items: flex-start; }
	.extensions-list {
		display: flex; flex-direction: column; gap: 0.4rem;
	}
	.extension-group {
		display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;
	}
	.extension-key {
		font-size: 0.75rem; font-weight: 600; color: #8888a0;
		min-width: 100px;
	}
	.extension-values {
		display: flex; gap: 0.25rem; flex-wrap: wrap;
	}

	/* Overlay controls */
	.overlay-status {
		margin-top: 0.75rem; margin-bottom: 0.75rem;
		display: flex; flex-direction: column; gap: 0.35rem;
		padding: 0.5rem 0.6rem;
		background: #0c0c18; border: 1px solid #1a1a2a; border-radius: 6px;
	}
	.overlay-status-row {
		display: flex; align-items: center; gap: 0.5rem;
		font-size: 0.75rem;
	}
	.overlay-status-label {
		font-weight: 600; width: 2.5rem; flex-shrink: 0; color: #8888a0;
	}
	.overlay-status-detail {
		font-size: 0.65rem; color: #5a5a70; min-width: 0;
	}
	.badge-dim {
		background: #1a1a2a; color: #5a5a70;
		padding: 0.1rem 0.4rem; border-radius: 3px; font-size: 0.65rem;
	}
	.overlay-section {
		margin-top: 0.75rem; padding-top: 0.75rem;
		border-top: 1px solid #1a1a2a;
	}
	.overlay-section-title {
		font-size: 0.8rem; margin-bottom: 0.5rem; color: #8888a0;
	}

	/* Presets */
	.preset-row { cursor: pointer; transition: background 0.1s; }
	.preset-row:hover { background: #141420; }
	.preset-detail-header {
		display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem;
	}

	/* Generate result */
	.gen-result {
		padding: 0.5rem 0.6rem;
		background: #0c0c18; border: 1px solid #1a1a2a; border-radius: 6px;
	}

	.settings-list { display: flex; flex-direction: column; gap: 0; }
	.setting-row {
		display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
		padding: 0.75rem 0; border-bottom: 1px solid #1a1a2a;
	}
	.setting-row:last-child { border-bottom: none; }
	.setting-info { flex: 1; min-width: 0; }
	.setting-key-row { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.15rem; }
	.setting-key { font-size: 0.85rem; font-weight: 600; }
	.setting-type { font-size: 0.55rem !important; }
	.setting-desc { font-size: 0.75rem; }
	.setting-control { flex-shrink: 0; width: 200px; }
	.setting-control input, .setting-control select {
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.4rem 0.6rem; border-radius: 4px; font-size: 0.8rem;
		font-family: inherit; outline: none; width: 100%;
	}
	.setting-control input:focus, .setting-control select:focus { border-color: #5a5a7a; }

	.script-editor {
		font-family: monospace; font-size: 0.8rem; resize: vertical; width: 100%;
		background: #0c0c18; border: 1px solid #2a2a3a; color: #e0e0f0;
		padding: 0.5rem; border-radius: 4px; outline: none;
	}
	.script-editor:focus { border-color: #5a5a7a; }

	@media (max-width: 768px) { .form-grid { grid-template-columns: 1fr; } }
</style>
