import type { Theme } from './types';

/**
 * Default theme — follows OS light/dark preference.
 *
 * Vars are empty. When this theme is active, no inline CSS vars are
 * applied, so the :root defaults in app.css (with prefers-color-scheme
 * media queries) handle everything. This gives automatic light/dark
 * switching matching the timelooptv.org brutalist palette.
 */
const defaultTheme: Theme = {
	id: 'default',
	name: 'Default',
	vars: {},
};

export default defaultTheme;
