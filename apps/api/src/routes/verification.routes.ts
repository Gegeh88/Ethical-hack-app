import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { VerificationCheckRequest } from '@haxvibe/shared-types';
import { ForbiddenError } from '../lib/errors.js';
import {
  generateToken,
  checkVerification,
  getVerificationStatus,
} from '../services/verification.service.js';

export default async function verificationRoutes(fastify: FastifyInstance): Promise<void> {
  // All verification routes require authentication + an active organization
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.userOrgId) {
      throw new ForbiddenError('Organization required');
    }
  });

  // POST /:id/verification — generate (or retrieve existing) verification token
  fastify.post<{ Params: { id: string } }>(
    '/:id/verification',
    async (req, reply) => {
      const { id } = req.params;
      const result = await generateToken(id, req.userId, req.userOrgId!, req);
      return reply.status(201).send({ data: result });
    },
  );

  // POST /:id/verification/check — attempt to verify using a specified method
  fastify.post<{ Params: { id: string } }>(
    '/:id/verification/check',
    async (req, _reply) => {
      const { id } = req.params;
      const { method } = VerificationCheckRequest.parse(req.body);
      const result = await checkVerification(id, method, req.userId, req.userOrgId!, req);
      return { data: result };
    },
  );

  // GET /:id/verification — get verification status and history
  fastify.get<{ Params: { id: string } }>(
    '/:id/verification',
    async (req, _reply) => {
      const { id } = req.params;
      const result = await getVerificationStatus(id, req.userOrgId!);
      return { data: result };
    },
  );
}
