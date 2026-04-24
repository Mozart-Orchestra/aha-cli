/**
 * Model ID validation — enforced across all injection paths.
 *
 * User directive (CLAUDE.md #7): all model IDs must start with `claude-`.
 * Applied at: update_agent_model, create_agent, batch_spawn_agents, runClaude env vars.
 */

const ALLOWED_MODEL_PREFIX = 'claude-';

export interface ModelValidationResult {
    valid: boolean;
    rejected: string[];
}

export function validateModelIds(model?: string, fallbackModel?: string): ModelValidationResult {
    const rejected: string[] = [];
    if (model && !model.startsWith(ALLOWED_MODEL_PREFIX)) {
        rejected.push(model);
    }
    if (fallbackModel && !fallbackModel.startsWith(ALLOWED_MODEL_PREFIX)) {
        rejected.push(fallbackModel);
    }
    return { valid: rejected.length === 0, rejected };
}

export function isAllowedModelId(model: string): boolean {
    return model.startsWith(ALLOWED_MODEL_PREFIX);
}
