# regex-extractor

Paste text (logs, CTF output, dumps). Get the values in it, grouped per input line.

- **100% client-side.** No backend, no telemetry, no CDN. Static files only.
- **Three ways to say what to extract:** built-in detectors, your own regexes, or *teach by example*
  (select values in the text and the tool synthesizes candidate regexes).
- **Safe by construction:** all regex execution runs in a Web Worker with a 2 s timeout.
  A catastrophic pattern is killed and reported; the page never freezes.
- **Zero runtime dependencies.** Vanilla TypeScript + DOM. Dev dependencies: `typescript`, `vite`, `vitest`.

```
Circuit[0] : 01110101 -> [OPERATION] -> 10001010
Circuit[0] : ('01101110', '10110100') -> [OPERATION] -> 11111110
```

with only the Binary detector on, "Per line" output (separator `, `) is exactly:

```
01110101, 10001010
01101110, 10110100, 11111110
```

## Run, build, test

```sh
npm install
npm run dev          # Vite dev server (the CSP <meta> is stripped in dev so HMR works)
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # typecheck + static site in dist/
npm run build:cli    # bundles src/core for the CLI (dist-cli/core.mjs)
```

Node 20+ is enough.

## Self-hosting

The build output in `dist/` is plain static files. Serve it with anything. A Docker setup is included.

```sh
docker compose up -d --build        # http://127.0.0.1:8080  (change with PORT=… in .env)
```

- `Dockerfile`: multi-stage. Node builds the site, `nginxinc/nginx-unprivileged` serves it (port 8080, non-root).
- `nginx.conf`: CSP and security headers, long cache for hashed assets, `/healthz`.
- `docker-compose.yml`: read-only root filesystem, all capabilities dropped, `no-new-privileges`,
  port bound to `127.0.0.1` only.
- `docker-compose.edge.yml`: optional override that also joins an external network named `edge`
  (for use behind a reverse proxy that reaches the container by name, `regex-extractor:8080`).
  Create the network once (`docker network create edge`) and run
  `docker compose -f docker-compose.yml -f docker-compose.edge.yml up -d --build`,
  or set `COMPOSE_FILE=docker-compose.yml:docker-compose.edge.yml` in a local `.env`.

Content-Security-Policy (set both as a `<meta>` tag in `index.html` and as a header in `nginx.conf`):

```
default-src 'self'; script-src 'self'; style-src 'self'; worker-src 'self'; connect-src 'none'
```

The nginx header adds `base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`
(`frame-ancestors` cannot be set from a `<meta>` tag).

## Command line (stretch)

`bin/extract.mjs` reuses `src/core` through the bundle from `npm run build:cli`.

```sh
npm run build:cli
cat dump.txt | node bin/extract.mjs -d binary,hex -f flat -u
node bin/extract.mjs --list                                   # detectors and parameters
node bin/extract.mjs -d none -r '(?<a>[01]{8}) -> (?<b>[01]{8})' --capture named -f json < dump.txt
node bin/extract.mjs -d binary -p binary.minLength=16 -p binary.multipleOf=8 < dump.txt
```

Options: `-d/--detectors`, `--all`, `-p/--param id.key=value`, `-r/--regex` (+ `--flags`, `--capture`),
`--across-text`, `-f/--format`, `-s/--sep`, `-u/--unique`, `--unique-scope`, `-k/--keep-empty`,
`-t/--type`, `--quote`, `--prefix`, `--suffix`. Exit code 1 if a custom regex is invalid.

## How it works

```
src/core      pure TypeScript, no DOM, no Node APIs  (types, detectors, resolve, run, format, infer, snippets, settings)
src/worker    worker entry, request handler, RegexRunner (timeout wrapper)
src/ui        vanilla DOM app (never innerHTML), styles, panels
tests         vitest
bin           CLI
```

Pipeline: split into lines (`\r\n | \n | \r`) → run every enabled detector and custom regex on each line
(precompiled once per config, `matchAll` with the `g` flag) → drop zero-length matches →
resolve overlaps → list of `Match` with absolute UTF-16 offsets.

**Overlap resolution.** Candidates are sorted by (priority desc, length desc, start asc) and accepted greedily
unless they overlap an accepted one. A rejected candidate with *exactly* the same span is recorded in the winner's
`alt` (for example a bit string that is also a valid decimal integer).
Priority order, highest first:
`flag, jwt, url, email, uuid, mac, ipv4, ipv6, binary, hash, hex, base64, iso8601, decimal-float, decimal-int, quoted-string`.
Custom regexes outrank all built-ins; earlier custom entries outrank later ones.

## Detector reference

