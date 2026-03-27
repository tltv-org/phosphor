// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

// Vite env vars
interface ImportMetaEnv {
	/** Home TLTV node (host:port) — used as default hint for channel resolution. */
	readonly VITE_TLTV_NODE?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

export {};
