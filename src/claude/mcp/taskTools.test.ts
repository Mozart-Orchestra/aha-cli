import { describe, expect, it } from 'vitest';
import {
    buildShowAllTaskPage,
    collectForeignActiveExecutionLockSessionIdsForAssignee,
    collectReleasableOverlapExecutionLockSessionIdsForAssignee,
    hasActiveExecutionLinkForSelf,
    isRetryableTaskSessionMismatchError,
    parseOverlappingActiveWorkTaskId,
    resolveCreateTaskPolicy,
    resolveTaskActorSessionId,
    runWithTaskSessionFallback,
    shouldRetryTaskSessionWithClient,
    splitTaskCommentContent,
    summarizeTaskForList,
} from './taskTools';

describe('resolveCreateTaskPolicy', () => {
    it('allows coordinator roles to create standard tasks with assignees', () => {
        const result = resolveCreateTaskPolicy({
            role: 'master',
            effectiveGenome: null,
            requestedType: 'standard',
            requestedAssigneeId: 'sess-1',
        });

        expect(result).toEqual({
            allowed: true,
            taskType: 'standard',
            assigneeId: 'sess-1',
        });
    });

    it('denies regular task creation for non-coordinator worker roles', () => {
        const result = resolveCreateTaskPolicy({
            role: 'implementer',
            effectiveGenome: null,
            requestedType: 'standard',
        });

        expect(result.allowed).toBe(false);
        expect(result.taskType).toBe('standard');
        expect(result.denyMessage).toContain('cannot create team tasks');
        expect(result.denyMessage).toContain('type="hypothesis"');
    });

    it('allows worker roles to create unassigned hypothesis tasks', () => {
        const result = resolveCreateTaskPolicy({
            role: 'implementer',
            effectiveGenome: null,
            requestedType: 'hypothesis',
        });

        expect(result).toEqual({
            allowed: true,
            taskType: 'hypothesis',
            assigneeId: null,
            labels: ['hypothesis'],
        });
    });

    it('rejects assigneeId on hypothesis tasks even for coordinators', () => {
        const result = resolveCreateTaskPolicy({
            role: 'master',
            effectiveGenome: null,
            requestedType: 'hypothesis',
            requestedAssigneeId: 'sess-2',
        });

        expect(result.allowed).toBe(false);
        expect(result.taskType).toBe('hypothesis');
        expect(result.denyMessage).toContain('must be unassigned');
    });

    it('still honors explicit task.create authority for standard tasks', () => {
        const result = resolveCreateTaskPolicy({
            role: 'implementer',
            effectiveGenome: { authorities: ['task.create'] },
            requestedType: 'standard',
        });

        expect(result).toEqual({
            allowed: true,
            taskType: 'standard',
            assigneeId: null,
        });
    });
});

describe('summarizeTaskForList', () => {
    it('keeps only compact fields needed for list views', () => {
        const summary = summarizeTaskForList({
            id: 'task-1',
            title: 'Fix scope noise',
            status: 'review',
            priority: 'high',
            assigneeId: 'session-1',
            reporterId: null,
            parentTaskId: 'parent-1',
            approvalStatus: 'pending',
            labels: ['scope', 'repo', 1 as any],
            updatedAt: 123,
            createdAt: 100,
            depth: 2,
            comments: [{}, {}],
            blockers: [{}],
            acceptanceCriteria: ['a', 'b'],
            subtaskIds: ['sub-1'],
            executionLinks: [
                { sessionId: 'old-primary', role: 'primary', status: 'active' },
                { sessionId: 'done-primary', role: 'primary', status: 'completed' },
            ],
        });

        expect(summary).toEqual({
            id: 'task-1',
            title: 'Fix scope noise',
            status: 'review',
            priority: 'high',
            assigneeId: 'session-1',
            reporterId: null,
            parentTaskId: 'parent-1',
            approvalStatus: 'pending',
            labels: ['scope', 'repo'],
            depth: 2,
            updatedAt: 123,
            createdAt: 100,
            commentCount: 2,
            blockerCount: 1,
            acceptanceCriteriaCount: 2,
            subtaskCount: 1,
            activeExecutionLocks: [{
                sessionId: 'old-primary',
                role: 'primary',
                status: 'active',
            }],
        });
    });
});

