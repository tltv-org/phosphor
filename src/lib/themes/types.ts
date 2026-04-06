/**
 * Theme definition.
 *
 * Themes control the viewer experience — the player, channel bar, EPG,
 * badges, and navigation chrome.  The management dashboard and settings
 * use a fixed admin look and are NOT themed.
 *
 * A Theme is a JSON-serialisable map of CSS custom property names
 * (without the `--` prefix) to their values.  Users can create custom
 * themes by providing a JSON file that overrides any subset — missing
 * keys fall back to the active base theme.
 */

export interface Theme {
	/** Unique machine name, e.g. "default", "phosphor-green" */
	id: string;
	/** Human-readable name shown in the theme picker */
	name: string;
	/** CSS custom property map — keys without `--` prefix */
	vars: Record<string, string>;
}

/**
 * Semantic token names used across all themes.
 * Themes MUST define at least these.  Viewer components reference
 * them as var(--<token>).
 */
export const THEME_TOKENS = [
	// ── Surface / background (viewer chrome) ──
	'bg-base',           // page background
	'bg-surface',        // nav bar, channel bar
	'bg-surface-raised', // dropdowns, popovers
	'bg-overlay',        // player overlays, backdrops
	'bg-input',          // channel input field

	// ── Borders ──
	'border-default',
	'border-subtle',
	'border-focus',

	// ── Text ──
	'text-primary',
	'text-secondary',
	'text-muted',
	'text-inverse',

	// ── Accent / brand ──
	'accent',
	'accent-hover',
	'accent-text',       // text on accent bg

	// ── Status badges ──
	'status-live',
	'status-playlist',
	'status-federation',
	'status-success',
	'status-warning',
	'status-error',

	// ── Player ──
	'player-bg',
	'player-controls',
	'player-progress',
	'player-buffer',

	// ── EPG / guide strip ──
	'epg-bg',
	'epg-block-playlist',
	'epg-now-marker',
	'epg-text',

	// ── Geometry ──
	'radius-sm',
	'radius-md',
	'radius-lg',
	'font-sans',
	'font-mono',
	'font-brand',        // brand/logo font (Space Grotesk)

	// ── Effects ──
	'glow-color',        // phosphor glow on text/elements (set to 'transparent' for none)
	'glow-accent',       // glow on accent-colored elements
	'scanline-opacity',  // 0 for none, 0.02-0.05 for subtle
	'frame-border',      // player/guide frame border color
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];
