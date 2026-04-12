/**
 * Strict hostname validation regex from the security contracts.
 * Allows only valid DNS hostnames with at least two labels.
 * Prevents command injection by rejecting any shell metacharacters.
 */
const HOST_REGEX = /^(?!-)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

/**
 * Validates that the given string is a well-formed DNS hostname.
 * This must be called before passing any host to scanner binaries,
 * network APIs, or external processes.
 */
export function isValidHost(host: string): boolean {
  return HOST_REGEX.test(host);
}

/**
 * Validates and returns the host, or throws if invalid.
 */
export function assertValidHost(host: string): string {
  if (!isValidHost(host)) {
    throw new Error(`Invalid hostname: ${host}`);
  }
  return host;
}
