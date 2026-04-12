import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';
import type { FastifyRequest } from 'fastify';
import type {
  VerificationMethod,
  VerificationResult,
  VerificationTokenResponse,
} from '@haxvibe/shared-types';
import { supabaseAdmin } from '../lib/supabase.js';
import { audit } from '../lib/audit.js';
import { assertPublicHost } from '../lib/ssrf-guard.js';
import {
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../lib/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DomainRow {
  id: string;
  host: string;
  organization_id: string;
}

interface VerificationRow {
  id: string;
  domain_id: string;
  token: string;
  method: VerificationMethod | null;
  status: string;
  evidence: Record<string, unknown> | null;
  attempt_count: number;
  created_at: string;
  verified_at: string | null;
  expires_at: string;
}

/**
 * Fetch a domain scoped to the given organization, or throw NotFoundError.
 */
async function getDomainForOrg(domainId: string, orgId: string): Promise<DomainRow> {
  const { data: domain, error } = await supabaseAdmin
    .from('domains')
    .select('id, host, organization_id')
    .eq('id', domainId)
    .eq('organization_id', orgId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch domain: ${error.message}`);
  }

  if (!domain) {
    throw new NotFoundError('Domain not found');
  }

  return domain as unknown as DomainRow;
}

/** Maximum body bytes we read from an external HTTP response. */
const MAX_RESPONSE_BYTES = 200 * 1024; // 200 KB

/**
 * Safely read up to `maxBytes` from a Response body.
 */
async function readBodyLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    totalLength += value.byteLength;
    if (totalLength > maxBytes) {
      // Take only what we need from this chunk
      const excess = totalLength - maxBytes;
      chunks.push(value.slice(0, value.byteLength - excess));
      reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }

  const decoder = new TextDecoder();
  return chunks.map((c) => decoder.decode(c, { stream: true })).join('');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate (or return existing) verification token for a domain.
 */
export async function generateToken(
  domainId: string,
  userId: string,
  orgId: string,
  req: FastifyRequest,
): Promise<VerificationTokenResponse> {
  const domain = await getDomainForOrg(domainId, orgId);

  // Check for existing pending, non-expired token
  const { data: existing, error: existingError } = await supabaseAdmin
    .from('domain_verifications')
    .select('id, token, expires_at')
    .eq('domain_id', domainId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to check existing tokens: ${existingError.message}`);
  }

  let token: string;
  let expiresAt: string;

  if (existing) {
    token = existing.token as string;
    expiresAt = existing.expires_at as string;
  } else {
    token = `hxv-verify-${randomBytes(16).toString('hex')}`;

    // expires_at = 7 days from now
    const expires = new Date();
    expires.setDate(expires.getDate() + 7);

    const { data: row, error: insertError } = await supabaseAdmin
      .from('domain_verifications')
      .insert({
        domain_id: domainId,
        token,
        status: 'pending',
        expires_at: expires.toISOString(),
      })
      .select('expires_at')
      .single();

    if (insertError || !row) {
      throw new Error(`Failed to create verification token: ${insertError?.message ?? 'no data returned'}`);
    }

    expiresAt = row.expires_at as string;

    await audit(req, {
      actor_id: userId,
      action: 'domain.verification_token_generated',
      resource_type: 'domain',
      resource_id: domainId,
      metadata: { host: domain.host },
    });
  }

  const host = domain.host;

  return {
    token,
    expiresAt,
    instructions: {
      dns: `Add a TXT record to _ethical-scan.${host} with value: ${token}`,
      meta: `Add <meta name="ethical-scan-verification" content="${token}"> to the <head> of https://${host}/`,
      file: `Create a file at https://${host}/.well-known/ethical-scan-verification.txt containing: ${token}`,
    },
  };
}

/**
 * Attempt to verify a domain using the specified method.
 */
