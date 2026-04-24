/**
 * @module helpAutoSpawn
 * @description Automatic help-agent spawning when @help is detected in team chat.
 *
 * Polls team message JSONL files each heartbeat cycle. If any message newer than
 * the last-checked timestamp contains "@help" (case-insensitive), and the team's
 * help-agent pool has room, a help-agent is spawned via requestHelp.
 *
 * Constraints enforced:
 *   - 60 s per-team debounce: at most one spawn trigger per team per minute
 *   - Pool cap: no spawn when active help-agent count ≥ poolMax (default 2)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { logger } from '@/ui/logger';
import { Metadata } from '@/api/types';
import { containsHelpMention } from '@/claude/team/helpLane';

// ── Constants ─────────────────────────────────────────────────────────────────

export const HELP_POOL_MAX = 2;
export const HELP_DEBOUNCE_MS = 60_000;
/** Warm-up period after recovery before auto-spawn is allowed (ms). */
export const HELP_RECOVERY_WARMUP_MS = 60_000;

// ── Types ─────────────────────────────────────────────────────────────────────

interface TeamMessage {
  id?: string;
  teamId?: string;
  fromRole?: string;
  content: string;
  timestamp: number;
  type?: string;
  metadata?: {
    type?: string;
    [key: string]: unknown;
  };
}

/** Per-team mutable state tracked across heartbeat cycles. */
export interface HelpAutoSpawnState {
  /** Last timestamp (ms) we read messages for each team. */
  lastCheckedTsByTeam: Map<string, number>;
  /** Last timestamp (ms) we triggered a help-agent spawn for each team. */
  lastSpawnTsByTeam: Map<string, number>;
  /**
   * Timestamp to use when a team is encountered for the first time.
   * Prevents replaying all historical @help messages after daemon restart.
   * Defaults to 0 (read all history) when not provided.
   */
  initialNow: number;
  /**
   * Timestamp (ms) when session recovery completed. null if not yet completed.
   * Auto-spawn is blocked until `recoveryCompletedAt + HELP_RECOVERY_WARMUP_MS`
   * to give pidToTrackedSession time to stabilize after daemon restart.
   */
  recoveryCompletedAt: number | null;
}

export type RequestHelpFn = (params: {
  teamId: string;
  type: string;
  description: string;
  severity: string;
}) => Promise<{
  success: boolean;
  helpAgentSessionId?: string;
  reused?: boolean;
  saturated?: boolean;
  error?: string;
}>;

/** Session shape expected by countActiveHelpAgents (subset of TrackedSession). */
interface SessionWithMeta {
  ahaSessionMetadataFromLocalWebhook?: Metadata;
  pid?: number;
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createHelpAutoSpawnState(initialNow?: number): HelpAutoSpawnState {
  return {
    lastCheckedTsByTeam: new Map(),
    lastSpawnTsByTeam: new Map(),
    initialNow: initialNow ?? 0,
    recoveryCompletedAt: null,
  };
}

/** Mark recovery as complete. Called from run.ts after signalRecoveryComplete(). */
export function markRecoveryComplete(state: HelpAutoSpawnState): void {
  state.recoveryCompletedAt = Date.now();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTeamMessages(teamId: string, fromTs: number, cwd: string): TeamMessage[] {
  const file = path.join(cwd, '.aha', 'teams', teamId, 'messages.jsonl');
  if (!fs.existsSync(file)) return [];
  try {
    const raw = fs.readFileSync(file, 'utf-8');
    const result: TeamMessage[] = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line) as TeamMessage;
        if (typeof msg.timestamp === 'number' && msg.timestamp > fromTs) {
          result.push(msg);
        }
      } catch { /* skip malformed lines */ }
    }
    return result;
  } catch {
    return [];
  }
}

export function shouldTriggerHelpAutoSpawn(message: TeamMessage): boolean {
  if (!containsHelpMention(message.content)) {
    return false;
  }

  if (message.fromRole === 'help-agent') {
    return false;
  }

  if (message.metadata?.type === 'handshake') {
    return false;
  }

  return true;
}

