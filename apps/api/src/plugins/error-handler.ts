import type { FastifyError, FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';

function buildErrorResponse(code: string, message: string, requestId: string, details?: unknown) {
  return {
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
      request_id: requestId,
    },
  };
}

async function errorHandlerPlugin(fastify: FastifyInstance): Promise<void> {
  fastify.setErrorHandler((error: FastifyError, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.id;

    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send(
        buildErrorResponse('VALIDATION', 'Invalid request', requestId, error.errors),
      );
    }

    // Custom application errors (by name convention from lib/errors.ts)
    if (error.name === 'ValidationError') {
      return reply.status(400).send(
        buildErrorResponse('VALIDATION', error.message, requestId, (error as unknown as { details?: unknown }).details),
      );
    }

    if (error.name === 'NotFoundError') {
      return reply.status(404).send(
        buildErrorResponse('NOT_FOUND', error.message, requestId),
      );
    }

    if (error.name === 'ForbiddenError') {
      return reply.status(403).send(
        buildErrorResponse('FORBIDDEN', error.message, requestId),
      );
    }

    if (error.name === 'RateLimitError' || error.statusCode === 429) {
      return reply.status(429).send(
        buildErrorResponse('RATE_LIMIT', error.message || 'Too many requests', requestId),
      );
    }

    // Fastify's built-in sensible errors (e.g. reply.unauthorized())
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send(
        buildErrorResponse(error.name ?? 'CLIENT_ERROR', error.message, requestId),
      );
    }

    // Unknown / internal errors: log full details, return generic message
    req.log.error({ err: error, requestId }, 'Unhandled error');

    return reply.status(500).send(
      buildErrorResponse('INTERNAL', 'Internal server error', requestId),
    );
  });
}

export default fp(errorHandlerPlugin, {
  name: 'error-handler',
});
