<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { RelayList, ChannelMetadata, BackendAdapter } from '$cathode';

	interface Props {
		relays: RelayList | null;
		channelMetadata: ChannelMetadata | null;
		channels: Array<{ id: string; name: string }>;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
	}

	let { relays, channelMetadata, channels, adapter, onRefresh }: Props = $props();

	let relayChannelId = $state('');
	let relayHint = $state('');
	let relayLoading = $state(false);
	let relayError = $state('');

	async function handleAddRelay() {
		if (!relayChannelId.trim() || !relayHint.trim() || !adapter) return;
		relayLoading = true;
		relayError = '';
		try {
			await adapter.addRelay(relayChannelId.trim(), relayHint.trim());
			relayChannelId = '';
			relayHint = '';
			await onRefresh();
		} catch (e: unknown) {
			relayError = CathodeApiError.extractMessage(e, 'Failed to add relay');
		} finally { relayLoading = false; }
	}

	async function handleRemoveRelay(id: string) {
		if (!confirm('Stop relaying this channel?')) return;
		try {
			await adapter?.removeRelay(id);
			await onRefresh();
		} catch (e: unknown) {
			relayError = CathodeApiError.extractMessage(e, 'Failed to stop relay');
		}
	}
</script>

<h2>Relays</h2>

{#if channelMetadata}
	<div class="station-context">
		<span class="text-muted">Station:</span>
		<strong>{channelMetadata.display_name}</strong>
		{#if channels.length > 0}
			<span class="text-muted">&middot; {channels.length} channel{channels.length !== 1 ? 's' : ''}</span>
		{/if}
	</div>
{/if}

<div class="action-bar">
	<input type="text" bind:value={relayChannelId} placeholder="Channel ID (TVxxx...)" class="input-sm" />
	<input type="text" bind:value={relayHint} placeholder="host:port" class="input-sm"
		onkeydown={(e) => { if (e.key === 'Enter') handleAddRelay(); }} />
	<button class="btn-primary btn-sm" onclick={handleAddRelay}
		disabled={!relayChannelId.trim() || !relayHint.trim() || relayLoading}>
		{relayLoading ? 'Adding...' : 'Add Relay'}
	</button>
</div>
{#if relayError}
	<div class="form-error">{relayError}</div>
{/if}
{#if relays && relays.relays.length > 0}
	<div class="table-wrap">
		<table>
			<thead><tr><th>Channel</th><th>Name</th><th>Status</th><th>Segments</th><th></th></tr></thead>
			<tbody>
				{#each relays.relays as relay}
					<tr>
						<td class="mono truncate" style="max-width:140px" title={relay.channel_id}>{relay.channel_id?.substring(0, 16)}...</td>
						<td>{relay.metadata_name || relay.name || '\u2014'}</td>
						<td>
							{#if relay.active}
								<span class="badge badge-active"><span class="dot"></span> Active</span>
							{:else if relay.error}
								<span class="badge badge-error" title={relay.error}>Error</span>
							{:else}
								<span class="text-muted">Inactive</span>
							{/if}
						</td>
						<td class="mono">{relay.cached_segments ?? '\u2014'}</td>
						<td class="row-actions">
							<button class="btn-danger btn-xs" onclick={() => handleRemoveRelay(relay.channel_id)}>Stop</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="text-muted">No relays configured.</p>
{/if}

<style>
	.station-context {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.8rem; margin-bottom: 0.75rem;
		padding: 0.4rem 0.6rem; background: #141420;
		border-radius: 4px; border: 1px solid #1a1a2a;
	}
</style>
