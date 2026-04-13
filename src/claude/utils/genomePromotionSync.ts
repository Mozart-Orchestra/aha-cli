import { configuration } from '@/configuration'
import { DEFAULT_GENOME_HUB_URL } from '@/configurationResolver'
import type { DiffChange } from '@/api/types/genome'
import { resolveGenomeHubWriteTokenSync, decodeJwtExpiryMs } from '@/utils/genomeHubAuth'
import { readPublishKeyFromSettings } from '@/configurationResolver'

type FetchResponseLike = {
    ok: boolean;
    status: number;
    text(): Promise<string>;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>

export type GenomePromoteTarget = {
    namespace: string;
    name: string;
}

export type GenomePromotePayload = {
    description?: string;
    spec: string;
    tags?: string;
    category?: string;
    isPublic: boolean;
    minAvgScore: number;
}

// ── Types ─────────────────────────────────────────────────────────────

export type GenomeCreateHubPayload = {
    namespace: string;
    name: string;
    version?: number;
    description?: string;
    spec: string;
    isPublic?: boolean;
    category?: string;
    tags?: string;
}

type DiffSubmitPayload = {
    description: string;
    changes: DiffChange[];
    verdictRefs?: string[];
    strategy?: string;
    authorRole?: string;
    authorSession?: string;
};

export type PackageDiffOp =
    | { type: 'manifest_set'; path: string; value: unknown }
    | { type: 'file_put'; path: string; content?: string; hash?: string }
    | { type: 'file_delete'; path: string };

type PackageDiffSubmitPayload = {
    description: string;
    ops: PackageDiffOp[];
    baseVersion?: number;
    verdictRefs?: string[];
    strategy?: string;
    authorRole?: string;
    authorSession?: string;
};

type HubResult = {
    ok: boolean;
    status: number;
    body: string;
    transport: 'direct-hub' | 'server-proxy';
};

// ── Auth: two explicit paths ──────────────────────────────────────────
//
// Path A: HUB_PUBLISH_KEY available → direct to genome-hub
// Path B: No HUB_PUBLISH_KEY, but authToken → proxy through happy-server
//
// Never silent fallback. The caller decides the path based on what
// credentials it has. If the chosen path fails, hard fail with diagnosis.

type WriteRoute =
    | { kind: 'direct'; hubUrl: string; hubPublishKey: string }
    | { kind: 'proxy'; serverUrl: string; authToken: string };

/**
 * Resolve a static HUB_PUBLISH_KEY only (not JWTs).
 * genome-hub does string comparison: it only accepts the exact static key.
 * JWTs from GENOME_HUB_AUTH_TOKEN / cache belong to the proxy path.
 */
function resolveStaticPublishKey(explicit?: string): string | undefined {
    // Explicit key from caller (non-JWT)
    if (explicit && decodeJwtExpiryMs(explicit) === null) {
        return explicit;
    }

    // HUB_PUBLISH_KEY env (non-JWT)
    const envKey = process.env.HUB_PUBLISH_KEY;
    if (envKey && decodeJwtExpiryMs(envKey) === null) {
        return envKey;
    }

    // settings.json publishKey (non-JWT)
    const settingsKey = readPublishKeyFromSettings(configuration.settingsFile);
    if (settingsKey && decodeJwtExpiryMs(settingsKey) === null) {
        return settingsKey;
    }

    return undefined;
}

function resolveWriteRoute(args: {
    hubUrl?: string;
    hubPublishKey?: string;
    serverUrl?: string;
    authToken?: string;
}): WriteRoute {
    const hubUrl = (args.hubUrl ?? DEFAULT_GENOME_HUB_URL).replace(/\/$/, '');
    const staticKey = resolveStaticPublishKey(args.hubPublishKey);

    if (staticKey) {
        return { kind: 'direct', hubUrl, hubPublishKey: staticKey };
    }

    // No static key — try proxy with auth token (JWT or session token)
    const serverUrl = (args.serverUrl ?? configuration.serverUrl).replace(/\/$/, '');
    const authToken = args.authToken ?? resolveGenomeHubWriteTokenSync();

    if (authToken) {
        return { kind: 'proxy', serverUrl, authToken };
    }

    // No credentials at all — will hard fail at request time with clear diagnosis
    return { kind: 'direct', hubUrl, hubPublishKey: '' };
}

function buildHeaders(route: WriteRoute): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (route.kind === 'direct' && route.hubPublishKey) {
        headers.Authorization = `Bearer ${route.hubPublishKey}`;
    } else if (route.kind === 'proxy' && route.authToken) {
        headers.Authorization = `Bearer ${route.authToken}`;
    }
    return headers;
}

