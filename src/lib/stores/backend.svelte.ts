/**
 * Backend connection store — Svelte 5 runes-based reactive state.
 *
 * Manages the connection to a TLTV management server (cathode or future backends).
 * Persists connection details in sessionStorage (API key shouldn't persist across sessions).
 */

import { CathodeClient } from '$cathode';
import type { BackendAdapter, ServerInfo } from '$cathode';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

const SESSION_KEY = 'phosphor-backend';

class BackendStore {
	adapter = $state<BackendAdapter | null>(null);
	state = $state<ConnectionState>('disconnected');
	serverInfo = $state<ServerInfo | null>(null);
	error = $state<string>('');
	baseUrl = $state<string>('');

	/** Available backend adapters. Add new ones here. */
	readonly adapters: Record<string, () => BackendAdapter> = {
		cathode: () => new CathodeClient(),
	};

	/** Try to restore a previous session connection. */
	async init() {
		try {
			const stored = sessionStorage.getItem(SESSION_KEY);
			if (!stored) return;
			const { backendId, baseUrl, apiKey } = JSON.parse(stored);
			if (backendId && baseUrl) {
				await this.connect(backendId, baseUrl, apiKey || '');
			}
		} catch {
			// Session restore failed — stale/corrupt sessionStorage. Start fresh.
		}
	}

	/** Connect to a management backend. */
	async connect(backendId: string, baseUrl: string, apiKey: string) {
		const factory = this.adapters[backendId];
		if (!factory) {
			this.state = 'error';
			this.error = `Unknown backend: ${backendId}`;
			return;
		}

		this.state = 'connecting';
		this.error = '';
		this.baseUrl = baseUrl;

		try {
			const adapter = factory();
			const info = await adapter.connect(baseUrl, apiKey);
			this.adapter = adapter;
			this.serverInfo = info;
			this.state = 'connected';

			// Persist (API key in sessionStorage — cleared when browser closes)
			sessionStorage.setItem(SESSION_KEY, JSON.stringify({
				backendId, baseUrl, apiKey,
			}));
		} catch (e) {
			this.state = 'error';
			this.error = e instanceof Error ? e.message : String(e);
			this.adapter = null;
			this.serverInfo = null;
		}
	}

	/** Disconnect from the current backend. */
	disconnect() {
		this.adapter = null;
		this.serverInfo = null;
		this.state = 'disconnected';
		this.error = '';
		this.baseUrl = '';
		sessionStorage.removeItem(SESSION_KEY);
	}
}

export const backendStore = new BackendStore();
