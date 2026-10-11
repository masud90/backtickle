/**
 * Tab buttons for a tabset, added after sanitizing by our own code:
 * `div.tabset > section.tabset-panel[data-tab-title]` gets a `div[role=tablist]` of
 * `button[role=tab]` in front, and only the first panel is shown. Arrow keys, Home and End move
 * between the tabs. The titles are set as text, never as markup.
 */

let counter = 0;

function select(tabs: HTMLElement[], panels: HTMLElement[], index: number, focus: boolean): void {
  tabs.forEach((tab, position) => {
    const on = position === index;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    (panels[position] as HTMLElement).hidden = !on;
  });
  if (focus) (tabs[index] as HTMLElement).focus();
}

/** Adds the tab buttons to a tabset element (once: a tabset that has them is left alone). */
export function enhanceTabset(root: Element): void {
  const children = Array.from(root.children);
  if (children.some((child) => child.classList.contains('tabset-tabs'))) return;
  const panels = children.filter(
    (child): child is HTMLElement =>
      child instanceof HTMLElement && child.classList.contains('tabset-panel'),
  );
  if (panels.length === 0) return;
  const document = root.ownerDocument;
  const list = document.createElement('div');
  list.className = 'tabset-tabs';
  list.setAttribute('role', 'tablist');
  const tabs: HTMLElement[] = [];
  const base = `wd-tabset-${++counter}`;
  panels.forEach((panel, index) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tabset-tab';
    tab.id = `${base}-tab-${index}`;
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-controls', `${base}-panel-${index}`);
    tab.textContent = panel.getAttribute('data-tab-title') ?? `Tab ${index + 1}`;
    panel.id = `${base}-panel-${index}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    tabs.push(tab);
    list.append(tab);
  });
  list.addEventListener('click', (event) => {
    const index = tabs.indexOf((event.target as Element).closest('button') as HTMLElement);
    if (index >= 0) select(tabs, panels, index, false);
  });
  list.addEventListener('keydown', (event) => {
    const current = tabs.indexOf(document.activeElement as HTMLElement);
    if (current < 0) return;
    let next = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (current - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    select(tabs, panels, next, true);
  });
  root.insertBefore(list, panels[0] as HTMLElement);
  select(tabs, panels, 0, false);
}
