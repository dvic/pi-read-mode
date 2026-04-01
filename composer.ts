interface ComposerState {
	text: string;
	cursor: number;
}

type ComposerEvent =
	| { type: "insert"; text: string }
	| { type: "newline" }
	| { type: "backspace" }
	| { type: "delete" }
	| { type: "left" }
	| { type: "right" }
	| { type: "moveToStart" }
	| { type: "moveToEnd" }
	| { type: "deleteToStart" }
	| { type: "deleteToEnd" }
	| { type: "deleteWordBackward" }
	| { type: "submit" };

interface ComposerResult {
	state: ComposerState;
	submittedText: string | null;
}

interface VisibleComposerLines {
	lines: string[];
	cursorLine: number;
	cursorColumn: number;
	hasLinesAbove: boolean;
	hasLinesBelow: boolean;
}

export function applyComposerEdit(state: ComposerState, event: ComposerEvent): ComposerResult {
	switch (event.type) {
		case "insert":
			return {
				state: insertText(state, event.text),
				submittedText: null,
			};
		case "newline":
			return {
				state: insertText(state, "\n"),
				submittedText: null,
			};
		case "backspace":
			if (state.cursor === 0) return { state, submittedText: null };
			return {
				state: {
					text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
					cursor: state.cursor - 1,
				},
				submittedText: null,
			};
		case "delete":
			if (state.cursor >= state.text.length) return { state, submittedText: null };
			return {
				state: {
					text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1),
					cursor: state.cursor,
				},
				submittedText: null,
			};
		case "left":
			return {
				state: { text: state.text, cursor: Math.max(0, state.cursor - 1) },
				submittedText: null,
			};
		case "right":
			return {
				state: { text: state.text, cursor: Math.min(state.text.length, state.cursor + 1) },
				submittedText: null,
			};
		case "moveToStart":
			return { state: { text: state.text, cursor: 0 }, submittedText: null };
		case "moveToEnd":
			return { state: { text: state.text, cursor: state.text.length }, submittedText: null };
		case "deleteToStart":
			return {
				state: { text: state.text.slice(state.cursor), cursor: 0 },
				submittedText: null,
			};
		case "deleteToEnd":
			return {
				state: { text: state.text.slice(0, state.cursor), cursor: state.cursor },
				submittedText: null,
			};
		case "deleteWordBackward":
			return {
				state: deleteWordBackward(state),
				submittedText: null,
			};
		case "submit":
			return {
				state,
				submittedText: state.text.trim() ? state.text : null,
			};
	}
}

export function getVisibleComposerLines(text: string, cursor: number, maxLines = 3): VisibleComposerLines {
	const rawLines = text.split("\n");
	const beforeCursor = text.slice(0, cursor);
	const cursorLine = beforeCursor.split("\n").length - 1;
	const cursorColumn = beforeCursor.length - (beforeCursor.lastIndexOf("\n") + 1);
	const start = Math.max(0, cursorLine - maxLines + 1);
	const lines = rawLines.slice(start, start + maxLines);

	return {
		lines,
		cursorLine: cursorLine - start,
		cursorColumn,
		hasLinesAbove: start > 0,
		hasLinesBelow: start + lines.length < rawLines.length,
	};
}

function insertText(state: ComposerState, text: string): ComposerState {
	return {
		text: state.text.slice(0, state.cursor) + text + state.text.slice(state.cursor),
		cursor: state.cursor + text.length,
	};
}

function deleteWordBackward(state: ComposerState): ComposerState {
	const before = state.text.slice(0, state.cursor);
	let end = before.length;
	while (end > 0 && before[end - 1] === " ") end--;
	while (end > 0 && before[end - 1] !== " ") end--;
	return {
		text: before.slice(0, end) + state.text.slice(state.cursor),
		cursor: end,
	};
}
