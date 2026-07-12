import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultWorkspace } from '../src/config.js';
import { interpretQuestion } from '../src/interpreter.js';

const cases = JSON.parse(await readFile(new URL('../evals/golden-cases.json', import.meta.url), 'utf8'));

for (const fixture of cases) {
  test(`golden interpretation: ${fixture.question}`, () => {
    const actual = interpretQuestion(fixture.question, defaultWorkspace);
    for (const [key, value] of Object.entries(fixture.expected)) {
      assert.deepEqual(actual[key], value, `Mismatch for ${key}`);
    }
  });
}