All detectors are listed in priority order. `N`/`M` are the min/max length parameters.
Boundaries use fixed-width lookarounds.

| # | id | default | pattern | parameters |
|---|----|---------|---------|------------|
| 1 | `flag` | on | `(?<!\w)(?:<prefix>\|…)\{[^}\s]{1,200}\}` | `prefixes` (strings, default `flag FLAG ctf CTF htb HTB picoCTF DUCTF ECSC [A-Za-z0-9_]{2,16}`) |
| 2 | `jwt` | on | `(?<![\w.-])[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*(?![\w-]\|\.[\w-])` + header must decode to JSON with `alg` | – |
| 3 | `url` | on | ``(?<!\w)(?:https?\|ftp\|wss?)://[^\s<>"'`]+`` + trailing `.,;:!?` and unbalanced `)]}` trimmed | – |
| 4 | `email` | on | `(?<![\w.%+-])[A-Za-z0-9._%+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?!\w)` | – |
| 5 | `uuid` | on | `(?<!\w)[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?!\w)` | – |
| 6 | `mac` | on | `(?<![\w:-])[0-9a-fA-F]{2}([:-])(?:[0-9a-fA-F]{2}\1){4}[0-9a-fA-F]{2}(?!\w\|[:-][0-9a-fA-F])` | – |
| 7 | `ipv4` | on | `(?<![\w.])O(?:\.O){3}(?!\w\|\.\d)`, `O = 25[0-5]\|2[0-4]\d\|1\d\d\|[1-9]?\d` | – |
| 8 | `ipv6` | on | `(?<![\w:.])[0-9a-fA-F:.]{2,}(?![\w:])` + hand-written validator (`::` compression, IPv4 tails) | – |
| 9 | `binary` | on | `(?<!\w)(?:0[bB])?[01]{N,M}(?!\w)` | `minLength` (8), `maxLength` (0 = none), `multipleOf` (1), `stripPrefix` (false) |
| 10 | `hash` | on | `(?<!\w)[0-9a-fA-F]{32\|40\|64\|128}(?!\w)` → `hash:md5`, `hash:sha1`, `hash:sha256`, `hash:sha512` | – |
| 11 | `hex` | on | `(?<!\w)(?:0[xX][0-9a-fA-F]{N,}\|[0-9a-fA-F]{N,})(?!\w)`; bare hex needs one `a-f` letter | `minLength` (8), `stripPrefix` (false) |
| 12 | `base64` | on | `(?<![A-Za-z0-9+/_-])[A-Za-z0-9+/_-]{N,}={0,2}(?![A-Za-z0-9+/_=-])` + padding and decode checks; `meta.decoded` preview | `minLength` (16) |
| 13 | `iso8601` | off | `(?<!\w)\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:[.,]\d+)?)?(?:Z\|[+-]\d{2}(?::?\d{2})?)?)?(?!\w)` + calendar/time validation | – |
| 14 | `decimal-float` | off | `(?<![\w.])[+-]?(?:\d+\.\d+\|\.\d+)(?:[eE][+-]?\d+)?(?!\w\|\.\d)` | – |
| 15 | `decimal-int` | off | `(?<![\w.])[+-]?\d+(?!\w\|\.\d)` | – |
| 16 | `quoted-string` | off | `(["'])((?:\\.\|(?!\1)[^\\\r\n])*)\1` → content without quotes | – |

Values are always strings: leading zeros are preserved, nothing is converted to a number.
The four noisy detectors are off by default (`decimal-int` would match the `0` in `Circuit[0]`).

## Custom regexes

Any number of entries: `{ label, pattern, flags (i m s u), capture mode }`.

- **Whole match**: the matched text.
- **Group 1**: only the first capture group (its exact offsets are used).
- **Named groups**: `text` is the whole match; each named group becomes a field in `groups`.

An invalid pattern shows the engine's error under that entry and never blocks the others.

## Teach by example

1. Select text in the input and press **Extract this** (positive) or **Not this** (negative).
   Or click a highlight: it cycles positive → negative → neutral (an "also matched" highlight goes to negative first).
   The Table output has a button per row for the same thing, so it works from the keyboard.
2. The tool shapes each positive example (runs of the narrowest class from the ladder
   `[01] \d [0-9a-f] [0-9A-F] [0-9a-fA-F] [a-z] [A-Z] [A-Za-z] [A-Za-z0-9] \w`, punctuation literal),
   merges the shapes and generates candidates:
   - **L0** exact literals joined by `|` (fallback only, never pre-selected)
   - **L1** shape with exact quantifiers, e.g. `[01]{8}`
   - **L2** same classes with `{min,max}`
   - **L3** widened `\w+` / `\S+`
