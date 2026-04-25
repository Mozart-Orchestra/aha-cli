/**
 * @module mentionAckTracker
 * @description Tracks @-mention ack timeouts for coordinator failover detection.
 *
 * When a team member is @-mentioned with high/urgent priority and does not respond
 * within the configured timeout, this module detects the "silent" state and produces
 * a failover recommendation (notify backup owner).
 *
 * PDCA-01: Coordinator失联自动接管机制
 *
 * ```mermaid
 * graph TD
 *   A[supervisorScheduler tick] --> B[runAckTimeoutCheck]
 *   B --> C{any pending watches?}
 *   C -->|yes| D{timeout elapsed?}
 *   D -->|yes| E{compact attempted?}
 *   E -->|no| F[return compact recommendation]
 *   E -->|yes| G[return notify-backup recommendation]
 *   D -->|no| H[no action]
 *   C -->|no| H
 * ```
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { configuration } from '@/configuration';
import { logger } from '@/ui/logger';

// ── Types ──────────────────────────────────────────────────────────────────────

/** A pending ack watch for a specific session */
export interface AckWatch {
    readonly targetSessionId: string;
    readonly targetRole: string;
    readonly mentionsCount: number;
    readonly firstMentionAt: number;
    readonly lastMentionAt: number;
    readonly priority: 'urgent' | 'high' | 'normal' | 'low';
    readonly compactAttempted: boolean;
    readonly compactResult?: 'success' | 'failed';
}

/** Failover configuration stored in supervisorState */
export interface CoordinatorFailoverConfig {
    readonly mode: 'dry-run' | 'active';
    /** Maps role → backup role for failover */
    readonly fallbackMap: Readonly<Record<string, string>>;
    /** Tracks consecutive takeovers per role to detect loops */
    readonly consecutiveTakeovers: Readonly<Record<string, number>>;
}

/** The result of an ack timeout check */
export type AckCheckResult =
    | { readonly action: 'none' }
    | { readonly action: 'compact'; readonly watch: AckWatch }
    | { readonly action: 'notify-backup'; readonly watch: AckWatch; readonly backupRole: string };

