# Phosphor

TLTV client application. Stream viewer with federation support and a management dashboard for [cathode](https://github.com/tltv-org/cathode) servers.

## What it does

- **Watch** any channel on the TLTV federation via `tltv://` URIs
- **TV guide grid** with channel discovery, 30-minute time slots, red now line, click-to-tune
- **Manage** a cathode server — channels, playlists, programs, schedules, playout, output pipelines, peers, relays, tokens, plugins
- **IPTV endpoints** — m3u and XMLTV links for external players (VLC, Kodi, Tivimate)
- **Logs** — real-time server log viewer with level/source filtering and SSE streaming
- **Theme** the viewing experience (operator-controlled, set via the management dashboard)

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env — set VITE_TLTV_NODE to your cathode's address
npm run dev
```

## Docker

```bash
docker build -t phosphor .
docker run -p 3000:80 phosphor
```

In the cathode dev stack:
```bash
cd ../cathode
docker compose -f docker-compose.dev.yml up -d --build phosphor
```

The production image runs as a non-root user. Source maps are disabled.

## Architecture

Phosphor is a SvelteKit SPA that builds to static files served by sirv. No server-side rendering — everything runs in the browser.

```
lib/tltv/      TLTV protocol SDK (pure TypeScript, zero deps)
               URI parsing, Ed25519 verification, channel resolution,
               node discovery, peer exchange

lib/cathode/   Cathode management client (pure TypeScript)
               Implements BackendAdapter interface — when other TLTV
               servers appear, add a new adapter here

lib/themes/    Viewer theming via CSS custom properties
               Built-in: Midnight, Phosphor Green, Broadcast, Ice Planet
               Custom: import/export JSON, stored in localStorage

lib/stores/    Svelte 5 reactive state (runes)
```

The protocol SDK and cathode client are framework-free TypeScript with no Svelte imports. They're structured for extraction into standalone packages when needed.

## Control Panel

Connect to a cathode instance at `/control` with URL + API key. If no playout backend is running at the target address, the connect form shows an error instead of entering a broken dashboard. Sidebar groups: Station, Content, Network, Settings (plus dynamic Plugins group when plugins are loaded).

### Station

- **Overview** — At-a-glance dashboard: engine status, now-playing, inputs summary, outputs summary, system stats
- **Inputs** — Per-layer input source management with inline editing
- **Playout** — Engine control surface with layer Take/Cut, text overlay, text presets
- **Outputs** — Output pipeline management (HLS, RTMP, file, null) with inline config editing
- **Channels** — Multi-channel CRUD with encoding presets
- **Schedule** — Visual week grid editor for multi-layer program blocks

### Content

- **Playlists** — Global named playlist CRUD with two-panel drag-and-drop builder
- **Library** — Media file browser with upload, delete, metadata view

### Network

- **Peers** — Peer management
- **Relays** — Relay management
- **Tokens** — Access token management per channel
- **IPTV** — Copy-paste URLs for external IPTV players

### Plugins

Dynamic sidebar entries for each loaded plugin with dedicated settings pages.

### Settings

- **Server** — Encoding, storage, backup/restore
- **Plugins** — Plugin list with active status, click to configure
- **Logs** — Real-time log viewer with level/source filters and SSE streaming
- **Client** — Default channel, viewer theme picker + JSON import/export

## Development

The `VITE_TLTV_NODE` env var tells the dev server which TLTV node to use as the default hint for channel resolution (e.g. `localhost:8888`). Vite proxies `/api/*`, `/hls/*`, `/tltv/*`, and `/.well-known/tltv` to this address so local-mode viewing and management work without CORS issues.

In production this env var isn't needed — phosphor is served from the same origin as cathode, so `location.host` is the TLTV node.

## Channel resolution

TLTV channel IDs are Ed25519 public keys — cryptographic identifiers with no server information embedded. Resolution requires at least one hint about where to find the channel:

```
tltv://TVxxx...@myserver.com:8888     Full URI with hint
tltv://TVxxx...                        Bare ID — resolves via local node + peer discovery
```

Resolution verifies Ed25519 signatures (rejects invalid), checks protocol version (`v === 1`), and follows migration documents (up to 5 hops). After tuning, metadata is refreshed every 60s to detect stream URL changes, name changes, and key migrations. The guide polls every 30s.

## Theming

Themes control the viewer experience (player, channel bar, TV guide). The management dashboard uses a fixed admin look regardless of theme.

Built-in themes: Midnight (default), Phosphor Green, Broadcast, Ice Planet. Custom themes are JSON objects with CSS custom property overrides. See `src/lib/themes/types.ts` for the full token list.

## Related

- [cathode](https://github.com/tltv-org/cathode) — TLTV reference server
- [cathode-plugins](https://github.com/tltv-org/cathode-plugins) — Plugin system
- [protocol](https://github.com/tltv-org/protocol) — TLTV protocol specification
