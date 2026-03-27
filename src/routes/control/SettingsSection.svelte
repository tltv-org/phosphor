<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type {
		StorageSettings,
		BackendAdapter,
	} from '$cathode';

	interface Props {
		adapter: BackendAdapter | null;
		onRefresh: () => void;
	}

	let { adapter, onRefresh }: Props = $props();

	let storage = $state<StorageSettings | null>(null);
	let settingsLoading = $state(false);
	let settingsSaving = $state<string | null>(null);
	let settingsError = $state('');
	let settingsSuccess = $state('');

	let editStorage = $state<Partial<StorageSettings>>({});

	// ── Backup / restore ──
	let backupLoading = $state(false);
	let restoreLoading = $state(false);
	let restoreInput = $state<HTMLInputElement>();
	let backupError = $state('');
	let restoreError = $state('');
	let restoreSuccess = $state('');

	function flashSuccess(msg: string) {
		settingsSuccess = msg;
		setTimeout(() => { settingsSuccess = ''; }, 3000);
	}

	export async function loadSettings() {
		if (!adapter) return;
		settingsLoading = true;
		settingsError = '';
		try {
			const result = await adapter.getStorage();
			storage = result;
			editStorage = { ...result };
		} catch (e: unknown) {
			settingsError = CathodeApiError.extractMessage(e, 'Failed to load settings');
		} finally { settingsLoading = false; }
	}

	async function handleBackup() {
		if (!adapter) return;
		backupLoading = true;
		backupError = '';
		try {
			const blob = await adapter.downloadBackup();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			const now = new Date();
			const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
			a.download = `cathode-backup-${ts}.tar.gz`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (e: unknown) {
			backupError = CathodeApiError.extractMessage(e, 'Backup failed');
		} finally { backupLoading = false; }
	}

	async function handleRestore(e: Event) {
		const input = e.target as HTMLInputElement;
		if (!input.files?.length || !adapter) return;
		const file = input.files[0];
		if (!confirm(`Restore from "${file.name}"? This will overwrite current configuration.`)) {
			input.value = '';
			return;
		}
		restoreLoading = true;
		restoreError = '';
		restoreSuccess = '';
		try {
			const result = await adapter.uploadRestore(file);
			restoreSuccess = `Restored: ${result.restored.join(', ')}${result.engine_restarted ? '. Engine restarted.' : ''}`;
			setTimeout(() => { restoreSuccess = ''; }, 5000);
			await loadSettings();
			onRefresh();
		} catch (e: unknown) {
			restoreError = CathodeApiError.extractMessage(e, 'Restore failed');
		} finally {
			restoreLoading = false;
			input.value = '';
		}
	}

	async function saveStorage() {
		if (!adapter || !storage) return;
		settingsSaving = 'storage';
		settingsError = '';
		try {
			const changes: Record<string, unknown> = {};
			if (editStorage.filler !== storage.filler) changes.filler = editStorage.filler;
			if (editStorage.shuffle !== storage.shuffle) changes.shuffle = editStorage.shuffle;
			if (JSON.stringify(editStorage.extensions) !== JSON.stringify(storage.extensions)) changes.extensions = editStorage.extensions;
			if (Object.keys(changes).length === 0) { settingsSaving = null; return; }
			await adapter.setStorage(changes as Partial<StorageSettings>);
			await loadSettings();
			flashSuccess('Storage updated.');
		} catch (e: unknown) {
			settingsError = CathodeApiError.extractMessage(e, 'Failed to update storage');
		} finally { settingsSaving = null; }
	}


</script>

<h2>Server Settings</h2>

{#if settingsLoading}
	<p class="text-muted">Loading settings...</p>
{:else}
	{#if settingsError}
		<div class="form-error">{settingsError}</div>
	{/if}
	{#if settingsSuccess}
		<div class="settings-success">{settingsSuccess}</div>
	{/if}

	<!-- Storage -->
	{#if storage}
		<div class="panel">
			<h3>Storage</h3>
			<p class="panel-desc">Media storage and filler clip configuration.</p>
			<div class="form-grid">
				<label class="form-label" style="grid-column: 1 / -1">
					<span>Filler clip</span>
					<input type="text" bind:value={editStorage.filler} placeholder="/tv-media/gen/failover.mp4" />
				</label>
				<label class="form-label">
					<span>Shuffle</span>
					<select bind:value={editStorage.shuffle}>
						<option value={false}>Off</option>
						<option value={true}>On</option>
					</select>
				</label>
				<label class="form-label" style="grid-column: 1 / -1">
					<span>Extensions (comma-separated)</span>
					<input type="text" value={editStorage.extensions?.join(', ') || ''}
						oninput={(e) => { editStorage.extensions = (e.target as HTMLInputElement).value.split(',').map(t => t.trim()).filter(Boolean); }} />
				</label>
			</div>
			<div class="form-actions">
				<button class="btn-primary btn-sm" onclick={saveStorage} disabled={settingsSaving === 'storage'}>
					{settingsSaving === 'storage' ? 'Saving...' : 'Save Storage'}
				</button>
			</div>
		</div>
	{/if}

	<!-- Backup / Restore -->
	<div class="panel">
		<h3>Backup &amp; Restore</h3>
		<p class="panel-desc">Download a full server backup or restore from a previous backup file.</p>
		{#if backupError}
			<div class="form-error">{backupError}</div>
		{/if}
		{#if restoreError}
			<div class="form-error">{restoreError}</div>
		{/if}
		{#if restoreSuccess}
			<div class="settings-success">{restoreSuccess}</div>
		{/if}
		<div class="form-actions" style="margin-top: 0">
			<button class="btn-primary btn-sm" onclick={handleBackup} disabled={backupLoading}>
				{backupLoading ? 'Downloading...' : 'Download Backup'}
			</button>
			<input type="file" accept=".tar.gz,.gz" onchange={handleRestore} bind:this={restoreInput} style="display:none" />
			<button class="btn-surface btn-sm" onclick={() => restoreInput?.click()} disabled={restoreLoading}>
				{restoreLoading ? 'Restoring...' : 'Restore from File'}
			</button>
		</div>
	</div>

{/if}
