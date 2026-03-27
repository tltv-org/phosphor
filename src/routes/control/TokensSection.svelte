<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { TokenList, CreatedToken, BackendAdapter } from '$cathode';

	interface Props {
		channels: Array<{ id: string; name: string }>;
		adapter: BackendAdapter | null;
	}

	let { channels, adapter }: Props = $props();

	let tokenChannelId = $state('');
	let tokens = $state<TokenList | null>(null);
	let tokenLoading = $state(false);
	let tokenError = $state('');
	let tokenName = $state('');
	let tokenExpiry = $state('');
	let createdToken = $state<CreatedToken | null>(null);
	let tokenCreateLoading = $state(false);

	// Auto-select first channel
	$effect(() => {
		if (channels.length > 0 && !tokenChannelId) {
			tokenChannelId = channels[0].id;
		}
	});

	async function loadTokens() {
		if (!tokenChannelId || !adapter) return;
		tokenLoading = true;
		tokenError = '';
		createdToken = null;
		try {
			tokens = await adapter.getTokens(tokenChannelId);
		} catch (e: unknown) {
			tokenError = CathodeApiError.extractMessage(e, 'Failed to load tokens');
			tokens = null;
		} finally { tokenLoading = false; }
	}

	async function handleCreateToken() {
		if (!tokenChannelId || !tokenName.trim() || !adapter) return;
		tokenCreateLoading = true;
		tokenError = '';
		try {
			createdToken = await adapter.createToken(
				tokenChannelId, tokenName.trim(), tokenExpiry || undefined
			);
			tokenName = '';
			tokenExpiry = '';
			await loadTokens();
		} catch (e: unknown) {
			tokenError = CathodeApiError.extractMessage(e, 'Failed to create token');
		} finally { tokenCreateLoading = false; }
	}

	async function handleRevokeToken(tokenId: string) {
		if (!confirm('Revoke this token? This cannot be undone.')) return;
		if (!adapter) return;
		try {
			await adapter.revokeToken(tokenChannelId, tokenId);
			await loadTokens();
		} catch (e: unknown) {
			tokenError = CathodeApiError.extractMessage(e, 'Failed to revoke');
		}
	}
</script>

<h2>Access Tokens</h2>

<div class="form-row" style="margin-bottom: 1rem">
	{#if channels.length > 0}
		<label class="form-label">
			<span>Channel</span>
			<select bind:value={tokenChannelId} onchange={() => { tokens = null; createdToken = null; }}>
				{#each channels as ch}
					<option value={ch.id}>{ch.name} ({ch.id.substring(0, 12)}...)</option>
				{/each}
			</select>
		</label>
	{:else}
		<label class="form-label">
			<span>Channel ID</span>
			<input type="text" bind:value={tokenChannelId} placeholder="TVxxx... or slug" />
		</label>
	{/if}
	<button class="btn-primary btn-sm form-btn" onclick={loadTokens}
		disabled={tokenLoading || !tokenChannelId}>
		{tokenLoading ? 'Loading...' : 'Load Tokens'}
	</button>
</div>

{#if tokenError}
	<div class="form-error">{tokenError}</div>
{/if}

{#if createdToken}
	<div class="token-created">
		<div class="token-label">Token created — copy now, it won't be shown again:</div>
		<div class="token-value">
			<code>{createdToken.token}</code>
			<button class="btn-surface btn-xs" onclick={() => navigator.clipboard?.writeText(createdToken?.token ?? '').catch(() => {})}>Copy</button>
		</div>
	</div>
{/if}

{#if tokens}
	<div class="panel">
		<h3>Create Token</h3>
		<div class="form-row">
			<label class="form-label">
				<span>Name</span>
				<input type="text" bind:value={tokenName} placeholder="my-viewer"
					onkeydown={(e) => { if (e.key === 'Enter') handleCreateToken(); }} />
			</label>
			<label class="form-label">
				<span>Expires (optional)</span>
				<input type="datetime-local" bind:value={tokenExpiry} />
			</label>
			<button class="btn-primary btn-sm form-btn" onclick={handleCreateToken}
				disabled={tokenCreateLoading || !tokenName.trim()}>
				{tokenCreateLoading ? 'Creating...' : 'Create'}
			</button>
		</div>
	</div>

	{#if tokens.tokens.length > 0}
		<div class="table-wrap">
			<table>
				<thead><tr><th>Name</th><th>Created</th><th>Expires</th><th></th></tr></thead>
				<tbody>
					{#each tokens.tokens as tok}
						<tr>
							<td>{tok.name}</td>
							<td class="mono text-muted">{tok.created?.slice(0, 16) || '\u2014'}</td>
							<td class="mono text-muted">{tok.expires?.slice(0, 16) || 'Never'}</td>
							<td class="row-actions">
								<button class="btn-danger btn-xs" onclick={() => handleRevokeToken(tok.token_id)}>Revoke</button>
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<p class="text-muted">No tokens for this channel.</p>
	{/if}
{/if}
