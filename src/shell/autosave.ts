/**
 * Auto-save (`saving.autoSave`). A document that has a file is saved 2 s after the last
 * edit, and at once when the window loses focus, when its tab is switched away from or closed,
 * and before quit. Untitled documents never. It uses the shell's own save path (safe save and
 * own-write suppression); a file changed on disk is left to the banner, and a failed save
 * shows the error and waits for the next edit. No polling: one timer per edited document,
 * cleared on save, close and settings change.
 */
import type { Shell } from './shell.svelte';
import { tabIsDirty } from './tab';

export const AUTOSAVE_DELAY_MS = 2000;

export class AutoSave {
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly shell: Shell;

  constructor(shell: Shell) {
    this.shell = shell;
  }

  /** The document changed: save it 2 s after the last edit. */
  edited(id: number): void {
    if (!this.eligible(id)) return;
    clearTimeout(this.timers.get(id));
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        // Only the document on show can be written (the editor holds its text); one that was
        // switched away from was saved at the switch.
        if (this.shell.activeId === id) void this.shell.enqueue(() => this.save(id));
      }, AUTOSAVE_DELAY_MS),
    );
  }

  /** Saves now if the document waits for it (tab switch, window blur, close, quit). */
  async flush(id: number | null): Promise<void> {
    if (id === null) return;
    this.cancel(id);
    await this.save(id);
  }

  cancel(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
  }

  /** The setting changed: nothing waits any more; with auto-save on, a dirty document starts over. */
  reset(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    if (this.shell.activeId !== null) this.edited(this.shell.activeId);
  }

  destroy(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private eligible(id: number): boolean {
    if (!this.shell.settings.saving.autoSave) return false;
    const tab = this.shell.getTab(id);
    return (
      !!tab &&
      tab.path !== null &&
      !tab.guide &&
      !tab.readOnly &&
      !tab.missing &&
      !tab.externalChange &&
      !(tab.lossy && !tab.lossyAccepted) &&
      tabIsDirty(tab)
    );
  }

  private async save(id: number): Promise<void> {
    if (this.shell.activeId !== id || !this.eligible(id)) return;
    await this.shell.saveQuietly(id);
  }
}
