import { defaultConfig, defaultFormatOptions } from '../core';
import type { ExtractConfig, FormatOptions, RunResult } from '../core';

export const SAMPLE_INPUT = [
  'Circuit[0] : 01110101 -> [OPERATION] -> 10001010',
  "Circuit[0] : ('01101110', '10110100') -> [OPERATION] -> 11111110",
].join('\n');

export interface AppState {
  input: string;
  isSample: boolean;
  config: ExtractConfig;
  output: FormatOptions;
  result: RunResult | null;
  error: string | null;
  running: boolean;
  rememberSettings: boolean;
  rememberInput: boolean;
}

export function initialState(): AppState {
  return {
    input: SAMPLE_INPUT,
    isSample: true,
    config: defaultConfig(),
    output: defaultFormatOptions(),
    result: null,
    error: null,
    running: false,
    rememberSettings: true,
    rememberInput: false,
  };
}