/** Audit log entry for coordinator-takeover.jsonl */
export interface TakeoverAuditEntry {
    readonly timestamp: number;
    readonly triggerRole: string;
    readonly triggerSessionId: string;
    readonly targetSessionId: string;
    readonly targetPid?: number;
    readonly reason: 'silent' | 'hung' | 'compact-failed' | 'consecutive-limit';
    readonly action: 'compact' | 'notify-backup' | 'escalate-user';
    readonly dryRun: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────────

/** Timeout thresholds by priority (ms) */
const SILENT_THRESHOLD_MS: Readonly<Record<string, number>> = {
    urgent: 5 * 60 * 1000,    // 5 min
    high: 7 * 60 * 1000,      // 7 min
    normal: 15 * 60 * 1000,   // 15 min
    low: 30 * 60 * 1000,      // 30 min
};

/** Confirmed silent threshold: always 10 min regardless of priority */
const CONFIRMED_SILENT_MS = 10 * 60 * 1000;

/** Minimum mention count before declaring silent */
const MIN_MENTION_COUNT = 2;

/** Maximum consecutive takeovers before escalating to user */
export const MAX_CONSECUTIVE_TAKEOVERS = 2;

/** Default fallback map */
const DEFAULT_FALLBACK_MAP: Readonly<Record<string, string>> = {
    'release-engineer': 'master',
    'security-officer': 'master',
    'qa-commander': 'master',
    'builder': 'master',
    'master': 'supervisor',
    'supervisor': 'master',
};

// ── Silent detection ───────────────────────────────────────────────────────────

/**
 * Get the silent threshold for a given priority level.
 * Falls back to 10 min for unknown priorities.
 */
function getSilentThresholdMs(priority: string): number {
    return SILENT_THRESHOLD_MS[priority] ?? CONFIRMED_SILENT_MS;
}

/**
 * Check if a watch has exceeded its silent threshold.
 */
function isSilent(watch: AckWatch, now: number): boolean {
    const threshold = getSilentThresholdMs(watch.priority);
    const elapsed = now - watch.lastMentionAt;
    return elapsed >= threshold && watch.mentionsCount >= MIN_MENTION_COUNT;
}

/**
 * Check if a watch has exceeded the confirmed-silent threshold (10 min).
 */
function isConfirmedSilent(watch: AckWatch, now: number): boolean {
    return (now - watch.lastMentionAt) >= CONFIRMED_SILENT_MS;
}

// ── Core check logic ───────────────────────────────────────────────────────────

/**
 * Run ack timeout check on all pending watches.
 *
 * Returns an array of recommended actions (compact or notify-backup).
 * Does NOT mutate input — returns new objects.
 */
export function runAckTimeoutCheck(
    watches: readonly AckWatch[],
    config: CoordinatorFailoverConfig,
    now: number,
): AckCheckResult[] {
    if (config.mode !== 'dry-run' && config.mode !== 'active') {
        return [];
    }

    const results: AckCheckResult[] = [];

    for (const watch of watches) {
        if (!isSilent(watch, now)) {
            continue;
        }

        // Step 1: compact_agent must be attempted first
        if (!watch.compactAttempted) {
            results.push({ action: 'compact', watch });
            continue;
        }

        // Step 2: if compact succeeded, re-mention was sent — check if still silent
        if (watch.compactResult === 'success' && !isConfirmedSilent(watch, now)) {
            continue; // Still within re-evaluation window after compact
        }

        // Step 3: notify backup owner
        const backupRole = config.fallbackMap[watch.targetRole];
        if (!backupRole) {
            logger.debug(
                `[ACK-TRACKER] No backup role configured for "${watch.targetRole}", ` +
                `skipping failover`
            );
            continue;
        }

        // Check consecutive takeover limit
        const consecutiveCount = config.consecutiveTakeovers[watch.targetRole] ?? 0;
        if (consecutiveCount >= MAX_CONSECUTIVE_TAKEOVERS) {
            logger.warn(
                `[ACK-TRACKER] Role "${watch.targetRole}" has been taken over ` +
                `${consecutiveCount} times consecutively — escalating to user`
            );
            // Still produce the result but mark as escalate
            results.push({
                action: 'notify-backup',
                watch,
                backupRole,
            });
            continue;
        }

        results.push({ action: 'notify-backup', watch, backupRole });
    }

    return results;
}

// ── Watch management (immutable) ───────────────────────────────────────────────

/**
 * Add a mention to the watch list. Returns a new array — does NOT mutate input.
 *
 * If a watch already exists for the target session, increments the mention count.
 */
export function addMentionToWatches(
    watches: readonly AckWatch[],
    sessionId: string,
    role: string,
    priority: 'urgent' | 'high' | 'normal' | 'low',
    now: number,
): AckWatch[] {
    const existing = watches.find(w => w.targetSessionId === sessionId);

    if (existing) {
        return watches.map(w =>
            w.targetSessionId === sessionId
                ? {
                    ...w,
                    mentionsCount: w.mentionsCount + 1,
                    lastMentionAt: now,
                    priority: comparePriority(priority, w.priority) > 0 ? priority : w.priority,
                }
                : w
        );
    }

    return [
        ...watches,
        {
            targetSessionId: sessionId,
            targetRole: role,
            mentionsCount: 1,
            firstMentionAt: now,
            lastMentionAt: now,
            priority,
            compactAttempted: false,
        },
    ];
}

/**
 * Mark compact as attempted on a watch. Returns a new array — does NOT mutate.
 */
export function markCompactAttempted(
    watches: readonly AckWatch[],
    sessionId: string,
    result: 'success' | 'failed',
): AckWatch[] {
    return watches.map(w =>
        w.targetSessionId === sessionId
            ? { ...w, compactAttempted: true, compactResult: result }
            : w
    );
}

/**
 * Remove a watch (e.g. after the target session responded). Returns a new array.
 * Also returns an updated consecutiveTakeovers map with the target role's counter reset to 0,
 * since the role has recovered.
 */
export function removeWatch(
    watches: readonly AckWatch[],
    sessionId: string,
    consecutiveTakeovers?: Readonly<Record<string, number>>,
): { watches: AckWatch[]; consecutiveTakeovers: Record<string, number> } {
    const removed = watches.find(w => w.targetSessionId === sessionId);
    const updatedWatches = watches.filter(w => w.targetSessionId !== sessionId);

    // Reset consecutive counter for the recovered role
    const updatedCounters: Record<string, number> = { ...(consecutiveTakeovers ?? {}) };
    if (removed && updatedCounters[removed.targetRole] !== undefined) {
        updatedCounters[removed.targetRole] = 0;
    }

    return { watches: updatedWatches, consecutiveTakeovers: updatedCounters };
}

/**
 * Prune watches older than the max retention window (1 hour).
 * Returns a new array — does NOT mutate.
 */
export function pruneStaleWatches(
    watches: readonly AckWatch[],
    now: number,
    maxAgeMs: number = 60 * 60 * 1000,
): AckWatch[] {
    return watches.filter(w => (now - w.firstMentionAt) < maxAgeMs);
}

// ── Audit log ──────────────────────────────────────────────────────────────────

/**
 * Append an entry to the coordinator-takeover audit log.
 * Best-effort — failure to write does NOT throw.
 */
export function appendTakeoverAudit(
    teamId: string,
    entry: TakeoverAuditEntry,
): void {
    try {
        const logPath = getTakeoverLogPath(teamId);
        const dir = dirname(logPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const line = JSON.stringify(entry) + '\n';
        appendFileSync(logPath, line, 'utf-8');
    } catch (error) {
        logger.debug(
            `[ACK-TRACKER] Failed to append takeover audit for team ${teamId}: ` +
            `${error instanceof Error ? error.message : String(error)}`
        );
    }
}

/**
 * Get the path to the takeover audit log for a team.
 */
export function getTakeoverLogPath(teamId: string): string {
    return join(configuration.ahaHomeDir, 'teams', teamId, 'coordinator-takeover.jsonl');
}

// ── Defaults ───────────────────────────────────────────────────────────────────

/**
 * Get the default failover config.
 */
export function getDefaultFailoverConfig(): CoordinatorFailoverConfig {
    return {
        mode: 'dry-run',
        fallbackMap: { ...DEFAULT_FALLBACK_MAP },
        consecutiveTakeovers: {},
    };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Compare two priorities. Returns positive if a > b.
 */
function comparePriority(
    a: 'urgent' | 'high' | 'normal' | 'low',
    b: 'urgent' | 'high' | 'normal' | 'low',
): number {
    const order: Record<string, number> = { urgent: 4, high: 3, normal: 2, low: 1 };
    return (order[a] ?? 0) - (order[b] ?? 0);
}