3. Each level is tried with boundaries in this order: none, word-edge lookaround
   (`(?<![01\w])…(?![01\w])`), then a literal context prefix/suffix of up to 3 characters that is identical
   across **all** positive examples (as fixed-width `(?<=…)` / `(?=…)`, so patterns paste into Python `re` and `grep -P`).
4. A candidate is valid when, over the whole input, it matches every positive example with the exact same span
   and does not touch any negative example. The default pick is the lowest-level valid candidate that is not L0.
   The top 5 are shown with regex, flags, total matches and "also matched" counts.
5. **Adopt** copies a candidate into the custom regex list. **Copy as** gives JavaScript, Python
   (`re.findall` / `re.finditer`), `grep -oP` and `rg -o -P` snippets, with a warning when a snippet is not
   equivalent (named groups are rewritten to `(?P<name>…)` for Python, `\p{…}`, `$`, variable-width lookbehind, …).
6. If no pattern can satisfy the examples, the tool says so and names the conflicting examples.

Inference is deterministic and runs in the worker. There is no ML.

## Limits

| Limit | Value | Behavior |
|---|---|---|
| Input size | 5 MB (5 × 1024 × 1024 UTF-16 code units) | nothing is processed, a notice is shown |
| Matches | 100,000 | output is truncated and a notice says so |
| Run time | 2 s | worker terminated, "pattern too slow or catastrophic backtracking", fresh worker spawned |
| Re-run debounce | 150 ms | stale results are dropped by request id |
| Highlighted spans | 3,000 | the notice says how many exist; output and copy contain all matches |
| Table rows shown | 2,000 | Copy and Download include all rows |

## Regex dialect notes

- The only engine is JavaScript `RegExp` (V8 / SpiderMonkey / JavaScriptCore). Lookbehind needs Safari 16.4+.
- Offsets are UTF-16 code-unit offsets into the whole input. They are used by the matcher, the highlighter and the
  formatters, so `text.slice(start, end)` is always the matched text (also with emoji and surrogate pairs).
- Custom patterns run **without** the `u` flag unless you tick `u`; with `u`, `.` matches a whole code point.
- Line mode matches each line on its own, so `^` and `$` are per line. "Match across the whole text" runs on the
  full input.
- Browsers normalize `\r\n` and `\r` to `\n` inside a `<textarea>`. The core handles all three line endings (tested);
  the CLI sees the original bytes.
- Named groups: JS `(?<name>…)`; Python `(?P<name>…)`; PCRE accepts both.
- Differences to watch when pasting elsewhere: Python `$` also matches before a trailing newline; PCRE has no `\uXXXX`
  (use `\x{XXXX}`); Python `re` has no `\p{…}`. The snippet generator warns about these.

## Verified results

| Check | Result |
|---|---|
| Acceptance test #1 | exact output, in unit tests and in the real browser (through the worker) |
| `(a+)+$` on `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!` | The real worker was killed at the 2 s limit and the page showed "Pattern too slow or catastrophic backtracking". The message appeared about 2.3 s after typing (150 ms debounce + 2 s timeout), in Chromium on the built site (static server and nginx container). The next edit ran on a fresh worker and worked. |
| Performance smoke test | 1 MiB of generated log text, 12 default detectors: **about 250–300 ms** (`npm test` prints `[perf] …`). With the 5 detectors of the original defaults it was about 170 ms. Regexes are compiled once per config and reused. |
| Headers | CSP and the other security headers are present on `/` and on `/assets/*`; the app runs with no console errors and makes no request outside its own origin. |

## Decisions

The spec said to decide, record, and keep going. Each decision below was taken without asking.

**Detectors**
1. **Defaults.** On: flag, jwt, url, email, uuid, mac, ipv4, ipv6, binary, hash, hex, base64. Off: iso8601, decimal-float,
   decimal-int, quoted-string (named as noisy in the spec). The spec only fixed binary, hex, hash, base64 and flag as on.
2. **Hex minimum length** counts the digits after a `0x` prefix, so `0xff` is not matched at the default 8.
   Lower `minLength` to catch it.
3. **Binary `maxLength` and `multipleOf`** reject a candidate whole. A 20-digit string with `maxLength = 16` is not
   cut into pieces. `minLength` also counts digits only (not the `0b`).
4. **Hash** matches any hex string of exactly 32/40/64/128 characters, including all-digit ones. Binary (higher priority)
   wins for 0/1 strings. The `alt` entry uses the candidate's type (`hash:md5`), not the detector id.
