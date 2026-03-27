/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// Dev proxy target — cathode's nginx-rtmp serves HLS + proxies API/protocol.
// Reads from VITE_TLTV_NODE env var, defaults to localhost:8888 (cathode dev stack).
const proxyTarget = `http://${process.env.VITE_TLTV_NODE || 'localhost:8888'}`;

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		proxy: {
			'/api': proxyTarget,
			'/hls': proxyTarget,
			'/tltv': proxyTarget,
			'/.well-known/tltv': proxyTarget,
			'/docs': proxyTarget,
			'/openapi.json': proxyTarget,
		}
	},
	build: {
		sourcemap: false,
	},
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node',
	}
});
