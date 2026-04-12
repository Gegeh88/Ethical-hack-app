import { sql } from '../lib/db.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuotaCheck {
  allowed: boolean;
  reason?: string;
  current: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Tier limits
// ---------------------------------------------------------------------------

const SCAN_LIMITS: Record<string, number> = { free: 3, pro: 50, business: 999 };
const DOMAIN_LIMITS: Record<string, number> = { free: 5, pro: 25, business: 100 };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getOrgTier(orgId: string): Promise<string> {
  const [sub] = await sql`
    SELECT tier FROM subscriptions WHERE organization_id = ${orgId}
  `;
  return (sub?.tier as string) ?? 'free';
}

// ---------------------------------------------------------------------------
// checkScanQuota
// ---------------------------------------------------------------------------

export async function checkScanQuota(orgId: string): Promise<QuotaCheck> {
  const tier = await getOrgTier(orgId);
  const limit = SCAN_LIMITS[tier] ?? 3;

  const [count] = await sql`
    SELECT count(*)::int AS total
    FROM scan_jobs
    WHERE organization_id = ${orgId}
      AND queued_at >= date_trunc('month', now())
  `;

  const current = (count?.total as number) ?? 0;

  if (current >= limit) {
    return {
      allowed: false,
      reason: `Havi scan limit elerve (${limit}/${tier} csomag)`,
      current,
      limit,
    };
  }

  return { allowed: true, current, limit };
}

// ---------------------------------------------------------------------------
// checkDomainQuota
// ---------------------------------------------------------------------------

export async function checkDomainQuota(orgId: string): Promise<QuotaCheck> {
  const tier = await getOrgTier(orgId);
  const limit = DOMAIN_LIMITS[tier] ?? 5;

  const [count] = await sql`
    SELECT count(*)::int AS total
    FROM domains
    WHERE organization_id = ${orgId}
  `;

  const current = (count?.total as number) ?? 0;

  if (current >= limit) {
    return {
      allowed: false,
      reason: `Domain limit elerve (${limit}/${tier} csomag)`,
      current,
      limit,
    };
  }

  return { allowed: true, current, limit };
}

// ---------------------------------------------------------------------------
// checkScanTypeAllowed
// ---------------------------------------------------------------------------

export async function checkScanTypeAllowed(orgId: string, scanType: string): Promise<boolean> {
  if (scanType === 'passive') return true;

  const tier = await getOrgTier(orgId);

  // Active/full scans require pro or business
  return tier !== 'free';
}
