export interface Line {
  /** 1-based */
  number: number;
  /** Absolute offset of the first code unit of the line. */
  start: number;
  text: string;
}

/** Split on \r\n | \n | \r, keeping absolute offsets. */
export function splitLines(input: string): Line[] {
  const lines: Line[] = [];
  const re = /\r\n|\n|\r/g;
  let last = 0;
  let n = 1;
  for (let m = re.exec(input); m !== null; m = re.exec(input)) {
    lines.push({ number: n++, start: last, text: input.slice(last, m.index) });
    last = m.index + m[0].length;
  }
  lines.push({ number: n, start: last, text: input.slice(last) });
  return lines;
}

/** Number of lines for output purposes: a single trailing terminator does not add a line. */
export function countLines(lines: Line[], input: string): number {
  if (input === '') return 0;
  const last = lines[lines.length - 1];
  return last.text === '' && lines.length > 1 ? lines.length - 1 : lines.length;
}

/** Line number (1-based) for an absolute offset, via binary search over line starts. */
export function lineAt(lines: Line[], offset: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid].start <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo].number;
}
