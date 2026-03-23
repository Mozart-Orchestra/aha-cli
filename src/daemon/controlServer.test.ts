import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockConfiguration = vi.hoisted(() => ({
    ahaHomeDir: '/tmp/test-aha',
}));

const mockSessionSyncClient = vi.hoisted(() => ({
    waitUntilConnected: vi.fn(async () => {}),
    sendUserTextMessage: vi.fn(),
    flush: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
}));

const mockApiClientInstance = vi.hoisted(() => ({
    getSession: vi.fn(async (sessionId: string) => ({
        id: sessionId,
        metadata: {},
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 0,
        encryptionKey: new Uint8Array([1, 2, 3]),
        encryptionVariant: 'legacy' as const,
        isDecrypted: true,
    })),
    sessionSyncClient: vi.fn(() => mockSessionSyncClient),
}));

const mockApiClient = vi.hoisted(() => ({
    create: vi.fn(async () => mockApiClientInstance),
}));

const mockReadCredentials = vi.hoisted(() => vi.fn(async () => ({
    token: 'test-token',
    encryption: {
        type: 'secret',
        secret: new Uint8Array([1, 2, 3]),
    },
})));

vi.mock('@/configuration', () => ({
    configuration: mockConfiguration,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        debugLargeJson: vi.fn(),
    },
}));

vi.mock('@/api/api', () => ({
    ApiClient: mockApiClient,
}));

vi.mock('@/persistence', () => ({
    readCredentials: mockReadCredentials,
}));

import { startDaemonControlServer } from './controlServer';
import { TrackedSession } from './types';

