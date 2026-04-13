import { DEFAULT_GENOME_HUB_URL } from '@/configurationResolver'
import type { DiffChange } from '@/api/types/genome'
import { resolveGenomeHubWriteTokenSync } from '@/utils/genomeHubAuth'

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

function buildHubHeaders(hubPublishKey?: string): Record<string, string> {
    const hubAuthToken = resolveGenomeHubWriteTokenSync(hubPublishKey)
    return {
        'Content-Type': 'application/json',
        ...(hubAuthToken ? { Authorization: `Bearer ${hubAuthToken}` } : {}),
    }
}

function diagnoseFailure(operation: string, hubUrl: string, status: number, body: string, error?: unknown): string {
    const lines = [
        `genome-hub ${operation} failed.`,
        `  Hub URL: ${hubUrl}`,
        `  Status: ${status}`,
    ];
    if (status === 401 || status === 403) {
        lines.push(
            `  Diagnosis: Auth rejected. Check HUB_PUBLISH_KEY.`,
            `  Action: Run \`docker exec happyhere-genome-hub-1 printenv HUB_PUBLISH_KEY\` and compare with local GENOME_HUB_PUBLISH_KEY.`,
        );
    } else if (status === 404) {
        lines.push(
            `  Diagnosis: Endpoint not found. Hub may be outdated or the entity/genome does not exist.`,
            `  Action: Verify the genome exists via GET ${hubUrl}/genomes and check hub version.`,
        );
    } else if (status >= 500) {
        lines.push(
            `  Diagnosis: Hub internal error. Check hub server logs.`,
        );
    } else if (status === 0 && error) {
        lines.push(
            `  Diagnosis: Network unreachable or timeout.`,
            `  Action: Verify GENOME_HUB_URL (${hubUrl}) is reachable: \`curl ${hubUrl}/genomes\``,
            `  Error: ${String(error)}`,
        );
    }
    if (body) {
        lines.push(`  Response: ${body.slice(0, 500)}`);
    }
    return lines.join('\n');
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
    transport: 'direct-hub';
};

// ── Direct hub calls (no fallback, hard fail) ─────────────────────────

async function hubPost(
    fetchImpl: FetchLike,
    url: string,
    hubPublishKey: string | undefined,
    payload: unknown,
    timeoutMs = 10_000,
): Promise<HubResult> {
    const response = await fetchImpl(url, {
        method: 'POST',
        headers: buildHubHeaders(hubPublishKey),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await response.text().catch(() => '');
    return { ok: response.ok, status: response.status, body, transport: 'direct-hub' };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Create a new genome in genome-hub. Hard fails on any error.
 */
export async function createGenomeViaMarketplace(args: {
    payload: GenomeCreateHubPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const hubUrl = (args.hubUrl ?? DEFAULT_GENOME_HUB_URL).replace(/\/$/, '');

    try {
        const result = await hubPost(fetchImpl, `${hubUrl}/genomes`, args.hubPublishKey, args.payload);
        if (!result.ok) {
            result.body = diagnoseFailure('createGenome', hubUrl, result.status, result.body);
        }
        return result;
    } catch (error) {
        return {
            ok: false,
            status: 0,
            body: diagnoseFailure('createGenome', hubUrl, 0, '', error),
            transport: 'direct-hub',
        };
    }
}

/**
 * Submit a diff to genome-hub (evolve_genome). Hard fails on any error.
 */
export async function submitDiffViaMarketplace(args: {
    namespace: string;
    name: string;
    payload: DiffSubmitPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const hubUrl = (args.hubUrl ?? DEFAULT_GENOME_HUB_URL).replace(/\/$/, '');
    const url = `${hubUrl}/genomes/${encodeURIComponent(args.namespace)}/${encodeURIComponent(args.name)}/diff`;

    try {
        const result = await hubPost(fetchImpl, url, args.hubPublishKey, args.payload);
        if (!result.ok) {
            result.body = diagnoseFailure(`submitDiff(${args.namespace}/${args.name})`, hubUrl, result.status, result.body);
        }
        return result;
    } catch (error) {
        return {
            ok: false,
            status: 0,
            body: diagnoseFailure(`submitDiff(${args.namespace}/${args.name})`, hubUrl, 0, '', error),
            transport: 'direct-hub',
        };
    }
}

/**
 * Submit a package diff to genome-hub (mutate_genome). Hard fails on any error.
 */
export async function submitPackageDiffViaMarketplace(args: {
    entityId: string;
    payload: PackageDiffSubmitPayload;
    hubUrl?: string;
    hubPublishKey?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const hubUrl = (args.hubUrl ?? DEFAULT_GENOME_HUB_URL).replace(/\/$/, '');
    const url = `${hubUrl}/entities/id/${encodeURIComponent(args.entityId)}/package-diffs`;

    try {
        const result = await hubPost(fetchImpl, url, args.hubPublishKey, args.payload);
        if (!result.ok) {
            result.body = diagnoseFailure(`submitPackageDiff(${args.entityId})`, hubUrl, result.status, result.body);
        }
        return result;
    } catch (error) {
        return {
            ok: false,
            status: 0,
            body: diagnoseFailure(`submitPackageDiff(${args.entityId})`, hubUrl, 0, '', error),
            transport: 'direct-hub',
        };
    }
}

/**
 * Promote a genome in genome-hub. Hard fails on any error.
 */
export async function promoteGenomeViaMarketplace(args: {
    target: GenomePromoteTarget;
    payload: GenomePromotePayload;
    hubUrl?: string;
    hubPublishKey?: string;
    fetchImpl?: FetchLike;
}): Promise<HubResult> {
    const fetchImpl = args.fetchImpl ?? (fetch as FetchLike);
    const hubUrl = (args.hubUrl ?? DEFAULT_GENOME_HUB_URL).replace(/\/$/, '');
    const url = `${hubUrl}/genomes/${encodeURIComponent(args.target.namespace)}/${encodeURIComponent(args.target.name)}/promote`;

    try {
        const result = await hubPost(fetchImpl, url, args.hubPublishKey, args.payload, 15_000);
        if (!result.ok) {
            result.body = diagnoseFailure(`promote(${args.target.namespace}/${args.target.name})`, hubUrl, result.status, result.body);
        }
        return result;
    } catch (error) {
        return {
            ok: false,
            status: 0,
            body: diagnoseFailure(`promote(${args.target.namespace}/${args.target.name})`, hubUrl, 0, '', error),
            transport: 'direct-hub',
        };
    }
}
