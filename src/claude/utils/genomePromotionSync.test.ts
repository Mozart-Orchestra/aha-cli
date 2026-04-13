import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_GENOME_HUB_URL } from '@/configurationResolver'

import { promoteGenomeViaMarketplace, submitDiffViaMarketplace, submitPackageDiffViaMarketplace } from './genomePromotionSync'

const DEFAULT_HUB_URL = DEFAULT_GENOME_HUB_URL.replace(/\/$/, '')
const ORIGINAL_HUB_PUBLISH_KEY = process.env.HUB_PUBLISH_KEY
const ORIGINAL_GENOME_HUB_AUTH_TOKEN = process.env.GENOME_HUB_AUTH_TOKEN

beforeEach(() => {
    delete process.env.HUB_PUBLISH_KEY
    delete process.env.GENOME_HUB_AUTH_TOKEN
})

afterEach(() => {
    if (ORIGINAL_HUB_PUBLISH_KEY === undefined) {
        delete process.env.HUB_PUBLISH_KEY
    } else {
        process.env.HUB_PUBLISH_KEY = ORIGINAL_HUB_PUBLISH_KEY
    }
    if (ORIGINAL_GENOME_HUB_AUTH_TOKEN === undefined) {
        delete process.env.GENOME_HUB_AUTH_TOKEN
    } else {
        process.env.GENOME_HUB_AUTH_TOKEN = ORIGINAL_GENOME_HUB_AUTH_TOKEN
    }
})

function response(status: number, body: string) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async text() { return body },
    }
}

describe('route selection: direct vs proxy', () => {
    it('uses direct hub when HUB_PUBLISH_KEY is available', async () => {
        process.env.HUB_PUBLISH_KEY = 'test-publish-key'
        const calls: Array<{ input: string; auth?: string }> = []
        const fetchImpl = async (input: string, init?: RequestInit) => {
            calls.push({
                input,
                auth: (init?.headers as Record<string, string>)?.Authorization,
            })
            return response(201, '{"genome":{"id":"g-1","version":2}}')
        }

        const result = await promoteGenomeViaMarketplace({
            target: { namespace: '@official', name: 'supervisor' },
            payload: { spec: '{}', isPublic: true, minAvgScore: 60 },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(true)
        expect(result.transport).toBe('direct-hub')
        expect(calls).toHaveLength(1)
        expect(calls[0].input).toContain(DEFAULT_HUB_URL)
        expect(calls[0].auth).toBe('Bearer test-publish-key')
    })

    it('uses server proxy when no HUB_PUBLISH_KEY but authToken provided', async () => {
        // No HUB_PUBLISH_KEY set
        const calls: Array<{ input: string; auth?: string }> = []
        const fetchImpl = async (input: string, init?: RequestInit) => {
            calls.push({
                input,
                auth: (init?.headers as Record<string, string>)?.Authorization,
            })
            return response(201, '{"genome":{"id":"g-1","version":2}}')
        }

        const result = await promoteGenomeViaMarketplace({
            target: { namespace: '@official', name: 'supervisor' },
            payload: { spec: '{}', isPublic: true, minAvgScore: 60 },
            authToken: 'user-session-token',
            serverUrl: 'https://api.aha-agi.com',
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(true)
        expect(result.transport).toBe('server-proxy')
        expect(calls).toHaveLength(1)
        expect(calls[0].input).toContain('api.aha-agi.com/v1/')
        expect(calls[0].auth).toBe('Bearer user-session-token')
    })

    it('never falls back — direct 401 stays 401, does not try proxy', async () => {
        process.env.HUB_PUBLISH_KEY = 'wrong-key'
        const calls: string[] = []
        const fetchImpl = async (input: string) => {
            calls.push(input)
            return response(401, '{"error":"Unauthorized"}')
        }

        const result = await submitDiffViaMarketplace({
            namespace: '@official',
            name: 'implementer',
            payload: { description: 'test', changes: [] },
            authToken: 'valid-token',  // would enable proxy in old code
            serverUrl: 'https://api.aha-agi.com',
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(401)
        expect(result.transport).toBe('direct-hub')
        expect(calls).toHaveLength(1)  // only one call, no fallback to proxy
        expect(result.body).toContain('HUB_PUBLISH_KEY rejected')
    })
})

describe('hard fail with diagnosis', () => {
    it('diagnoses auth failure on direct route', async () => {
        process.env.HUB_PUBLISH_KEY = 'bad-key'
        const fetchImpl = async () => response(401, '{"error":"Unauthorized"}')

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: { description: 'test', baseVersion: 1, ops: [] },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.body).toContain('HUB_PUBLISH_KEY rejected')
        expect(result.body).toContain('bad-key'.slice(0, 8))
    })

    it('diagnoses auth failure on proxy route', async () => {
        // No HUB_PUBLISH_KEY → proxy route
        const fetchImpl = async () => response(401, '{"error":"Unauthorized"}')

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: { description: 'test', baseVersion: 1, ops: [] },
            authToken: 'expired-token',
            serverUrl: 'https://api.test.com',
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.transport).toBe('server-proxy')
        expect(result.body).toContain('Auth token rejected')
        expect(result.body).toContain('Re-login')
    })

    it('diagnoses network error', async () => {
        process.env.HUB_PUBLISH_KEY = 'key'
        const fetchImpl = async () => { throw new Error('ECONNREFUSED') }

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: { description: 'test', baseVersion: 1, ops: [] },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(0)
        expect(result.body).toContain('Network unreachable')
        expect(result.body).toContain('ECONNREFUSED')
    })

    it('diagnoses missing credentials entirely', async () => {
        // No HUB_PUBLISH_KEY, no authToken
        const fetchImpl = async () => response(401, '')

        const result = await submitDiffViaMarketplace({
            namespace: '@official',
            name: 'test',
            payload: { description: 'test', changes: [] },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.body).toContain('No HUB_PUBLISH_KEY found')
        expect(result.body).toContain('login to provision')
    })
})
