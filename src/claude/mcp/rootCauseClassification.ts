/**
 * @module rootCauseClassification
 * @description Root cause classification for low-scoring agents.
 *
 * Sprint 0424 lesson: agents were evolved when the real problem was deployment
 * drift, Prisma config mismatch, or missing environment variables. Evolving a
 * genome that has no defect wastes team bandwidth and pollutes the genome lineage.
 *
 * This module provides `classifyRootCause()` which examines system state to
 * determine whether a low score is caused by:
 *   1. **system** problems (deploy drift, config drift, permission mismatch)
 *   2. **genome** problems (specific deficit, design flaw)
 *   3. **external** factors (task ambiguity, resource constraints)
 *
 * Only genome-rooted problems should trigger `evolve_genome`.
 * System problems should create code/deploy fix tasks instead.
 *
 * Pure functions — no I/O. The caller provides the data; this module
 * returns a classification.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Root cause category determined by classification. */
export type RootCauseCategory =
  | { type: 'system'; subType: 'deploy_drift' | 'config_drift' | 'permission_mismatch' | 'infrastructure' }
  | { type: 'genome'; subType: 'specific_deficit' | 'design_flaw' }
  | { type: 'external'; subType: 'task_ambiguity' | 'resource_constraint' };

/** Score dimensions from score_agent output. */
export interface ScoreDimensions {
  delivery: number;
  integrity: number;
  efficiency: number | null;
  collaboration: number;
  reliability: number;
}

/** System state data needed for classification. All optional — missing fields skip that check. */
export interface SystemStateForClassification {
  /** Commit hash the system was deployed from. */
  deployCommit?: string;
  /** Commit hash this agent's build reports. */
  agentBuildCommit?: string;
  /** Whether Prisma schema provider is postgresql (vs sqlite = drift). */
  prismaProviderCorrect?: boolean;
  /** Number of MCP tools the agent can see. */
  visibleToolCount?: number;
  /** Number of MCP tools the genome spec requires. */
  expectedToolCount?: number;
  /** Team-wide average score across all agents. */
  teamAvgScore?: number;
}

/** Result of root cause classification with reasoning. */
export interface RootCauseResult {
  category: RootCauseCategory;
  /** Human-readable explanation of why this classification was chosen. */
  reasoning: string;
  /** Recommended action. */
  recommendedAction: 'create_fix_task' | 'evolve_genome' | 'log_and_notify';
}

// ─── Classification ─────────────────────────────────────────────────────────

/**
 * Classify the root cause of a low agent score.
 *
 * Checks are ordered by priority: system problems first (they affect all agents,
 * so fixing them has the highest leverage), then genome problems, then external.
 */
export function classifyRootCause(
  overall: number,
  dimensions: ScoreDimensions,
  state: SystemStateForClassification,
): RootCauseResult {
  // Rule 1: Deploy drift — system is running a different commit than expected
  if (state.deployCommit && state.agentBuildCommit && state.deployCommit !== state.agentBuildCommit) {
    return {
      category: { type: 'system', subType: 'deploy_drift' },
      reasoning: `Deploy drift: system=${state.deployCommit.slice(0, 8)} vs agent=${state.agentBuildCommit.slice(0, 8)}. ` +
        `Evolution will not fix a stale deployment.`,
      recommendedAction: 'create_fix_task',
    };
  }

  // Rule 2: Config drift — Prisma provider wrong (sqlite instead of postgresql)
  if (state.prismaProviderCorrect === false) {
    return {
      category: { type: 'system', subType: 'config_drift' },
      reasoning: 'Prisma schema provider is incorrect. Database queries will fail. This is a deployment config issue.',
      recommendedAction: 'create_fix_task',
    };
  }

  // Rule 3: Permission mismatch — agent has fewer tools than genome expects
  if (typeof state.visibleToolCount === 'number' && typeof state.expectedToolCount === 'number'
    && state.visibleToolCount < state.expectedToolCount - 5) {
    return {
      category: { type: 'system', subType: 'permission_mismatch' },
      reasoning: `Tool count mismatch: agent sees ${state.visibleToolCount} but genome expects ~${state.expectedToolCount}. ` +
        `Missing tools constrain the agent regardless of genome quality.`,
      recommendedAction: 'create_fix_task',
    };
  }

  // Rule 4: Multi-agent low score — infrastructure problem
  if (typeof state.teamAvgScore === 'number' && state.teamAvgScore < 50) {
    return {
      category: { type: 'system', subType: 'infrastructure' },
      reasoning: `Team average score is ${Math.round(state.teamAvgScore)} — multiple agents underperforming suggests infrastructure issue.`,
      recommendedAction: 'create_fix_task',
    };
  }

  // Rule 5: Specific dimension deficit — one area drags the score down
  const dimensionEntries = Object.entries(dimensions) as Array<[string, number]>;
  const sorted = [...dimensionEntries].sort(([, a], [, b]) => a - b);
  const lowest = sorted[0];
  const highest = sorted[sorted.length - 1];

  if (lowest[1] < 40 && highest[1] > 60) {
    return {
      category: { type: 'genome', subType: 'specific_deficit' },
      reasoning: `Specific deficit in ${lowest[0]} (${Math.round(lowest[1])}) while ${highest[0]} is ${Math.round(highest[1])}. ` +
        `Genome should be evolved to address the weak dimension.`,
      recommendedAction: 'evolve_genome',
    };
  }

  // Rule 6: All dimensions low — fundamental design problem
  if (dimensionEntries.every(([, v]) => v < 50)) {
    return {
      category: { type: 'genome', subType: 'design_flaw' },
      reasoning: `All dimensions below 50 (range ${Math.round(sorted[0][1])}-${Math.round(sorted[sorted.length - 1][1])}). ` +
        `Genome has fundamental design issues requiring radical mutation.`,
      recommendedAction: 'evolve_genome',
    };
  }

  // Default: external factors
  return {
    category: { type: 'external', subType: 'task_ambiguity' },
    reasoning: `Overall=${overall} but no clear system or genome root cause identified. ` +
      `Likely external factors (task ambiguity, resource constraints, or one-off issues).`,
    recommendedAction: 'log_and_notify',
  };
}

/**
 * Determine the evolution trigger level based on score history.
 * Aligns with Design Architect's evolution-loop-interaction.md:
 *   L1 = record (all scores)
 *   L2 = alert (overall < 60 or any dimension < 40)
 *   L3 = proposal (3 L2 alerts with same genome + root cause = genome)
 */
export function determineTriggerLevel(
  overall: number,
  dimensions: ScoreDimensions,
): 'L1_record' | 'L2_alert' {
  const anyDimensionBelow40 = Object.values(dimensions).some(v => v < 40);
  if (overall < 60 || anyDimensionBelow40) {
    return 'L2_alert';
  }
  return 'L1_record';
}

/**
 * Format a root cause result as a concise string for inclusion in score_agent response.
 */
export function formatRootCauseSummary(result: RootCauseResult): string {
  const cat = result.category;
  const typeLabel = `${cat.type}/${cat.subType}`;
  return `[ROOT-CAUSE: ${typeLabel}] ${result.reasoning} → ${result.recommendedAction}`;
}
