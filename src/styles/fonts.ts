// Import the primary fonts that load at startup
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';

export type ReadingFontId =
  | 'inter'
  | 'system'
  | 'literata'
  | 'atkinson'
  | 'lexend'
  | 'opendyslexic';

export interface ReadingFont {
  id: ReadingFontId;
  displayName: string;
  fontFamily: string;
}

export const READING_FONTS: ReadingFont[] = [
  {
    id: 'inter',
    displayName: 'Inter',
    fontFamily:
      '"Inter Variable", "Inter", -apple-system, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif',
  },
  {
    id: 'system',
    displayName: 'System',
    fontFamily: '-apple-system, "Segoe UI Variable", "Segoe UI", system-ui',
  },
  {
    id: 'literata',
    displayName: 'Literata',
    fontFamily: '"Literata Variable", "Literata", serif',
  },
  {
    id: 'atkinson',
    displayName: 'Atkinson Hyperlegible',
    fontFamily: '"Atkinson Hyperlegible", sans-serif',
  },
  {
    id: 'lexend',
    displayName: 'Lexend Deca',
    fontFamily: '"Lexend Deca Variable", "Lexend Deca", sans-serif',
  },
  {
    id: 'opendyslexic',
    displayName: 'OpenDyslexic',
    fontFamily: '"OpenDyslexic", sans-serif',
  },
];

export async function loadReadingFont(id: ReadingFontId): Promise<void> {
  if (id === 'inter' || id === 'system') {
    // Inter is already loaded at startup, system uses nothing
    return;
  }

  switch (id) {
    case 'literata':
      await import('@fontsource-variable/literata');
      break;
    case 'atkinson':
      await import('@fontsource/atkinson-hyperlegible');
      break;
    case 'lexend':
      await import('@fontsource-variable/lexend-deca');
      break;
    case 'opendyslexic':
      await import('@fontsource/opendyslexic');
      break;
  }
}
