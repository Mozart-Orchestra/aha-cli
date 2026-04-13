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
        async text() {
            return body
        },
    }
}

describe('promoteGenomeViaMarketplace', () => {
    it('promotes directly when genome-hub accepts the request', async () => {
        const calls: Array<{ input: string; method?: string }> = []
        const fetchImpl = async (input: string, init?: RequestInit) => {
            calls.push({ input, method: init?.method })
            return response(201, '{"genome":{"id":"g-1","version":2}}')
        }

        const result = await promoteGenomeViaMarketplace({
            target: { namespace: '@official', name: 'supervisor' },
            payload: {
                spec: '{"displayName":"Supervisor"}',
                isPublic: true,
                minAvgScore: 60,
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result).toMatchObject({
            ok: true,
            status: 201,
            transport: 'direct-hub',
        })
        expect(calls).toHaveLength(1)
    })

    it('hard fails with diagnosis when genome-hub returns 401', async () => {
        const fetchImpl = async () => response(401, '{"error":"Unauthorized"}')

        const result = await promoteGenomeViaMarketplace({
            target: { namespace: '@official', name: 'supervisor' },
            payload: {
                spec: '{"displayName":"Supervisor"}',
                isPublic: true,
                minAvgScore: 60,
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(401)
        expect(result.transport).toBe('direct-hub')
        expect(result.body).toContain('Auth rejected')
        expect(result.body).toContain('HUB_PUBLISH_KEY')
    })

    it('hard fails with diagnosis on network error', async () => {
        const fetchImpl = async () => { throw new Error('ECONNREFUSED') }

        const result = await promoteGenomeViaMarketplace({
            target: { namespace: '@official', name: 'supervisor' },
            payload: {
                spec: '{"displayName":"Supervisor"}',
                isPublic: true,
                minAvgScore: 60,
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(0)
        expect(result.body).toContain('Network unreachable')
        expect(result.body).toContain('ECONNREFUSED')
    })
})

describe('submitDiffViaMarketplace', () => {
    it('submits diff directly when genome-hub accepts', async () => {
        const fetchImpl = async () => response(201, '{"genome":{"version":2},"diff":{"id":"d-1"}}')

        const result = await submitDiffViaMarketplace({
            namespace: '@official',
            name: 'implementer',
            payload: {
                description: 'test diff',
                changes: [{ type: 'kv', path: 'behavior.onIdle', to: 'self-assign' }],
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result).toMatchObject({ ok: true, status: 201, transport: 'direct-hub' })
    })

    it('hard fails with diagnosis on 403', async () => {
        const fetchImpl = async () => response(403, '{"error":"Forbidden"}')

        const result = await submitDiffViaMarketplace({
            namespace: '@official',
            name: 'implementer',
            payload: {
                description: 'test diff',
                changes: [],
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(403)
        expect(result.body).toContain('Auth rejected')
    })
})

describe('submitPackageDiffViaMarketplace', () => {
    it('submits package diffs directly when genome-hub accepts', async () => {
        const calls: Array<{ input: string }> = []
        const fetchImpl = async (input: string) => {
            calls.push({ input })
            return response(201, '{"entity":{"id":"e-1","version":2},"diff":{"id":"d-1"}}')
        }

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: {
                description: 'Mutate package manifest',
                baseVersion: 1,
                ops: [{ type: 'manifest_set', path: 'behavior.onIdle', value: 'self-assign' }],
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result).toMatchObject({ ok: true, status: 201, transport: 'direct-hub' })
        expect(calls).toHaveLength(1)
        expect(calls[0].input).toBe(`${DEFAULT_HUB_URL}/entities/id/entity-1/package-diffs`)
    })

    it('hard fails on 403 — no silent fallback', async () => {
        const calls: Array<string> = []
        const fetchImpl = async (input: string) => {
            calls.push(input)
            return response(403, '{"error":"Forbidden"}')
        }

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: {
                description: 'Mutate package manifest',
                baseVersion: 1,
                ops: [{ type: 'manifest_set', path: 'behavior.onIdle', value: 'self-assign' }],
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(403)
        expect(result.body).toContain('Auth rejected')
        expect(calls).toHaveLength(1) // no second call to proxy
    })

    it('hard fails on network error with actionable diagnosis', async () => {
        const fetchImpl = async () => { throw new Error('fetch failed: ECONNREFUSED') }

        const result = await submitPackageDiffViaMarketplace({
            entityId: 'entity-1',
            payload: {
                description: 'test',
                baseVersion: 1,
                ops: [],
            },
            fetchImpl: fetchImpl as any,
        })

        expect(result.ok).toBe(false)
        expect(result.status).toBe(0)
        expect(result.body).toContain('Network unreachable')
        expect(result.body).toContain('GENOME_HUB_URL')
        expect(result.body).toContain('ECONNREFUSED')
    })
})
