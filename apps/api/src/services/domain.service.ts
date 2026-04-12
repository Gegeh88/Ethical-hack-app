import { sql } from '../lib/db.js';
import { NotFoundError } from '../lib/errors.js';

interface DomainRow {
  id: string;
  organization_id: string;
  added_by: string | null;
  host: string;
  verified_at: string | null;
  verification_method: string | null;
  verification_expires_at: string | null;
  is_shared_hosting: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface ListDomainsResult {
  data: DomainRow[];
  total: number;
}

export async function listDomains(
  orgId: string,
  page: number,
  limit: number,
): Promise<ListDomainsResult> {
  const offset = (page - 1) * limit;

  const [countResult] = await sql`
    SELECT count(*)::int AS total
    FROM domains
    WHERE organization_id = ${orgId}
  `;

  const rows = await sql`
    SELECT id, organization_id, added_by, host, verified_at, verification_method,
           verification_expires_at, is_shared_hosting, notes, created_at, updated_at
    FROM domains
    WHERE organization_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;

  return {
    data: rows as unknown as DomainRow[],
    total: (countResult?.total as number) ?? 0,
  };
}

export async function createDomain(
  orgId: string,
  userId: string,
  host: string,
  isSharedHosting: boolean,
): Promise<DomainRow> {
  const [domain] = await sql`
    INSERT INTO domains (organization_id, added_by, host, is_shared_hosting)
    VALUES (${orgId}, ${userId}, ${host}, ${isSharedHosting})
    RETURNING id, organization_id, added_by, host, verified_at, verification_method,
              verification_expires_at, is_shared_hosting, notes, created_at, updated_at
  `;

  if (!domain) {
    throw new Error('Failed to create domain');
  }

  return domain as unknown as DomainRow;
}

export async function getDomainById(
  orgId: string,
  domainId: string,
): Promise<DomainRow & { verifications: unknown[] }> {
  const [domain] = await sql`
    SELECT id, organization_id, added_by, host, verified_at, verification_method,
           verification_expires_at, is_shared_hosting, notes, created_at, updated_at
    FROM domains
    WHERE id = ${domainId} AND organization_id = ${orgId}
  `;

  if (!domain) {
    throw new NotFoundError('Domain not found');
  }

  // Fetch associated verification records
  const verifications = await sql`
    SELECT id, domain_id, method, token, status, checked_at, expires_at, created_at
    FROM domain_verifications
    WHERE domain_id = ${domainId}
    ORDER BY created_at DESC
  `;

  return {
    ...(domain as unknown as DomainRow),
    verifications: verifications as unknown[],
  };
}

export async function deleteDomain(
  orgId: string,
  domainId: string,
): Promise<void> {
  const result = await sql`
    DELETE FROM domains
    WHERE id = ${domainId} AND organization_id = ${orgId}
  `;

  if (result.count === 0) {
    throw new NotFoundError('Domain not found');
  }
}
