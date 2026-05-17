// ============================================================
// CENTRALIZED ASYNC ERROR HANDLER
// Eliminates try/catch boilerplate in EVERY route
// All errors automatically caught and forwarded to error handler
// ============================================================

const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;