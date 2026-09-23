import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installEpisodeSeekPointerHandlers } from '../src/episode-seek.mjs';

class FakeBar {
  constructor({ left = 10, width = 200 } = {}) {
    this.left = left;
    this.width = width;
    this.listeners = new Map();
    this.captured = new Set();
    this.classes = new Set();
    this.attributes = new Map();
  }
  addEventListener(type, handler) {
    const list = this.listeners.get(type) || [];
    list.push(handler);
    this.listeners.set(type, list);
  }
  removeEventListener(type, handler) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((fn) => fn !== handler));
  }
  getBoundingClientRect() { return { left: this.left, width: this.width }; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  setPointerCapture(id) { this.captured.add(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  releasePointerCapture(id) { this.captured.delete(id); this.dispatch('lostpointercapture', event(id)); }
  classList = {
    add: (name) => this.classes.add(name),
    remove: (name) => this.classes.delete(name),
    contains: (name) => this.classes.has(name),
  };
  dispatch(type, evt) {
    for (const handler of [...(this.listeners.get(type) || [])]) handler(evt);
  }
}

function pointerEvent(pointerId, x, y, extra = {}) {
  return {
    pointerId,
    clientX: x,
    clientY: y,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    ...extra,
  };
}
const clickEvent = (x, y, extra = {}) => ({
  clientX: x,
  clientY: y,
  detail: 1,
  pointerType: 'mouse',
  preventDefault() { this.defaultPrevented = true; },
  ...extra,
});

function setup() {
  const bar = new FakeBar();
  let duration = 1000;
  const previews = [];
  const seeks = [];
  let restores = 0;
  const dispose = installEpisodeSeekPointerHandlers(bar, {
    getDuration: () => duration,
    seekToFraction: (frac) => seeks.push(frac),
    onPreview: (frac) => previews.push(frac),
    onRestore: () => { restores += 1; },
  });
  return {
    bar, previews, seeks, dispose,
    get restores() { return restores; },
    set duration(value) { duration = value; },
  };
}

test('episode seek tap commits on click and clamps to slider bounds', () => {
  const s = setup();
  s.bar.dispatch('click', clickEvent(60, 10));
  assert.deepEqual(s.seeks, [0.25]);
  assert.equal(s.bar.classList.contains('dragging'), false);
});

test('episode seek tap at either edge clamps to 0 or 1', () => {
  const s = setup();
  s.bar.dispatch('click', clickEvent(-40, 10));
  s.bar.dispatch('click', clickEvent(400, 10));
  assert.deepEqual(s.seeks, [0, 1]);
});

test('duration changes refresh slider aria-valuemax', () => {
  const s = setup();
  const durationChange = s.bar.listeners.get('durationchange')?.[0];
  assert.equal(s.bar.getAttribute('aria-valuemax'), '1000');
  s.duration = 720;
  durationChange?.();
  assert.equal(s.bar.getAttribute('aria-valuemax'), '720');
});

test('horizontal drag previews continuously and commits once on pointerup', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(2, 20, 10));
  s.bar.dispatch('pointermove', pointerEvent(2, 100, 10));
  s.bar.dispatch('pointermove', pointerEvent(2, 210, 10)); // clamps at the right edge
  assert.deepEqual(s.previews, [0.05, 0.45, 1]);
  assert.deepEqual(s.seeks, []);
  s.bar.dispatch('pointerup', pointerEvent(2, 190, 10));
  s.bar.dispatch('click', clickEvent(190, 10, { pointerType: '' }));
  assert.deepEqual(s.seeks, [0.9]);
});

test('vertical intent cancels without seeking; subsequent pointerup is ignored', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(3, 50, 10));
  s.bar.dispatch('pointermove', pointerEvent(3, 53, 30));
  s.bar.dispatch('pointerup', pointerEvent(3, 53, 30));
  assert.deepEqual(s.seeks, []);
  assert.equal(s.bar.classList.contains('dragging'), false);
  assert.equal(s.restores, 1);
});

test('release-only vertical gesture is ignored when touch produces no pointermove', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(31, 50, 10));
  s.bar.dispatch('pointerup', pointerEvent(31, 53, 30));
  assert.deepEqual(s.seeks, []);
  assert.equal(s.bar.classList.contains('dragging'), false);
});

test('pointercancel and lost capture restore actual state without committing', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(4, 80, 10));
  s.bar.dispatch('pointermove', pointerEvent(4, 140, 10));
  s.bar.dispatch('pointercancel', pointerEvent(4, 140, 10));
  assert.deepEqual(s.seeks, []);
  assert.equal(s.restores, 1);

  s.bar.dispatch('pointerdown', pointerEvent(5, 80, 10));
  s.bar.dispatch('lostpointercapture', pointerEvent(5, 80, 10));
  assert.equal(s.restores, 2);
  assert.equal(s.bar.classList.contains('dragging'), false);
});

test('rapid pointer replacement cancels the previous drag and isolates pointer ids', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(6, 20, 10));
  s.bar.dispatch('pointermove', pointerEvent(6, 100, 10));
  s.bar.dispatch('pointerdown', pointerEvent(7, 40, 10));
  s.bar.dispatch('pointermove', pointerEvent(6, 180, 10)); // stale pointer ignored
  s.bar.dispatch('pointermove', pointerEvent(7, 120, 10));
  s.bar.dispatch('pointerup', pointerEvent(7, 120, 10));
  assert.deepEqual(s.seeks, [0.55]);
  assert.equal(s.restores, 2); // replacement restores, release refreshes
});

test('dispose removes all pointer listeners and cancels an active drag', () => {
  const s = setup();
  s.bar.dispatch('pointerdown', pointerEvent(8, 20, 10));
  s.dispose();
  assert.equal(s.bar.classList.contains('dragging'), false);
  assert.equal(s.bar.listeners.get('pointerdown').length, 0);
  assert.equal(s.bar.listeners.get('pointermove').length, 0);
});
