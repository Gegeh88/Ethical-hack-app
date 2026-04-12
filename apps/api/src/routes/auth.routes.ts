import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { RegisterOrgRequest } from '@haxvibe/shared-types';
import { audit } from '../lib/audit.js';
import { ForbiddenError } from '../lib/errors.js';
import { createOrganization } from '../services/org.service.js';
import { supabaseAdmin } from '../lib/supabase.js';

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
      // Fetch via Supabase REST API (avoids direct Postgres connection issues)
      const { data: user } = await supabaseAdmin
        .from('app_users')
        .select('id, organization_id, display_name, role, locale, totp_enabled, created_at, updated_at')
        .eq('id', req.userId)
        .single();

      let org = null;
      let subscription = null;

      if (user?.organization_id) {
        const { data: orgRow } = await supabaseAdmin
          .from('organizations')
          .select('id, name, billing_email, created_at, updated_at')
          .eq('id', user.organization_id)
          .single();
        org = orgRow ?? null;

        if (org) {
          const { data: subRow } = await supabaseAdmin
            .from('subscriptions')
            .select('id, organization_id, tier, status, created_at, updated_at')
            .eq('organization_id', org.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single();
          subscription = subRow ?? null;
        }
      }

      return { data: { user, org, subscription } };
    },
  );
}
