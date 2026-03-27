<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { PeerList, ChannelMetadata, BackendAdapter } from '$cathode';

	interface Props {
		peers: PeerList | null;
		channelMetadata: ChannelMetadata | null;
		channels: Array<{ id: string; name: string }>;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
	}

	let { peers, channelMetadata, channels, adapter, onRefresh }: Props = $props();

	let peerHint = $state('');
	let peerLoading = $state(false);
	let peerError = $state('');

	function fmtTimeAgo(iso: string): string {
		const ms = Date.now() - new Date(iso).getTime();
		const mins = Math.floor(ms / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		return `${Math.floor(hrs / 24)}d ago`;
	}

	async function handleAddPeer() {
		if (!peerHint.trim() || !adapter) return;
		peerLoading = true;
		peerError = '';
		try {
			await adapter.addPeer(peerHint.trim());
			peerHint = '';
			await onRefresh();
		} catch (e: unknown) {
			peerError = CathodeApiError.extractMessage(e, 'Failed to add peer');
		} finally { peerLoading = false; }
	}

	async function handleRemovePeer(id: string) {
		if (!confirm('Remove this peer?')) return;
		try {
			await adapter?.removePeer(id);
			await onRefresh();
		} catch (e: unknown) {
			peerError = CathodeApiError.extractMessage(e, 'Failed to remove');
		}
	}
</script>

<h2>Peers</h2>

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
	<input type="text" bind:value={peerHint} placeholder="host:port" class="input-sm"
		onkeydown={(e) => { if (e.key === 'Enter') handleAddPeer(); }} />
	<button class="btn-primary btn-sm" onclick={handleAddPeer}
		disabled={!peerHint.trim() || peerLoading}>
		{peerLoading ? 'Adding...' : 'Add Peer'}
	</button>
</div>
{#if peerError}
	<div class="form-error">{peerError}</div>
{/if}
{#if peers && peers.peers.length > 0}
	<div class="table-wrap">
		<table>
			<thead><tr><th>ID</th><th>Name</th><th>Hints</th><th>Last Seen</th><th></th></tr></thead>
			<tbody>
				{#each peers.peers as peer}
					<tr>
						<td class="mono truncate" style="max-width:160px" title={peer.id}>{peer.id?.substring(0, 16)}...</td>
						<td>{peer.name || '\u2014'}</td>
						<td class="mono">{peer.hints?.join(', ')}</td>
						<td class="text-muted">{peer.last_seen ? fmtTimeAgo(peer.last_seen) : '\u2014'}</td>
						<td class="row-actions">
							<button class="btn-danger btn-xs" onclick={() => handleRemovePeer(peer.id)}>Remove</button>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{:else}
	<p class="text-muted">No peers discovered.</p>
{/if}

<style>
	.station-context {
		display: flex; align-items: center; gap: 0.4rem;
		font-size: 0.8rem; margin-bottom: 0.75rem;
		padding: 0.4rem 0.6rem; background: #141420;
		border-radius: 4px; border: 1px solid #1a1a2a;
	}
</style>
