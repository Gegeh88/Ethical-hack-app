import { supabaseAdmin } from '../lib/supabase.js';

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
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('tier')
    .eq('organization_id', orgId)
    .maybeSingle();

  return (sub?.tier as string) ?? 'free';
}

// ---------------------------------------------------------------------------
// checkScanQuota
// ---------------------------------------------------------------------------

export async function checkScanQuota(orgId: string): Promise<QuotaCheck> {
  const tier = await getOrgTier(orgId);
  const limit = SCAN_LIMITS[tier] ?? 3;

  // Count scans queued this month
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { count, error } = await supabaseAdmin
    .from('scan_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .gte('queued_at', startOfMonth.toISOString());

  if (error) {
    throw new Error(`Scan quota check failed: ${error.message}`);
  }

  const current = count ?? 0;

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

  const { count, error } = await supabaseAdmin
    .from('domains')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  if (error) {
    throw new Error(`Domain quota check failed: ${error.message}`);
  }

  const current = count ?? 0;

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
