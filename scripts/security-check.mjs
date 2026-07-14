import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const roots = ['src', 'test', 'scripts', 'docs', '.github'];
const extensions = new Set(['.js', '.mjs', '.json', '.md', '.yml', '.yaml', '.toml', '.sql']);
const findings = [];
const rules = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['OpenAI project key', /\bsk-proj-[A-Za-z0-9_-]{20,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['credential URL', /\b(?:postgres|postgresql|mysql):\/\/(?![^\s/:@]+:(?:password|example|replace-me|<[^>]+>)@)[^\s/:@]+:[^\s/@]+@/i]
];

for (const root of roots) await walk(root);

if (findings.length) {
  console.error('Security scan found possible committed credentials:');
  for (const finding of findings) console.error(`- ${finding.file}:${finding.line} ${finding.rule}`);
  process.exit(1);
}
console.log('Security scan passed.');

async function walk(path) {
  let entries;
  try { entries = await readdir(path, { withFileTypes: true }); }
  catch { return; }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue;
    const child = join(path, entry.name);
    if (entry.isDirectory()) await walk(child);
    else if (extensions.has(extname(entry.name))) await scan(child);
  }
}

async function scan(path) {
  const text = await readFile(path, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/security-check\.mjs/.test(path) && /private key|OpenAI project key|GitHub token|AWS access key|credential URL/.test(line)) return;
    for (const [rule, pattern] of rules) {
      if (rule === 'credential URL' && isExplicitLocalFixture(line)) continue;
      if (pattern.test(line)) findings.push({ file: relative('.', path), line: index + 1, rule });
      pattern.lastIndex = 0;
    }
  });
}

function isExplicitLocalFixture(line) {
  return /(?:127\.0\.0\.1|localhost|@postgres(?::\d+)?\/)/i.test(line)
    && /(?:test|local|reader|postgres)/i.test(line);
}