export function countActiveHelpAgents(
  sessions: Iterable<SessionWithMeta>,
  teamId: string
): number {
  let count = 0;
  for (const s of sessions) {
    const meta = s.ahaSessionMetadataFromLocalWebhook;
    const sessionTeamId = meta?.teamId ?? meta?.roomId;
    if (sessionTeamId === teamId && meta?.role === 'help-agent') {
      // Verify PID is still alive — kill(pid, 0) is a liveness check, not a kill.
      // Without this, a killed-but-undead process stays in pidToTrackedSession
      // while the auto-spawner sees count=0 and bypasses HELP_POOL_MAX.
      if (s.pid) {
        try {
          process.kill(s.pid, 0);
        } catch {
          continue; // PID is dead, don't count it
        }
      }
      count++;
    }
  }
  return count;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check all active teams for @help messages and spawn help-agents as needed.
 *
 * Called once per heartbeat cycle (typically every 60 s) from run.ts.
 *
 * @param params.activeTeamIds    - All currently active team IDs to scan.
 * @param params.sessions         - Live session map values for pool counting.
 * @param params.state            - Mutable per-team debounce/check-cursor state.
 * @param params.requestHelp      - Callback to spawn/reuse a help-agent.
 * @param params.serverHelpCountFn - Optional async fn that queries server for help-agent
 *                                   count per team. When provided, pool cap uses
 *                                   max(localCount, serverCount) for dual-source defense.
 * @param params.poolMax          - Max concurrent help-agents per team (default 2).
 * @param params.debounceMs       - Min ms between spawns per team (default 60 000).
 * @param params.cwd              - Working directory for .aha/teams/ (default process.cwd()).
 * @param params.now              - Injectable clock for testing (default Date.now()).
 */
export async function checkHelpAutoSpawn(params: {
  activeTeamIds: string[];
  sessions: Iterable<SessionWithMeta>;
  state: HelpAutoSpawnState;
  requestHelp: RequestHelpFn;
  serverHelpCountFn?: (teamId: string) => Promise<number>;
  poolMax?: number;
  debounceMs?: number;
  cwd?: string;
  now?: number;
}): Promise<void> {
  const {
    activeTeamIds,
    sessions,
    state,
    requestHelp,
    serverHelpCountFn,
  } = params;
  const poolMax = params.poolMax ?? HELP_POOL_MAX;
  const debounceMs = params.debounceMs ?? HELP_DEBOUNCE_MS;
  const cwd = params.cwd ?? process.cwd();
  const now = params.now ?? Date.now();

  // Recovery warm-up gate: skip auto-spawn until recovery + warmup period elapses.
  // This prevents spawn overflow during the window between daemon start and
  // pidToTrackedSession being fully populated by recoverExistingSessions().
  if (state.recoveryCompletedAt == null) {
    logger.debug('[HELP AUTO SPAWN] Recovery not yet complete — skipping all teams');
    return;
  }
  if (now - state.recoveryCompletedAt < HELP_RECOVERY_WARMUP_MS) {
    const remaining = Math.ceil((HELP_RECOVERY_WARMUP_MS - (now - state.recoveryCompletedAt)) / 1000);
    logger.debug(`[HELP AUTO SPAWN] Recovery warm-up active (${remaining}s remaining) — skipping all teams`);
    return;
  }

  for (const teamId of activeTeamIds) {
    const lastChecked = state.lastCheckedTsByTeam.get(teamId) ?? state.initialNow;
    const lastSpawn = state.lastSpawnTsByTeam.get(teamId) ?? 0;

    // Advance the check cursor regardless of spawn outcome
    state.lastCheckedTsByTeam.set(teamId, now);

    // Debounce: skip if we recently triggered a spawn for this team
    if (now - lastSpawn < debounceMs) {
      continue;
    }

    const messages = readTeamMessages(teamId, lastChecked, cwd);

    const hasHelpRequest = messages.some(shouldTriggerHelpAutoSpawn);

    if (!hasHelpRequest) continue;

    // Pool cap check — local PID-based count is the authoritative source.
    // Server roster is logged for diagnostics but NOT used for blocking because
    // server-side member records are never cleaned up when sessions die
    // (lifecycle.runStatus stays 'active' indefinitely).
    const localHelpCount = countActiveHelpAgents(sessions, teamId);
    const activeHelpCount = localHelpCount;

    if (serverHelpCountFn) {
      try {
        const serverHelpCount = await serverHelpCountFn(teamId);
        if (serverHelpCount !== localHelpCount) {
          logger.debug(
            `[HELP AUTO SPAWN] Server/Local count mismatch for team ${teamId}: ` +
            `server=${serverHelpCount}, local=${localHelpCount} (using local)`
          );
        }
      } catch {
        // Diagnostic only — ignore failure
      }
    }

    if (activeHelpCount >= poolMax) {
      logger.debug(
        `[HELP AUTO SPAWN] @help detected for team ${teamId} but pool is full ` +
        `(${activeHelpCount}/${poolMax}) — skipping`
      );
      continue;
    }

    logger.debug(
      `[HELP AUTO SPAWN] @help detected for team ${teamId} ` +
      `(local=${localHelpCount}, effective=${activeHelpCount}, max ${poolMax}) — spawning help-agent`
    );

    // Record spawn time before the async call to prevent parallel triggers
    state.lastSpawnTsByTeam.set(teamId, now);

    try {
      const result = await requestHelp({
        teamId,
        type: 'help-request',
        description: '@help mention detected in team chat — auto-spawning help-agent',
        severity: 'medium',
      });

      if (result.success || result.reused) {
        logger.debug(
          `[HELP AUTO SPAWN] Help-agent ${result.reused ? 'reused' : 'spawned'} ` +
          `for team ${teamId}: ${result.helpAgentSessionId ?? '(no session id)'}`
        );
      } else if (result.saturated) {
        logger.debug(`[HELP AUTO SPAWN] Pool saturated for team ${teamId} after requestHelp`);
      } else {
        logger.debug(`[HELP AUTO SPAWN] requestHelp failed for team ${teamId}: ${result.error ?? 'unknown'}`);
      }
    } catch (err) {
      logger.debug(`[HELP AUTO SPAWN] Error calling requestHelp for team ${teamId}: ${err}`);
    }
  }
}
