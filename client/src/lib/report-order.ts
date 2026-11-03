type DatedExpense = { date: string };

function dateKey(date: string): string {
  // Input fields store ISO calendar dates. Keep incomplete/imported invalid
  // dates at the end rather than allowing them to interrupt chronological order.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "";
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : "";
}

/** Report presentation only: never reorder the editor's or query cache's array. */
export function sortReportItems<T extends DatedExpense>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.date === "prepaid" || b.date === "prepaid") {
      return Number(b.date === "prepaid") - Number(a.date === "prepaid");
    }
    const aDate = dateKey(a.date);
    const bDate = dateKey(b.date);
    if (!aDate || !bDate) return Number(!aDate) - Number(!bDate);
    // ISO dates sort chronologically without local timezone conversions.
    // Equal dates (and prepaid entries) retain their existing relative order.
    return aDate < bDate ? -1 : aDate > bDate ? 1 : 0;
  });
}
