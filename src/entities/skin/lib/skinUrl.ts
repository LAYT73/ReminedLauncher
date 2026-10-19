/** True for a remote (Supabase CDN) skin; false for a local file path. */
export function isSkinUrl(path: string | null | undefined): boolean {
  if (!path) return false;
  return /^https?:\/\//i.test(path.trim());
}
