import type { Theme } from './types';

/** Green-tinted CRT / retro terminal aesthetic. */
const phosphorGreen: Theme = {
	id: 'phosphor-green',
	name: 'Phosphor Green',
	vars: {
		// ── Surface / background ──
		'bg-base': '#050a05',
		'bg-surface': '#0a140a',
		'bg-surface-raised': '#0f1e0f',
		'bg-overlay': 'rgba(0, 5, 0, 0.9)',
		'bg-input': '#081008',

		// ── Borders ──
		'border-default': '#1a3a1a',
		'border-subtle': '#0f250f',
		'border-focus': '#3a7a3a',

		// ── Text ──
		'text-primary': '#33ff33',
		'text-secondary': '#22aa22',
		'text-muted': '#147014',
		'text-inverse': '#050a05',

		// ── Accent / brand ──
		'accent': '#33ff33',
		'accent-hover': '#66ff66',
		'accent-text': '#050a05',

		// ── Status ──
		'status-live': '#ff3333',
		'status-playlist': '#33ff33',
		'status-federation': '#33aaff',
		'status-success': '#33ff33',
		'status-warning': '#ffcc00',
		'status-error': '#ff3333',

		// ── Player ──
		'player-bg': '#000000',
		'player-controls': '#33ff33',
		'player-progress': '#33ff33',
		'player-buffer': '#0f250f',

		// ── EPG / guide ──
		'epg-bg': '#0a140a',
		'epg-block-playlist': '#0f2a0f',
		'epg-now-marker': '#ff3333',
		'epg-text': '#33ff33',

		// ── Geometry ──
		'radius-sm': '2px',
		'radius-md': '4px',
		'radius-lg': '6px',
		'font-sans': "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
		'font-mono': "'JetBrains Mono', 'Fira Code', 'SF Mono', Consolas, monospace",
		'font-brand': "'Space Grotesk', sans-serif",

		// ── Effects ──
		'glow-color': 'rgba(51, 255, 51, 0.4)',
		'glow-accent': 'rgba(51, 255, 51, 0.6)',
		'scanline-opacity': '0.03',
		'frame-border': '#1a3a1a',
	}
};

export default phosphorGreen;
