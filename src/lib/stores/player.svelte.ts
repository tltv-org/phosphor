import type { ResolvedChannel } from '$tltv';

export type PlayerStatus = 'connecting' | 'live' | 'buffering' | 'offline' | 'error';

class PlayerStore {
	status = $state<PlayerStatus>('connecting');
	statusMessage = $state<string>('Connecting...');
	muted = $state<boolean>(true);

	/** Current HLS source URL (set after channel resolution). */
	src = $state<string>('');

	/** Now-playing text (for EPG display). */
	nowPlaying = $state<string>('');

	/** Federation state (populated when tuned to a tltv:// channel). */
	resolved = $state<ResolvedChannel | null>(null);

	/** The tltv:// URI currently tuned to (for display/copy). */
	currentUri = $state<string>('');

	/** Tune to a resolved channel. */
	setFederation(resolved: ResolvedChannel, uri: string) {
		this.src = resolved.streamUrl;
		this.resolved = resolved;
		this.currentUri = uri;
		this.nowPlaying = resolved.metadata.name || '';
	}

	setStatus(status: PlayerStatus, message?: string) {
		this.status = status;
		if (message !== undefined) this.statusMessage = message;
	}

	toggleMute() {
		this.muted = !this.muted;
	}
}

export const playerStore = new PlayerStore();
