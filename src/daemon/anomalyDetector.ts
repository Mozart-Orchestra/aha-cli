/**
 * @module anomalyDetector
 * @description Automated anomaly detection for the daemon heartbeat cycle.
 *
 * Detects two categories of anomalies:
 *   1. Spawn frequency — same role spawned >N times in a sliding window
 *   2. Pool overflow — help-agent / supervisor count exceeds configured limits
 *
 * Context window monitoring and heartbeat timeout detection are already
 * handled by `AgentHeartbeat` (heartbeat.ts) — those are NOT duplicated here.
 *
 * ```mermaid
 * graph TD
 *   A[run.ts heartbeat] --> B[runAnomalyDetection]
 *   B --> C[traceStore.queryByKind]
 *   B --> D[pidToTrackedSession scan]
 *   B --> E[emitTraceEvent anomaly_detected]
 * ```
 */

import { TraceEventKind } from '@/trace/traceTypes';
import { queryByKind } from '@/trace/traceStore';
import { emitTraceEvent } from '@/trace/traceEmitter';
import { logger } from '@/ui/logger';
import type { TrackedSession } from './types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnomalyAlert {
  readonly type: 'spawn_frequency' | 'pool_overflow';
  readonly severity: 'warn' | 'critical';
  readonly message: string;
  readonly teamId: string | null;
  readonly details: Readonly<Record<string, unknown>>;
}

export interface AnomalyDetectorConfig {
  /** Max spawns of the same role within the window before alerting (default: 5) */
  readonly spawnFrequencyThreshold: number;
  /** Sliding window in ms for spawn frequency check (default: 300_000 = 5 min) */
  readonly spawnFrequencyWindowMs: number;
  /** Max help-agent instances per team (default: 2) */
  readonly maxHelpAgents: number;
  /** Max supervisor instances globally (default: 2) */
  readonly maxSupervisors: number;
}

export interface AnomalyDetectorContext {
  /** Live session map from the daemon */
  readonly pidToTrackedSession: Map<number, TrackedSession>;
  /** Team IDs currently active in the daemon */
  readonly activeTeamIds: readonly string[];
}

const DEFAULT_CONFIG: AnomalyDetectorConfig = {
  spawnFrequencyThreshold: 5,
  spawnFrequencyWindowMs: 5 * 60 * 1000,
  maxHelpAgents: 2,
  maxSupervisors: 2,
};

// ── Cooldown tracking ─────────────────────────────────────────────────────────

/** Last emit timestamp per alert key to avoid log spam. */
const alertCooldown = new Map<string, number>();
/** Minimum ms between repeated alerts of the same key (default: 5 min) */
const ALERT_COOLDOWN_MS = 5 * 60 * 1000;

function isAlertOnCooldown(key: string): boolean {
  const lastEmitted = alertCooldown.get(key);
  if (lastEmitted == null) return false;
  return Date.now() - lastEmitted < ALERT_COOLDOWN_MS;
}

function markAlertEmitted(key: string): void {
  alertCooldown.set(key, Date.now());
}

// ── Detection: Spawn Frequency ────────────────────────────────────────────────

function detectSpawnFrequency(
  config: AnomalyDetectorConfig,
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  const since = Date.now() - config.spawnFrequencyWindowMs;

  let events: import('@/trace/traceTypes').TraceEvent[];
  try {
    events = queryByKind(TraceEventKind.spawn_started, { since });
  } catch (err) {
    // Trace DB may not be initialized yet — skip detection silently.
    return alerts;
  }

  // Group spawn events by team + role
  const countByTeamRole = new Map<string, { teamId: string | null; role: string; count: number }>();
  for (const event of events) {
    let role = 'unknown';
    if (event.attrs_json) {
      try {
        const attrs = JSON.parse(event.attrs_json) as Record<string, unknown>;
        if (typeof attrs.role === 'string') role = attrs.role;
      } catch { /* ignore malformed attrs */ }
    }
    const key = `${event.team_id ?? 'global'}:${role}`;
    const existing = countByTeamRole.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      countByTeamRole.set(key, { teamId: event.team_id, role, count: 1 });
    }
  }

  for (const [, data] of countByTeamRole) {
    if (data.count > config.spawnFrequencyThreshold) {
      alerts.push({
        type: 'spawn_frequency',
        severity: data.count > config.spawnFrequencyThreshold * 2 ? 'critical' : 'warn',
        message: `Spawn frequency anomaly: role="${data.role}" spawned ${data.count} times in ${Math.round(config.spawnFrequencyWindowMs / 60_000)}min (threshold: ${config.spawnFrequencyThreshold})`,
        teamId: data.teamId,
        details: {
          role: data.role,
          count: data.count,
          threshold: config.spawnFrequencyThreshold,
          windowMs: config.spawnFrequencyWindowMs,
        },
      });
    }
  }

  return alerts;
}

