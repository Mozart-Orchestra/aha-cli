import { trimIdent } from '@/utils/trimIdent';

function uniqueStrings(values?: Array<string | null | undefined>): string[] {
    if (!values?.length) {
        return [];
    }

    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
        if (typeof value !== 'string') {
            continue;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(trimmed);
    }

    return result;
}

export function buildCodexCustomSystemPromptBlock(prompt?: string | null): string | undefined {
    const trimmed = prompt?.trim();
    if (!trimmed) {
        return undefined;
    }

    return trimIdent(`
        <codex_custom_system_prompt>
        Treat the following block as high-priority runtime instructions attached by Aha.
        Keep following your role, genome, and team protocols unless this block explicitly refines them.

        ${trimmed}
        </codex_custom_system_prompt>
    `);
}

export function buildCodexToolAccessInstruction(args: {
    allowedTools?: string[] | null;
    disallowedTools?: string[] | null;
}): string | undefined {
    const allowedTools = uniqueStrings(args.allowedTools ?? []);
    const disallowedTools = uniqueStrings(args.disallowedTools ?? []);

    if (allowedTools.length === 0 && disallowedTools.length === 0) {
        return undefined;
    }

    const lines = ['## Runtime Tool Access Contract'];

    if (allowedTools.length > 0) {
        lines.push(`- Allowed/preferred Aha tools: ${allowedTools.join(', ')}`);
    }
    if (disallowedTools.length > 0) {
        lines.push(`- Disallowed Aha tools: ${disallowedTools.join(', ')}`);
    }

    lines.push('- Respect this contract when choosing tools. If the task seems blocked by tool limits, explain the limit instead of guessing.');
    return lines.join('\n');
}

export function buildSkillsAwarenessPrompt(skillNames?: string[] | null): string | undefined {
    const normalized = uniqueStrings(skillNames ?? []);
    if (normalized.length === 0) {
        return undefined;
    }

    return [
        '## Available Agent Skills',
        '',
        ...normalized.map((skill) => `- /${skill}`),
        '',
        'Use these skills when they match the current task.',
    ].join('\n');
}

export type CodexTeamHistoryMessage = {
    type?: string | null;
    fromRole?: string | null;
    timestamp?: number | string | null;
    content?: string | null;
    shortContent?: string | null;
    metadata?: { priority?: string | null } | null;
};

function formatHistoryTimestamp(timestamp?: number | string | null): string {
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        return new Date(timestamp).toISOString().slice(11, 19);
    }
    if (typeof timestamp === 'string' && timestamp.trim()) {
        const parsed = Date.parse(timestamp);
        if (Number.isFinite(parsed)) {
            return new Date(parsed).toISOString().slice(11, 19);
        }
    }
    return '--:--:--';
}

export function summarizeCodexTeamHistory(
    history?: CodexTeamHistoryMessage[] | null,
    maxMessages = 10,
): string {
    if (!history?.length) {
        return '(No recent history)';
    }

    const requestedLimit = Number.isFinite(maxMessages) ? Math.trunc(maxMessages) : 10;
    const limit = Math.max(1, requestedLimit);
    const tail = history.slice(-limit);
    const typeCounts = tail.reduce<Record<string, number>>((acc, message) => {
        const type = message.type || 'chat';
        acc[type] = (acc[type] || 0) + 1;
        return acc;
    }, {});

    const lines = tail.map((message) => {
        const time = formatHistoryTimestamp(message.timestamp);
        const role = message.fromRole || 'user';
        const type = message.type || 'chat';
        const priority = message.metadata?.priority ? ` [${String(message.metadata.priority).toUpperCase()}]` : '';
        const preview = (message.shortContent || message.content || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 160);
        return `[${time}] ${role} · ${type}${priority}: ${preview}`;
    });

    const statsText = Object.entries(typeCounts)
        .map(([type, count]) => `${type}:${count}`)
        .join(' · ');

    return `${lines.join('\n')}\n\nActive type distribution: ${statsText || 'none'}`;
}

export function buildCodexTeamContextMessage(args: {
    rolePrompt?: string | null;
    teamName?: string | null;
    historyText?: string | null;
}): string | undefined {
    const rolePrompt = args.rolePrompt?.trim();
    const teamName = args.teamName?.trim() || 'Team';
    const historyText = args.historyText?.trim() || '(No recent history)';
    const activityBlock = trimIdent(`
        ## Team Name
        ${teamName}

        ## Recent Team Activity
        ${historyText}
    `);

    return [rolePrompt, activityBlock]
        .filter((block): block is string => Boolean(block?.trim()))
        .join('\n\n') || undefined;
}

export function composeCodexBaseInstructions(blocks: Array<string | null | undefined>): string | undefined {
    const normalized = blocks
        .map((block) => block?.trim())
        .filter((block): block is string => Boolean(block));

    return normalized.length > 0 ? normalized.join('\n\n') : undefined;
}
