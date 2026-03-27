import type { Theme } from './types';
export type { Theme, ThemeToken } from './types';
export { THEME_TOKENS } from './types';

import midnight from './midnight';
import phosphorGreen from './phosphor-green';
import broadcast from './broadcast';
import icePlanet from './ice-planet';

/** All built-in themes, keyed by id. */
export const builtinThemes: Record<string, Theme> = {
	midnight,
	'phosphor-green': phosphorGreen,
	broadcast,
	'ice-planet': icePlanet,
};

/** Default theme id. */
export const DEFAULT_THEME = 'midnight';

/**
 * Create a custom theme by overlaying partial vars on a base theme.
 */
export function createTheme(
	id: string,
	name: string,
	vars: Record<string, string>,
	base: string = DEFAULT_THEME
): Theme {
	const baseTheme = builtinThemes[base] ?? builtinThemes[DEFAULT_THEME];
	return {
		id,
		name,
		vars: { ...baseTheme.vars, ...vars },
	};
}

/**
 * Apply a theme to the document by setting CSS custom properties on :root.
 */
export function applyTheme(theme: Theme): void {
	const root = document.documentElement;
	for (const [key, value] of Object.entries(theme.vars)) {
		root.style.setProperty(`--${key}`, value);
	}
	root.setAttribute('data-theme', theme.id);
}

/**
 * Load a custom theme from a JSON object (e.g. fetched from a URL or file).
 * The JSON should have { id, name, vars: {...}, base?: "midnight" }.
 */
export function loadThemeFromJSON(json: {
	id: string;
	name: string;
	vars: Record<string, string>;
	base?: string;
}): Theme {
	return createTheme(json.id, json.name, json.vars, json.base);
}
