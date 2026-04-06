import type { Theme } from './types';

/**
 * Ice Planet — broadcast terminal aesthetic.
 *
 * Inspired by LEGO Ice Planet 2002: trans-neon orange, medium blue,
 * near-black with blue undertone. CRT phosphor glow, scan lines,
 * the feeling of picking up a pirate broadcast from deep space.
 */
const icePlanet: Theme = {
	id: 'ice-planet',
	name: 'Ice Planet',
	vars: {
		// ── Surface ──
		'bg-base': '#06080f',
		'bg-surface': '#0a0e18',
		'bg-surface-raised': '#0f1420',
		'bg-overlay': 'rgba(6, 8, 15, 0.92)',
		'bg-input': '#080c14',

		// ── Borders — medium blue tones ──
		'border-default': '#152040',
		'border-subtle': '#0e1630',
		'border-focus': '#0055BF',

		// ── Text ──
		'text-primary': '#d0d8e8',
		'text-secondary': '#8898b8',
		'text-muted': '#5878a0',
		'text-inverse': '#06080f',

		// ── Accent — trans-neon orange ──
		'accent': '#ff6600',
		'accent-hover': '#ff8833',
		'accent-text': '#06080f',

		// ── Status ──
		'status-live': '#ff6600',
		'status-playlist': '#7088a8',
		'status-federation': '#0055BF',
		'status-success': '#4ade80',
		'status-warning': '#ff6600',
		'status-error': '#ff3333',

		// ── Player ──
		'player-bg': '#000204',
		'player-controls': '#d0d8e8',
		'player-progress': '#ff6600',
		'player-buffer': '#152040',

		// ── EPG / guide ──
		'epg-bg': '#080c16',
		'epg-block-playlist': '#0e1428',
		'epg-now-marker': '#ff6600',
		'epg-text': '#98a8c0',

		// ── Geometry ──
		'radius-sm': '2px',
		'radius-md': '2px',
		'radius-lg': '4px',
		'font-sans': "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
		'font-mono': "'JetBrains Mono', 'Fira Code', 'SF Mono', 'Consolas', monospace",
		'font-brand': "'Space Grotesk', sans-serif",

		// ── Effects ──
		'glow-color': 'rgba(255, 102, 0, 0.35)',
		'glow-accent': 'rgba(255, 102, 0, 0.5)',
		'scanline-opacity': '0.025',
		'frame-border': '#152040',
	}
};

export default icePlanet;