function diagnoseFailure(
    operation: string,
    route: WriteRoute,
    status: number,
    body: string,
    error?: unknown,
): string {
    const target = route.kind === 'direct' ? route.hubUrl : route.serverUrl;
    const lines = [
        `genome-hub ${operation} failed via ${route.kind}.`,
        `  Target: ${target}`,
        `  Status: ${status}`,
    ];
    if (status === 401 || status === 403) {
        if (route.kind === 'direct') {
            lines.push(
                `  Diagnosis: HUB_PUBLISH_KEY rejected by genome-hub.`,
                `  Action: Run \`docker exec happyhere-genome-hub-1 printenv HUB_PUBLISH_KEY\` and compare.`,
                `  Has key: ${route.hubPublishKey ? 'yes (' + route.hubPublishKey.length + ' chars)' : 'NO — set HUB_PUBLISH_KEY or login to provision'}`,
            );
        } else {
            lines.push(
                `  Diagnosis: Auth token rejected by happy-server proxy.`,
                `  Action: Re-login or check auth token validity.`,
            );
        }
    } else if (status === 404) {
        lines.push(
            `  Diagnosis: Endpoint not found. ${route.kind === 'proxy' ? 'Server may lack the proxy route.' : 'Hub may be outdated or entity missing.'}`,
        );
    } else if (status >= 500) {
        lines.push(
            `  Diagnosis: ${route.kind === 'direct' ? 'Hub' : 'Server'} internal error. Check logs.`,
        );
    } else if (status === 0 && error) {
        lines.push(
            `  Diagnosis: Network unreachable or timeout.`,
            `  Action: Verify ${target} is reachable.`,
            `  Error: ${String(error)}`,
        );
    }
    if (!route.hubPublishKey && route.kind === 'direct') {
        lines.push(
            `  No HUB_PUBLISH_KEY found. Set HUB_PUBLISH_KEY env or login to provision credentials.`,
        );
    }
    if (body) {
        lines.push(`  Response: ${body.slice(0, 500)}`);
    }
    return lines.join('\n');
}

// ── Core request ──────────────────────────────────────────────────────

async function hubWrite(
    fetchImpl: FetchLike,
    route: WriteRoute,
    path: string,
    payload: unknown,
    operation: string,
    timeoutMs = 10_000,
): Promise<HubResult> {
    const baseUrl = route.kind === 'direct' ? route.hubUrl : route.serverUrl;
    const prefix = route.kind === 'proxy' ? '/v1' : '';
    const url = `${baseUrl}${prefix}${path}`;

    try {
        const response = await fetchImpl(url, {
            method: 'POST',
            headers: buildHeaders(route),
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(timeoutMs),
        });
        const body = await response.text().catch(() => '');

        if (!response.ok) {
            return {
                ok: false,
                status: response.status,
                body: diagnoseFailure(operation, route, response.status, body),
                transport: route.kind === 'direct' ? 'direct-hub' : 'server-proxy',
            };
        }

        return {
            ok: true,
            status: response.status,
            body,
            transport: route.kind === 'direct' ? 'direct-hub' : 'server-proxy',
        };
    } catch (error) {
        return {
            ok: false,
            status: 0,
            body: diagnoseFailure(operation, route, 0, '', error),
            transport: route.kind === 'direct' ? 'direct-hub' : 'server-proxy',
        };
    }
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Create a new genome in genome-hub.
 * Route A (direct) if HUB_PUBLISH_KEY available, Route B (proxy) if only authToken.
 */
export async function createGenomeViaMarketplace(args: {
    payload: GenomeCreateHubPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    serverUrl?: string;
    authToken?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const route = resolveWriteRoute(args);
    return hubWrite(fetchImpl, route, '/genomes', args.payload, 'createGenome');
}

/**
 * Submit a diff to genome-hub (evolve_genome).
 * Route A (direct) if HUB_PUBLISH_KEY available, Route B (proxy) if only authToken.
 */
export async function submitDiffViaMarketplace(args: {
    namespace: string;
    name: string;
    payload: DiffSubmitPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    serverUrl?: string;
    authToken?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const route = resolveWriteRoute(args);
    const path = `/genomes/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.name)}/diff`;
    return hubWrite(fetchImpl, route, path, args.payload, `submitDiff(${args.namespace}/${args.name})`);
}

/**
 * Submit a package diff to genome-hub (mutate_genome).
 * Route A (direct) if HUB_PUBLISH_KEY available, Route B (proxy) if only authToken.
 */
export async function submitPackageDiffViaMarketplace(args: {
    entityId: string;
    payload: PackageDiffSubmitPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    serverUrl?: string;
    authToken?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const route = resolveWriteRoute(args);
    const path = `/entities/id/${encodeURIComponent(args.entityId)}/package-diffs`;
    return hubWrite(fetchImpl, route, path, args.payload, `submitPackageDiff(${args.entityId})`);
}

/**
 * Promote a genome in genome-hub.
 * Route A (direct) if HUB_PUBLISH_KEY available, Route B (proxy) if only authToken.
 */
export async function promoteGenomeViaMarketplace(args: {
    target: GenomePromoteTarget;
    payload: GenomePromotePayload;
    hubUrl?: string;
    hubPublishKey?: string;
    serverUrl?: string;
    authToken?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const route = resolveWriteRoute(args);
    const path = `/genomes/${encodeURIComponent(args.target.namespace)}/${encodeURIComponent(args.target.name)}/promote`;
    return hubWrite(fetchImpl, route, path, args.payload, `promote(${args.target.namespace}/${args.target.name})`, 15_000);
}
