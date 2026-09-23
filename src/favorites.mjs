/**
 * Pure favorites logic shared by frontend and tests (no DOM, no localStorage).
 * The frontend duplicates loadFavorites/saveFavorites with try/catch around
 * localStorage; this module holds the testable core.
 */

export const MAX_FAVORITES = 4;
export const FAVORITES_KEY = 'minradio.favorites.v1';

/**
 * Parse and sanitize a stored favorites payload.
 * Never throws; always returns at most MAX_FAVORITES integer ids per category.
 */
export function favoritesFromRaw(raw) {
  if (!raw) return { channels: [], podcasts: [] };
  try {
    const parsed = JSON.parse(raw);
    const clean = (v) =>
      Array.isArray(v)
        ? v.filter((id) => Number.isInteger(id)).slice(0, MAX_FAVORITES)
        : [];
    return { channels: clean(parsed?.channels), podcasts: clean(parsed?.podcasts) };
  } catch {
    return { channels: [], podcasts: [] };
  }
}

/**
 * Toggle an id in a picks array, enforcing the max of MAX_FAVORITES.
 * Returns { picks, accepted }.
 */
export function togglePick(picks, id, max = MAX_FAVORITES) {
  const arr = [...picks];
  const idx = arr.indexOf(id);
  if (idx >= 0) {
    arr.splice(idx, 1);
    return { picks: arr, accepted: true };
  }
  if (arr.length >= max) return { picks: arr, accepted: false };
  arr.push(id);
  return { picks: arr, accepted: true };
}

/** Sort news items newest first by publishDateUtc; malformed entries sink. */
export function sortNewsNewestFirst(items) {
  return [...(items || [])].sort(
    (a, b) => (b?.publishDateUtc ?? 0) - (a?.publishDateUtc ?? 0)
  );
}
