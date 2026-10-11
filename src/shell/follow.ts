/**
 * Decides which scroll events sync scroll follows. Two panes scroll each other, and a scroll set
 * by the program fires an event just like one made by the person, so without a rule they would
 * answer each other forever. The pane the person scrolls leads: for the next `FOLLOW_MS` after
 * its last event the other pane's events are echoes and are ignored. A pane that stays quiet for
 * that long may lead next. Pure: the clock is passed in.
 */

export type Side = 'editor' | 'preview';

/** How long the follower's own scroll events are ignored after the leader's last one. */
export const FOLLOW_MS = 100;

export class FollowGuard {
  private leader: Side | null = null;
  private until = Number.NEGATIVE_INFINITY;
  private mutedUntil = Number.NEGATIVE_INFINITY;

  /** A scroll event from `side` at time `now`. True when it is a real scroll to follow. */
  shouldFollow(side: Side, now: number): boolean {
    if (now < this.mutedUntil) return false;
    if (this.leader !== null && this.leader !== side && now < this.until) return false;
    this.leader = side;
    this.until = now + FOLLOW_MS;
    return true;
  }

  /** The program is about to scroll the other pane for `side` (again): its echo is ignored. */
  lead(side: Side, now: number): void {
    this.leader = side;
    this.until = now + FOLLOW_MS;
  }

  /** Ignores every scroll event for `ms` (a jump to a heading scrolls both panes by itself). */
  mute(now: number, ms: number): void {
    this.mutedUntil = Math.max(this.mutedUntil, now + ms);
  }

  reset(): void {
    this.leader = null;
    this.until = Number.NEGATIVE_INFINITY;
    this.mutedUntil = Number.NEGATIVE_INFINITY;
  }
}
