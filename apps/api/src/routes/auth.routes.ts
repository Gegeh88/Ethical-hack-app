import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RegisterOrgRequest } from '@haxvibe/shared-types';
import { sql } from '../lib/db.js';
import { audit } from '../lib/audit.js';
import { ForbiddenError } from '../lib/errors.js';
import { createOrganization } from '../services/org.service.js';

export default async function authRoutes(fastify: FastifyInstance): Promise<void> {
  // POST /register-org — create organization for the authenticated user
  fastify.post(
    '/register-org',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = RegisterOrgRequest.parse(req.body);

      // Pre-check: user must not already have an org
      if (req.userOrgId) {
        throw new ForbiddenError('User already belongs to an organization');
      }

      const { org, subscription } = await createOrganization(
        req.userId,
        body.name,
        body.billingEmail,
      );

      await audit(req, {
        actor_id: req.userId,
        action: 'org.created',
        resource_type: 'organization',
        resource_id: org.id,
        metadata: { name: body.name },
      });

      return reply.status(201).send({ data: { org, subscription } });
    },
  );

  // GET /me — return current user profile, org, and subscription
  fastify.get(
    '/me',
    { preHandler: [fastify.authenticate] },
    async (req: FastifyRequest, _reply: FastifyReply) => {
      // Fetch the full user row
      const [user] = await sql`
        SELECT id, organization_id, display_name, role, locale, totp_enabled, created_at, updated_at
        FROM app_users
        WHERE id = ${req.userId}
      `;

      let org = null;
      let subscription = null;

      if (user?.organization_id) {
        const [orgRow] = await sql`
          SELECT id, name, billing_email, created_at, updated_at
          FROM organizations
          WHERE id = ${user.organization_id}
        `;
        org = orgRow ?? null;

        if (org) {
          const [subRow] = await sql`
            SELECT id, organization_id, tier, status, created_at, updated_at
            FROM subscriptions
            WHERE organization_id = ${org.id}
            ORDER BY created_at DESC
            LIMIT 1
          `;
          subscription = subRow ?? null;
        }
      }

      return { data: { user, org, subscription } };
    },
  );
}
