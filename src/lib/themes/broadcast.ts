import type { Theme } from './types';

/** Clean broadcast-booth look — dark navy with warm highlights. */
const broadcast: Theme = {
	id: 'broadcast',
	name: 'Broadcast',
	vars: {
		// ── Surface / background ──
		'bg-base': '#0c1220',
		'bg-surface': '#141e30',
		'bg-surface-raised': '#1c2840',
		'bg-overlay': 'rgba(8, 12, 24, 0.9)',
		'bg-input': '#101a28',

		// ── Borders ──
		'border-default': '#283850',
		'border-subtle': '#1c2840',
		'border-focus': '#4a6a90',

		// ── Text ──
		'text-primary': '#e8eaf0',
		'text-secondary': '#8898b0',
		'text-muted': '#4a5a70',
		'text-inverse': '#0c1220',

		// ── Accent / brand ──
		'accent': '#f59e0b',
		'accent-hover': '#fbbf24',
		'accent-text': '#0c1220',

		// ── Status ──
		'status-live': '#ef4444',
		'status-playlist': '#34d399',
		'status-federation': '#60a5fa',
		'status-success': '#34d399',
		'status-warning': '#f59e0b',
		'status-error': '#ef4444',

		// ── Player ──
		'player-bg': '#000000',
		'player-controls': '#e8eaf0',
		'player-progress': '#f59e0b',
		'player-buffer': '#283850',

		// ── EPG / guide ──
		'epg-bg': '#141e30',
		'epg-block-playlist': '#1a2e50',
		'epg-now-marker': '#ef4444',
		'epg-text': '#c8d0e0',

		// ── Geometry ──
		'radius-sm': '4px',
		'radius-md': '8px',
		'radius-lg': '12px',
		'font-sans': "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
		'font-mono': "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",

		// ── Effects ──
		'glow-color': 'transparent',
		'glow-accent': 'transparent',
		'scanline-opacity': '0',
		'frame-border': '#283850',
	}
};

export default broadcast;
