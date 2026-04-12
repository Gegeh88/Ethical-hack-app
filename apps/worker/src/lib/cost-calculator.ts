/**
 * Gemini pricing as of 2025-Q4 (USD per 1M tokens).
 *
 * These rates are for the standard (non-batched) API tier.
 * Update when Google changes pricing.
 *
 * Source: https://ai.google.dev/pricing
 */
const PRICING: Record<string, { input: number; output: number }> = {
  // Gemini 2.5 Flash
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.0-flash': { input: 0.10, output: 0.40 },
  // Gemini 2.5 Pro
  'gemini-2.5-pro': { input: 1.25, output: 10.00 },
};

/**
 * Calculate the USD cost of a Gemini API call based on model and token counts.
 * Returns 0 if the model is not in the pricing table (defensive).
 */
export function calculateGeminiCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const p = PRICING[model] ?? { input: 0, output: 0 };
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
