import type { FastifyRequest } from 'fastify';
import { supabaseAdmin } from './supabase.js';

interface AuditEntry {
  actor_id: string;
  actor_type?: 'user' | 'system' | 'admin' | 'api' | 'worker';
  action: string;
  resource_type?: string;
  resource_id?: string;
  metadata?: Record<string, unknown>;
}

export async function audit(req: FastifyRequest, entry: AuditEntry): Promise<void> {
  const { error } = await supabaseAdmin.from('audit_log').insert({
    actor_id: entry.actor_id,
    actor_type: entry.actor_type ?? 'user',
    action: entry.action,
    resource_type: entry.resource_type ?? null,
    resource_id: entry.resource_id ?? null,
    ip_address: req.ip,
    user_agent: req.headers['user-agent'] ?? null,
    metadata: entry.metadata ?? null,
  });

  if (error) {
    // Log but don't throw — audit failures should not break the main flow
    req.log.error({ err: error }, 'Failed to write audit log entry');
  }
}
