import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: 'index.html', // SPA mode — all routes handled client-side
			precompress: true
		}),
		alias: {
			$tltv: 'src/lib/tltv',
			$cathode: 'src/lib/cathode',
			$stores: 'src/lib/stores',
			$themes: 'src/lib/themes'
		}
	},
	vitePlugin: {
		dynamicCompileOptions: ({ filename }) =>
			filename.includes('node_modules') ? undefined : { runes: true }
	}
};

export default config;
