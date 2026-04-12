import type { FastifyRequest } from 'fastify';
import { sql } from './db.js';

interface AuditEntry {
  actor_id: string;
  actor_type?: 'user' | 'system' | 'admin' | 'api' | 'worker';
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

export async function audit(req: FastifyRequest, entry: AuditEntry): Promise<void> {
  await sql`
    INSERT INTO audit_log (actor_id, actor_type, action, resource_type, resource_id, ip_address, user_agent, metadata)
    VALUES (
      ${entry.actor_id},
      ${entry.actor_type ?? 'user'},
      ${entry.action},
      ${entry.resource_type ?? null},
      ${entry.resource_id ?? null},
      ${req.ip}::inet,
      ${req.headers['user-agent'] ?? null},
      ${entry.metadata ? JSON.stringify(entry.metadata) : null}
    )
  `;
}
