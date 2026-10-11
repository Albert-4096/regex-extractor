#!/usr/bin/env node
// CLI for regex-extractor: stdin (or files) -> extracted values, using the same src/core as the web UI.
// Build the core bundle first:  npm run build:cli
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
let core;
try {
  core = await import(join(here, '..', 'dist-cli', 'core.mjs'));
} catch {
  console.error('extract: core bundle not found. Run `npm run build:cli` first.');
  process.exit(2);
}
const { DETECTORS, defaultConfig, extract, formatOutput, defaultFormatOptions, MAX_INPUT_CHARS } = core;

const HELP = `Usage: extract [options] [file ...]      (reads stdin when no file is given)

Detectors
  -d, --detectors a,b,c     enable exactly these detectors, or "none" (default: the web UI defaults)
      --all                 enable every detector
      --list                list detector ids and parameters, then exit
  -p, --param id.key=value  detector parameter, repeatable (e.g. -p binary.minLength=16)
  -r, --regex PATTERN       add a custom regex, repeatable
      --flags imsu          flags for the previous --regex
      --capture MODE        full | group1 | named, for the previous --regex
      --across-text         match on the whole input instead of line by line

Output
  -f, --format FMT          perline | flat | json | jsonl | csv | table   (default: perline)
  -s, --sep STR             separator for perline (supports \\t \\n)       (default: ", ")
  -u, --unique              drop duplicate values
      --unique-scope S      global | line                                 (default: global)
  -k, --keep-empty          keep empty lines
  -t, --type a,b            keep only these types (hash matches hash:md5 ...)
      --quote Q             none | single | double
      --prefix STR / --suffix STR
  -h, --help
`;

function fail(msg) {
  console.error(`extract: ${msg}`);
  process.exit(2);
}

const argv = process.argv.slice(2);
const files = [];
const opts = defaultFormatOptions();
const config = defaultConfig();
let onlyDetectors = null;
let all = false;
const params = [];
const customs = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const val = () => {
    if (i + 1 >= argv.length) fail(`missing value for ${a}`);
    return argv[++i];
  };
  switch (a) {
    case '-h':
    case '--help':
      console.log(HELP);
      process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case '--list':
      for (const d of DETECTORS) {
        const ps = d.params.map((p) => `${p.key}=${JSON.stringify(p.default)}`).join(' ');
        console.log(`${d.id.padEnd(14)} ${d.defaultEnabled ? 'on ' : 'off'}  ${ps}`);
      }
      process.exit(0);
    // eslint-disable-next-line no-fallthrough
    case '-d':
    case '--detectors':
      onlyDetectors = val().split(',').map((s) => s.trim()).filter((s) => s && s !== 'none');
      break;
    case '--all':
      all = true;
      break;
    case '-p':
    case '--param': {
      const m = /^([\w-]+)\.(\w+)=(.*)$/.exec(val());
      if (!m) fail('--param expects id.key=value');
      params.push(m.slice(1));
      break;
    }
    case '-r':
    case '--regex':
      customs.push({ id: `cli${customs.length}`, label: `regex${customs.length + 1}`, pattern: val(), flags: '', captureMode: 'full' });
      break;
    case '--flags':
      if (!customs.length) fail('--flags must follow --regex');
      customs[customs.length - 1].flags = val();
      break;
    case '--capture':
      if (!customs.length) fail('--capture must follow --regex');
      customs[customs.length - 1].captureMode = val();
      break;
    case '--across-text':
      config.acrossText = true;
      break;
    case '-f':
    case '--format':
      opts.format = val();
      break;
    case '-s':
    case '--sep':
      opts.separator = val();
      break;
    case '-u':
    case '--unique':
      opts.unique = true;
      break;
    case '--unique-scope':
      opts.uniqueScope = val();
      break;
    case '-k':
    case '--keep-empty':
      opts.keepEmptyLines = true;
      break;
    case '-t':
    case '--type':
      opts.types = val().split(',').map((s) => s.trim()).filter(Boolean);
      break;
    case '--quote':
      opts.quote = val();
      break;
    case '--prefix':
      opts.prefix = val();
      break;
    case '--suffix':
      opts.suffix = val();
      break;
    default:
      if (a.startsWith('-') && a !== '-') fail(`unknown option ${a} (try --help)`);
      files.push(a);
  }
}

if (!['perline', 'flat', 'json', 'jsonl', 'csv', 'table'].includes(opts.format)) fail(`unknown format "${opts.format}"`);
const known = new Set(DETECTORS.map((d) => d.id));
for (const id of onlyDetectors ?? []) if (!known.has(id)) fail(`unknown detector "${id}" (see --list)`);
for (const d of config.detectors) {
  if (all) d.enabled = true;
  else if (onlyDetectors) d.enabled = onlyDetectors.includes(d.id);
}
for (const [id, key, raw] of params) {
  const d = config.detectors.find((x) => x.id === id);
  if (!d) fail(`unknown detector "${id}" in --param`);
  const def = DETECTORS.find((x) => x.id === id).params.find((p) => p.key === key);
  if (!def) fail(`detector "${id}" has no parameter "${key}"`);
  d.params[key] = def.type === 'number' ? Number(raw) : def.type === 'boolean' ? raw === 'true' : raw.split(',');
}
config.custom = customs;

const chunks = [];
if (files.length) for (const f of files) chunks.push(readFileSync(f, 'utf8'));
else chunks.push(readFileSync(0, 'utf8'));
const text = chunks.join('\n');
if (text.length > MAX_INPUT_CHARS) fail('input is larger than the 5 MB limit');

const res = extract(text, config);
for (const e of res.errors) console.error(`extract: ${e.label}: ${e.message}`);
if (res.truncated) console.error('extract: truncated at 100,000 matches');
const out = formatOutput(res.matches, res.lineCount, opts);
if (out !== '') process.stdout.write(out + '\n');
process.exit(res.errors.some((e) => e.index >= 0) ? 1 : 0);