describe('buildShowAllTaskPage', () => {
    const tasks = Array.from({ length: 4 }, (_, index) => ({
        id: `task-${index + 1}`,
        title: `Task ${index + 1}`,
        status: index % 2 === 0 ? 'todo' : 'review',
        comments: Array.from({ length: index }, () => ({ content: 'x'.repeat(1000) })),
        blockers: [],
        acceptanceCriteria: [],
        subtaskIds: [],
    }));

    it('returns compact board summaries instead of raw full tasks', () => {
        const result = buildShowAllTaskPage({
            tasks,
            teamStats: { totalTasks: 4 },
            pendingApprovals: [{
                id: 'task-2',
                title: 'Task 2',
                status: 'review',
                comments: [{}, {}],
            }],
        }) as any;

        expect(result.mode).toBe('board-overview');
        expect(result.teamStats).toEqual({ totalTasks: 4 });
        expect(result.pendingApprovals).toEqual([{
            id: 'task-2',
            title: 'Task 2',
            status: 'review',
            priority: null,
            assigneeId: null,
            reporterId: null,
            parentTaskId: null,
            approvalStatus: null,
            labels: [],
            depth: 0,
            updatedAt: null,
            createdAt: null,
            commentCount: 2,
            blockerCount: 0,
            acceptanceCriteriaCount: 0,
            subtaskCount: 0,
        }]);
        expect(result.boardOverview).toMatchObject({
            totalBoardTasks: 4,
            matchingTasks: 4,
            returnedTasks: 4,
            pendingApprovalCount: 1,
        });
        expect(result.allTasks).toHaveLength(4);
        expect(result.allTasks[1]).toMatchObject({ id: 'task-2', commentCount: 1 });
        expect(result.allTasks[1]).not.toHaveProperty('comments');
        expect(result.guidance.details).toContain('get_task');
    });

    it('keeps status filtering while staying compact', () => {
        const result = buildShowAllTaskPage({
            tasks,
            status: 'review',
        }) as any;

        expect(result.filters).toEqual({ status: 'review' });
        expect(result.boardOverview).toMatchObject({
            totalBoardTasks: 4,
            matchingTasks: 2,
            returnedTasks: 2,
            pendingApprovalCount: 0,
            statusCounts: {
                todo: 0,
                'in-progress': 0,
                review: 2,
                blocked: 0,
                done: 0,
            },
        });
        expect(result.allTasks).toHaveLength(2);
        expect(result.allTasks.every((task: any) => task.status === 'review')).toBe(true);
    });
});

describe('resolveTaskActorSessionId', () => {
    it('prefers metadata.ahaSessionId when present', () => {
        expect(resolveTaskActorSessionId({ ahaSessionId: 'server-sid' }, 'local-sid')).toBe('server-sid');
    });

    it('falls back to client session id when ahaSessionId is empty or whitespace', () => {
        expect(resolveTaskActorSessionId({ ahaSessionId: '' }, 'local-sid')).toBe('local-sid');
        expect(resolveTaskActorSessionId({ ahaSessionId: '   ' }, 'local-sid')).toBe('local-sid');
    });

    it('falls back to client session id when metadata is missing', () => {
        expect(resolveTaskActorSessionId({}, 'local-sid')).toBe('local-sid');
        expect(resolveTaskActorSessionId(null, 'local-sid')).toBe('local-sid');
        expect(resolveTaskActorSessionId(undefined, 'local-sid')).toBe('local-sid');
    });
});

describe('splitTaskCommentContent', () => {
    it('keeps short comments as a single trimmed chunk', () => {
        expect(splitTaskCommentContent('  short note  ', 20)).toEqual(['short note']);
    });

    it('drops blank comments after trimming', () => {
        expect(splitTaskCommentContent('   \n\t   ', 20)).toEqual([]);
    });

    it('splits long task comments into bounded chunks to avoid server 400s', () => {
        const content = [
            'a'.repeat(12),
            'b'.repeat(12),
            'c'.repeat(12),
        ].join('\n');

        const chunks = splitTaskCommentContent(content, 20);

        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
        expect(chunks.join('\n')).toContain('aaaaaaaaaaaa');
        expect(chunks.join('\n')).toContain('bbbbbbbbbbbb');
        expect(chunks.join('\n')).toContain('cccccccccccc');
    });
});

