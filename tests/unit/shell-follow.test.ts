import { describe, expect, it } from 'vitest';
import { FOLLOW_MS, FollowGuard } from '../../src/shell/follow';

describe('FollowGuard', () => {
  it('follows the first scroll, whichever pane it comes from', () => {
    expect(new FollowGuard().shouldFollow('editor', 0)).toBe(true);
    expect(new FollowGuard().shouldFollow('preview', 0)).toBe(true);
  });

  it('keeps following the pane that leads', () => {
    const guard = new FollowGuard();
    for (let t = 0; t < 1000; t += 16) expect(guard.shouldFollow('editor', t)).toBe(true);
  });

  it('ignores the other pane for FOLLOW_MS after the last event of the leader', () => {
    const guard = new FollowGuard();
    guard.shouldFollow('editor', 1000);
    expect(guard.shouldFollow('preview', 1000 + FOLLOW_MS - 1)).toBe(false);
    expect(guard.shouldFollow('preview', 1000 + FOLLOW_MS)).toBe(true);
  });

  it('lets the other pane lead once the leader has been quiet', () => {
    const guard = new FollowGuard();
    guard.shouldFollow('editor', 0);
    expect(guard.shouldFollow('preview', 500)).toBe(true);
    // Now the preview leads: the editor's echo is ignored.
    expect(guard.shouldFollow('editor', 510)).toBe(false);
  });

  it('does not let echoes extend the leader window', () => {
    const guard = new FollowGuard();
    guard.shouldFollow('editor', 0);
    expect(guard.shouldFollow('preview', 50)).toBe(false);
    expect(guard.shouldFollow('preview', 90)).toBe(false);
    // 100 ms after the editor's own last event, not after the echoes.
    expect(guard.shouldFollow('preview', 100)).toBe(true);
  });

  it('lead() starts the echo window for a follow made by the program', () => {
    const guard = new FollowGuard();
    guard.lead('editor', 200);
    expect(guard.shouldFollow('preview', 250)).toBe(false);
    expect(guard.shouldFollow('preview', 300)).toBe(true);
  });

  it('mute() ignores both panes for a while, and reset() forgets everything', () => {
    const guard = new FollowGuard();
    guard.mute(0, 250);
    expect(guard.shouldFollow('editor', 100)).toBe(false);
    expect(guard.shouldFollow('preview', 249)).toBe(false);
    expect(guard.shouldFollow('editor', 250)).toBe(true);
    guard.mute(300, 250);
    guard.reset();
    expect(guard.shouldFollow('preview', 310)).toBe(true);
  });
});
