/**
 * Adaptive currency formatting for LLM token costs.
 * Avoids displaying $0.00 for sub-cent costs (Finding 13).
 *
 * Exports: formatCost
 * Feature: token cost estimator
 */
export function formatCost(amount: number): string {
  if (amount === 0) return "$0.00";
  if (amount < 0.01) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}
