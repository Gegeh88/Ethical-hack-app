/**
 * Prompt registry — versioned prompt definitions for AI-powered report generation.
 *
 * Convention: each prompt has a versioned ID like 'exec-summary:v1'.
 * When changing a prompt, create a new version (v2) instead of overwriting.
 * The ai_usage.prompt_id column tracks which version was used.
 */
export {
  EXEC_SUMMARY_PROMPT_ID,
  EXEC_SUMMARY_SYSTEM,
  buildExecSummaryPrompt,
  type ExecSummaryInput,
} from './exec-summary.js';

export {
  ENRICH_FINDING_PROMPT_ID,
  ENRICH_FINDING_SYSTEM,
  buildEnrichPrompt,
  type EnrichFindingInput,
  type AiExplanation,
} from './enrich-finding.js';
