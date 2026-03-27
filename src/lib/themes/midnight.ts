import type { Theme } from './types';

/** Default theme — dark, readable, functional. */
const midnight: Theme = {
	id: 'midnight',
	name: 'Midnight',
	vars: {
		// ── Surface ──
		'bg-base': '#0f0f14',
		'bg-surface': '#161620',
		'bg-surface-raised': '#1e1e2a',
		'bg-overlay': 'rgba(10, 10, 16, 0.92)',
		'bg-input': '#121218',

		// ── Borders ──
		'border-default': '#2a2a38',
		'border-subtle': '#1e1e2a',
		'border-focus': '#4a4a60',

		// ── Text ──
		'text-primary': '#e8e8f0',
		'text-secondary': '#a0a0b8',
		'text-muted': '#6a6a80',
		'text-inverse': '#0f0f14',

		// ── Accent ──
		'accent': '#818cf8',
		'accent-hover': '#a5b4fc',
		'accent-text': '#0f0f14',

		// ── Status ──
		'status-live': '#ef4444',
		'status-playlist': '#a0a0b8',
		'status-federation': '#60a5fa',
		'status-success': '#4ade80',
		'status-warning': '#fbbf24',
		'status-error': '#ef4444',

		// ── Player ──
		'player-bg': '#000000',
		'player-controls': '#e8e8f0',
		'player-progress': '#818cf8',
		'player-buffer': '#2a2a38',

		// ── EPG / guide ──
		'epg-bg': '#121218',
		'epg-block-playlist': '#1a1a26',
		'epg-now-marker': '#ef4444',
		'epg-text': '#c0c0d0',

		// ── Geometry ──
		'radius-sm': '3px',
		'radius-md': '5px',
		'radius-lg': '8px',
		'font-sans': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		'font-mono': "'SF Mono', 'Fira Code', 'Consolas', monospace",

		// ── Effects ──
		'glow-color': 'transparent',
		'glow-accent': 'transparent',
		'scanline-opacity': '0',
		'frame-border': '#2a2a38',
	}
};

export default midnight;
