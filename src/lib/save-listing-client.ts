// Shared client-side helpers for the "save listing" heart button, used by
// /search/, /properties/, and their map components. Save state is
// session-only (sessionStorage, not localStorage) — hearts reset to empty
// next visit, matching the "for the rest of the browsing session" spec.
const STORAGE_KEY = 'saved_listings_v1';

function readSaved(): Set<string> {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function isListingSaved(mls: string | null | undefined): boolean {
  if (!mls) return false;
  return readSaved().has(mls);
}

export function markListingSaved(mls: string | null | undefined): void {
  if (!mls) return;
  const saved = readSaved();
  saved.add(mls);
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...saved]));
}

export function setHeartVisual(btn: Element, filled: boolean): void {
  btn.classList.toggle('is-saved', filled);
  btn.setAttribute('aria-pressed', String(filled));
  const outline = btn.querySelector('.heart-outline');
  const solid = btn.querySelector('.heart-filled');
  outline?.classList.toggle('hidden', filled);
  solid?.classList.toggle('hidden', !filled);
}

// Called after any bulk of `[data-save-heart]` buttons enters the DOM —
// initial page load, a re-rendered map/grid after panning, or a freshly
// opened Leaflet popup — so their filled/outline state reflects listings
// already saved earlier in this session.
export function syncHeartButtons(root: ParentNode = document): void {
  const saved = readSaved();
  root.querySelectorAll<HTMLElement>('[data-save-heart]').forEach((btn) => {
    setHeartVisual(btn, saved.has(btn.getAttribute('data-mls') || ''));
  });
}
