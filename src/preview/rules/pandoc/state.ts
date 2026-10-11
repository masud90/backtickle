/** Reads of the per-line arrays of the block state (0 for a line that does not exist). */
import type { StateBlock } from 'markdown-it';

export const bMark = (state: StateBlock, line: number): number => state.bMarks[line] ?? 0;
export const eMark = (state: StateBlock, line: number): number => state.eMarks[line] ?? 0;
export const tShift = (state: StateBlock, line: number): number => state.tShift[line] ?? 0;
export const sCount = (state: StateBlock, line: number): number => state.sCount[line] ?? 0;
export const bsCount = (state: StateBlock, line: number): number => state.bsCount[line] ?? 0;
