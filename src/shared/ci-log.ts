/**
 * The readable end of a GitHub Actions job's log, for the Focus panel. A
 * raw log puts a timestamp on every line, colours with ANSI codes, redraws
 * progress bars with \r and ends with cleanup steps after the failure, so
 * the part worth reading is the lines up to the last error.
 */

/** Lines shown at most. */
export const CI_LOG_TAIL_LINES = 200;
/** Characters shown at most: a minified bundle can be one long line. */
export const CI_LOG_TAIL_CHARS = 64 * 1024;
/** Lines kept after the last error: the end of its step, not the cleanup after. */
const LINES_AFTER_ERROR = 5;

// eslint-disable-next-line no-control-regex -- matching terminal escapes is the point
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex -- control characters left once escapes are gone
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;
/** Characters that reorder text on screen, so a line can't read as another. */
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;
/** The timestamp GitHub puts on every line. */
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z ?/;
const ERROR_MARK = '##[error]';

/** One raw log line as it shows: its last \r redraw, without escapes,
 *  control characters or timestamp. */
function cleanLine(raw: string): string {
  const draws = raw.replace(/\r$/, '').split('\r');
  return (draws[draws.length - 1] ?? '')
    .replace(ANSI, '')
    .replace(CONTROL, '')
    .replace(BIDI, '')
    .replace(TIMESTAMP, '');
}

export interface CiLogTail {
  text: string;
  /** Lines of the cleaned log before and after the part shown. */
  omittedBefore: number;
  omittedAfter: number;
  /** 1-based line in `text` of the last error, when there is one. */
  errorLine?: number;
}

/** The last lines of a job's log, ending a few lines after its last error. */
export function tailCiLog(raw: string): CiLogTail {
  const lines = raw.replace(/^\uFEFF/, '').split('\n').map(cleanLine)
    .filter((line) => line !== '##[endgroup]')
    .map((line) => line.replace(/^##\[group\]/, ''));
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  let end = lines.length;
  const lastError = lines.findLastIndex((line) => line.startsWith(ERROR_MARK));
  if (lastError >= 0) end = Math.min(end, lastError + 1 + LINES_AFTER_ERROR);
  let start = Math.max(0, end - CI_LOG_TAIL_LINES);
  // Within the character cap too, dropping whole lines from the start; a
  // single line longer than the cap keeps its end.
  let size = lines.slice(start, end).reduce((n, line) => n + line.length + 1, 0);
  while (size > CI_LOG_TAIL_CHARS && end - start > 1) {
    size -= lines[start].length + 1;
    start++;
  }
  const shown = lines.slice(start, end);
  if (shown.length === 1 && shown[0].length > CI_LOG_TAIL_CHARS) shown[0] = shown[0].slice(-CI_LOG_TAIL_CHARS);
  return {
    text: shown.join('\n'),
    omittedBefore: start,
    omittedAfter: lines.length - end,
    ...(lastError >= start && lastError < end ? { errorLine: lastError - start + 1 } : {}),
  };
}
