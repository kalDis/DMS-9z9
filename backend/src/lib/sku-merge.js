// Manual variant merges. Some products sell under two codes — e.g. a variant whose
// ADS run on one code but whose ORDERS come in on another. Without a merge, the Ad
// ROI report splits them: one code shows spend with no orders (fake loss), the other
// shows orders with no spend (fake profit). Listing a pair here makes the report (and
// Cal's brief/lookup) count both codes as ONE product under the canonical code.
//
// Keyed by baseKey (letters + number, no leading zeros, e.g. "TY-36" -> "TY36").
// Shape: { <businessId>: { <aliasBaseKey>: <canonicalBaseKey> } }. alias folds INTO canonical.
// To merge another pair, add one line here (no schema/UI change needed).
const MERGES = {
  4: { TY36: 'TY37' }, // Tyshoo: TY-36 (orders) folds into TY-37 (ads)
};

// Resolve a baseKey to its canonical baseKey for a business (no-op when unmapped).
function mergeKey(businessId, key) {
  if (!key) return key;
  const m = MERGES[businessId];
  return (m && m[key]) || key;
}

module.exports = { mergeKey, MERGES };
