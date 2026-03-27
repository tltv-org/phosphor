<script lang="ts">
	import { CathodeApiError } from '$cathode';
	import type { ProgramBlock, ProgramList, MediaList, BackendAdapter, BlockTypesResponse, RegistrySourceType, PluginPresetSummary } from '$cathode';

	interface Props {
		media: MediaList | null;
		programs: ProgramList | null;
		adapter: BackendAdapter | null;
		onRefresh: () => void;
		timezone?: string;
		playoutMode?: { mode: string; day_start: string } | null;
		layerNames?: string[];
		blockTypes?: BlockTypesResponse | null;
		pluginSourceTypes?: RegistrySourceType[];
	}

	let { media, programs, adapter, onRefresh, timezone, playoutMode, layerNames = [], blockTypes = null, pluginSourceTypes = [] }: Props = $props();

	// ── Dynamic block types / layers ──
	const DEFAULT_LAYERS = ['input_a', 'input_b', 'blinder', 'failover'];

	function getAvailableBlockTypes(): string[] {
		// Start with block types from the API
		const types = blockTypes?.all && blockTypes.all.length > 0
			? [...blockTypes.all]
			: ['playlist', 'file', 'image', 'redirect'];
		// Merge plugin source types as block types (until cathode registers them natively)
		for (const pst of pluginSourceTypes) {
			if (!types.includes(pst.name)) types.push(pst.name);
		}
		return types;
	}

	// ── Plugin block type presets ──
	let blockPresets = $state<PluginPresetSummary[]>([]);
	let blockPresetsLoading = $state(false);

	function getBlockTypePlugin(typeName: string): string | null {
		if (!blockTypes) return null;
		const info = blockTypes.plugin[typeName];
		if (!info?.source) return null;
		// source is like "plugin:gstreamer-source" — extract plugin name
		return info.source.startsWith('plugin:') ? info.source.slice(7) : null;
	}

	async function fetchBlockPresets(typeName: string) {
		const pluginName = getBlockTypePlugin(typeName);
		if (!pluginName || !adapter) { blockPresets = []; return; }
		blockPresetsLoading = true;
		try {
			const result = await adapter.getPluginPresets(pluginName);
			blockPresets = result.presets;
		} catch { blockPresets = []; }
		finally { blockPresetsLoading = false; }
	}

	function getAvailableLayers(): string[] {
		if (layerNames && layerNames.length > 0) return layerNames;
		return DEFAULT_LAYERS;
	}

	function formatLayerLabel(layer: string): string {
		return layer.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
	}

	// ── Timezone-aware date helpers ──
	// All schedule dates use the channel's timezone (e.g. "America/New_York").
	// Without this, 7 PM Eastern on March 25 shows as March 26 (UTC).

	/** Get today's date string in the channel timezone (YYYY-MM-DD). */
	function todayInTz(): string {
		if (timezone) {
			try {
				// Intl gives us the date parts in the target timezone
				const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
				return parts; // en-CA format is YYYY-MM-DD
			} catch { /* invalid tz — fall through */ }
		}
		// Fallback: local time (browser timezone)
		const d = new Date();
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	/** Convert a Date to YYYY-MM-DD in the channel timezone. */
	function dateToIso(d: Date): string {
		if (timezone) {
			try {
				return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
			} catch { /* fall through */ }
		}
		return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
	}

	// ── Week navigation ──
	let weekStart = $state(getWeekStart(new Date()));
	let tzInitialized = $state(false);
	// Re-initialize dates when timezone prop arrives (it's often null on first render)
	$effect(() => {
		if (timezone && !tzInitialized) {
			tzInitialized = true;
			const today = todayInTz();
			weekStart = getWeekStart(new Date(today + 'T00:00:00'));
			selectedDate = today;
		}
	});

	function getWeekStart(d: Date): Date {
		// Get the ISO date in channel tz, then find the Sunday of that week
		const iso = dateToIso(d);
		const local = new Date(iso + 'T00:00:00');
		const day = local.getDay(); // 0=Sun
		local.setDate(local.getDate() - day);
		return local;
	}

	function getWeekDates(): string[] {
		const dates: string[] = [];
		for (let i = 0; i < 7; i++) {
			const d = new Date(weekStart);
			d.setDate(d.getDate() + i);
			dates.push(dateToIso(d));
		}
		return dates;
	}

	function navWeek(dir: -1 | 1) {
		const next = new Date(weekStart);
		next.setDate(next.getDate() + dir * 7);
		weekStart = next;
		loadWeekPrograms();
	}

	function jumpToDate(dateStr: string) {
		if (!dateStr) return;
		weekStart = getWeekStart(new Date(dateStr + 'T00:00:00'));
		selectedDate = dateStr;
		loadWeekPrograms();
	}

	function goToday() {
		const today = todayInTz();
		weekStart = getWeekStart(new Date(today + 'T00:00:00'));
		selectedDate = today;
		loadWeekPrograms();
	}

	function fmtDayHeader(iso: string): { weekday: string; label: string } {
		const d = new Date(iso + 'T00:00:00');
		const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
		const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
		return { weekday, label: `${month} ${d.getDate()}` };
	}

	function isToday(date: string): boolean {
		return date === todayInTz();
	}

	// ── Week program data ──
	let selectedDate = $state(todayInTz());
	let weekPrograms = $state<Record<string, ProgramBlock[]>>({});
	let draftPrograms = $state<Record<string, ProgramBlock[]>>({});
	let weekLoading = $state(false);

	// ── Program state (selected day) ──
	let progError = $state('');
	let progSaving = $state(false);
	let showBlockForm = $state(false);
	let editingBlockIdx = $state<number | null>(null);
	let selectedIdxs = $state<Set<number>>(new Set());
	let blockForm = $state<ProgramBlock>({ start: '00:00:00', end: '01:00:00', type: 'playlist', title: '', layer: 'input_a' });

	// ── Available playlists for named playlist references ──
	let availablePlaylists = $state<Array<{name: string; entry_count: number; total_duration: number}>>([]);

	// ── Media file lists for file/image block pickers ──
	const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'];
	function isImage(filename: string): boolean {
		const lower = filename.toLowerCase();
		return IMAGE_EXTS.some(ext => lower.endsWith(ext));
	}
	let videoFiles = $derived(media?.items.filter(f => !isImage(f.filename)) ?? []);
	let imageFiles = $derived(media?.items.filter(f => isImage(f.filename)) ?? []);

	// ── Grid config ──
	const SNAP_MINUTES = 15; // snap to 15-min grid
	const DAY_START_HOUR = 0;
	const DAY_END_HOUR = 24;
	const TOTAL_MINUTES = (DAY_END_HOUR - DAY_START_HOUR) * 60;
	const HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR + 1 }, (_, i) => i + DAY_START_HOUR);

	// Zoom: hourHeight is reactive, controlled by slider (16px–120px per hour)
	const ZOOM_KEY = 'phosphor_schedule_zoom';
	let hourHeight = $state((() => {
		try { const v = parseInt(localStorage.getItem(ZOOM_KEY) || ''); return v >= 16 && v <= 120 ? v : 32; }
		catch { return 32; }
	})());
	$effect(() => { localStorage.setItem(ZOOM_KEY, String(hourHeight)); });
	let GRID_HEIGHT = $derived((DAY_END_HOUR - DAY_START_HOUR) * hourHeight);

	const BLOCK_COLORS: Record<string, string> = {
		playlist: '#6366f1',
		file: '#818cf8',
		image: '#a855f7',
		redirect: '#10b981',
	};

	function getBlockColor(type: string): string {
		return BLOCK_COLORS[type] || '#555';
	}

	// ── Drag state ──
	const RESIZE_EDGE_PX = 6; // px from top/bottom edge to trigger resize

	let drag = $state<{
		type: 'create' | 'move' | 'resize-top' | 'resize-bottom';
		sourceDate: string;   // date the block started on
		currentDate: string;  // date the cursor is currently over
		startMinute: number;
		currentMinute: number;
		blockIdx?: number;
		offsetMinute?: number;
		origBlock?: ProgramBlock;
	} | null>(null);

	function snapMinute(m: number): number {
		return Math.round(Math.max(0, Math.min(TOTAL_MINUTES, m)) / SNAP_MINUTES) * SNAP_MINUTES;
	}

	function yToMinute(y: number): number {
		return (y / GRID_HEIGHT) * TOTAL_MINUTES + DAY_START_HOUR * 60;
	}

	function getColumnY(e: MouseEvent, col: HTMLElement): number {
		return e.clientY - col.getBoundingClientRect().top;
	}

	function detectDateFromX(e: MouseEvent): string | null {
		const cols = document.querySelectorAll<HTMLElement>('[data-date]');
		for (const col of cols) {
			const rect = col.getBoundingClientRect();
			if (e.clientX >= rect.left && e.clientX < rect.right) {
				return col.dataset.date || null;
			}
		}
		return null;
	}

	function isNearEdge(e: MouseEvent, blockEl: HTMLElement): 'top' | 'bottom' | null {
		const rect = blockEl.getBoundingClientRect();
		if (e.clientY - rect.top < RESIZE_EDGE_PX) return 'top';
		if (rect.bottom - e.clientY < RESIZE_EDGE_PX) return 'bottom';
		return null;
	}

	// ── Overlap detection ──
	function wouldOverlap(date: string, start: number, end: number, excludeIdx?: number, layer?: string): boolean {
		const blocks = weekPrograms[date] || [];
		return blocks.some((b, i) => {
			if (i === excludeIdx) return false;
			// Different layers can overlap freely
			const blockLayer = b.layer || 'input_a';
			const targetLayer = layer || 'input_a';
			if (blockLayer !== targetLayer) return false;
			const bStart = timeToMinutes(b.start);
			const bEnd = timeToMinutes(b.end);
			return start < bEnd && end > bStart;
		});
	}

	function handleDragStart(date: string, e: MouseEvent) {
		const col = e.currentTarget as HTMLElement;
		const minute = snapMinute(yToMinute(getColumnY(e, col)));
		const blocks = weekPrograms[date] || [];
		let forceBottomResize = false;
		let clickedIdx = blocks.findIndex(b =>
			minute >= timeToMinutes(b.start) && minute < timeToMinutes(b.end)
		);

		if (clickedIdx < 0) {
			// Check if near the bottom edge of any block (for resize handle)
			const resizeMargin = (RESIZE_EDGE_PX / GRID_HEIGHT) * TOTAL_MINUTES;
			clickedIdx = blocks.findIndex(b => {
				const bEnd = timeToMinutes(b.end);
				return minute >= bEnd && minute < bEnd + resizeMargin;
			});
			if (clickedIdx >= 0) forceBottomResize = true;
		}

		if (clickedIdx >= 0) {
			const block = blocks[clickedIdx];
			selectedDate = date;

			// Shift+click: toggle in multi-select
			if (e.shiftKey) {
				const next = new Set(selectedIdxs);
				if (next.has(clickedIdx)) next.delete(clickedIdx);
				else next.add(clickedIdx);
				selectedIdxs = next;
				editingBlockIdx = clickedIdx;
				blockForm = { ...block };
				showBlockForm = true;
				e.preventDefault();
				return;
			}

			// Regular click: single select
			selectedIdxs = new Set([clickedIdx]);
			editingBlockIdx = clickedIdx;
			blockForm = { ...block };
			showBlockForm = true;

			// Check if near edge for resize
			const blockEls = col.querySelectorAll<HTMLElement>('.week-block');
			const edge = forceBottomResize ? 'bottom' : (blockEls[clickedIdx] ? isNearEdge(e, blockEls[clickedIdx]) : null);

			if (edge === 'top') {
				drag = {
					type: 'resize-top', sourceDate: date, currentDate: date,
					startMinute: timeToMinutes(block.start), currentMinute: minute,
					blockIdx: clickedIdx, origBlock: { ...block },
				};
			} else if (edge === 'bottom') {
				drag = {
					type: 'resize-bottom', sourceDate: date, currentDate: date,
					startMinute: timeToMinutes(block.end), currentMinute: minute,
					blockIdx: clickedIdx, origBlock: { ...block },
				};
			} else {
				drag = {
					type: 'move', sourceDate: date, currentDate: date,
					startMinute: minute, currentMinute: minute,
					blockIdx: clickedIdx,
					offsetMinute: minute - timeToMinutes(block.start),
					origBlock: { ...block },
				};
			}
		} else {
			// Create drag
			selectedDate = date;
			editingBlockIdx = null;
			selectedIdxs = new Set();
			showBlockForm = false;
			drag = {
				type: 'create', sourceDate: date, currentDate: date,
				startMinute: minute, currentMinute: minute,
			};
		}
		e.preventDefault();
	}

	function handleDragMove(e: MouseEvent) {
		if (!drag) return;
		const hoveredDate = detectDateFromX(e) || drag.currentDate;
		const colEl = document.querySelector(`[data-date="${hoveredDate}"]`) as HTMLElement;
		if (!colEl) return;
		const minute = snapMinute(yToMinute(getColumnY(e, colEl)));

		if (drag.type === 'create') {
			drag = { ...drag, currentMinute: minute };

		} else if (drag.type === 'move' && drag.blockIdx !== undefined && drag.origBlock) {
			const dur = timeToMinutes(drag.origBlock.end) - timeToMinutes(drag.origBlock.start);
			let newStart = snapMinute(minute - (drag.offsetMinute || 0));
			newStart = Math.max(0, Math.min(TOTAL_MINUTES - dur, newStart));

			if (hoveredDate !== drag.currentDate) {
				// Cross-day: check overlap on target day (no excludeIdx since it's a new entry)
				if (wouldOverlap(hoveredDate, newStart, newStart + dur, undefined, drag.origBlock?.layer)) return;
				const movedBlock = { ...drag.origBlock, start: minutesToTime(newStart), end: minutesToTime(newStart + dur) };
				const oldBlocks = (weekPrograms[drag.currentDate] || []).filter((_, i) => i !== drag!.blockIdx);
				const newBlocks = [...(weekPrograms[hoveredDate] || []), movedBlock];
				newBlocks.sort((a, b) => a.start.localeCompare(b.start));
				const newIdx = newBlocks.indexOf(movedBlock);
				draftPrograms = { ...draftPrograms, [drag.currentDate]: oldBlocks, [hoveredDate]: newBlocks };
				weekPrograms = { ...weekPrograms, [drag.currentDate]: oldBlocks, [hoveredDate]: newBlocks };
				drag = { ...drag, currentDate: hoveredDate, currentMinute: minute, blockIdx: newIdx };
				selectedDate = hoveredDate;
			} else {
				// Same day: check overlap excluding self
				if (wouldOverlap(drag.currentDate, newStart, newStart + dur, drag.blockIdx, drag.origBlock?.layer)) return;
				const movedBlock = { ...drag.origBlock, start: minutesToTime(newStart), end: minutesToTime(newStart + dur) };
				const blocks = [...(weekPrograms[drag.currentDate] || [])];
				blocks[drag.blockIdx] = movedBlock;
				weekPrograms = { ...weekPrograms, [drag.currentDate]: blocks };
				drag = { ...drag, currentMinute: minute };
			}

		} else if (drag.type === 'resize-top' && drag.blockIdx !== undefined && drag.origBlock) {
			const origEnd = timeToMinutes(drag.origBlock.end);
			const newStart = Math.max(0, Math.min(origEnd - SNAP_MINUTES, minute));
			if (wouldOverlap(drag.sourceDate, newStart, origEnd, drag.blockIdx, drag.origBlock.layer)) return;
			const newStartTime = minutesToTime(newStart);
			const blocks = [...(weekPrograms[drag.sourceDate] || [])];
			blocks[drag.blockIdx] = { ...blocks[drag.blockIdx], start: newStartTime };
			weekPrograms = { ...weekPrograms, [drag.sourceDate]: blocks };
			blockForm = { ...blockForm, start: newStartTime };
			drag = { ...drag, currentMinute: minute };

		} else if (drag.type === 'resize-bottom' && drag.blockIdx !== undefined && drag.origBlock) {
			const origStart = timeToMinutes(drag.origBlock.start);
			const newEnd = Math.min(TOTAL_MINUTES, Math.max(origStart + SNAP_MINUTES, minute));
			if (wouldOverlap(drag.sourceDate, origStart, newEnd, drag.blockIdx, drag.origBlock.layer)) return;
			const newEndTime = minutesToTime(newEnd);
			const blocks = [...(weekPrograms[drag.sourceDate] || [])];
			blocks[drag.blockIdx] = { ...blocks[drag.blockIdx], end: newEndTime };
			weekPrograms = { ...weekPrograms, [drag.sourceDate]: blocks };
			blockForm = { ...blockForm, end: newEndTime };
			drag = { ...drag, currentMinute: minute };
		}
	}

	function handleDragEnd(e?: MouseEvent) {
		if (!drag) return;
		const date = drag.currentDate || drag.sourceDate;

		// On mouseleave during resize, clamp to grid boundary
		if (e?.type === 'mouseleave' && drag.origBlock) {
			if (drag.type === 'resize-bottom' && drag.blockIdx !== undefined) {
				// Clamp to bottom of grid
				const origStart = timeToMinutes(drag.origBlock.start);
				const blocks = [...(weekPrograms[drag.sourceDate] || [])];
				blocks[drag.blockIdx] = { ...blocks[drag.blockIdx], end: minutesToTime(TOTAL_MINUTES) };
				weekPrograms = { ...weekPrograms, [drag.sourceDate]: blocks };
				if (showBlockForm) blockForm = { ...blockForm, end: minutesToTime(TOTAL_MINUTES) };
				draftPrograms = { ...draftPrograms, [drag.sourceDate]: blocks };
			} else if (drag.type === 'resize-top' && drag.blockIdx !== undefined) {
				// Clamp to top of grid
				const blocks = [...(weekPrograms[drag.sourceDate] || [])];
				blocks[drag.blockIdx] = { ...blocks[drag.blockIdx], start: minutesToTime(0) };
				weekPrograms = { ...weekPrograms, [drag.sourceDate]: blocks };
				if (showBlockForm) blockForm = { ...blockForm, start: minutesToTime(0) };
				draftPrograms = { ...draftPrograms, [drag.sourceDate]: blocks };
			}
		}

		if (drag.type === 'create') {
			const minA = Math.min(drag.startMinute, drag.currentMinute);
			const minB = Math.max(drag.startMinute, drag.currentMinute);
			const startMin = minB - minA >= SNAP_MINUTES ? minA : drag.startMinute;
			const endMin = minB - minA >= SNAP_MINUTES ? minB : Math.min(drag.startMinute + 60, TOTAL_MINUTES);

			// Don't create if it would overlap
			if (wouldOverlap(date, startMin, endMin, undefined, 'input_a')) {
				drag = null;
				return;
			}

			// Create block immediately on the grid
			const defaultType = getAvailableBlockTypes()[0] || 'playlist';
			const typeLabel = defaultType.charAt(0).toUpperCase() + defaultType.slice(1);
			const newBlock: ProgramBlock = {
				start: minutesToTime(startMin),
				end: minutesToTime(endMin),
				type: defaultType,
				title: typeLabel,
				layer: getAvailableLayers()[0] || 'input_a',
			};
			const blocks = [...(weekPrograms[date] || []), newBlock];
			blocks.sort((a, b) => a.start.localeCompare(b.start));
			draftPrograms = { ...draftPrograms, [date]: blocks };
			weekPrograms = { ...weekPrograms, [date]: blocks };
			selectedDate = date;

			// Select the new block for editing
			const newIdx = blocks.indexOf(newBlock);
			editingBlockIdx = newIdx;
			blockForm = { ...newBlock };
			showBlockForm = true;

		} else if (drag.type === 'move' || drag.type === 'resize-top' || drag.type === 'resize-bottom') {
			// Sort blocks on the final date
			const blocks = [...(weekPrograms[date] || [])];
			blocks.sort((a, b) => a.start.localeCompare(b.start));
			draftPrograms = { ...draftPrograms, [date]: blocks };
			weekPrograms = { ...weekPrograms, [date]: blocks };
			selectedDate = date;
		}
		drag = null;
	}

	// Drag preview rectangle (for create)
	function getDragPreview(): { top: number; height: number } | null {
		if (!drag || drag.type !== 'create') return null;
		const minA = Math.min(drag.startMinute, drag.currentMinute);
		const minB = Math.max(drag.startMinute, drag.currentMinute);
		if (minB - minA < SNAP_MINUTES) return null;
		const top = ((minA - DAY_START_HOUR * 60) / TOTAL_MINUTES) * GRID_HEIGHT;
		const height = ((minB - minA) / TOTAL_MINUTES) * GRID_HEIGHT;
		return { top, height };
	}

	// Cursor style based on hover position
	function getBlockCursor(e: MouseEvent, blockEl: HTMLElement): string {
		const edge = isNearEdge(e, blockEl);
		if (edge) return 'ns-resize';
		return 'grab';
	}

	function normalizeTime(t: string): string {
		if (!t) return '00:00:00';
		if (t.length === 5) return t + ':00';
		return t;
	}

	/** Convert 24:00:00 → 23:59:59 for <input type="time"> display (can't show 24:00) */
	function timeForInput(t: string): string {
		return t === '24:00:00' ? '23:59:59' : t;
	}

	/** Convert 23:59:59 back to 24:00:00 if user left it at end-of-day */
	function timeFromInput(t: string): string {
		if (t === '23:59:59' || t === '23:59') return '24:00:00';
		return t;
	}

	function timeToMinutes(t: string): number {
		const parts = t.split(':').map(Number);
		const h = parts[0] || 0;
		const m = parts[1] || 0;
		// 24:00:00 = end of day = 1440 minutes
		return h * 60 + m;
	}

	function minutesToTime(m: number): string {
		// 1440 = end of day boundary, use 24:00:00 (not 00:00:00)
		if (m >= TOTAL_MINUTES) return '24:00:00';
		const h = Math.floor(m / 60);
		const min = Math.floor(m % 60);
		return `${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}:00`;
	}

	function fmtTimeRange(start: string, end: string): string {
		return `${start.slice(0, 5)}\u2013${end.slice(0, 5)}`;
	}

	function blockDurationMinutes(block: ProgramBlock): number {
		return timeToMinutes(block.end) - timeToMinutes(block.start);
	}

	function fmtDuration(secs: number): string {
		const h = Math.floor(secs / 3600);
		const m = Math.floor((secs % 3600) / 60);
		if (h > 0 && m > 0) return `${h}h ${m}m`;
		if (h > 0) return `${h}h`;
		return `${m}m`;
	}

	function fmtBlockDuration(block: ProgramBlock): string {
		const mins = blockDurationMinutes(block);
		const h = Math.floor(mins / 60);
		const m = mins % 60;
		if (h > 0 && m > 0) return `${h}h ${m}m`;
		if (h > 0) return `${h}h`;
		return `${m}m`;
	}

	function getPlaylistInfo(block: ProgramBlock): { totalDuration: number; loops: number; cutsClip: boolean } | null {
		if (block.type !== 'playlist' || !block.playlist_name) return null;
		const pl = availablePlaylists.find(p => p.name === block.playlist_name);
		if (!pl || pl.total_duration <= 0) return null;
		const blockSecs = blockDurationMinutes(block) * 60;
		const loops = blockSecs / pl.total_duration;
		const cutsClip = loops > 1 && (blockSecs % pl.total_duration) !== 0;
		return { totalDuration: pl.total_duration, loops, cutsClip };
	}

	// ── Block positioning (vertical) ──
	function blockTop(block: ProgramBlock): number {
		const startMin = timeToMinutes(block.start);
		return ((startMin - DAY_START_HOUR * 60) / TOTAL_MINUTES) * GRID_HEIGHT;
	}

	function blockHeight(block: ProgramBlock): number {
		const dur = blockDurationMinutes(block);
		const natural = (dur / TOTAL_MINUTES) * GRID_HEIGHT;
		// Minimum visual height = 15 minutes at current zoom
		const minPx = (SNAP_MINUTES / TOTAL_MINUTES) * GRID_HEIGHT;
		return Math.max(natural, minPx);
	}

	// ── Scroll to now ──
	function scrollToNow() {
		const scrollEl = document.querySelector('.week-scroll') as HTMLElement;
		if (!scrollEl) return;
		const nowY = getNowTop();
		// Scroll so now-line is ~1/3 from the top of the viewport
		scrollEl.scrollTop = Math.max(0, nowY - scrollEl.clientHeight / 3);
	}

	// ── Now-line position ──
	function getNowTop(): number {
		let hrs: number, mins: number;
		if (timezone) {
			try {
				const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(new Date());
				hrs = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
				mins = parseInt(parts.find(p => p.type === 'minute')?.value || '0');
			} catch {
				const now = new Date();
				hrs = now.getHours(); mins = now.getMinutes();
			}
		} else {
			const now = new Date();
			hrs = now.getHours(); mins = now.getMinutes();
		}
		return ((hrs * 60 + mins - DAY_START_HOUR * 60) / TOTAL_MINUTES) * GRID_HEIGHT;
	}

	// ── Data loading ──
	async function loadWeekPrograms() {
		if (!adapter) return;
		weekLoading = true;
		progError = '';
		const dates = getWeekDates();
		const results = await Promise.allSettled(dates.map(d => adapter!.getProgram(d)));
		const newData: Record<string, ProgramBlock[]> = {};
		results.forEach((r, i) => {
			if (r.status === 'fulfilled') {
				newData[dates[i]] = r.value.blocks || [];
			} else {
				// 404 = no program, that's fine
				newData[dates[i]] = [];
			}
		});
		// Merge any unsaved drafts back
		for (const [date, blocks] of Object.entries(draftPrograms)) {
			if (date in newData) {
				newData[date] = blocks;
			}
		}
		weekPrograms = newData;
		weekLoading = false;
	}

	function selectedBlocks(): ProgramBlock[] {
		return weekPrograms[selectedDate] || [];
	}

	function setSelectedBlocks(blocks: ProgramBlock[]) {
		draftPrograms = { ...draftPrograms, [selectedDate]: blocks };
		weekPrograms = { ...weekPrograms, [selectedDate]: blocks };
	}

	/** Convert time for API: 24:00:00 → 23:59:59 (cathode rejects 24:00:00) */
	function timeForApi(t: string): string {
		return t === '24:00:00' ? '23:59:59' : normalizeTime(t);
	}

	async function saveProgram() {
		if (!adapter) return;
		const draftDates = Object.keys(draftPrograms);
		if (draftDates.length === 0) return;
		progSaving = true;
		progError = '';
		try {
			for (const date of draftDates) {
				const blocks = (weekPrograms[date] || []).map(b => {
					const block: ProgramBlock = {
						...b,
						start: timeForApi(b.start),
						end: timeForApi(b.end),
					};
					// Cathode expects 'name' for the preset reference on plugin block types
					if (block.preset && !block.name) block.name = block.preset;
					return block;
				});
				await adapter.setProgram(date, blocks);
			}
			draftPrograms = {};
			await onRefresh();
		} catch (e: unknown) {
			progError = CathodeApiError.extractMessage(e, 'Failed to save program');
		} finally { progSaving = false; }
	}

	async function handleDeleteProgram() {
		if (!selectedDate || !confirm(`Delete program for ${selectedDate}?`)) return;
		progSaving = true;
		progError = '';
		if (!adapter) { progSaving = false; return; }
		try {
			await adapter.deleteProgram(selectedDate);
			setSelectedBlocks([]);
			delete draftPrograms[selectedDate];
			draftPrograms = { ...draftPrograms };
			await onRefresh();
		} catch (e: unknown) {
			progError = CathodeApiError.extractMessage(e, 'Failed to delete');
		} finally { progSaving = false; }
	}

	// ── Block form ──
	/** Auto-fill title from block type + selection (only if title is empty or was auto-generated) */
	let titleWasAuto = $state(false);
	function autoTitle() {
		if (blockForm.title && !titleWasAuto) return; // user typed a custom title
		const type = blockForm.type;
		let title = type.charAt(0).toUpperCase() + type.slice(1);
		if (type === 'playlist' && blockForm.playlist_name) title = blockForm.playlist_name;
		else if (type === 'file' && blockForm.file) title = blockForm.file.split('/').pop() || title;
		else if (type === 'image' && blockForm.file) title = blockForm.file.split('/').pop() || title;
		else if (type === 'redirect' && blockForm.url) title = 'Redirect';
		else if (blockForm.preset) title = `${title}: ${blockForm.preset}`;
		else if (blockForm.name) title = `${title}: ${blockForm.name}`;
		blockForm.title = title;
		titleWasAuto = true;
	}

	function openAddBlock() {
		editingBlockIdx = null;
		const blocks = selectedBlocks();
		const lastEnd = blocks.length > 0 ? blocks[blocks.length - 1].end : '00:00:00';
		const startMin = timeToMinutes(lastEnd);
		const endMin = Math.min(startMin + 60, 1440);
		const defaultType = getAvailableBlockTypes()[0] || 'playlist';
		titleWasAuto = true;
		blockForm = { start: lastEnd, end: minutesToTime(endMin), type: defaultType, title: '', layer: getAvailableLayers()[0] || 'input_a' };
		autoTitle();
		showBlockForm = true;
	}

	function openEditBlock(idx: number) {
		editingBlockIdx = idx;
		blockForm = { ...selectedBlocks()[idx] };
		titleWasAuto = false; // existing block — don't overwrite user's title
		showBlockForm = true;
	}

	function cancelBlockForm() {
		showBlockForm = false;
		editingBlockIdx = null;
	}

	function saveBlock() {
		const { start, end, type, title, layer, loop } = blockForm;
		const block: ProgramBlock = {
			start: normalizeTime(start),
			end: normalizeTime(end),
			type,
			title,
			...(layer ? { layer } : {}),
			...(loop !== undefined ? { loop } : {}),
		};
		// Only include fields relevant to the current block type
		if (type === 'playlist') {
			if (blockForm.playlist_name) block.playlist_name = blockForm.playlist_name;
		} else if (type === 'file' || type === 'image') {
			if (blockForm.file) block.file = blockForm.file;
		} else if (type === 'redirect') {
			if (blockForm.url) block.url = blockForm.url;
		} else {
			// Plugin block types use preset/name
			if (blockForm.preset) block.preset = blockForm.preset;
			if (blockForm.preset && !blockForm.name) block.name = blockForm.preset;
			else if (blockForm.name) block.name = blockForm.name;
		}
		const blocks = [...selectedBlocks()];
		if (editingBlockIdx !== null) {
			blocks[editingBlockIdx] = block;
		} else {
			blocks.push(block);
		}
		blocks.sort((a, b) => a.start.localeCompare(b.start));
		setSelectedBlocks(blocks);
		showBlockForm = false;
		editingBlockIdx = null;
	}

	// ── Day header interactions ──
	function handleHeaderClick(date: string) {
		selectedDate = date;
		selectedIdxs = new Set();
		editingBlockIdx = null;
		showBlockForm = false;
	}

	function handleHeaderDblClick(date: string) {
		selectedDate = date;
		const blocks = weekPrograms[date] || [];
		if (blocks.length > 0) {
			// Select all blocks on that day
			selectedIdxs = new Set(blocks.map((_, i) => i));
			editingBlockIdx = null;
			showBlockForm = false;
		} else {
			// Create an all-day block
			const defaultLayer = getAvailableLayers()[0] || 'input_a';
			if (wouldOverlap(date, 0, TOTAL_MINUTES, undefined, defaultLayer)) return;
			const defaultType = getAvailableBlockTypes()[0] || 'playlist';
			const typeLabel = defaultType.charAt(0).toUpperCase() + defaultType.slice(1);
			const allDay: ProgramBlock = {
				start: '00:00:00', end: '24:00:00',
				type: defaultType, title: typeLabel,
				layer: defaultLayer,
			};
			draftPrograms = { ...draftPrograms, [date]: [allDay] };
			weekPrograms = { ...weekPrograms, [date]: [allDay] };
			selectedIdxs = new Set([0]);
			editingBlockIdx = 0;
			blockForm = { ...allDay };
			showBlockForm = true;
		}
	}

	function toggleBlockLoop(idx: number) {
		const blocks = [...selectedBlocks()];
		blocks[idx] = { ...blocks[idx], loop: blocks[idx].loop === false ? true : false };
		setSelectedBlocks(blocks);
	}

	function removeBlock(idx: number) {
		setSelectedBlocks(selectedBlocks().filter((_, i) => i !== idx));
		if (editingBlockIdx === idx) {
			editingBlockIdx = null;
			showBlockForm = false;
		}
	}

	// ── Clipboard + keyboard ──
	let clipboard = $state<ProgramBlock[]>([]);

	function selectAllWeek() {
		const allBlocks: ProgramBlock[] = [];
		for (const date of getWeekDates()) {
			const blocks = weekPrograms[date] || [];
			allBlocks.push(...blocks.map(b => ({ ...b })));
		}
		clipboard = allBlocks;
		selectedIdxs = new Set(selectedBlocks().map((_, i) => i));
	}

	function handleKeydown(e: KeyboardEvent) {
		const tag = (e.target as HTMLElement)?.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

		if (e.key === 'Delete' || e.key === 'Backspace') {
			if (selectedIdxs.size > 0) {
				e.preventDefault();
				// Delete all selected blocks (iterate from highest idx down)
				const idxs = [...selectedIdxs].sort((a, b) => b - a);
				let blocks = [...selectedBlocks()];
				for (const idx of idxs) blocks.splice(idx, 1);
				setSelectedBlocks(blocks);
				selectedIdxs = new Set();
				editingBlockIdx = null;
				showBlockForm = false;
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
			if (selectedIdxs.size > 0) {
				e.preventDefault();
				const blocks = selectedBlocks();
				clipboard = [...selectedIdxs].sort((a, b) => a - b).map(i => ({ ...blocks[i] }));
			}
		} else if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
			if (clipboard.length > 0) {
				e.preventDefault();
				// Filter out blocks that would overlap — paste what fits
				const pasted = clipboard
					.filter(b => {
						const s = timeToMinutes(b.start);
						const en = timeToMinutes(b.end);
						return !wouldOverlap(selectedDate, s, en, undefined, b.layer);
					})
					.map(b => ({ ...b }));
				if (pasted.length === 0) return;
				const blocks = [...selectedBlocks(), ...pasted];
				blocks.sort((a, b) => a.start.localeCompare(b.start));
				setSelectedBlocks(blocks);
				// Select all pasted blocks
				const newIdxs = new Set(pasted.map(p => blocks.indexOf(p)));
				selectedIdxs = newIdxs;
				editingBlockIdx = null;
				showBlockForm = false;
			}
		} else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyA') {
			// Select all blocks across the entire week
			e.preventDefault();
			e.stopPropagation();
			const allBlocks: ProgramBlock[] = [];
			for (const date of getWeekDates()) {
				const blocks = weekPrograms[date] || [];
				allBlocks.push(...blocks.map(b => ({ ...b })));
			}
			clipboard = allBlocks;
			selectedIdxs = new Set(selectedBlocks().map((_, i) => i));
		} else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.code === 'KeyA') {
			// Select all blocks on current day
			e.preventDefault();
			const blocks = selectedBlocks();
			selectedIdxs = new Set(blocks.map((_, i) => i));
			editingBlockIdx = null;
			showBlockForm = false;
		} else if (e.key === 'Escape') {
			selectedIdxs = new Set();
			cancelBlockForm();
		}
	}

	function dateHasData(date: string): boolean {
		return programs?.programs?.some(p => p.date === date && p.has_program) ?? false;
	}

	// ── Auto-load week on mount / adapter change ──
	$effect(() => {
		if (adapter) {
			loadWeekPrograms().then(() => { setTimeout(scrollToNow, 100); });
			adapter.getPlaylists().then(r => { availablePlaylists = r.playlists; }).catch(() => {});
		}
	});

	// ── Keyboard listener ──
	$effect(() => {
		window.addEventListener('keydown', handleKeydown);
		return () => window.removeEventListener('keydown', handleKeydown);
	});

	// ── Unsaved changes detection ──
	function hasDrafts(): boolean {
		return Object.keys(draftPrograms).length > 0;
	}

	function handleBeforeUnload(e: BeforeUnloadEvent) {
		if (hasDrafts()) {
			e.preventDefault();
		}
	}

	$effect(() => {
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () => window.removeEventListener('beforeunload', handleBeforeUnload);
	});
