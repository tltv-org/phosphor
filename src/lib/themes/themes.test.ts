import { describe, it, expect } from 'vitest';
import { builtinThemes, DEFAULT_THEME, createTheme, loadThemeFromJSON, THEME_TOKENS } from './index';
import type { Theme } from './types';

// ── Built-in themes ──

describe('built-in themes', () => {
	it('has 4 built-in themes', () => {
		expect(Object.keys(builtinThemes)).toHaveLength(4);
	});

	it('default theme is midnight', () => {
		expect(DEFAULT_THEME).toBe('midnight');
		expect(builtinThemes['midnight']).toBeDefined();
	});

	it('all expected themes exist', () => {
		expect(builtinThemes['midnight']).toBeDefined();
		expect(builtinThemes['phosphor-green']).toBeDefined();
		expect(builtinThemes['broadcast']).toBeDefined();
		expect(builtinThemes['ice-planet']).toBeDefined();
	});

	it.each(Object.entries(builtinThemes))('%s has correct structure', (id, theme) => {
		expect(theme.id).toBe(id);
		expect(theme.name).toBeTruthy();
		expect(typeof theme.vars).toBe('object');
	});

	it.each(Object.entries(builtinThemes))('%s defines all required tokens', (id, theme) => {
		for (const token of THEME_TOKENS) {
			expect(theme.vars[token], `${id} missing token: ${token}`).toBeDefined();
		}
	});
});

// ── createTheme ──

describe('createTheme', () => {
	it('creates a theme with overrides on default base', () => {
		const theme = createTheme('custom', 'Custom', { accent: '#ff0000' });
		expect(theme.id).toBe('custom');
		expect(theme.name).toBe('Custom');
		expect(theme.vars['accent']).toBe('#ff0000');
		// Non-overridden tokens should come from midnight
		expect(theme.vars['bg-base']).toBe(builtinThemes['midnight'].vars['bg-base']);
	});

	it('uses specified base theme', () => {
		const theme = createTheme('custom', 'Custom', { accent: '#ff0000' }, 'phosphor-green');
		// Non-overridden tokens should come from phosphor-green
		expect(theme.vars['bg-base']).toBe(builtinThemes['phosphor-green'].vars['bg-base']);
		// Overridden token should be the custom value
		expect(theme.vars['accent']).toBe('#ff0000');
	});

	it('falls back to default theme when base does not exist', () => {
		const theme = createTheme('custom', 'Custom', {}, 'nonexistent');
		expect(theme.vars['bg-base']).toBe(builtinThemes['midnight'].vars['bg-base']);
	});

	it('preserves all base tokens when no overrides given', () => {
		const base = builtinThemes['broadcast'];
		const theme = createTheme('clone', 'Clone', {}, 'broadcast');
		for (const token of THEME_TOKENS) {
			expect(theme.vars[token]).toBe(base.vars[token]);
		}
	});

	it('can add tokens not in the standard list', () => {
		const theme = createTheme('custom', 'Custom', { 'custom-token': '#abc123' });
		expect(theme.vars['custom-token']).toBe('#abc123');
	});
});

// ── loadThemeFromJSON ──

describe('loadThemeFromJSON', () => {
	it('creates a theme from JSON with base fallback', () => {
		const json = {
			id: 'imported',
			name: 'Imported Theme',
			vars: { accent: '#00ff00', 'text-primary': '#ffffff' },
			base: 'ice-planet',
		};
		const theme = loadThemeFromJSON(json);
		expect(theme.id).toBe('imported');
		expect(theme.name).toBe('Imported Theme');
		expect(theme.vars['accent']).toBe('#00ff00');
		expect(theme.vars['text-primary']).toBe('#ffffff');
		// Non-overridden should come from ice-planet
		expect(theme.vars['bg-base']).toBe(builtinThemes['ice-planet'].vars['bg-base']);
	});

	it('defaults to midnight base when base is omitted', () => {
		const json = {
			id: 'minimal',
			name: 'Minimal',
			vars: { accent: '#ff00ff' },
		};
		const theme = loadThemeFromJSON(json);
		expect(theme.vars['bg-base']).toBe(builtinThemes['midnight'].vars['bg-base']);
	});

	it('produces a complete theme even with empty vars', () => {
		const theme = loadThemeFromJSON({ id: 'empty', name: 'Empty', vars: {} });
		for (const token of THEME_TOKENS) {
			expect(theme.vars[token]).toBeDefined();
		}
	});
});

// ── THEME_TOKENS constant ──

describe('THEME_TOKENS', () => {
	it('has 38 tokens', () => {
		expect(THEME_TOKENS).toHaveLength(38);
	});

	it('contains no duplicates', () => {
		const unique = new Set(THEME_TOKENS);
		expect(unique.size).toBe(THEME_TOKENS.length);
	});

	it('includes critical categories', () => {
		// Spot-check key tokens from each category
		expect(THEME_TOKENS).toContain('bg-base');
		expect(THEME_TOKENS).toContain('text-primary');
		expect(THEME_TOKENS).toContain('accent');
		expect(THEME_TOKENS).toContain('player-bg');
		expect(THEME_TOKENS).toContain('epg-bg');
		expect(THEME_TOKENS).toContain('glow-color');
		expect(THEME_TOKENS).toContain('radius-sm');
	});
});