describe('task session fallback retry helpers', () => {
    it('detects retryable session mismatch errors', () => {
        expect(isRetryableTaskSessionMismatchError(new Error('Invalid actor session for this team'))).toBe(true);
        expect(isRetryableTaskSessionMismatchError(new Error('Request failed with status code 400'))).toBe(true);
        expect(isRetryableTaskSessionMismatchError(new Error('Network timeout'))).toBe(false);
    });

    it('retries with client session when stale ahaSessionId mismatch is detected', async () => {
        const calls: string[] = [];
        const { result, sessionId } = await runWithTaskSessionFallback({
            operation: 'update_task',
            metadata: { ahaSessionId: 'stale-server-sid' },
            clientSessionId: 'client-sid',
            preferredSessionId: 'stale-server-sid',
            execute: async (sid) => {
                calls.push(sid);
                if (sid === 'stale-server-sid') {
                    throw new Error('Invalid actor session for this team');
                }
                return { ok: true };
            },
        });

        expect(calls).toEqual(['stale-server-sid', 'client-sid']);
        expect(sessionId).toBe('client-sid');
        expect(result).toEqual({ ok: true });
    });

    it('does not retry when metadata/session mismatch preconditions are not met', () => {
        expect(shouldRetryTaskSessionWithClient({
            metadata: { ahaSessionId: 'same' },
            clientSessionId: 'same',
            attemptedSessionId: 'same',
            error: new Error('Invalid actor session for this team'),
        })).toBe(false);

        expect(shouldRetryTaskSessionWithClient({
            metadata: { ahaSessionId: 'server' },
            clientSessionId: 'client',
            attemptedSessionId: 'client',
            error: new Error('Invalid actor session for this team'),
        })).toBe(false);
    });
});

describe('collectForeignActiveExecutionLockSessionIdsForAssignee', () => {
    it('returns foreign active lock holders when the task is assigned to the current agent', () => {
        const result = collectForeignActiveExecutionLockSessionIdsForAssignee({
            assigneeId: 'current-session',
            executionLinks: [
                { sessionId: 'stale-session', status: 'active' },
                { sessionId: 'current-session', status: 'active' },
            ],
        }, ['current-session']);

        expect(result).toEqual(['stale-session']);
    });

    it('dedupes foreign lock holders and ignores non-active links', () => {
        const result = collectForeignActiveExecutionLockSessionIdsForAssignee({
            assigneeId: 'server-session',
            executionLinks: [
                { sessionId: 'old-session', status: 'active' },
                { sessionId: 'old-session', status: 'active' },
                { sessionId: 'support-session', role: 'supporting', status: 'active' },
                { sessionId: 'done-session', status: 'completed' },
                { sessionId: 'abandoned-session', status: 'abandoned' },
                { sessionId: '', status: 'active' },
            ],
        }, ['server-session', 'local-session']);

        expect(result).toEqual(['old-session']);
    });

    it('does not collect locks for unassigned tasks or tasks assigned to another agent', () => {
        expect(collectForeignActiveExecutionLockSessionIdsForAssignee({
            assigneeId: null,
            executionLinks: [{ sessionId: 'old-session', status: 'active' }],
        }, ['current-session'])).toEqual([]);

        expect(collectForeignActiveExecutionLockSessionIdsForAssignee({
            assigneeId: 'other-session',
            executionLinks: [{ sessionId: 'old-session', status: 'active' }],
        }, ['current-session'])).toEqual([]);
    });

    it('supports both preferred AHA session id and local client session id as self candidates', () => {
        const result = collectForeignActiveExecutionLockSessionIdsForAssignee({
            assigneeId: 'aha-session',
            executionLinks: [
                { sessionId: 'aha-session', status: 'active' },
                { sessionId: 'client-session', status: 'active' },
                { sessionId: 'legacy-session', status: 'active' },
            ],
        }, ['aha-session', 'client-session']);

        expect(result).toEqual(['legacy-session']);
    });
});

