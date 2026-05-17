// ============================================================
// GLOBAL ERROR HANDLER
// Catches ALL uncaught errors from routes
// Provides structured, consistent error responses
// Previously: Each route had different error formats
// ============================================================

const errorHandler = (err, req, res, _next) => {
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path}:`, err.message);

  // Determine status code
  const statusCode = err.statusCode || err.status || 500;

  res.status(statusCode).json({
    success: false,
    error: err.message || "Internal server error",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};

module.exports = errorHandler;