export const DEFAULT_CLAUDE_CONTEXT_WINDOW_TOKENS = 200_000;

// Per-model context window sizes (tokens).
// Values verified against actual API behavior:
// - Opus 4.x: 1 000 000 (confirmed by runtime model identity + get_context_status)
// - Sonnet 4.x / Haiku 4.x: 200 000 (observed limit)
export const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
    // Opus 4 family — 1M context window
    'claude-opus-4': 1_000_000,
    'claude-opus-4-1': 1_000_000,
    'claude-opus-4-6': 1_000_000,
    'claude-opus-4-20250514': 1_000_000,
    // Sonnet 4 family — 200K context window
    'claude-sonnet-4': 200_000,
    'claude-sonnet-4-6': 200_000,
    'claude-sonnet-4-20250514': 200_000,
    // Haiku 4 family — 200K context window
    'claude-haiku-4': 200_000,
    'claude-haiku-4-6': 200_000,
    // Explicit [1m] variants — actual limit is model-dependent
    'claude-opus-4-6[1m]': 1_000_000,
    'claude-sonnet-4-6[1m]': 200_000,
    'claude-haiku-4-6[1m]': 200_000,
};

export function resolveContextWindowTokens(modelId?: string | null): number | undefined {
    const normalized = modelId?.trim();
    if (!normalized) return undefined;

    const exactMatch = MODEL_CONTEXT_WINDOWS[normalized];
    if (exactMatch) return exactMatch;

    const prefixMatch = Object.entries(MODEL_CONTEXT_WINDOWS).find(([knownModel]) =>
        normalized.startsWith(`${knownModel}-`)
    );
    if (prefixMatch) {
        return prefixMatch[1];
    }

    // Unknown claude-* model: return undefined rather than guessing.
    // Wrong context window data is worse than no data.
    return undefined;
}

export function isRecognizedModelId(modelId?: string | null): boolean {
    const normalized = modelId?.trim();
    if (!normalized) return false;

    if (Object.prototype.hasOwnProperty.call(MODEL_CONTEXT_WINDOWS, normalized)) {
        return true;
    }

    return Object.keys(MODEL_CONTEXT_WINDOWS).some((knownModel) =>
        normalized.startsWith(`${knownModel}-`)
    );
}

export function buildModelSelfAwarenessPrompt(opts: {
    modelId?: string | null;
    fallbackModelId?: string | null;
    contextWindowTokens?: number;
}): string {
    const lines = ['## Runtime Model Identity'];

    if (opts.modelId) {
        lines.push(`- Current model: ${opts.modelId}`);
    }
    if (opts.fallbackModelId) {
        lines.push(`- Fallback model: ${opts.fallbackModelId}`);
    }
    if (typeof opts.contextWindowTokens === 'number') {
        lines.push(`- Context window: ${opts.contextWindowTokens} tokens`);
    }

    return lines.length > 1 ? lines.join('\n') : '';
}
