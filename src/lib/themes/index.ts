import type { Theme } from './types';
export type { Theme, ThemeToken } from './types';
export { THEME_TOKENS } from './types';

import defaultTheme from './default';
import phosphorGreen from './phosphor-green';
import broadcast from './broadcast';
import icePlanet from './ice-planet';

/** All built-in themes, keyed by id. */
export const builtinThemes: Record<string, Theme> = {
	default: defaultTheme,
	'phosphor-green': phosphorGreen,
	broadcast,
	'ice-planet': icePlanet,
};

/** Default theme id. */
export const DEFAULT_THEME = 'default';

/**
 * Create a custom theme by overlaying partial vars on a base theme.
 * Custom themes need a concrete base with all tokens defined.
 * Default has empty vars, so we fall back to phosphor-green.
 */
export function createTheme(
	id: string,
	name: string,
	vars: Record<string, string>,
	base: string = 'phosphor-green'
): Theme {
	const baseTheme = builtinThemes[base] ?? builtinThemes['phosphor-green'];
	return {
		id,
		name,
		vars: { ...baseTheme.vars, ...vars },
	};
}

/**
 * Apply a theme to the document.
 *
 * For the 'default' theme (empty vars), this clears all inline CSS
 * properties so the :root defaults + prefers-color-scheme in app.css
 * take effect. For explicit themes, sets inline vars on :root.
 */
export function applyTheme(theme: Theme): void {
	const root = document.documentElement;

	if (Object.keys(theme.vars).length === 0) {
		// Default theme — clear inline vars so CSS handles light/dark
		root.removeAttribute('style');
		root.setAttribute('data-theme', theme.id);
		return;
	}

	// Explicit theme — clear first, then set new vars
	root.removeAttribute('style');
	for (const [key, value] of Object.entries(theme.vars)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.setAttribute('data-theme', theme.id);
}

/**
 * Load a custom theme from a JSON object (e.g. fetched from a URL or file).
 * The JSON should have { id, name, vars: {...}, base?: "phosphor-green" }.
 */
export function loadThemeFromJSON(json: {
	id: string;
	name: string;
	vars: Record<string, string>;
	base?: string;
}): Theme {
	return createTheme(json.id, json.name, json.vars, json.base);
}
