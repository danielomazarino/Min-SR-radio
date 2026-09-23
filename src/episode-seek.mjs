/**
 * Pointer state machine for the on-demand episode seek slider.
 * Horizontal movement previews and commits on release; vertical intent and
 * cancelled pointers restore the media position without seeking.
 */
export function installEpisodeSeekPointerHandlers(bar, {
  getDuration,
  seekToFraction,
  onPreview,
  onRestore,
}) {
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let axis = null;
  let previewFraction = null;
  let suppressClickUntil = 0;

  const fractionAt = (clientX) => {
    const rect = bar.getBoundingClientRect();
    if (!rect.width) return null;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const clear = (pointerId) => {
    const capturedId = activePointerId;
    activePointerId = null;
    axis = null;
    previewFraction = null;
    bar.classList.remove('dragging');
    const id = pointerId ?? capturedId;
    if (id != null) {
      try {
        if (bar.hasPointerCapture(id)) bar.releasePointerCapture(id);
      } catch { /* capture may already have been released */ }
    }
  };

  const restore = (pointerId) => {
    if (activePointerId == null) return;
    clear(pointerId);
    onRestore();
  };

  const onPointerDown = (event) => {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)
        || !(getDuration() > 0)) return;
    if (activePointerId != null) restore();
    const fraction = fractionAt(event.clientX);
    if (fraction == null) return;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    axis = null;
    previewFraction = fraction;
    bar.classList.add('dragging');
    onPreview(fraction);
    try { bar.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
  };

  const onPointerMove = (event) => {
    if (event.pointerId !== activePointerId) return;
    if (axis == null) {
      const dx = Math.abs(event.clientX - startX);
      const dy = Math.abs(event.clientY - startY);
      if (dx < 8 && dy < 8) return;
      axis = dx >= dy ? 'x' : 'y';
      if (axis === 'y') {
        restore(event.pointerId);
        return;
      }
    }
    if (axis !== 'x') return;
    previewFraction = fractionAt(event.clientX);
    if (previewFraction != null) onPreview(previewFraction);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== activePointerId) return;
    const fraction = fractionAt(event.clientX) ?? previewFraction;
    const dx = Math.abs(event.clientX - startX);
    const dy = Math.abs(event.clientY - startY);
    const releaseAxis = axis ?? ((dx < 8 && dy < 8) ? null : (dx >= dy ? 'x' : 'y'));
    const shouldCommit = releaseAxis === 'x';
    if (shouldCommit) suppressClickUntil = Date.now() + 400;
    clear(event.pointerId);
    if (shouldCommit && fraction != null && getDuration() > 0) {
      seekToFraction(fraction);
    }
    onRestore();
  };

  const onClick = (event) => {
    if (event.detail === 0 || event.pointerType === '' || !(getDuration() > 0)) return;
    if (Date.now() <= suppressClickUntil) {
      suppressClickUntil = 0;
      event.preventDefault();
      return; // suppress the synthetic click following a committed pointer drag
    }
    const fraction = fractionAt(event.clientX);
    if (fraction != null) seekToFraction(fraction);
  };

  const onPointerCancel = (event) => restore(event.pointerId);
  const onLostPointerCapture = (event) => restore(event.pointerId);
  const onPointerLeave = (event) => {
    if (event.pointerId === activePointerId && !bar.hasPointerCapture(event.pointerId)) {
      restore(event.pointerId);
    }
  };

  const listeners = [
    ['pointerdown', onPointerDown],
    ['pointermove', onPointerMove],
    ['pointerup', onPointerUp],
    ['click', onClick],
    ['pointercancel', onPointerCancel],
    ['lostpointercapture', onLostPointerCapture],
    ['pointerleave', onPointerLeave],
  ];
  for (const [type, listener] of listeners) bar.addEventListener(type, listener);

  bar.setAttribute('aria-valuemax', String(getDuration()));
  const onDurationChange = () => bar.setAttribute('aria-valuemax', String(getDuration()));
  bar.addEventListener('durationchange', onDurationChange);
  listeners.push(['durationchange', onDurationChange]);

  return () => {
    restore();
    for (const [type, listener] of listeners) bar.removeEventListener(type, listener);
  };
}