describe('hasActiveExecutionLinkForSelf', () => {
    it('allows an active primary execution owner to mutate an unassigned task', () => {
        const result = hasActiveExecutionLinkForSelf({
            assigneeId: null,
            executionLinks: [
                { sessionId: 'current-session', role: 'primary', status: 'active' },
            ],
        }, ['current-session']);

        expect(result).toBe(true);
    });

    it('does not treat completed, supporting, or foreign links as ownership', () => {
        expect(hasActiveExecutionLinkForSelf({
            executionLinks: [
                { sessionId: 'current-session', role: 'primary', status: 'completed' },
            ],
        }, ['current-session'])).toBe(false);

        expect(hasActiveExecutionLinkForSelf({
            executionLinks: [
                { sessionId: 'current-session', role: 'supporting', status: 'active' },
            ],
        }, ['current-session'])).toBe(false);

        expect(hasActiveExecutionLinkForSelf({
            executionLinks: [
                { sessionId: 'other-session', role: 'primary', status: 'active' },
            ],
        }, ['current-session'])).toBe(false);
    });
});

describe('overlap execution lock helpers', () => {
    it('parses overlapping active work task id from start_task errors', () => {
        expect(parseOverlappingActiveWorkTaskId('Task overlaps with active work on C5cxUlrKVe7u')).toBe('C5cxUlrKVe7u');
        expect(parseOverlappingActiveWorkTaskId(new Error('Failed to start task: Task overlaps with active work on abc_123'))).toBe('abc_123');
        expect(parseOverlappingActiveWorkTaskId('Task already being executed')).toBeNull();
    });

    it('releases stale overlap locks only when the target task is assigned to self', () => {
        const result = collectReleasableOverlapExecutionLockSessionIdsForAssignee({
            targetTask: { assigneeId: 'current-session' },
            overlapTask: {
                status: 'in-progress',
                assigneeId: 'old-owner',
                executionLinks: [
                    { sessionId: 'old-owner', role: 'primary', status: 'active' },
                    { sessionId: 'supporting-agent', role: 'supporting', status: 'active' },
                    { sessionId: 'done-agent', role: 'primary', status: 'completed' },
                ],
            },
            sessionCandidates: ['current-session'],
            runningSessionIds: ['current-session'],
        });

        expect(result).toEqual(['old-owner']);
    });

    it('does not release overlap locks held by a running foreign owner on an in-progress task', () => {
        const result = collectReleasableOverlapExecutionLockSessionIdsForAssignee({
            targetTask: { assigneeId: 'current-session' },
            overlapTask: {
                status: 'in-progress',
                assigneeId: 'other-running-owner',
                executionLinks: [
                    { sessionId: 'other-running-owner', role: 'primary', status: 'active' },
                ],
            },
            sessionCandidates: ['current-session'],
            runningSessionIds: ['other-running-owner'],
        });

        expect(result).toEqual([]);
    });

    it('releases overlap locks for non-in-progress duplicate work even if the old owner is still visible', () => {
        const result = collectReleasableOverlapExecutionLockSessionIdsForAssignee({
            targetTask: { assigneeId: 'current-session' },
            overlapTask: {
                status: 'review',
                assigneeId: 'other-running-owner',
                executionLinks: [
                    { sessionId: 'other-running-owner', role: 'primary', status: 'active' },
                ],
            },
            sessionCandidates: ['current-session'],
            runningSessionIds: ['other-running-owner'],
        });

        expect(result).toEqual(['other-running-owner']);
    });

    it('does not release overlap locks if the target task is not assigned to self', () => {
        const result = collectReleasableOverlapExecutionLockSessionIdsForAssignee({
            targetTask: { assigneeId: 'someone-else' },
            overlapTask: {
                status: 'review',
                executionLinks: [
                    { sessionId: 'old-owner', role: 'primary', status: 'active' },
                ],
            },
            sessionCandidates: ['current-session'],
            runningSessionIds: [],
        });

        expect(result).toEqual([]);
    });
});
