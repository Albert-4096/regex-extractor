export interface Snippet {
  id: 'js' | 'python' | 'grep' | 'rg';
  title: string;
  code: string;
  /** Non-empty when the snippet is not exactly equivalent to the JavaScript pattern. */
  warnings: string[];
}

/** Bodies of lookbehinds, to detect variable-width ones. */
function lookbehindBodies(pattern: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] === '\\') {
      i++;
      continue;
    }
    if (pattern.startsWith('(?<=', i) || pattern.startsWith('(?<!', i)) {
      let body = '';
      let inClass = false;
      let j = i + 4;
      for (; j < pattern.length; j++) {
        const c = pattern[j];
        if (c === '\\') {
          body += c + (pattern[j + 1] ?? '');
          j++;
          continue;
        }
        if (c === '[') inClass = true;
        else if (c === ']') inClass = false;
        else if (c === ')' && !inClass) break;
        body += c;
      }
      out.push(body);
    }
  }
  return out;
}

function hasVariableLookbehind(pattern: string): boolean {
  return lookbehindBodies(pattern).some((b) => /[*+?{|]/.test(b.replace(/\\./g, 'X').replace(/\[[^\]]*\]/g, 'X')));
}

/** True when the pattern has an unescaped `$` outside a character class. */
function hasDollar(pattern: string): boolean {
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') i++;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '$' && !inClass) return true;
  }
  return false;
}

function pyLiteral(p: string): string {
  if (!p.includes('"') && !p.endsWith('\\') && !/[\r\n]/.test(p)) return `r"${p}"`;
  if (!p.includes("'") && !p.endsWith('\\') && !/[\r\n]/.test(p)) return `r'${p}'`;
  return '"' + p.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
}

const shell = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function snippets(pattern: string, flags = ''): Snippet[] {
  const f = [...new Set(flags.split(''))].filter((x) => 'imsu'.includes(x));
  const inline = ['i', 'm', 's'].filter((x) => f.includes(x)).join('');

  /* JavaScript */
  const js: Snippet = {
    id: 'js',
    title: 'JavaScript',
    code:
      `const re = new RegExp(${JSON.stringify(pattern)}, ${JSON.stringify('g' + f.join(''))});\n` +
      `for (const m of text.matchAll(re)) console.log(m[0]);`,
    warnings: [],
  };

  /* Python */
  const pyWarn: string[] = [];
  let py = pattern;
  if (/\(\?<[A-Za-z_][A-Za-z0-9_]*>/.test(py)) {
    py = py.replace(/\(\?<([A-Za-z_][A-Za-z0-9_]*)>/g, '(?P<$1>');
    pyWarn.push('Named groups were rewritten to Python syntax: (?P<name>…).');
  }
  if (/\\k<[A-Za-z_][A-Za-z0-9_]*>/.test(py)) {
    py = py.replace(/\\k<([A-Za-z_][A-Za-z0-9_]*)>/g, '(?P=$1)');
    pyWarn.push('Named back-references \\k<name> were rewritten to (?P=name).');
  }
  if (/\\[pP]\{/.test(pattern)) pyWarn.push('Python re does not support \\p{…} Unicode property escapes (use the regex module).');
  if (/\\u\{/.test(pattern)) pyWarn.push('Python re does not support \\u{…} code point escapes.');
  if (hasDollar(pattern)) pyWarn.push('In Python, $ also matches just before a trailing newline. Use \\Z for the end of the string.');
  if (hasVariableLookbehind(pattern)) pyWarn.push('Python re needs fixed-width lookbehind. This pattern has a variable-width lookbehind.');
  const pyFlags = ['re.A', ...(f.includes('i') ? ['re.I'] : []), ...(f.includes('m') ? ['re.M'] : []), ...(f.includes('s') ? ['re.S'] : [])].join(' | ');
  const lit = pyLiteral(py);
  const python: Snippet = {
    id: 'python',
    title: 'Python',
    code:
      `import re\n` +
      `flags = ${pyFlags}  # re.A: \\d and \\w are ASCII-only, like JavaScript\n` +
      `values = re.findall(${lit}, text, flags)  # tuples if the pattern has groups\n` +
      `for m in re.finditer(${lit}, text, flags):\n` +
      `    print(m.group(0))`,
    warnings: pyWarn,
  };

  /* PCRE tools */
  const pcreWarn: string[] = [];
  if (/\\u[0-9a-fA-F]{4}|\\u\{/.test(pattern)) pcreWarn.push('PCRE does not support \\uXXXX escapes. Use \\x{XXXX}.');
  if (hasVariableLookbehind(pattern)) pcreWarn.push('PCRE needs fixed-width lookbehind. This pattern has a variable-width lookbehind.');
  const pcre = (inline ? `(?${inline})` : '') + pattern;
  const grepWarn = [...pcreWarn];
  const rgWarn = [...pcreWarn];
  if (f.includes('s') || f.includes('m')) {
    grepWarn.push('grep works line by line, so the s and m flags change nothing across lines. Use -z to search whole files.');
    rgWarn.push('rg works line by line unless you add -U. Use -U for patterns that span lines.');
  }

  return [
    js,
    python,
    { id: 'grep', title: 'grep -oP', code: `grep -oP ${shell(pcre)} file.txt`, warnings: grepWarn },
    { id: 'rg', title: 'ripgrep', code: `rg -o -P ${shell(pcre)} file.txt`, warnings: rgWarn },
  ];
}
