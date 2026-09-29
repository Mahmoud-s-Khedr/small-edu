export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message);
export const unauthorized = (message = 'Authentication is required') => new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to perform this action') => new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Resource not found') => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (message: string) => new ApiError(409, 'CONFLICT', message);
export const serviceUnavailable = (message = 'The service is temporarily unavailable') => new ApiError(503, 'SERVICE_UNAVAILABLE', message);
