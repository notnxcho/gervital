// Pure math for the contingency fund. Follows fixedExpenseCalc's style.

// Budget limit: pct % of the monthlyized fixed-expense base.
export function contingencyLimit(fixedMonthly, pct) {
  return Number(fixedMonthly) * Number(pct) / 100
}

// Fund status against a limit.
// fillPct is clamped to [0, 100]; remaining may go negative; over = spend beyond limit.
export function contingencyStatus(consumed, limit) {
  const c = Number(consumed)
  const l = Number(limit)
  const over = c > l
  const fillPct = l > 0 ? Math.min(100, (c / l) * 100) : (c > 0 ? 100 : 0)
  return { fillPct, remaining: l - c, over }
}
