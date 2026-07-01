import type express from "express";

/**
 * Wraps async route handlers to catch promise rejections
 * and forward them to Express error handling middleware
 */
export function asyncHandler(
  handler: (
    request: express.Request,
    response: express.Response,
    next: express.NextFunction,
  ) => Promise<void>,
): express.RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}