// ── Detection: Pool Overflow ──────────────────────────────────────────────────

interface PoolCount {
  readonly teamId: string;
  readonly helpAgents: number;
  readonly supervisors: number;
}

function countPoolByTeam(
  pidToTrackedSession: Map<number, TrackedSession>,
): PoolCount[] {
  // Group by team
  const byTeam = new Map<string, { helpAgents: number; supervisors: number }>();

  for (const session of pidToTrackedSession.values()) {
    const meta = session.ahaSessionMetadataFromLocalWebhook;
    const role = meta?.role;
    if (role !== 'help-agent' && role !== 'supervisor') continue;

    const teamId = meta?.teamId ?? meta?.roomId ?? 'global';
    const existing = byTeam.get(teamId);
    if (existing) {
      if (role === 'help-agent') existing.helpAgents += 1;
      else if (role === 'supervisor') existing.supervisors += 1;
    } else {
      byTeam.set(teamId, {
        helpAgents: role === 'help-agent' ? 1 : 0,
        supervisors: role === 'supervisor' ? 1 : 0,
      });
    }
  }

  return Array.from(byTeam.entries()).map(([teamId, counts]) => ({
    teamId,
    ...counts,
  }));
}

function detectPoolOverflow(
  ctx: AnomalyDetectorContext,
  config: AnomalyDetectorConfig,
): AnomalyAlert[] {
  const alerts: AnomalyAlert[] = [];
  const poolCounts = countPoolByTeam(ctx.pidToTrackedSession);

  for (const pool of poolCounts) {
    if (pool.helpAgents > config.maxHelpAgents) {
      alerts.push({
        type: 'pool_overflow',
        severity: pool.helpAgents > config.maxHelpAgents * 2 ? 'critical' : 'warn',
        message: `Pool overflow: ${pool.helpAgents} help-agents in team ${pool.teamId} (max: ${config.maxHelpAgents})`,
        teamId: pool.teamId,
        details: {
          role: 'help-agent',
          count: pool.helpAgents,
          max: config.maxHelpAgents,
        },
      });
    }

    if (pool.supervisors > config.maxSupervisors) {
      alerts.push({
        type: 'pool_overflow',
        severity: pool.supervisors > config.maxSupervisors * 2 ? 'critical' : 'warn',
        message: `Pool overflow: ${pool.supervisors} supervisors in team ${pool.teamId} (max: ${config.maxSupervisors})`,
        teamId: pool.teamId,
        details: {
          role: 'supervisor',
          count: pool.supervisors,
          max: config.maxSupervisors,
        },
      });
    }
  }

  return alerts;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run one tick of anomaly detection. Called from the daemon heartbeat interval.
 *
 * Returns detected anomalies. Each anomaly is also emitted as a trace event
 * with cooldown deduplication to avoid log spam.
 */
export function runAnomalyDetection(
  ctx: AnomalyDetectorContext,
  partialConfig?: Partial<AnomalyDetectorConfig>,
): AnomalyAlert[] {
  const config: AnomalyDetectorConfig = { ...DEFAULT_CONFIG, ...partialConfig };
  const allAlerts: AnomalyAlert[] = [
    ...detectSpawnFrequency(config),
    ...detectPoolOverflow(ctx, config),
  ];

  // Emit trace events for new alerts (with cooldown)
  for (const alert of allAlerts) {
    const cooldownKey = `${alert.type}:${alert.teamId ?? 'global'}:${(alert.details as { role?: string }).role ?? ''}`;
    if (isAlertOnCooldown(cooldownKey)) continue;

    try {
      emitTraceEvent(
        TraceEventKind.anomaly_detected,
        'daemon',
        { team_id: alert.teamId },
        alert.message,
        {
          level: alert.severity === 'critical' ? 'error' : 'warn',
          status: alert.type,
          attrs: {
            anomalyType: alert.type,
            severity: alert.severity,
            ...alert.details,
          },
        },
      );
      markAlertEmitted(cooldownKey);
    } catch (err) {
      logger.debug('[ANOMALY DETECTOR] Failed to emit trace event:', err);
    }
  }

  return allAlerts;
}
