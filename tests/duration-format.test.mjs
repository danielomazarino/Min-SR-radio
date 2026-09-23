import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'app.js'), 'utf8');

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.floor(seconds % 60);
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

test('duration formatter never emits seconds 60 near minute boundary', () => {
  assert.equal(formatDuration(119.9), '1:59');
  assert.equal(formatDuration(119.999), '1:59');
  assert.equal(formatDuration(120), '2:00');
  assert.equal(formatDuration(59.999), '0:59');
});

test('tracked app duration formatter floors seconds instead of rounding to 60', () => {
  const start = source.indexOf('  function fmtDur(sec) {');
  const end = source.indexOf('\n  function showToast', start);
  const formatter = source.slice(start, end);
  assert.match(formatter, /Math\.floor\(sec % 60\)/);
  assert.doesNotMatch(formatter, /Math\.round\(sec % 60\)/);
});
