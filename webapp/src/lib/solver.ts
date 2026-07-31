/** Trivial brute-force Set search: all 3-combinations, per-attribute all-same or all-different. */

export function isSet(a: string, b: string, c: string): boolean {
  // A "?" is a placeholder for an attribute the classifier couldn't read,
  // not a wildcard -- without this check, two unclassified cards would
  // spuriously "match" each other (every '?' compares equal) and produce a
  // Set that was never actually verified.
  if (a.includes("?") || b.includes("?") || c.includes("?")) return false;
  for (let idx = 0; idx < 4; idx++) {
    const values = new Set([a[idx], b[idx], c[idx]]);
    if (values.size === 2) return false;
  }
  return true;
}

/** Indices (into `labels`) of every valid Set among all 3-combinations. */
export function findSets(labels: string[]): [number, number, number][] {
  const out: [number, number, number][] = [];
  const n = labels.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let k = j + 1; k < n; k++) {
        if (isSet(labels[i], labels[j], labels[k])) out.push([i, j, k]);
      }
    }
  }
  return out;
}
