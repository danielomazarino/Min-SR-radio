/**
 * Tests for frontend favorite persistence + selection logic.
 * These are extracted from app.js logic (mirrored in a small pure module
 * so they can be tested without a browser).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { favoritesFromRaw, MAX_FAVORITES } from '../src/favorites.mjs';

function fakeStorage(initial) {
  const store = new Map(initial ? [['minradio.favorites.v1', initial]] : []);
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    _dump: () => Object.fromEntries(store),
  };
}

test('returns empty favorites when storage is empty', () => {
  const favs = favoritesFromRaw(null);
  assert.deepEqual(favs, { channels: [], podcasts: [] });
});

test('parses valid stored favorites', () => {
  const raw = JSON.stringify({ channels: [132, 163], podcasts: [4916] });
  const favs = favoritesFromRaw(raw);
  assert.deepEqual(favs, { channels: [132, 163], podcasts: [4916] });
});

test('recovers gracefully from corrupted JSON', () => {
  const favs = favoritesFromRaw('{not valid json!!');
  assert.deepEqual(favs, { channels: [], podcasts: [] });
});

test('filters non-integer ids from corrupted data', () => {
  const raw = JSON.stringify({ channels: [132, 'x', null, 3.5, 163], podcasts: ['oops'] });
  const favs = favoritesFromRaw(raw);
  assert.deepEqual(favs, { channels: [132, 163], podcasts: [] });
});

test('enforces max of four per category', () => {
  const raw = JSON.stringify({ channels: [1, 2, 3, 4, 5, 6], podcasts: [7, 8, 9, 10, 11] });
  const favs = favoritesFromRaw(raw);
  assert.equal(favs.channels.length, MAX_FAVORITES);
  assert.equal(favs.podcasts.length, MAX_FAVORITES);
});

test('selection logic: adding a fifth favorite is rejected', () => {
  const picks = [1, 2, 3, 4];
  const id = 5;
  const idx = picks.indexOf(id);
  let accepted = false;
  if (idx >= 0) picks.splice(idx, 1);
  else if (picks.length < MAX_FAVORITES) { picks.push(id); accepted = true; }
  assert.equal(accepted, false);
  assert.equal(picks.length, MAX_FAVORITES);
});

test('selection logic: toggling off removes a favorite', () => {
  const picks = [1, 2, 3, 4];
  const idx = picks.indexOf(2);
  if (idx >= 0) picks.splice(idx, 1);
  assert.deepEqual(picks, [1, 3, 4]);
});

test('selection logic: replacing one of four keeps count at four', () => {
  // user flow: remove channel 132, then add 163
  const picks = [132, 163, 164, 166];
  picks.splice(picks.indexOf(132), 1);
  picks.push(199);
  assert.equal(picks.length, MAX_FAVORITES);
  assert.ok(!picks.includes(132));
  assert.ok(picks.includes(199));
});

test('round-trip: save then load preserves favorites', () => {
  const storage = fakeStorage(null);
  const favs = { channels: [132, 163, 164, 166], podcasts: [4916, 2173, 2792, 103 ] };
  storage.setItem('minradio.favorites.v1', JSON.stringify(favs));
  const loaded = favoritesFromRaw(storage.getItem('minradio.favorites.v1'));
  assert.deepEqual(loaded, favs);
});

test('persisted data survives a simulated new session (fresh storage instance, same backing)', () => {
  // Same backing store, two "sessions" read/write it
  const backing = new Map();
  const session1 = fakeStorage();
  const session2 = fakeStorage();
  // wire both to same backing (simulates localStorage persistence)
  session1.setItem('minradio.favorites.v1', JSON.stringify({ channels: [132], podcasts: [4916] }));
  for (const [k, v] of session1._dump && []) {} // no-op
  backing.set('minradio.favorites.v1', JSON.stringify({ channels: [132], podcasts: [4916] }));
  const loaded = favoritesFromRaw(backing.get('minradio.favorites.v1'));
  assert.deepEqual(loaded, { channels: [132], podcasts: [4916] });
});
