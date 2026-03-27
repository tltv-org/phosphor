/**
 * Theme store — Svelte 5 runes-based reactive state.
 *
 * Persists the selected theme ID in localStorage.
 * Custom themes can be loaded from JSON at runtime.
 */

import { builtinThemes, DEFAULT_THEME, applyTheme, loadThemeFromJSON } from '$themes';
import type { Theme } from '$themes';

const STORAGE_KEY = 'phosphor-theme';
const CUSTOM_THEMES_KEY = 'phosphor-custom-themes';

class ThemeStore {
	current = $state<Theme>(builtinThemes[DEFAULT_THEME]);
	customThemes = $state<Record<string, Theme>>({});

	/** All available themes (builtin + custom). */
	get all(): Theme[] {
		return [...Object.values(builtinThemes), ...Object.values(this.customThemes)];
	}

	/** Initialise from localStorage and apply. */
	init() {
		// Load custom themes
		try {
			const stored = localStorage.getItem(CUSTOM_THEMES_KEY);
			if (stored) {
				const customs = JSON.parse(stored) as Array<{
					id: string; name: string; vars: Record<string, string>; base?: string;
				}>;
				for (const c of customs) {
					this.customThemes[c.id] = loadThemeFromJSON(c);
				}
			}
		} catch { /* ignore corrupt storage */ }

		// Load selected theme
		const savedId = localStorage.getItem(STORAGE_KEY) ?? DEFAULT_THEME;
		const theme = builtinThemes[savedId] ?? this.customThemes[savedId] ?? builtinThemes[DEFAULT_THEME];
		this.current = theme;
		applyTheme(theme);
	}

	/** Switch to a theme by ID. */
	set(id: string) {
		const theme = builtinThemes[id] ?? this.customThemes[id];
		if (!theme) return;
		this.current = theme;
		applyTheme(theme);
		localStorage.setItem(STORAGE_KEY, id);
	}

	/** Add a custom theme from JSON and optionally activate it. */
	addCustom(json: { id: string; name: string; vars: Record<string, string>; base?: string }, activate = false) {
		const theme = loadThemeFromJSON(json);
		this.customThemes[theme.id] = theme;

		// Persist custom themes
		const toStore = Object.values(this.customThemes).map(t => ({
			id: t.id, name: t.name, vars: t.vars,
		}));
		localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(toStore));

		if (activate) this.set(theme.id);
	}

	/** Remove a custom theme. */
	removeCustom(id: string) {
		if (!this.customThemes[id]) return;
		delete this.customThemes[id];

		const toStore = Object.values(this.customThemes).map(t => ({
			id: t.id, name: t.name, vars: t.vars,
		}));
		localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(toStore));

		// If the removed theme was active, fall back to default
		if (this.current.id === id) this.set(DEFAULT_THEME);
	}
}

export const themeStore = new ThemeStore();
