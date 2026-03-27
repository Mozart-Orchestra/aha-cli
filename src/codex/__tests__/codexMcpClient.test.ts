import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => {
    class FakeClient {
        connect = vi.fn(async () => { });
        callTool = vi.fn(async () => ({}));
        close = vi.fn(async () => { });
        notification = vi.fn(async () => { });
        setNotificationHandler = vi.fn();
        setRequestHandler = vi.fn();
    }

    class FakeTransport {
        pid: number | null = 4321;
        close = vi.fn(async () => { });

        constructor(public readonly options: any) { }
    }

    const state = {
        clients: [] as FakeClient[],
        transports: [] as FakeTransport[],
    };

    const ClientCtor = vi.fn(() => {
        const client = new FakeClient();
        state.clients.push(client);
        return client;
    });

    const TransportCtor = vi.fn((options: any) => {
        const transport = new FakeTransport(options);
        state.transports.push(transport);
        return transport;
    });

    return {
        state,
        ClientCtor,
        TransportCtor,
        execSync: vi.fn(() => 'codex-cli 0.117.0'),
        logger: {
            debug: vi.fn(),
        },
    };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: mocked.ClientCtor,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: mocked.TransportCtor,
}));

vi.mock('child_process', () => ({
    execSync: mocked.execSync,
}));

vi.mock('@/ui/logger', () => ({
    logger: mocked.logger,
}));

import { CodexMcpClient } from '../codexMcpClient';

describe('CodexMcpClient transport shutdown', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocked.state.clients.length = 0;
        mocked.state.transports.length = 0;
    });

    it('disconnect preserves session identifiers for resume flows', async () => {
        const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
        try {
            const client = new CodexMcpClient();
            await client.connect();

            (client as any).sessionId = 'session-123';
            (client as any).conversationId = 'conversation-123';

            await client.disconnect();

            expect(mocked.state.clients[0]?.close).toHaveBeenCalledTimes(1);
            expect((client as any).transport).toBeNull();
            expect((client as any).connected).toBe(false);
            expect((client as any).sessionId).toBe('session-123');
            expect((client as any).conversationId).toBe('conversation-123');
            expect(killSpy.mock.calls).toEqual([
                [4321, 0],
                [4321, 'SIGKILL'],
            ]);
        } finally {
            killSpy.mockRestore();
        }
    });

    it('forceCloseSession clears session identifiers after transport shutdown', async () => {
        const killSpy = vi.spyOn(process, 'kill').mockImplementation((() => true) as any);
        try {
            const client = new CodexMcpClient();
            await client.connect();

            (client as any).sessionId = 'session-456';
            (client as any).conversationId = 'conversation-456';

            await client.forceCloseSession();

            expect(mocked.state.clients[0]?.close).toHaveBeenCalledTimes(1);
            expect((client as any).transport).toBeNull();
            expect((client as any).connected).toBe(false);
            expect((client as any).sessionId).toBeNull();
            expect((client as any).conversationId).toBeNull();
            expect(killSpy.mock.calls).toEqual([
                [4321, 0],
                [4321, 'SIGKILL'],
            ]);
        } finally {
            killSpy.mockRestore();
        }
    });
});
