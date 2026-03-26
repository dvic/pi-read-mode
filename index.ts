/**
 * Read Mode extension - scroll through conversation history while composing.
 *
 * Alt+R or /read opens a fullscreen viewer that captures pi's already-rendered
 * component output and displays it in a scrollable viewport with a text input
 * pinned at the bottom for composing a follow-up.
 *
 * Uses a fullscreen hack: after ctx.ui.custom() mounts our component, we
 * reach into tui.children (public on Container), strip everything except our
 * container, and call requestRender(true). This keeps total rendered output
 * within one screen, preventing the scroll-to-bottom problem. On exit we
 * restore and re-render.
 *
 * Content is captured by calling render(width) on the saved children —
 * producing the exact same ANSI-styled lines pi normally displays.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	type Component,
	CURSOR_MARKER,
	type Focusable,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

interface ReadModeResult { text: string }

// ── Constants ───────────────────────────────────────────────────────────────

const HEADER_LINES = 4;
const FOOTER_LINES = 5;
const SCROLL_STEP_MOUSE = 3;

// Pre-compiled regexes for mouse sequence parsing
const SGR_MOUSE_RE = /^\x1b\[<(\d+);\d+;\d+[Mm]$/;
// Bitmask: keep button ID (bits 0-1) and wheel direction (bits 6-7), ignore modifier bits (2-5)
const MOUSE_BUTTON_MASK = 0xc3;
const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

// ── Component ───────────────────────────────────────────────────────────────

class ReadModeComponent implements Component, Focusable {
	focused = false;
	private contentLines: string[] = [];
	private scrollOffset = 0;
	private inputText = "";
	private inputCursor = 0;
	private wrappedDone: (result: ReadModeResult | null) => void;
	private tui: any;
	private theme: any;
	private cachedRenderWidth = 0;
	private capturedChildren: Component[] = [];
	private savedTuiChildren: Component[] = [];
	private fullscreenActive = false;
	private needsFullscreenSetup = true;
	private startAtBottom = false;

	constructor(tui: any, theme: any, externalDone: (r: ReadModeResult | null) => void) {
		this.tui = tui;
		this.theme = theme;

		this.wrappedDone = (result: ReadModeResult | null) => {
			try { this.exitFullscreen(); } catch { /* ensure done is always called */ }
			externalDone(result);
		};
	}

	// ── Fullscreen lifecycle ──────────────────────────────────────────────

	private enterFullscreen(): void {
		if (this.fullscreenActive) return;

		// Find the tui child (editorContainer) that holds this component
		let myContainer: any = null;
		for (const child of this.tui.children) {
			if (child?.children?.includes?.(this)) {
				myContainer = child;
				break;
			}
		}
		if (!myContainer) return;

		// Save all children and capture references for rendering
		this.savedTuiChildren = [...this.tui.children];
		this.capturedChildren = this.savedTuiChildren.filter((c: any) => c !== myContainer);

		// Replace tui children with only our container
		this.tui.children.length = 0;
		this.tui.children.push(myContainer);
		this.fullscreenActive = true;
		this.startAtBottom = true;
		// Force re-render now that we have captured children
		this.cachedRenderWidth = 0;

		// Enable mouse wheel reporting for trackpad scrolling
		this.tui.terminal.write("\x1b[?1000h\x1b[?1006h");
		this.tui.requestRender(true);
	}

	private exitFullscreen(): void {
		// Disable mouse reporting even on partial setup
		this.tui.terminal.write("\x1b[?1000l\x1b[?1006l");

		if (this.fullscreenActive && this.savedTuiChildren.length > 0) {
			this.tui.children.length = 0;
			this.tui.children.push(...this.savedTuiChildren);
			this.savedTuiChildren = [];
			this.capturedChildren = [];
			this.fullscreenActive = false;
		}

		this.tui.requestRender(true);
	}

	// ── Scroll helpers ────────────────────────────────────────────────────

	private vh(): number {
		return Math.max(1, this.tui.terminal.rows - HEADER_LINES - FOOTER_LINES);
	}

	private maxScroll(): number {
		return Math.max(0, this.contentLines.length - this.vh());
	}

	private scrollBy(delta: number): void {
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll(), this.scrollOffset + delta));
	}

	// ── Mouse parsing ─────────────────────────────────────────────────────

	/** Returns scroll lines (negative=up, positive=down) or 0 if not a wheel event. */
	private parseMouseScroll(data: string): number {
		// SGR extended format: \x1b[<button;col;rowM
		const sgr = data.match(SGR_MOUSE_RE);
		if (sgr) {
			const base = parseInt(sgr[1], 10) & MOUSE_BUTTON_MASK;
			if (base === WHEEL_UP) return -SCROLL_STEP_MOUSE;
			if (base === WHEEL_DOWN) return SCROLL_STEP_MOUSE;
		}
		// Legacy X10 format: \x1b[M + 3 raw bytes
		if (data.length === 6 && data.startsWith("\x1b[M")) {
			const base = (data.charCodeAt(3) - 32) & MOUSE_BUTTON_MASK;
			if (base === WHEEL_UP) return -SCROLL_STEP_MOUSE;
			if (base === WHEEL_DOWN) return SCROLL_STEP_MOUSE;
		}
		return 0;
	}

	// ── Input handling ────────────────────────────────────────────────────

	private insertAtCursor(text: string): void {
		this.inputText = this.inputText.slice(0, this.inputCursor) + text + this.inputText.slice(this.inputCursor);
		this.inputCursor += text.length;
	}

	handleInput(data: string): void {
		// Mouse wheel (trackpad)
		const wheelDelta = this.parseMouseScroll(data);
		if (wheelDelta !== 0) { this.scrollBy(wheelDelta); return; }

		// Navigation
		if (matchesKey(data, "escape"))   { this.wrappedDone(null); return; }
		if (matchesKey(data, "enter"))    { const t = this.inputText.trim(); if (t) this.wrappedDone({ text: t }); return; }
		if (matchesKey(data, "pageUp"))   { this.scrollBy(-(this.vh() - 2)); return; }
		if (matchesKey(data, "pageDown")) { this.scrollBy(this.vh() - 2); return; }
		if (matchesKey(data, "up"))       { this.scrollBy(-1); return; }
		if (matchesKey(data, "down"))     { this.scrollBy(1); return; }
		if (matchesKey(data, "home"))     { this.scrollOffset = 0; return; }
		if (matchesKey(data, "end"))      { this.scrollOffset = this.maxScroll(); return; }

		// Input line editing
		if (matchesKey(data, "backspace")) {
			if (this.inputCursor > 0) {
				this.inputText = this.inputText.slice(0, this.inputCursor - 1) + this.inputText.slice(this.inputCursor);
				this.inputCursor--;
			}
			return;
		}
		if (matchesKey(data, "delete")) {
			if (this.inputCursor < this.inputText.length) {
				this.inputText = this.inputText.slice(0, this.inputCursor) + this.inputText.slice(this.inputCursor + 1);
			}
			return;
		}
		if (matchesKey(data, "left"))   { if (this.inputCursor > 0) this.inputCursor--; return; }
		if (matchesKey(data, "right"))  { if (this.inputCursor < this.inputText.length) this.inputCursor++; return; }
		if (matchesKey(data, "ctrl+a")) { this.inputCursor = 0; return; }
		if (matchesKey(data, "ctrl+e")) { this.inputCursor = this.inputText.length; return; }
		if (matchesKey(data, "ctrl+u")) { this.inputText = this.inputText.slice(this.inputCursor); this.inputCursor = 0; return; }
		if (matchesKey(data, "ctrl+k")) { this.inputText = this.inputText.slice(0, this.inputCursor); return; }
		if (matchesKey(data, "ctrl+w") || matchesKey(data, "alt+backspace")) {
			const before = this.inputText.slice(0, this.inputCursor);
			let end = before.length;
			while (end > 0 && before[end - 1] === " ") end--;
			while (end > 0 && before[end - 1] !== " ") end--;
			this.inputText = before.slice(0, end) + this.inputText.slice(this.inputCursor);
			this.inputCursor = end;
			return;
		}

		// Bracketed paste: \x1b[200~<text>\x1b[201~
		if (data.startsWith("\x1b[200~")) {
			const text = data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "");
			if (text) this.insertAtCursor(text);
			return;
		}

		// Printable character insertion (also handles plain paste without brackets)
		if (data.length >= 1 && data.charCodeAt(0) >= 32 && !data.startsWith("\x1b")) {
			this.insertAtCursor(data);
		}
	}

	// ── Rendering ─────────────────────────────────────────────────────────

	private renderContent(width: number): string[] {
		if (this.cachedRenderWidth !== width) {
			const lines: string[] = [];
			for (const child of this.capturedChildren) {
				lines.push(...child.render(width));
			}
			// Strip CURSOR_MARKER so it doesn't confuse TUI cursor positioning
			this.contentLines = lines.map(l => l.replaceAll(CURSOR_MARKER, ""));
			this.cachedRenderWidth = width;
		}
		return this.contentLines;
	}

	private renderHr(width: number, text?: string): string {
		if (!text) return this.theme.fg("border", "─".repeat(width));
		const label = ` ${text} `;
		const lw = visibleWidth(label);
		const rem = Math.max(0, width - lw);
		const left = Math.min(3, rem);
		return this.theme.fg("border", "─".repeat(left))
			+ this.theme.fg("accent", label)
			+ this.theme.fg("border", "─".repeat(rem - left));
	}

	render(width: number): string[] {
		if (this.needsFullscreenSetup) {
			this.needsFullscreenSetup = false;
			process.nextTick(() => this.enterFullscreen());
		}

		const th = this.theme;
		const termRows = this.tui.terminal.rows;
		const all = this.renderContent(width);
		const vh = this.vh();
		const total = all.length;
		const maxS = Math.max(0, total - vh);
		// On first fullscreen render, jump to bottom so most recent content is visible
		if (this.startAtBottom) {
			this.startAtBottom = false;
			this.scrollOffset = maxS;
		}
		if (this.scrollOffset > maxS) this.scrollOffset = maxS;

		const lines: string[] = [];

		// Header (4 lines)
		lines.push(this.renderHr(width, "Read Mode"));
		lines.push(truncateToWidth(total > vh
			? th.fg("dim", `  lines ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + vh, total)} of ${total}`)
			: th.fg("dim", `  ${total} lines`), width));
		lines.push(this.scrollOffset > 0
			? truncateToWidth(th.fg("dim", `  ↑ ${this.scrollOffset} more above`), width)
			: "");
		lines.push(this.renderHr(width));

		// Content area (vh lines)
		const visible = all.slice(this.scrollOffset, this.scrollOffset + vh);
		for (const line of visible) lines.push(truncateToWidth(line, width));
		// Pad remaining viewport
		for (let i = visible.length; i < vh; i++) lines.push("");

		// Footer (5 lines)
		const below = total - (this.scrollOffset + vh);
		lines.push(below > 0
			? truncateToWidth(th.fg("dim", `  ↓ ${below} more below`), width)
			: "");
		lines.push(this.renderHr(width));

		// Input line with cursor
		const before = this.inputText.slice(0, this.inputCursor);
		const after = this.inputText.slice(this.inputCursor);
		const cursorChar = after.length > 0 ? after[0] : " ";
		const rest = after.length > 0 ? after.slice(1) : "";
		const marker = this.focused ? CURSOR_MARKER : "";
		lines.push(truncateToWidth(
			th.fg("accent", "> ") + `${before}${marker}\x1b[7m${cursorChar}\x1b[27m${rest}`,
			width,
		));
		lines.push(this.renderHr(width));
		lines.push(truncateToWidth(
			th.fg("dim", "  ↑↓ scroll • PgUp/PgDn page • Home/End • Enter send • Esc cancel"),
			width,
		));

		// Ensure exactly termRows lines (insert padding before the last line)
		if (lines.length < termRows) {
			const pad = termRows - lines.length;
			const lastLine = lines.pop()!;
			for (let i = 0; i < pad; i++) lines.push("");
			lines.push(lastLine);
		} else if (lines.length > termRows) {
			lines.length = termRows;
		}
		return lines;
	}

	invalidate(): void { this.cachedRenderWidth = 0; }
	dispose(): void { try { this.exitFullscreen(); } catch { /* best-effort cleanup */ } }
}

// ── Entry points ────────────────────────────────────────────────────────────

function openReadMode(pi: ExtensionAPI, ui: any): Promise<void> {
	return ui.custom(
		(tui: any, theme: any, _kb: any, done: (r: ReadModeResult | null) => void) => {
			return new ReadModeComponent(tui, theme, done);
		},
	).then((result: ReadModeResult | null) => {
		if (result?.text) pi.sendUserMessage(result.text);
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("read", {
		description: "Scroll through conversation history while composing a follow-up",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) { ctx.ui.notify("Read mode requires interactive mode", "error"); return; }
			if (!ctx.isIdle()) { ctx.ui.notify("Wait for the agent to finish", "warning"); return; }
			await openReadMode(pi, ctx.ui);
		},
	});

	pi.registerShortcut("alt+r", {
		description: "Enter read mode",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			if (!ctx.isIdle()) { ctx.ui.notify("Wait for the agent to finish", "warning"); return; }
			await openReadMode(pi, ctx.ui);
		},
	});
}
