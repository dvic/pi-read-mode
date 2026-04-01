import test from 'node:test';
import assert from 'node:assert/strict';

import { applyComposerEdit, getVisibleComposerLines } from '../composer.ts';

test('newline inserts at cursor instead of submitting', () => {
	const result = applyComposerEdit(
		{ text: 'hello world', cursor: 5 },
		{ type: 'newline' },
	);

	assert.deepEqual(result, {
		state: { text: 'hello\n world', cursor: 6 },
		submittedText: null,
	});
});

test('submit preserves multiline text', () => {
	const result = applyComposerEdit(
		{ text: 'line 1\nline 2', cursor: 13 },
		{ type: 'submit' },
	);

	assert.deepEqual(result, {
		state: { text: 'line 1\nline 2', cursor: 13 },
		submittedText: 'line 1\nline 2',
	});
});

test('composer view keeps the cursor line visible', () => {
	const view = getVisibleComposerLines('one\ntwo\nthree\nfour', 18, 2);

	assert.deepEqual(view, {
		lines: ['three', 'four'],
		cursorLine: 1,
		cursorColumn: 4,
		hasLinesAbove: true,
		hasLinesBelow: false,
	});
});
