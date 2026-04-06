<script lang="ts">
	import { onMount } from 'svelte';
	import { themeStore } from '$stores/theme.svelte';
	import { backendStore } from '$stores/backend.svelte';
	import '../app.css';

	let { children } = $props();

	onMount(async () => {
		themeStore.init();
		backendStore.init();
	});
</script>

<div class="shell">
	<nav class="nav">
		<a href="/" class="nav-brand" aria-label="tltv home">
			<svg class="nav-lockup" viewBox="0 0 1020 350" fill="currentColor" aria-hidden="true">
				<svg x="0" y="0" width="491" height="350" viewBox="0 0 491.321548 349.773636">
					<g transform="translate(-0.176918,349.811893) scale(0.100000,-0.100000)" fill="currentColor" stroke="none">
						<path d="M2050 3493 c-881 -31 -1492 -102 -1671 -194 -95 -48 -171 -145 -214 -272 -98 -292 -154 -705 -162 -1192 -8 -497 27 -842 127 -1233 48 -187 74 -246 140 -316 96 -102 195 -137 505 -181 756 -105 1734 -133 2665 -75 330 21 800 78 959 117 195 47 311 159 370 358 52 179 98 442 128 735 24 242 24 784 0 1030 -40 397 -116 746 -191 874 -34 58 -117 133 -179 161 -243 111 -1187 198 -2092 193 -170 -1 -344 -3 -385 -5z m-246 -993 c33 -5 92 -25 132 -44 68 -32 101 -64 609 -571 296 -295 547 -543 559 -550 17 -11 80 -15 299 -15 392 -2 361 -37 365 410 3 365 0 389 -57 427 -33 23 -39 23 -303 23 -177 0 -277 -4 -291 -11 -12 -6 -95 -84 -185 -172 l-162 -162 -113 113 -112 112 170 170 c178 178 221 211 320 250 57 22 75 24 326 28 170 2 293 0 340 -7 193 -30 343 -175 378 -365 14 -76 15 -704 1 -777 -15 -79 -67 -177 -124 -235 -58 -57 -156 -109 -235 -124 -70 -13 -552 -13 -622 0 -30 5 -85 26 -124 45 -64 31 -111 75 -580 545 -280 282 -532 529 -558 551 l-49 39 -278 0 -278 0 -30 -25 c-52 -43 -53 -53 -50 -424 l3 -343 37 -34 c22 -20 49 -35 65 -35 100 -6 532 5 548 13 11 6 92 82 180 169 l160 159 113 -113 112 -113 -183 -182 c-262 -260 -269 -262 -677 -262 -141 0 -281 5 -311 10 -170 32 -310 164 -355 335 -10 37 -14 143 -14 423 0 351 1 376 21 434 52 156 176 269 332 303 75 16 530 20 621 5z"/>
					</g>
				</svg>
				<svg x="530" y="15" width="480" height="320" viewBox="0 -984 1726 1276">
					<g transform="scale(1,-1)">
						<g transform="translate(0,0)"><path d="M260 0Q211 0 180.5 30.5Q150 61 150 112V392H26V496H150V650H276V496H412V392H276V134Q276 104 304 104H400V0Z" fill="currentColor"/></g>
						<g transform="translate(456,0)"><path d="M70 0V700H196V0Z" fill="currentColor"/></g>
						<g transform="translate(722,0)"><path d="M260 0Q211 0 180.5 30.5Q150 61 150 112V392H26V496H150V650H276V496H412V392H276V134Q276 104 304 104H400V0Z" fill="currentColor"/></g>
						<g transform="translate(1178,0)"><path d="M174 0 16 496H150L265 92H283L398 496H532L374 0Z" fill="currentColor"/></g>
					</g>
				</svg>
			</svg>
		</a>
		<div class="nav-links">
			<a href="/control">control</a>
			<span class="nav-sep" aria-hidden="true">|</span>
			<a href="https://timelooptv.org">project</a>
			<a href="https://spec.timelooptv.org">spec</a>
			<a href="https://github.com/tltv-org">github</a>
		</div>
	</nav>

	<main class="main">
		{@render children()}
	</main>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
	}

	.nav {
		display: flex;
		align-items: center;
		gap: 1.5rem;
		max-width: 72rem;
		width: 100%;
		margin: 0 auto;
		padding: 1rem 2rem;
		border-bottom: 1px solid var(--rule);
		font-family: var(--font-sans);
	}

	.nav-brand {
		color: var(--fg);
		text-decoration: none;
		display: flex;
		align-items: center;
	}
	.nav-brand:hover { opacity: 0.7; }
	.nav-lockup { height: 24px; width: auto; }

	.nav-links {
		margin-left: auto;
		display: flex;
		gap: 1.5rem;
	}
	.nav-links a {
		color: var(--fg-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.nav-links a:hover { color: var(--fg); }
	.nav-sep { color: var(--fg-faint); font-size: 0.9rem; }

	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
	}
</style>
