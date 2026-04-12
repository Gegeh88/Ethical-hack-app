import { lookup } from 'node:dns/promises';

/**
 * Private/reserved IPv4 ranges in numeric form.
 * Each entry is an inclusive [start, end] range.
 */
const PRIVATE_RANGES: ReadonlyArray<{ start: number; end: number }> = [
  { start: 0x0a000000, end: 0x0affffff }, // 10.0.0.0/8
  { start: 0xac100000, end: 0xac1fffff }, // 172.16.0.0/12
  { start: 0xc0a80000, end: 0xc0a8ffff }, // 192.168.0.0/16
  { start: 0x7f000000, end: 0x7fffffff }, // 127.0.0.0/8
  { start: 0xa9fe0000, end: 0xa9feffff }, // 169.254.0.0/16 (link-local)
  { start: 0x00000000, end: 0x00ffffff }, // 0.0.0.0/8
];

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

function isPrivateIp(ip: string): boolean {
  // IPv6 loopback
  if (ip === '::1') return true;
  // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1)
  if (ip.startsWith('::ffff:')) {
    const v4 = ip.slice(7);
    return isPrivateIp(v4);
  }
  // Pure IPv6 — block all non-global unicast (conservative approach)
  if (ip.includes(':')) return true;
  // IPv4
  const num = ipToInt(ip);
  return PRIVATE_RANGES.some((r) => num >= r.start && num <= r.end);
}

/**
 * Resolves a hostname and asserts the resulting IP is not in a private range.
 * Must be called before any HTTP fetch to an external host to prevent SSRF.
 *
 * @returns The resolved public IP address.
 * @throws Error if the host resolves to a private/reserved IP.
 */
export async function assertPublicHost(host: string): Promise<string> {
  const { address } = await lookup(host);
  if (isPrivateIp(address)) {
    throw new Error(`SSRF blocked: ${host} resolves to private IP ${address}`);
  }
  return address;
}
