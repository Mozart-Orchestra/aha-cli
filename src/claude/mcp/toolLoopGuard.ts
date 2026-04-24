import { hashObject } from '@/utils/deterministicJson';

export type RepeatedToolCallGuardDecision = {
    allowed: boolean;
    count: number;
    threshold: number;
    windowMs: number;
    toolName: string;
    paramsHash: string;
    message?: string;
};

type ToolLoopGuardState = {
    key: string;
    count: number;
    firstAt: number;
    lastAt: number;
};

export type RepeatedToolCallGuard = {
    check(args: {
        sessionId?: string | null;
        toolName: string;
        params?: unknown;
    }): RepeatedToolCallGuardDecision;
};

export function createRepeatedToolCallGuard(options: {
    threshold?: number;
    windowMs?: number;
    now?: () => number;
} = {}): RepeatedToolCallGuard {
    const threshold = Math.max(2, Math.trunc(options.threshold ?? 3));
    const windowMs = Math.max(1_000, Math.trunc(options.windowMs ?? 60_000));
    const now = options.now ?? (() => Date.now());
    const stateBySession = new Map<string, ToolLoopGuardState>();

    return {
        check(args): RepeatedToolCallGuardDecision {
            const sessionId = args.sessionId?.trim() || 'unknown-session';
            const paramsHash = hashObject(args.params ?? {});
            const key = `${args.toolName}:${paramsHash}`;
            const current = now();
            const previous = stateBySession.get(sessionId);

            let nextState: ToolLoopGuardState;
            if (previous && previous.key === key && current - previous.firstAt <= windowMs) {
                nextState = {
                    key,
                    count: previous.count + 1,
                    firstAt: previous.firstAt,
                    lastAt: current,
                };
            } else {
                nextState = {
                    key,
                    count: 1,
                    firstAt: current,
                    lastAt: current,
                };
            }
            stateBySession.set(sessionId, nextState);

            const allowed = nextState.count < threshold;
            return {
                allowed,
                count: nextState.count,
                threshold,
                windowMs,
                toolName: args.toolName,
                paramsHash,
                message: allowed
                    ? undefined
                    : `重复 MCP 工具调用已被阻断：${args.toolName} 使用相同参数在 ${Math.round(windowMs / 1000)} 秒内连续调用 ${nextState.count} 次。请停止循环，先读取最新状态/日志，再换一个动作。`,
            };
        },
    };
}
