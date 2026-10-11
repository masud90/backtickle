/** The home folder as `~`. */
export function tilde(value: string): string {
  return value.replace(/^\/Users\/[^/]+(?=\/|$)/, '~');
}

/** Folds case and accents, for search. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}
