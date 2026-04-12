import { supabaseAdmin } from '../lib/supabase.js';
import { NotFoundError, RateLimitError } from '../lib/errors.js';
import { checkDomainQuota } from './quota.service.js';

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

  // Count total
  const { count, error: countError } = await supabaseAdmin
    .from('domains')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId);

  if (countError) {
    throw new Error(`Failed to count domains: ${countError.message}`);
  }

  // Paginated rows
  const { data: rows, error: rowsError } = await supabaseAdmin
    .from('domains')
    .select('id, organization_id, added_by, host, verified_at, verification_method, verification_expires_at, is_shared_hosting, notes, created_at, updated_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (rowsError) {
    throw new Error(`Failed to list domains: ${rowsError.message}`);
  }

  return {
    data: (rows ?? []) as unknown as DomainRow[],
    total: count ?? 0,
  };
}

export async function createDomain(
  orgId: string,
  userId: string,
  host: string,
  isSharedHosting: boolean,
): Promise<DomainRow> {
  // Quota check — enforce domain limit per tier
  const quota = await checkDomainQuota(orgId);
  if (!quota.allowed) {
    throw new RateLimitError(quota.reason!);
  }

  const { data: domain, error } = await supabaseAdmin
    .from('domains')
    .insert({
      organization_id: orgId,
      added_by: userId,
      host,
      is_shared_hosting: isSharedHosting,
    })
    .select('id, organization_id, added_by, host, verified_at, verification_method, verification_expires_at, is_shared_hosting, notes, created_at, updated_at')
    .single();

  if (error || !domain) {
    throw new Error(`Failed to create domain: ${error?.message ?? 'no data returned'}`);
  }

  return domain as unknown as DomainRow;
}

export async function getDomainById(
  orgId: string,
  domainId: string,
): Promise<DomainRow & { verifications: unknown[] }> {
  const { data: domain, error } = await supabaseAdmin
    .from('domains')
    .select('id, organization_id, added_by, host, verified_at, verification_method, verification_expires_at, is_shared_hosting, notes, created_at, updated_at')
    .eq('id', domainId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch domain: ${error.message}`);
  }

  if (!domain) {
    throw new NotFoundError('Domain not found');
  }

  // Fetch associated verification records
  const { data: verifications, error: verError } = await supabaseAdmin
    .from('domain_verifications')
    .select('id, domain_id, method, token, status, checked_at, expires_at, created_at')
    .eq('domain_id', domainId)
    .order('created_at', { ascending: false });

  if (verError) {
    throw new Error(`Failed to fetch verifications: ${verError.message}`);
  }

  return {
    ...(domain as unknown as DomainRow),
    verifications: (verifications ?? []) as unknown[],
  };
}

export async function deleteDomain(
  orgId: string,
  domainId: string,
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('domains')
    .delete()
    .eq('id', domainId)
    .eq('organization_id', orgId)
    .select('id');

  if (error) {
    throw new Error(`Failed to delete domain: ${error.message}`);
  }

  if (!data || data.length === 0) {
    throw new NotFoundError('Domain not found');
  }
}