5. **Base64 extras** (beyond the spec): all-digit candidates are rejected (they are numbers), and a candidate whose only
   "signal" is `-` or `_` must contain both lower- and upper-case letters (so `snake_case_names` are not base64).
   Mixed `+/` and `-_` alphabets are rejected. Unpadded standard-alphabet strings need a length that is a multiple of 4.
6. **IPv6** `::` alone is rejected (noise). IPv4 rejects leading zeros (`01.2.3.4`). Time-like `12:30:45` is not IPv6.
7. **JWT before URL** (spec order): a URL that contains a JWT shows as the JWT only.
8. **Flag prefixes** are literal strings, except the entry `[A-Za-z0-9_]{2,16}` which is a pattern.
9. **iso8601** rejects the whole candidate when the date or time is out of range (`2024-01-15T25:00:00` gives nothing).

**Core and output**
10. **CSV** uses `\n` between rows (RFC 4180 quoting for `,` `"` and newlines), a `v1..vn` header, no line column.
11. **Quote, prefix, suffix** apply to the Per line and Flat formats only. JSON, JSONL, CSV and Table are structured.
12. **Type filter** matches a family: `hash` keeps `hash:md5`, `hash:sha1`, …
13. **Whole-text mode:** a match's `line` is the line where it starts.
14. **Lines:** a single trailing line break does not create an extra empty line for "keep empty lines".
15. **Over-limit input** is refused (nothing processed) instead of silently truncated, so offsets never lie.
16. **Timing** (`elapsedMs`) uses `Date.now()` so `src/core` assumes no browser or Node timer API.

**Worker and UI**
17. **Two workers:** one for extraction, one for inference, so a new example never cancels a running extraction.
    A newer request terminates the older one's worker (no queueing behind a stuck regex) and the older promise
    rejects as stale.
18. **Persistence:** settings are saved to `localStorage` by default (toggle in the panel); the last input is saved only
    if you tick the box (off by default). Every access is wrapped in try/catch.
19. **Examples** are stored as absolute spans, so editing the input clears them (with a notice).
20. **Settings panel** auto-opens on the first example only on screens wide enough to show it beside the content.
    On narrow screens it is an overlay and the learned pattern is shown under the highlighted view.
21. **Highlight colors** use the Okabe–Ito palette; the second lap of the palette uses a dashed underline, and every
    highlight has a text tooltip and a chip with the type name, so color is never the only signal.
22. **Custom entries** are ordered by position; built-in order is fixed (spec list).

**Inference**
23. **Run grouping:** a "run" is a maximal sequence of word characters, and its class is the least general ladder class that
    covers every character of every example at that position. For uniform runs (`01110101` → `[01]{8}`) this is the
    same as per-character shaping; it also lets `0123` and `1111` unify as `\d{4}`.
24. **Context** is taken from the same line only, at most 3 characters, and is emitted as lookarounds so the match
    span stays exactly the value.
25. **"Matches no negative example"** means no match overlaps a negative span (stricter than equal spans).
26. **Per line vs whole text:** inference evaluates candidates the same way extraction does (per line, unless
    "match across the whole text" is on).
27. **L0** is shown only when fewer than 5 other candidates exist, and is never pre-selected.
28. **Spec inconsistency, acceptance test #2:** the spec says the default candidate "extracts all 4 binary values and
    reports 2 also matched". The reference input contains **5** binary values (acceptance test #1 prints 5).
    With the two values of line 1 as positives the default candidate `[01]{8}` correctly yields **5 matches, 3 also
    matched**, and the unit test asserts that. Flipping the two quoted values to negative gives
    `(?<= )[01]{8}`: 3 matches, 1 also matched.

## Known limitations

- Catastrophic backtracking is *contained* (timeout + restart), not prevented. A very slow but finite pattern on a
  big input can still hit the 2 s limit.
- JS-only: no PCRE features (possessive quantifiers, recursion, atomic groups). Snippets for other tools are
  best-effort conversions with warnings, not a PCRE emulator.
- Heuristic detectors have false positives: any 8+ letter word made only of `a–f` (`defaced`, `effaced`) is hex;
  `a::b` is a valid IPv6 address; base64 matches long mixed-case identifiers with digits; `quoted-string` pairs
  apostrophes in prose.
- Inference is per-shape: examples with different skeletons (different punctuation positions) fall back to L3 or L0.
  Examples that contain spaces cannot use L3.
- Only the first 3,000 highlights are drawn; "also matched" spans are capped at 20,000 per candidate.
- Selecting examples works from the textarea (or by clicking highlights/table rows). Selecting directly in the
  highlighted view is not supported.
- Not a binary-file parser: input is text, as pasted.

## License

MIT
