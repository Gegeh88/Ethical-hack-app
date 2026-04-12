import { sql } from './db.js';

/**
 * Defense-in-depth authorization check at the worker level.
 * Verifies that a domain is eligible to be scanned:
 *   1. Domain exists and is verified (not expired)
 *   2. An active consent record exists
 *   3. The requesting user belongs to the domain's organization
 *
 * This runs INDEPENDENTLY of the API-level check. Both must pass.
 * If any condition fails, the scan must be rejected.
 */
export async function canScanDomain(
  domainId: string,
  requestedBy: string,
): Promise<{ host: string; isSharedHosting: boolean }> {
  // 1. Domain must be verified and not expired
  const [domain] = await sql`
    SELECT d.id, d.host, d.organization_id, d.is_shared_hosting,
           d.verified_at, d.verification_expires_at
    FROM domains d
    WHERE d.id = ${domainId}
      AND d.verified_at IS NOT NULL
      AND d.verification_expires_at > now()
  `;

  if (!domain) {
    throw new Error('Domain not found or verification expired');
  }

  // 2. Active consent record must exist
  const [consent] = await sql`
    SELECT id FROM consent_records
    WHERE domain_id = ${domainId}
      AND active = true
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (!consent) {
    throw new Error('No active consent record for this domain');
  }

  // 3. Requesting user must belong to the domain's organization
  const [user] = await sql`
    SELECT id FROM app_users
    WHERE id = ${requestedBy}
      AND organization_id = ${domain.organization_id}
  `;

  if (!user) {
    throw new Error('User does not belong to the domain organization');
  }

  return {
    host: domain.host as string,
    isSharedHosting: domain.is_shared_hosting as boolean,
  };
}
