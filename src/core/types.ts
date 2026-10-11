/** A single extracted value. Offsets are absolute UTF-16 code-unit offsets, end exclusive. */
export type Match = {
  line: number; // 1-based
  start: number;
  end: number;
  text: string;
  type: string;
  groups?: Record<string, string>;
  alt?: string[];
  meta?: Record<string, string>;
};

export type ParamValue = number | boolean | string | string[];
export type Params = Record<string, ParamValue>;

export type ParamDef =
  | { key: string; label: string; type: 'number'; default: number; min?: number; max?: number; help?: string }
  | { key: string; label: string; type: 'boolean'; default: boolean; help?: string }
  | { key: string; label: string; type: 'strings'; default: string[]; help?: string };

export type Refined = {
  text: string;
  /** Offset of `text` inside the regex match (m[0]). */
  offset: number;
  type?: string;
  meta?: Record<string, string>;
};

export interface Detector {
  id: string;
  label: string;
  priority: number;
  defaultEnabled: boolean;
  params: ParamDef[];
  /** Pattern documentation for the README / UI (human readable). */
  describe: string;
  build(params: Params): RegExp;
  validate?(m: RegExpExecArray, params: Params): boolean;
  refine?(m: RegExpExecArray, params: Params): Refined | null;
}

export type CaptureMode = 'full' | 'group1' | 'named';

export interface CustomRegex {
  id: string;
  label: string;
  pattern: string;
  flags: string; // subset of "imsu"
  captureMode: CaptureMode;
}

export interface DetectorSetting {
  id: string;
  enabled: boolean;
  params: Params;
}

export interface ExtractConfig {
  detectors: DetectorSetting[];
  custom: CustomRegex[];
  /** Run on the whole input instead of line by line. */
  acrossText: boolean;
}

export interface CustomError {
  index: number;
  id: string;
  label: string;
  message: string;
}

export interface RunResult {
  matches: Match[];
  lineCount: number;
  truncated: boolean;
  errors: CustomError[];
  /** Set when the input exceeded the size limit and nothing was run. */
  inputTooLarge: boolean;
  elapsedMs: number;
}

export interface Candidate {
  start: number;
  end: number;
  text: string;
  type: string;
  priority: number;
  line: number;
  groups?: Record<string, string>;
  meta?: Record<string, string>;
}

export const MAX_INPUT_CHARS = 5 * 1024 * 1024;
export const MAX_MATCHES = 100_000;