</script>

<h2>Schedule</h2>

<p class="panel-desc">
	Programs define time-based blocks for schedule mode. Click a day column to add blocks, click a block to edit.
</p>

{#if playoutMode?.mode === 'loop'}
	<div class="loop-warning">
		Loop mode active — the schedule below is inactive. Switch to schedule mode in Playout to use programmed blocks.
	</div>
{/if}

	{#if progError}
		<div class="form-error">{progError}</div>
	{/if}

	<!-- Week nav -->
	<div class="week-nav">
		<button class="btn-surface btn-xs" onclick={() => navWeek(-1)}>Prev</button>
		<button class="btn-surface btn-xs" onclick={goToday}>Today</button>
		<button class="btn-surface btn-xs" onclick={() => navWeek(1)}>Next</button>
		<input type="date" class="week-date-picker" value={selectedDate}
			onchange={(e) => jumpToDate((e.target as HTMLInputElement).value)} />
		<button class="btn-surface btn-xs" onclick={selectAllWeek} title="Copy all blocks from this week to clipboard">Select Week</button>
		{#if weekLoading}
			<span class="text-muted" style="font-size: 0.75rem; margin-left: 0.5rem">Loading...</span>
		{/if}
		{#if hasDrafts()}
			<span class="draft-indicator">Unsaved changes</span>
		{/if}
		{#if timezone}
			<span class="tz-label">{timezone}</span>
		{/if}
	</div>

	<!-- Week grid -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="week-scroll"
		onmousemove={handleDragMove}
		onmouseup={handleDragEnd}
		onmouseleave={(e) => handleDragEnd(e)}>
		<div class="week-grid">
			<!-- Hour gutter -->
			<div class="week-gutter">
				<div class="week-gutter-header"></div>
			<div class="week-gutter-body" style="height: {GRID_HEIGHT}px">
				{#each HOURS as h}
					<div class="hour-label" style="top: {h === DAY_END_HOUR ? GRID_HEIGHT - 10 : (h - DAY_START_HOUR) * hourHeight + 2}px">
						{h.toString().padStart(2, '0')}:00
					</div>
				{/each}
				</div>
			</div>

			<!-- Day columns -->
			{#each getWeekDates() as date}
				{@const header = fmtDayHeader(date)}
				{@const today = isToday(date)}
				{@const selected = date === selectedDate}
				{@const blocks = weekPrograms[date] || []}
				{@const hasData = dateHasData(date)}
				{@const preview = drag?.sourceDate === date ? getDragPreview() : null}
				<div class="week-col" class:week-col-today={today} class:week-col-selected={selected}>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="week-col-header" class:week-col-header-today={today}
						onclick={() => handleHeaderClick(date)}
						ondblclick={() => handleHeaderDblClick(date)}>
						<span class="col-weekday">{header.weekday}</span>
						<span class="col-date" class:col-date-today={today}>{header.label}</span>
						{#if hasData}
							<span class="col-dot"></span>
						{/if}
					</div>
					<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="week-col-body" data-date={date} style="height: {GRID_HEIGHT}px"
					onmousedown={(e) => handleDragStart(date, e)}>
					<!-- Hour grid lines -->
					{#each HOURS as h}
						{#if h < DAY_END_HOUR}
							<div class="hour-line" style="top: {(h - DAY_START_HOUR) * hourHeight}px"></div>
						{/if}
					{/each}
						<!-- Drag preview -->
						{#if preview}
							<div class="drag-preview" style="top: {preview.top}px; height: {preview.height}px"></div>
						{/if}
						<!-- Program blocks -->
						{#each blocks as block, idx}
							{@const top = blockTop(block)}
							{@const height = blockHeight(block)}
							{@const isDragging = drag && drag.blockIdx === idx && drag.currentDate === date && (drag.type === 'move' || drag.type === 'resize-top' || drag.type === 'resize-bottom')}
							<div class="week-block"
								class:week-block-selected={selected && (editingBlockIdx === idx || selectedIdxs.has(idx))}
								class:week-block-dragging={isDragging}
								style="top: {top}px; height: {height}px; background: {getBlockColor(block.type)}"
								title="{block.title || block.type} ({fmtTimeRange(block.start, block.end)})">
								<div class="block-resize-handle block-resize-top"></div>
								{#if height > 18}
									<span class="week-block-time">{block.start.slice(0, 5)}</span>
								{/if}
							{#if height > 30}
								<span class="week-block-title">{block.title || block.type}</span>
							{/if}
							{#if height > 44 && block.layer && block.layer !== 'input_a'}
								<span class="week-block-layer">{block.layer}</span>
							{/if}
								{#if block.type === 'playlist' && block.loop !== false && block.playlist_name}
									{@const pInfo = getPlaylistInfo(block)}
									{#if pInfo && pInfo.loops > 0}
										{@const loopPct = 100 / pInfo.loops}
										{#each Array.from({ length: Math.floor(pInfo.loops) }, (_, i) => i + 1) as n}
											{#if n < pInfo.loops}
												<div class="block-loop-line" style="top: {(loopPct * n).toFixed(1)}%"></div>
											{/if}
										{/each}
										{#if pInfo.cutsClip}
											<div class="block-loop-cut" style="top: {(loopPct * Math.floor(pInfo.loops)).toFixed(1)}%"></div>
										{/if}
									{/if}
								{/if}
								{#if block.type === 'playlist' && block.loop === false}
									{@const pInfo2 = getPlaylistInfo(block)}
									{#if pInfo2}
										{@const fillPct = Math.min(100, (1 / pInfo2.loops) * 100)}
										{#if fillPct < 100}
											<div class="block-unfilled" style="top: {fillPct.toFixed(1)}%; bottom: 0"></div>
										{/if}
									{/if}
								{/if}
								<div class="block-resize-handle block-resize-bottom"></div>
							</div>
						{/each}
						<!-- Now line -->
						{#if today}
							<div class="week-now" style="top: {getNowTop()}px"></div>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Zoom control -->
	<div class="zoom-bar">
		<button class="zoom-btn" class:zoom-btn-active={hourHeight <= 20} onclick={() => hourHeight = 16} title="Full day view">Day</button>
		<button class="zoom-btn" class:zoom-btn-active={hourHeight > 20 && hourHeight <= 44} onclick={() => hourHeight = 32} title="Normal view">Normal</button>
		<button class="zoom-btn" class:zoom-btn-active={hourHeight > 44 && hourHeight <= 80} onclick={() => hourHeight = 60} title="Detailed view">Detail</button>
		<button class="zoom-btn" class:zoom-btn-active={hourHeight > 80} onclick={() => hourHeight = 120} title="Fine detail view">Fine</button>
		<span class="zoom-fine">
			<button class="zoom-btn" onclick={() => { hourHeight = Math.max(16, hourHeight - 4); }}>-</button>
			<button class="zoom-btn" onclick={() => { hourHeight = Math.min(120, hourHeight + 4); }}>+</button>
		</span>
		<button class="zoom-btn" onclick={scrollToNow} title="Scroll to current time">Now</button>
	</div>

	<!-- Selected day detail -->
	<div class="day-detail">
		<div class="day-detail-header">
			<h3>{selectedDate}</h3>
			<span class="text-muted" style="font-size: 0.8rem">{selectedBlocks().length} block{selectedBlocks().length !== 1 ? 's' : ''}</span>
		</div>

		<!-- Blocks table -->
		{#if selectedBlocks().length > 0 && !drag}
			<div class="table-wrap">
				<table>
					<thead><tr><th>Start</th><th>End</th><th>Dur</th><th>Type</th><th>Source</th><th>Layer</th><th>Title</th><th></th></tr></thead>
					<tbody>
						{#each selectedBlocks() as block, idx}
							<tr class:clickable={true} class:row-selected={selectedIdxs.has(idx)}
								onclick={() => openEditBlock(idx)}>
								<td class="mono">{block.start.slice(0, 5)}</td>
								<td class="mono">{block.end.slice(0, 5)}</td>
								<td class="text-muted">{fmtBlockDuration(block)}</td>
							<td><span class="type-badge" style="background: {getBlockColor(block.type)}">{block.type}</span></td>
							<td class="mono" style="font-size: 0.7rem">
								{block.playlist_name || block.preset || block.name || block.file || block.url || '\u2014'}
							</td>
							<td class="mono" style="font-size: 0.7rem">{block.layer || 'input_a'}</td>
							<td>{block.title}</td>
								<td class="row-actions">
									{#if block.type === 'playlist'}
										<button class="btn-xs" class:btn-surface={block.loop !== false} class:btn-loop-off={block.loop === false}
											title={block.loop === false ? 'No loop (click to enable)' : 'Looping (click to disable)'}
											onclick={(e) => { e.stopPropagation(); toggleBlockLoop(idx); }}>
											{block.loop === false ? '1x' : '∞'}
										</button>
									{/if}
									<button class="btn-surface btn-xs" onclick={(e) => { e.stopPropagation(); openEditBlock(idx); }}>Edit</button>
									<button class="btn-danger btn-xs" onclick={(e) => { e.stopPropagation(); removeBlock(idx); }}>Del</button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		<!-- Block form -->
		{#if showBlockForm && !drag}
			<div class="panel" style="margin-top: 0.75rem">
				<h3>{editingBlockIdx !== null ? 'Edit Block' : 'New Block'}</h3>
				<div class="form-grid">
					<label class="form-label">
						<span>Start</span>
						<input type="time" step="1" value={timeForInput(blockForm.start)}
							oninput={(e) => { blockForm.start = normalizeTime((e.target as HTMLInputElement).value); }} />
					</label>
					<label class="form-label">
						<span>End{blockForm.end === '24:00:00' ? ' (end of day)' : ''}</span>
						<input type="time" step="1" value={timeForInput(blockForm.end)}
							oninput={(e) => { blockForm.end = timeFromInput(normalizeTime((e.target as HTMLInputElement).value)); }} />
					</label>
				<label class="form-label">
					<span>Type</span>
					<select bind:value={blockForm.type} onchange={() => { if (getBlockTypePlugin(blockForm.type)) fetchBlockPresets(blockForm.type); autoTitle(); }}>
						{#each getAvailableBlockTypes() as bt}
							<option value={bt}>{bt}</option>
						{/each}
					</select>
				</label>
					<label class="form-label">
						<span>Layer</span>
						<select bind:value={blockForm.layer}>
							{#each getAvailableLayers() as lyr}
								<option value={lyr}>{formatLayerLabel(lyr)}</option>
							{/each}
						</select>
					</label>
					<label class="form-label">
						<span>Title</span>
						<input type="text" bind:value={blockForm.title} placeholder="Block title"
							oninput={() => { titleWasAuto = false; }} />
					</label>
				</div>

			{#if blockForm.type === 'playlist'}
				<div style="margin-top: 0.5rem">
					<label class="form-label" style="flex: 1">
						<span>Playlist</span>
						<select bind:value={blockForm.playlist_name} onchange={autoTitle}>
							<option value="">-- Select a playlist --</option>
							{#each availablePlaylists as pl}
								<option value={pl.name}>{pl.name} ({pl.entry_count} files, {fmtDuration(pl.total_duration)})</option>
							{/each}
						</select>
					</label>
					{#if availablePlaylists.length === 0}
						<p class="text-muted" style="font-size: 0.75rem; margin-top: 0.25rem">No saved playlists. Create one in Content &gt; Playlists.</p>
					{/if}
				</div>
			{:else if blockForm.type === 'file'}
				<div style="margin-top: 0.5rem">
					<label class="form-label" style="flex: 1">
						<span>File</span>
						{#if videoFiles.length > 0}
							<select bind:value={blockForm.file} onchange={autoTitle}>
								<option value="">-- Select a file --</option>
								{#each videoFiles as f}
									<option value={f.filename}>{f.filename} ({fmtDuration(f.duration)})</option>
								{/each}
							</select>
						{:else}
							<span class="text-muted" style="font-size: 0.75rem">No media files. Upload in Content &gt; Library.</span>
						{/if}
					</label>
				</div>
			{:else if blockForm.type === 'image'}
				<div style="margin-top: 0.5rem">
					<label class="form-label" style="flex: 1">
						<span>Image</span>
						{#if imageFiles.length > 0}
							<select bind:value={blockForm.file} onchange={autoTitle}>
								<option value="">-- Select an image --</option>
								{#each imageFiles as f}
									<option value={f.filename}>{f.filename}</option>
								{/each}
							</select>
						{:else}
							<span class="text-muted" style="font-size: 0.75rem">No image files. Upload in Content &gt; Library.</span>
						{/if}
					</label>
				</div>
			{:else if blockForm.type === 'redirect'}
				<div class="form-grid" style="margin-top: 0.5rem">
					<label class="form-label">
						<span>URL</span>
						<input type="text" bind:value={blockForm.url} placeholder="https://example.com/stream.m3u8" />
					</label>
				</div>
		{:else}
				{@const pluginName = getBlockTypePlugin(blockForm.type)}
				{#if pluginName}
					<div class="form-grid" style="margin-top: 0.5rem">
						<label class="form-label" style="flex: 1">
							<span>Preset</span>
							{#if blockPresetsLoading}
								<span class="text-muted" style="font-size: 0.75rem">Loading...</span>
							{:else if blockPresets.length > 0}
								<select bind:value={blockForm.preset} onchange={autoTitle}>
									<option value="">-- Select preset --</option>
									{#each blockPresets as p}
										<option value={p.name}>{p.name}{p.description ? ` — ${p.description}` : ''}</option>
									{/each}
								</select>
							{:else}
								<span class="text-muted" style="font-size: 0.75rem">No presets. Configure in Plugins.</span>
							{/if}
						</label>
					</div>
				{/if}
			{/if}

				<div class="form-actions">
					<button class="btn-primary btn-sm" onclick={saveBlock}
						disabled={!blockForm.start || !blockForm.end || !blockForm.title}>
						{editingBlockIdx !== null ? 'Update' : 'Add'}
					</button>
					<button class="btn-surface btn-sm" onclick={cancelBlockForm}>Cancel</button>
				</div>
			</div>
		{:else}
			<button class="btn-surface btn-sm" onclick={openAddBlock} style="margin-top: 0.5rem">+ Add Block</button>
		{/if}

		<!-- Save / delete -->
		<div class="form-actions" style="margin-top: 1rem; padding-top: 0.75rem; border-top: 1px solid #1a1a2a">
		<button class="btn-primary btn-sm" onclick={saveProgram}
			disabled={progSaving || !hasDrafts()}>
			{progSaving ? 'Saving...' : hasDrafts() ? 'Save All (' + Object.keys(draftPrograms).length + ' days)' : 'Saved'}
		</button>
			{#if selectedBlocks().length > 0}
				<button class="btn-danger btn-sm" onclick={handleDeleteProgram} disabled={progSaving}>Delete Program</button>
			{/if}
		</div>
	</div>

<style>
	/* ── Loop warning ── */
	.loop-warning {
		background: rgba(251, 191, 36, 0.08);
		border: 1px solid rgba(251, 191, 36, 0.25);
		color: #fbbf24;
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		margin-bottom: 1rem;
	}

	/* ── Week navigation ── */
	.week-nav {
		display: flex; align-items: center; gap: 0.5rem;
		margin-bottom: 0.75rem; flex-wrap: wrap;
	}
	.zoom-bar {
		display: flex; align-items: center; gap: 2px; padding: 0.35rem 0;
		justify-content: flex-end;
	}
	.zoom-btn {
		padding: 0.15rem 0.5rem; font-size: 0.65rem;
		background: #1a1a2e; border: 1px solid #2a2a3a; color: #888;
		border-radius: 3px; cursor: pointer; white-space: nowrap;
	}
	.zoom-btn:hover { background: #2a2a3a; color: #ccc; }
	.zoom-btn-active { background: #6366f1; color: #fff; border-color: #6366f1; }
	.zoom-fine { display: flex; gap: 1px; margin-left: 0.25rem; }

	.draft-indicator {
		font-size: 0.7rem;
		color: #fbbf24;
		background: rgba(251, 191, 36, 0.1);
		border: 1px solid rgba(251, 191, 36, 0.25);
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
	}
	.tz-label {
		font-size: 0.7rem;
		color: #8888a0;
		font-family: monospace;
		margin-left: auto;
		background: #141420;
		border: 1px solid #1a1a2a;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
	}
	.week-date-picker {
		font-size: 0.7rem;
		padding: 0.15rem 0.3rem;
		background: #141420;
		border: 1px solid #1a1a2a;
		border-radius: 4px;
		color: #8888a0;
		font-family: monospace;
	}

	/* ── Week scroll container ── */
	.week-scroll {
		max-height: 420px;
		overflow-y: auto;
		border: 1px solid #1a1a2a;
		border-radius: 6px;
		margin-bottom: 1rem;
		user-select: none;
	}
	.week-scroll::-webkit-scrollbar { width: 6px; }
	.week-scroll::-webkit-scrollbar-track { background: #0c0c18; }
	.week-scroll::-webkit-scrollbar-thumb { background: #2a2a3a; border-radius: 3px; }

	/* ── Week grid (vertical calendar) ── */
	.week-grid {
		display: flex;
		background: #0c0c18;
		position: relative;
	}

	/* Hour gutter (left labels) */
	.week-gutter {
		flex-shrink: 0;
		width: 44px;
		border-right: 1px solid #1a1a2a;
		position: sticky;
		left: 0;
		z-index: 5;
		background: #0c0c18;
	}
	.week-gutter-header {
		height: 36px;
		border-bottom: 1px solid #1a1a2a;
		position: sticky;
		top: 0;
		background: #0c0c18;
		z-index: 6;
	}
	.week-gutter-body {
		position: relative;
		overflow: visible;
	}
	.hour-label {
		position: absolute;
		right: 6px;
		font-size: 0.6rem;
		color: #5a5a70;
		font-family: monospace;
		line-height: 1;
	}

	/* Day columns */
	.week-col {
		flex: 1;
		min-width: 0;
		border-right: 1px solid #141420;
	}
	.week-col:last-child { border-right: none; }
	.week-col-selected { background: rgba(99, 102, 241, 0.04); }

	.week-col-header {
		height: 36px;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1px;
		border-bottom: 1px solid #1a1a2a;
		cursor: pointer;
		position: sticky;
		top: 0;
		background: #0c0c18;
		z-index: 5;
	}
	.week-col-header-today {
		border-bottom: 2px solid #818cf8;
	}
	.col-weekday {
		font-size: 0.55rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #5a5a70;
	}
	.col-date {
		font-size: 0.7rem;
		font-weight: 600;
		color: #c0c0d0;
	}
	.col-date-today { color: #818cf8; }
	.col-dot {
		width: 5px; height: 5px; border-radius: 50%; background: #10b981;
		position: absolute; bottom: 4px; right: 4px;
	}

	.week-col-body {
		position: relative;
		cursor: crosshair;
		overflow: hidden;
	}

	/* Hour grid lines */
	.hour-line {
		position: absolute;
		left: 0; right: 0;
		height: 1px;
		background: #141420;
	}

	/* Program blocks in the week view */
	.week-block {
		position: absolute;
		left: 2px;
		right: 2px;
		border-radius: 3px;
		padding: 2px 4px;
		overflow: hidden;
		cursor: pointer;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 1px;
		transition: filter 0.1s;
		border-left: 3px solid rgba(255,255,255,0.15);
	}
	.week-block:hover { filter: brightness(1.2); }
	.week-block-selected {
		outline: 2px solid #fff;
		outline-offset: -1px;
		z-index: 3;
	}
	.week-block-dragging {
		opacity: 0.85;
		z-index: 10;
	}

	/* Resize handles at top/bottom edges */
	.block-resize-handle {
		position: absolute;
		left: 0; right: 0;
		height: 6px;
		cursor: ns-resize;
		z-index: 5;
	}
	.block-resize-top { top: 0; }
	.block-resize-bottom { bottom: 0; }

	/* Drag preview (create) */
	.drag-preview {
		position: absolute;
		left: 2px; right: 2px;
		background: rgba(99, 102, 241, 0.25);
		border: 1px dashed rgba(99, 102, 241, 0.6);
		border-radius: 3px;
		z-index: 8;
		pointer-events: none;
	}
	.week-block-time {
		font-size: 0.55rem;
		font-weight: 600;
		color: rgba(255,255,255,0.8);
		line-height: 1.1;
	}
	.week-block-title {
		font-size: 0.6rem;
		color: #fff;
		line-height: 1.2;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.week-block-layer {
		font-size: 0.45rem;
		color: rgba(255,255,255,0.4);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	/* Loop boundary lines inside blocks */
	.block-loop-line {
		position: absolute;
		left: 3px; right: 3px;
		height: 1px;
		background: rgba(255,255,255,0.25);
		pointer-events: none;
		z-index: 1;
	}
	.block-loop-cut {
		position: absolute;
		left: 3px; right: 3px;
		height: 1px;
		background: rgba(239, 68, 68, 0.6);
		pointer-events: none;
		z-index: 1;
		border-top: 1px dashed rgba(239, 68, 68, 0.8);
	}
	.btn-loop-off {
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	.block-unfilled {
		position: absolute;
		left: 0; right: 0;
		background: repeating-linear-gradient(
			-45deg,
			transparent,
			transparent 3px,
			rgba(239, 68, 68, 0.2) 3px,
			rgba(239, 68, 68, 0.2) 6px
		);
		border-top: 1px dashed rgba(239, 68, 68, 0.5);
		pointer-events: none;
		z-index: 1;
	}

	/* Now line */
	.week-now {
		position: absolute;
		left: 0; right: 0;
		height: 2px;
		background: #ef4444;
		z-index: 4;
		pointer-events: none;
	}
	.week-now::before {
		content: '';
		position: absolute;
		left: -3px;
		top: -3px;
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ef4444;
	}

	/* ── Day detail panel ── */
	.day-detail {
		background: #141420;
		border: 1px solid #1a1a2a;
		border-radius: 8px;
		padding: 1rem;
	}
	.day-detail-header {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.75rem;
	}
	.day-detail-header h3 {
		margin-bottom: 0;
		font-family: monospace;
	}

	.row-selected { background: #1a1a30 !important; }

	/* ── Responsive ── */
	@media (max-width: 768px) {
		.week-gutter { width: 32px; }
		.hour-label { font-size: 0.5rem; right: 2px; }
		.week-col-header { height: 30px; }
		.col-weekday { font-size: 0.45rem; }
		.col-date { font-size: 0.55rem; }
		.week-block-time { font-size: 0.45rem; }
		.week-block-title { font-size: 0.45rem; }
		.week-scroll { max-height: 320px; }
	}
</style>
