/**
 * @module poolCountTracker
 * @description Event-sourced pool counter for per-role-per-team agent counts.
 *
 * Maintains an O(1) lookup table updated at spawn/exit boundaries:
 *   - `onTracked(pid, teamId, role)` — increment on pidToTrackedSession.set()
 *   - `onUntracked(pid)` — decrement on pidToTrackedSession.delete()
 *   - `resetFromSnapshot(sessions)` — rebuild after daemon recovery
 *
 * The counter coexists with `countActiveHelpAgents()` (PID-liveness scan).
 * The scan remains the authoritative source for heartbeat diagnostics;
 * this tracker provides fast pre-checks to avoid full iteration.
 *
 * ```mermaid
 * graph TD
 *   A[sessionManager set/delete] --> B[PoolCountTracker]
 *   B --> C[helpAutoSpawn checkHelpAutoSpawn]
 *   B --> D[anomalyDetector detectPoolOverflow]
 *   E[recoverExistingSessions] --> B
 * ```
 */

import { logger } from '@/ui/logger';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PoolCountTracker {
  /** Record that a session was added to tracking. */
  onTracked(pid: number, teamId: string | undefined, role: string | undefined): void;
  /** Record that a session was removed from tracking. */
  onUntracked(pid: number): void;
  /** Get current count for a specific team + role. */
  getCount(teamId: string, role: string): number;
  /** Get all counts for a team. */
  getTeamCounts(teamId: string): ReadonlyMap<string, number>;
  /** Reset counter from a snapshot of live sessions (after recovery). */
  resetFromSnapshot(sessions: Iterable<{ pid?: number; role?: string; teamId?: string }>): void;
  /** Get total count across all teams for a role. */
  getGlobalCount(role: string): number;
  /** Debug dump of all counters. */
  dump(): Record<string, Record<string, number>>;
}

// ── Internal tracking ─────────────────────────────────────────────────────────

/** Per-PID record so we can decrement the correct bucket on exit. */
interface PidEntry {
  teamId: string;
  role: string;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createPoolCountTracker(): PoolCountTracker {
  /** teamId → role → count */
  const counts = new Map<string, Map<string, number>>();
  /** pid → { teamId, role } — needed for accurate decrement on exit. */
  const pidIndex = new Map<number, PidEntry>();

  function ensureRoleBucket(teamId: string, role: string): Map<string, number> {
    let teamMap = counts.get(teamId);
    if (!teamMap) {
      teamMap = new Map();
      counts.set(teamId, teamMap);
    }
    return teamMap;
  }

  return {
    onTracked(pid: number, teamId: string | undefined, role: string | undefined): void {
      if (!teamId || !role) return;
      // If PID was already tracked (e.g., recovery overlap), decrement old bucket first.
      const existing = pidIndex.get(pid);
      if (existing) {
        const oldTeam = counts.get(existing.teamId);
        if (oldTeam) {
          const oldCount = (oldTeam.get(existing.role) ?? 1) - 1;
          if (oldCount <= 0) {
            oldTeam.delete(existing.role);
          } else {
            oldTeam.set(existing.role, oldCount);
          }
        }
      }
      const teamMap = ensureRoleBucket(teamId, role);
      teamMap.set(role, (teamMap.get(role) ?? 0) + 1);
      pidIndex.set(pid, { teamId, role });
    },

    onUntracked(pid: number): void {
      const entry = pidIndex.get(pid);
      if (!entry) return;
      const teamMap = counts.get(entry.teamId);
      if (teamMap) {
        const current = teamMap.get(entry.role) ?? 1;
        if (current <= 1) {
          teamMap.delete(entry.role);
        } else {
          teamMap.set(entry.role, current - 1);
        }
        if (teamMap.size === 0) {
          counts.delete(entry.teamId);
        }
      }
      pidIndex.delete(pid);
    },

    getCount(teamId: string, role: string): number {
      return counts.get(teamId)?.get(role) ?? 0;
    },

    getTeamCounts(teamId: string): ReadonlyMap<string, number> {
      return counts.get(teamId) ?? new Map();
    },

    resetFromSnapshot(sessions: Iterable<{ pid?: number; role?: string; teamId?: string }>): void {
      counts.clear();
      pidIndex.clear();
      let recovered = 0;
      for (const s of sessions) {
        if (s.pid && s.teamId && s.role) {
          // PID liveness check — only count live processes.
          try {
            process.kill(s.pid, 0);
          } catch {
            continue;
          }
          const teamMap = ensureRoleBucket(s.teamId, s.role);
          teamMap.set(s.role, (teamMap.get(s.role) ?? 0) + 1);
          pidIndex.set(s.pid, { teamId: s.teamId, role: s.role });
          recovered++;
        }
      }
      if (recovered > 0) {
        logger.debug(`[POOL COUNT TRACKER] Recovered ${recovered} live sessions into pool counter`);
      }
    },

    getGlobalCount(role: string): number {
      let total = 0;
      for (const teamMap of counts.values()) {
        total += teamMap.get(role) ?? 0;
      }
      return total;
    },

    dump(): Record<string, Record<string, number>> {
      const result: Record<string, Record<string, number>> = {};
      for (const [teamId, teamMap] of counts.entries()) {
        result[teamId] = Object.fromEntries(teamMap.entries());
      }
      return result;
    },
  };
}
