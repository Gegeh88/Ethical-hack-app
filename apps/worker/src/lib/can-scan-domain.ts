import { supabaseAdmin } from './supabase.js';

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
  const { data: domain, error: domainError } = await supabaseAdmin
    .from('domains')
    .select('id, host, organization_id, is_shared_hosting, verified_at, verification_expires_at')
    .eq('id', domainId)
    .not('verified_at', 'is', null)
    .gt('verification_expires_at', new Date().toISOString())
    .maybeSingle();

  if (domainError) {
    throw new Error(`Failed to check domain: ${domainError.message}`);
  }

  if (!domain) {
    throw new Error('Domain not found or verification expired');
  }

  // 2. Active consent record must exist
  const { data: consent, error: consentError } = await supabaseAdmin
    .from('consent_records')
    .select('id')
    .eq('domain_id', domainId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (consentError) {
    throw new Error(`Failed to check consent: ${consentError.message}`);
  }

  if (!consent) {
    throw new Error('No active consent record for this domain');
  }

  // 3. Requesting user must belong to the domain's organization
  const { data: user, error: userError } = await supabaseAdmin
    .from('app_users')
    .select('id')
    .eq('id', requestedBy)
    .eq('organization_id', domain.organization_id as string)
    .maybeSingle();

  if (userError) {
    throw new Error(`Failed to check user authorization: ${userError.message}`);
  }

  if (!user) {
    throw new Error('User does not belong to the domain organization');
  }

  return {
    host: domain.host as string,
    isSharedHosting: domain.is_shared_hosting as boolean,
  };
}
