/** Mermaid theme variables built from the design tokens in force (light, dark), read at render time. */

export type Appearance = 'light' | 'dark';

export function currentAppearance(doc: Document = document): Appearance {
  const set = doc.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  return doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const FALLBACK: Record<string, string> = {
  surface: '#fcf8fb',
  'surface-container': '#f0edef',
  'surface-container-high': '#eae7ea',
  'on-surface': '#1b1b1d',
  'on-surface-variant': '#414755',
  outline: '#717786',
  'outline-variant': '#c1c6d7',
  primary: '#0058bc',
  'primary-fixed': '#d8e2ff',
  'on-primary-fixed': '#001a41',
  'secondary-fixed': '#e2dfff',
  'on-secondary-fixed': '#0c006a',
  'tertiary-fixed': '#72fe88',
  'on-tertiary-fixed': '#002107',
  error: '#ba1a1a',
};

export function themeVariables(
  doc: Document = document,
  appearance: Appearance = currentAppearance(doc),
): Record<string, string | boolean> {
  // A light diagram asked for in a dark window (export): the light values, not the tokens in force.
  const forcedLight = appearance === 'light' && currentAppearance(doc) === 'dark';
  const style = forcedLight ? undefined : doc.defaultView?.getComputedStyle(doc.documentElement);
  const token = (name: string): string => {
    const value = style?.getPropertyValue(`--wd-${name}`).trim();
    return value ? value : (FALLBACK[name] ?? '#808080');
  };
  const font = style?.getPropertyValue('--wd-font-sans').trim();
  const dark = appearance === 'dark';
  // Node fill and its text: the light tinted fixed colors on light, dark containers on dark.
  const fill = token(dark ? 'surface-container-high' : 'primary-fixed');
  const fillText = token(dark ? 'on-surface' : 'on-primary-fixed');
  return {
    darkMode: dark,
    fontFamily: font ? font : 'system-ui, sans-serif',
    fontSize: '14px',
    background: token('surface'),
    textColor: token('on-surface'),
    primaryColor: fill,
    primaryTextColor: fillText,
    primaryBorderColor: token('primary'),
    secondaryColor: token('secondary-fixed'),
    secondaryTextColor: token('on-secondary-fixed'),
    secondaryBorderColor: token('outline'),
    tertiaryColor: token('tertiary-fixed'),
    tertiaryTextColor: token('on-tertiary-fixed'),
    tertiaryBorderColor: token('outline'),
    lineColor: token('on-surface-variant'),
    mainBkg: fill,
    nodeBorder: token('primary'),
    nodeTextColor: fillText,
    clusterBkg: token('surface-container'),
    clusterBorder: token('outline'),
    titleColor: token('on-surface'),
    edgeLabelBackground: token('surface'),
    noteBkgColor: token('surface-container-high'),
    noteTextColor: token('on-surface'),
    noteBorderColor: token('outline'),
    actorBkg: fill,
    actorBorder: token('primary'),
    actorTextColor: fillText,
    actorLineColor: token('outline'),
    signalColor: token('on-surface'),
    signalTextColor: token('on-surface'),
    labelBoxBkgColor: token('surface-container'),
    labelBoxBorderColor: token('outline'),
    labelTextColor: token('on-surface'),
    loopTextColor: token('on-surface'),
    classText: fillText,
    errorBkgColor: token('error'),
  };
}
