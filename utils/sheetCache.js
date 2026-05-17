// ============================================================
// IN-MEMORY SHEET CACHE
// Reduces Google Sheets API calls by caching full sheet reads
// TTL-based invalidation prevents stale data
// Previously: Every filter/GET hit read the full sheet again
// Now: First read cached, subsequent reads served from memory
// ============================================================

const cache = new Map();
const DEFAULT_TTL = 10 * 1000; // 10 seconds

function getCacheKey(spreadsheetId, range) {
  return `${spreadsheetId}:${range}`;
}

function getCache(spreadsheetId, range) {
  const key = getCacheKey(spreadsheetId, range);
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttl) {
    return entry.data;
  }
  return null;
}

function setCache(spreadsheetId, range, data, ttl = DEFAULT_TTL) {
  const key = getCacheKey(spreadsheetId, range);
  cache.set(key, { data, timestamp: Date.now(), ttl });
}

function invalidateCache(spreadsheetId, range) {
  if (spreadsheetId && range) {
    cache.delete(getCacheKey(spreadsheetId, range));
  } else {
    cache.clear();
  }
}

// Cleanup stale entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > entry.ttl) {
      cache.delete(key);
    }
  }
}, 30 * 1000);

module.exports = { getCache, setCache, invalidateCache };