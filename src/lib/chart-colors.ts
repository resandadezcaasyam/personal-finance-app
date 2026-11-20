/**
 * Chart palette (SVG attributes cannot read CSS variables, so these are literal hex values that read on light AND dark
 * surfaces). Blue-first; red/green/amber are kept ONLY where they carry financial meaning (deficit, healthy, warning).
 */
export const CHART = {
  primary: "#2563EB",   // royal blue: main series
  cyan: "#06B6D4",      // secondary series
  soft: "#93C5FD",      // supporting series
  navy: "#1E3A8A",
  sky: "#38BDF8",
  indigo: "#6366F1",
  slate: "#94A3B8",
  loss: "#DC2626",      // deficit / overdue (semantic)
  gain: "#059669",      // healthy / positive (semantic, graphics only)
  warn: "#D97706",      // warning / scenario B (semantic)
} as const;

/** Categorical series for donuts/legends: blues first, then distinguishable supporting hues. */
export const CATEGORY_PALETTE = [CHART.primary, CHART.cyan, CHART.soft, CHART.navy, CHART.sky, CHART.indigo, "#A5B4FC", CHART.slate] as const;
