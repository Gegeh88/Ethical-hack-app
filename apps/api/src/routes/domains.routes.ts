import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PaginationQuery, CreateDomainRequest } from '@haxvibe/shared-types';
import { audit } from '../lib/audit.js';
import { ForbiddenError } from '../lib/errors.js';
import {
  listDomains,
  createDomain,
  getDomainById,
  deleteDomain,
} from '../services/domain.service.js';

export default async function domainRoutes(fastify: FastifyInstance): Promise<void> {
  // All domain routes require authentication + an active organization
  fastify.addHook('preHandler', fastify.authenticate);
  fastify.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    if (!req.userOrgId) {
      throw new ForbiddenError('You must create an organization before managing domains');
    }
  });

  // GET / — list domains for the user's organization
  fastify.get('/', async (req: FastifyRequest, _reply: FastifyReply) => {
    const query = PaginationQuery.parse(req.query);
    const result = await listDomains(req.userOrgId!, query.page, query.limit);
    return { data: result.data, total: result.total };
  });

  // POST / — add a new domain
  fastify.post('/', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = CreateDomainRequest.parse(req.body);
    const domain = await createDomain(
      req.userOrgId!,
      req.userId,
      body.host,
      body.is_shared_hosting,
    );

    await audit(req, {
      actor_id: req.userId,
      action: 'domain.created',
      resource_type: 'domain',
      resource_id: domain.id,
      metadata: { host: body.host, is_shared_hosting: body.is_shared_hosting },
    });

    return reply.status(201).send({ data: domain });
  });

  // GET /:id — get a single domain with verification history
  fastify.get('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, _reply: FastifyReply) => {
    const { id } = req.params;
    const domain = await getDomainById(req.userOrgId!, id);
    return { data: domain };
  });

  // DELETE /:id — remove a domain (admin/owner only)
  fastify.delete('/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    if (req.userRole !== 'owner' && req.userRole !== 'admin') {
      throw new ForbiddenError('Only organization owners or admins can delete domains');
    }

    const { id } = req.params;
    await deleteDomain(req.userOrgId!, id);

    await audit(req, {
      actor_id: req.userId,
      action: 'domain.deleted',
      resource_type: 'domain',
      resource_id: id,
    });

    return reply.status(204).send();
  });
}