describe('controlServer /team-pulse', () => {
    let stopServer: () => Promise<void>;
    let port: number;
    const trackedSessions: TrackedSession[] = [];

    beforeEach(async () => {
        trackedSessions.length = 0;

        const result = await startDaemonControlServer({
            getChildren: () => trackedSessions,
            stopSession: () => false,
            spawnSession: async () => ({ type: 'error' as const, error: 'not implemented' }),
            requestShutdown: () => {},
            onAhaSessionWebhook: () => {},
            getTeamPulse: (teamId: string) => {
                // Simulate: return sessions matching team
                return trackedSessions
                    .filter(s => {
                        const meta = s.ahaSessionMetadataFromLocalWebhook;
                        return (meta?.teamId || meta?.roomId) === teamId && s.ahaSessionId;
                    })
                    .map(s => ({
                        sessionId: s.ahaSessionId!,
                        role: s.ahaSessionMetadataFromLocalWebhook?.role || 'unknown',
                        status: 'alive' as const,
                        lastSeenMs: 0,
                        pid: s.pid,
                        runtimeType: s.ahaSessionMetadataFromLocalWebhook?.flavor,
                    }));
            },
        });

        port = result.port;
        stopServer = result.stop;
    });

    afterEach(async () => {
        await stopServer();
    });

    it('should return empty members for unknown team', async () => {
        const response = await fetch(`http://127.0.0.1:${port}/team-pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: 'non-existent' }),
        });

        expect(response.ok).toBe(true);
        const data = await response.json() as { teamId: string; members: unknown[]; summary: string };
        expect(data.teamId).toBe('non-existent');
        expect(data.members).toHaveLength(0);
        expect(data.summary).toBe('No agents tracked');
    });

    it('should return members for a team with sessions', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            ahaSessionId: 'session-1',
            pid: 12345,
            ahaSessionMetadataFromLocalWebhook: {
                teamId: 'team-alpha',
                role: 'builder',
                flavor: 'claude',
            } as any,
        });
        trackedSessions.push({
            startedBy: 'daemon',
            ahaSessionId: 'session-2',
            pid: 12346,
            ahaSessionMetadataFromLocalWebhook: {
                teamId: 'team-alpha',
                role: 'supervisor',
                flavor: 'claude',
            } as any,
        });

        const response = await fetch(`http://127.0.0.1:${port}/team-pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: 'team-alpha' }),
        });

        expect(response.ok).toBe(true);
        const data = await response.json() as { teamId: string; members: Array<{ sessionId: string; role: string; status: string }>; summary: string };
        expect(data.teamId).toBe('team-alpha');
        expect(data.members).toHaveLength(2);
        expect(data.members[0].role).toBe('builder');
        expect(data.members[1].role).toBe('supervisor');
        expect(data.summary).toContain('2 alive');
    });

    it('should not include sessions from other teams', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            ahaSessionId: 'session-1',
            pid: 12345,
            ahaSessionMetadataFromLocalWebhook: {
                teamId: 'team-alpha',
                role: 'builder',
            } as any,
        });
        trackedSessions.push({
            startedBy: 'daemon',
            ahaSessionId: 'session-2',
            pid: 12346,
            ahaSessionMetadataFromLocalWebhook: {
                teamId: 'team-beta',
                role: 'builder',
            } as any,
        });

        const response = await fetch(`http://127.0.0.1:${port}/team-pulse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamId: 'team-alpha' }),
        });

        const data = await response.json() as { members: unknown[] };
        expect(data.members).toHaveLength(1);
    });
});

describe('controlServer /heartbeat-ping', () => {
    let stopServer: () => Promise<void>;
    let port: number;
    const pings: Array<{ sessionId: string; teamId: string; role: string }> = [];

    beforeEach(async () => {
        pings.length = 0;

        const result = await startDaemonControlServer({
            getChildren: () => [],
            stopSession: () => false,
            spawnSession: async () => ({ type: 'error' as const, error: 'not implemented' }),
            requestShutdown: () => {},
            onAhaSessionWebhook: () => {},
            onHeartbeatPing: (sessionId, teamId, role) => {
                pings.push({ sessionId, teamId, role });
            },
        });

        port = result.port;
        stopServer = result.stop;
    });

    afterEach(async () => {
        await stopServer();
    });

    it('should accept heartbeat ping and invoke callback', async () => {
        const response = await fetch(`http://127.0.0.1:${port}/heartbeat-ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'sess-1', teamId: 'team-a', role: 'builder' }),
        });

        const body = await response.text();
        expect(response.ok).toBe(true);
        const data = JSON.parse(body) as { ok: boolean };
        expect(data.ok).toBe(true);
        expect(pings).toHaveLength(1);
        expect(pings[0]).toEqual({ sessionId: 'sess-1', teamId: 'team-a', role: 'builder' });
    });

    it('should work without onHeartbeatPing callback', async () => {
        await stopServer();
        const result = await startDaemonControlServer({
            getChildren: () => [],
            stopSession: () => false,
            spawnSession: async () => ({ type: 'error' as const, error: 'not implemented' }),
            requestShutdown: () => {},
            onAhaSessionWebhook: () => {},
            // No onHeartbeatPing
        });
        port = result.port;
        stopServer = result.stop;

        const response = await fetch(`http://127.0.0.1:${port}/heartbeat-ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'sess-1', teamId: 'team-a', role: 'builder' }),
        });

        expect(response.ok).toBe(true);
    });
});

describe('controlServer /session-command', () => {
    let stopServer: () => Promise<void>;
    let port: number;
    const trackedSessions: TrackedSession[] = [];

    beforeEach(async () => {
        trackedSessions.length = 0;
        mockReadCredentials.mockClear();
        mockApiClient.create.mockClear();
        mockApiClientInstance.getSession.mockClear();
        mockApiClientInstance.sessionSyncClient.mockClear();
        mockSessionSyncClient.waitUntilConnected.mockClear();
        mockSessionSyncClient.sendUserTextMessage.mockClear();
        mockSessionSyncClient.flush.mockClear();
        mockSessionSyncClient.close.mockClear();

        const result = await startDaemonControlServer({
            getChildren: () => trackedSessions,
            stopSession: () => false,
            spawnSession: async () => ({ type: 'error' as const, error: 'not implemented' }),
            requestShutdown: () => {},
            onAhaSessionWebhook: () => {},
        });

        port = result.port;
        stopServer = result.stop;
    });

    afterEach(async () => {
        await stopServer();
    });

    it('injects commands into the live session via session socket', async () => {
        trackedSessions.push({
            startedBy: 'daemon',
            ahaSessionId: 'session-1',
            pid: 12345,
            ahaSessionMetadataFromLocalWebhook: {
                teamId: 'team-alpha',
                role: 'builder',
                flavor: 'codex',
            } as any,
        });

        const response = await fetch(`http://127.0.0.1:${port}/session-command`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: 'session-1', command: '/compact' }),
        });

        expect(response.ok).toBe(true);
        await expect(response.json()).resolves.toEqual({ success: true });
        expect(mockReadCredentials).toHaveBeenCalledTimes(1);
        expect(mockApiClient.create).toHaveBeenCalledTimes(1);
        expect(mockApiClientInstance.getSession).toHaveBeenCalledWith('session-1');
        expect(mockSessionSyncClient.waitUntilConnected).toHaveBeenCalledWith(2000);
        expect(mockSessionSyncClient.sendUserTextMessage).toHaveBeenCalledWith('/compact', { sentFrom: 'daemon-control-server' });
        expect(mockSessionSyncClient.flush).toHaveBeenCalledTimes(1);
        expect(mockSessionSyncClient.close).toHaveBeenCalledTimes(1);
    });
});
