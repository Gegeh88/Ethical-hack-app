import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { UserRole } from '@haxvibe/shared-types';
import { supabaseAdmin } from '../lib/supabase.js';
import { sql } from '../lib/db.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
    userOrgId: string | null;
    userRole: UserRole;
  }
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate request with default values so Fastify knows the shape
  fastify.decorateRequest('userId', '');
  fastify.decorateRequest('userOrgId', null);
  fastify.decorateRequest('userRole', 'member');

  async function authenticate(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.unauthorized('Missing or malformed Authorization header');
    }

    const token = authHeader.slice(7);
    if (!token) {
      return reply.unauthorized('Empty bearer token');
    }

    // Verify JWT via Supabase Auth (server-side, service_role)
    const { data: { user: supabaseUser }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !supabaseUser) {
      req.log.warn({ error: error?.message }, 'JWT verification failed');
      return reply.unauthorized('Invalid or expired token');
    }

    // Fetch the app_users row for this auth user
    const [appUser] = await sql`
      SELECT id, organization_id, role
      FROM app_users
      WHERE id = ${supabaseUser.id}
    `;

    if (!appUser) {
      req.log.warn({ supabaseUserId: supabaseUser.id }, 'No app_users row found for authenticated user');
      return reply.unauthorized('User profile not found');
    }

    req.userId = appUser.id as string;
    req.userOrgId = (appUser.organization_id as string) ?? null;
    req.userRole = (appUser.role as UserRole) ?? 'member';
  }

  fastify.decorate('authenticate', authenticate);
}

export default fp(authPlugin, {
  name: 'auth',
  dependencies: ['@fastify/sensible'],
});