export async function checkVerification(
  domainId: string,
  method: VerificationMethod,
  userId: string,
  orgId: string,
  req: FastifyRequest,
): Promise<VerificationResult> {
  const domain = await getDomainForOrg(domainId, orgId);

  // Rate limit: max 20 verification attempts per domain per 24 hours
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  const { data: attemptRows, error: attemptError } = await supabaseAdmin
    .from('domain_verifications')
    .select('attempt_count')
    .eq('domain_id', domainId)
    .gte('created_at', twentyFourHoursAgo.toISOString());

  if (attemptError) {
    throw new Error(`Failed to check verification attempts: ${attemptError.message}`);
  }

  const totalAttempts = (attemptRows ?? []).reduce(
    (sum, row) => sum + ((row.attempt_count as number) ?? 0),
    0,
  );

  if (totalAttempts >= 20) {
    throw new RateLimitError(
      'Too many verification attempts for this domain. Try again in 24 hours.',
    );
  }

  // Get latest pending token
  const { data: pending, error: pendingError } = await supabaseAdmin
    .from('domain_verifications')
    .select('id, token, expires_at')
    .eq('domain_id', domainId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (pendingError) {
    throw new Error(`Failed to fetch pending verification: ${pendingError.message}`);
  }

  if (!pending) {
    throw new ValidationError(
      'No pending verification token found. Generate a new token first.',
    );
  }

  const verificationId = pending.id as string;
  const token = pending.token as string;
  const host = domain.host;

  // Increment attempt counter
  // We need the current value first to increment
  const { error: incError } = await supabaseAdmin.rpc('increment_attempt_count', {
    verification_id: verificationId,
  }).then(
    // If the RPC doesn't exist, fall back to a manual update
    (res) => {
      if (res.error) {
        // Fallback: read current count and update
        return { error: res.error };
      }
      return res;
    },
  );

  // If RPC failed (likely doesn't exist), do a manual read + update
  if (incError) {
    const { data: currentRow } = await supabaseAdmin
      .from('domain_verifications')
      .select('attempt_count')
      .eq('id', verificationId)
      .single();

    const currentCount = (currentRow?.attempt_count as number) ?? 0;

    await supabaseAdmin
      .from('domain_verifications')
      .update({ attempt_count: currentCount + 1 })
      .eq('id', verificationId);
  }

  // Execute the appropriate verification method
  let verified = false;
  let reason: string | undefined;
  let evidence: Record<string, unknown> | undefined;

  try {
    switch (method) {
      case 'dns': {
        const result = await verifyDns(host, token);
        verified = result.verified;
        reason = result.reason;
        evidence = result.evidence;
        break;
      }
      case 'meta': {
        const result = await verifyMeta(host, token);
        verified = result.verified;
        reason = result.reason;
        evidence = result.evidence;
        break;
      }
      case 'file': {
        const result = await verifyFile(host, token);
        verified = result.verified;
        reason = result.reason;
        evidence = result.evidence;
        break;
      }
    }
  } catch (err) {
    verified = false;
    reason = err instanceof Error ? err.message : 'Unknown verification error';
  }

  if (verified) {
    // Sequential updates (replaces the SQL transaction).
    // If the first succeeds but the second fails, domain_verifications will be
    // marked verified but domains.verified_at won't be set. Acceptable for now;
    // can be replaced with an RPC function later.
    const now = new Date().toISOString();
    const expiresOneYear = new Date();
    expiresOneYear.setFullYear(expiresOneYear.getFullYear() + 1);

    const { error: verUpdateError } = await supabaseAdmin
      .from('domain_verifications')
      .update({
        status: 'verified',
        method,
        verified_at: now,
        evidence: evidence ?? {},
      })
      .eq('id', verificationId);

    if (verUpdateError) {
      throw new Error(`Failed to update verification record: ${verUpdateError.message}`);
    }

    const { error: domUpdateError } = await supabaseAdmin
      .from('domains')
      .update({
        verified_at: now,
        verification_method: method,
        verification_expires_at: expiresOneYear.toISOString(),
        updated_at: now,
      })
      .eq('id', domainId);

    if (domUpdateError) {
      throw new Error(`Failed to update domain verification status: ${domUpdateError.message}`);
    }

    await audit(req, {
      actor_id: userId,
      action: 'domain.verified',
      resource_type: 'domain',
      resource_id: domainId,
      metadata: { host, method },
    });
  } else {
    await audit(req, {
      actor_id: userId,
      action: 'domain.verification_failed',
      resource_type: 'domain',
      resource_id: domainId,
      metadata: { host, method, reason },
    });
  }

  return {
    verified,
    method,
    ...(reason ? { reason } : {}),
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Get the current verification status and history for a domain.
 */
export async function getVerificationStatus(
  domainId: string,
  orgId: string,
): Promise<{ current: VerificationRow | null; history: VerificationRow[] }> {
  await getDomainForOrg(domainId, orgId);

  // Current pending verification (if any)
  const { data: current, error: currentError } = await supabaseAdmin
    .from('domain_verifications')
    .select('id, domain_id, token, method, status, evidence, attempt_count, created_at, verified_at, expires_at')
    .eq('domain_id', domainId)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (currentError) {
    throw new Error(`Failed to fetch current verification: ${currentError.message}`);
  }

  // Full history (last 10)
  const { data: history, error: historyError } = await supabaseAdmin
    .from('domain_verifications')
    .select('id, domain_id, token, method, status, evidence, attempt_count, created_at, verified_at, expires_at')
    .eq('domain_id', domainId)
    .order('created_at', { ascending: false })
    .limit(10);

  if (historyError) {
    throw new Error(`Failed to fetch verification history: ${historyError.message}`);
  }

  return {
    current: (current as unknown as VerificationRow) ?? null,
    history: (history ?? []) as unknown as VerificationRow[],
  };
}

// ---------------------------------------------------------------------------
// Verification method implementations
// ---------------------------------------------------------------------------

interface MethodResult {
  verified: boolean;
  reason?: string;
  evidence?: Record<string, unknown>;
}

/**
 * DNS TXT record verification.
 * Checks `_ethical-scan.<host>` for a TXT record matching the token.
 */
async function verifyDns(host: string, token: string): Promise<MethodResult> {
  const lookupHost = `_ethical-scan.${host}`;
  let records: string[][];
  try {
    records = await resolveTxt(lookupHost);
  } catch {
    return {
      verified: false,
      reason: `DNS lookup failed for ${lookupHost}. Ensure the TXT record exists.`,
    };
  }

  // resolveTxt returns string[][] — each record can be multiple chunks joined
  const found = records.some((chunks) => chunks.join('') === token);

  if (found) {
    return {
      verified: true,
      evidence: { dns_host: lookupHost, record_count: records.length },
    };
  }

  return {
    verified: false,
    reason: `TXT record for ${lookupHost} does not contain the expected token.`,
    evidence: {
      dns_host: lookupHost,
      found_records: records.map((c) => c.join('')),
    },
  };
}

/**
 * Meta tag verification.
 * Fetches the root page and checks for
 * `<meta name="ethical-scan-verification" content="<token>">` in the HTML.
 */
async function verifyMeta(host: string, token: string): Promise<MethodResult> {
  // SSRF guard: resolve host and assert it's public before making the request
  await assertPublicHost(host);

  const url = `https://${host}/`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HaxVibe-Verifier/1.0' },
      redirect: 'follow',
    });
  } catch {
    return {
      verified: false,
      reason: `Failed to fetch ${url}. Ensure the site is accessible via HTTPS.`,
    };
  }

  if (!response.ok) {
    return {
      verified: false,
      reason: `HTTP ${response.status} when fetching ${url}.`,
    };
  }

  const html = await readBodyLimited(response, MAX_RESPONSE_BYTES);

  // Match the meta tag — allow flexible whitespace and quoting
  const regex = new RegExp(
    `<meta\\s+name=["']ethical-scan-verification["']\\s+content=["']${escapeRegex(token)}["']\\s*/?>`,
    'i',
  );
  // Also check reverse attribute order
  const regexReverse = new RegExp(
    `<meta\\s+content=["']${escapeRegex(token)}["']\\s+name=["']ethical-scan-verification["']\\s*/?>`,
    'i',
  );

  const found = regex.test(html) || regexReverse.test(html);

  if (found) {
    return {
      verified: true,
      evidence: { url, method: 'meta' },
    };
  }

  return {
    verified: false,
    reason: `Meta tag not found in the <head> of ${url}. Ensure the tag is present and the content matches exactly.`,
  };
}

/**
 * Well-known file verification.
 * Fetches `/.well-known/ethical-scan-verification.txt` and compares content.
 */
async function verifyFile(host: string, token: string): Promise<MethodResult> {
  // SSRF guard: resolve host and assert it's public before making the request
  await assertPublicHost(host);

  const url = `https://${host}/.well-known/ethical-scan-verification.txt`;
  let response: Response;
  try {
    response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'HaxVibe-Verifier/1.0' },
      redirect: 'follow',
    });
  } catch {
    return {
      verified: false,
      reason: `Failed to fetch ${url}. Ensure the file is accessible via HTTPS.`,
    };
  }

  if (!response.ok) {
    return {
      verified: false,
      reason: `HTTP ${response.status} when fetching ${url}.`,
    };
  }

  const body = await readBodyLimited(response, MAX_RESPONSE_BYTES);
  const trimmed = body.trim();

  if (trimmed === token) {
    return {
      verified: true,
      evidence: { url, method: 'file' },
    };
  }

  return {
    verified: false,
    reason: `File content at ${url} does not match the expected token.`,
  };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
