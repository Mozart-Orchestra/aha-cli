import { describe, expect, it } from 'vitest';
import { createRepeatedToolCallGuard } from './toolLoopGuard';

describe('createRepeatedToolCallGuard', () => {
    it('窗口期内第三次相同 tool+params 调用会被阻断', () => {
        let now = 1_000;
        const guard = createRepeatedToolCallGuard({
            threshold: 3,
            windowMs: 60_000,
            now: () => now,
        });

        const input = {
            sessionId: 'session-1',
            toolName: 'update_task',
            params: { taskId: 'task-1', status: 'done' },
        };

        expect(guard.check(input).allowed).toBe(true);
        now += 1_000;
        expect(guard.check(input).allowed).toBe(true);
        now += 1_000;
        const blocked = guard.check(input);

        expect(blocked.allowed).toBe(false);
        expect(blocked.count).toBe(3);
        expect(blocked.message).toContain('重复 MCP 工具调用已被阻断');
        expect(blocked.message).toContain('update_task');
    });

    it('参数变化时重置计数', () => {
        const guard = createRepeatedToolCallGuard({ threshold: 3 });

        expect(guard.check({ sessionId: 's', toolName: 'change_title', params: { title: 'A' } }).allowed).toBe(true);
        expect(guard.check({ sessionId: 's', toolName: 'change_title', params: { title: 'A' } }).allowed).toBe(true);
        expect(guard.check({ sessionId: 's', toolName: 'change_title', params: { title: 'B' } }).allowed).toBe(true);
        expect(guard.check({ sessionId: 's', toolName: 'change_title', params: { title: 'B' } }).allowed).toBe(true);
    });

    it('窗口过期后重置计数', () => {
        let now = 1_000;
        const guard = createRepeatedToolCallGuard({
            threshold: 3,
            windowMs: 10_000,
            now: () => now,
        });
        const input = { sessionId: 's', toolName: 'score_agent', params: { sessionId: 'target' } };

        expect(guard.check(input).allowed).toBe(true);
        now += 1_000;
        expect(guard.check(input).allowed).toBe(true);
        now += 11_000;
        const afterWindow = guard.check(input);

        expect(afterWindow.allowed).toBe(true);
        expect(afterWindow.count).toBe(1);
    });

    it('不同 session 独立计数', () => {
        const guard = createRepeatedToolCallGuard({ threshold: 3 });
        const params = { taskId: 'task-1' };

        expect(guard.check({ sessionId: 'a', toolName: 'get_task', params }).allowed).toBe(true);
        expect(guard.check({ sessionId: 'a', toolName: 'get_task', params }).allowed).toBe(true);
        expect(guard.check({ sessionId: 'b', toolName: 'get_task', params }).allowed).toBe(true);
        expect(guard.check({ sessionId: 'a', toolName: 'get_task', params }).allowed).toBe(false);
        expect(guard.check({ sessionId: 'b', toolName: 'get_task', params }).allowed).toBe(true);
    });
});
