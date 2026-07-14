import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const directory = 'supabase/migrations';
const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
const errors = [];
const numbers = new Set();
let previous = 0;

for (const file of files) {
  const match = /^(\d+)_/.exec(file);
  if (!match) { errors.push(`${file}: filename must start with a numeric sequence`); continue; }
  const number = Number(match[1]);
  if (numbers.has(number)) errors.push(`${file}: duplicate migration sequence ${number}`);
  if (number <= previous) errors.push(`${file}: migration sequence is not strictly increasing`);
  numbers.add(number); previous = number;

  const sql = await readFile(join(directory, file), 'utf8');
  if (!sql.trim()) errors.push(`${file}: migration is empty`);
  if (/disable\s+row\s+level\s+security/i.test(sql)) errors.push(`${file}: disabling RLS is forbidden`);
  if (/drop\s+(table|schema|type)\b/i.test(sql) && !/drop\s+policy\s+if\s+exists/i.test(sql)) {
    errors.push(`${file}: destructive schema drops require a reviewed rollback migration`);
  }
  if (/create\s+table\s+(?:if\s+not\s+exists\s+)?public\./i.test(sql) && !/enable\s+row\s+level\s+security/i.test(sql)) {
    errors.push(`${file}: public tables require explicit RLS enablement in the migration`);
  }
}

if (!files.length) errors.push('No Supabase migrations found.');
if (errors.length) {
  console.error('Migration safety check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Migration safety check passed for ${files.length} files.`);
