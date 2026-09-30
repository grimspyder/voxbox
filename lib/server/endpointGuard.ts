// SSRF protection for the optional OpenAI-compatible custom endpoint.
//
// The developer setting lets a user point the SERVER at an arbitrary host, so a
// bare "does it look like a URL" check is not enough: it would let anyone turn
// KITT's proxy into an internal-network scanner. The consumer build therefore
// refuses custom endpoints entirely unless the deployment explicitly opts in.

import { PROVIDER_HOSTS } from './limits';

/** Set KITT_ALLOW_CUSTOM_ENDPOINTS=true only in a developer/self-hosted build. */
export const CUSTOM_ENDPOINTS_ENABLED = process.env.KITT_ALLOW_CUSTOM_ENDPOINTS === 'true';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  '169.254.169.254',
]);

const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];

export interface EndpointCheck {
  ok: boolean;
  /** Normalized origin (no path/query), present when ok. */
  origin?: string;
  reason?: string;
}

/** Parse a decimal/octal/hex IPv4 host into four bytes, or null if it is not one. */
function ipv4ToBytes(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length > 4) return null;
  const nums: number[] = [];
  for (const rawPart of parts) {
    if (rawPart === '') return null;
    let value: number;
    if (/^0[xX][0-9a-fA-F]+$/.test(rawPart)) value = parseInt(rawPart, 16);
    else if (/^0[0-7]+$/.test(rawPart)) value = parseInt(rawPart, 8);
    else if (/^\d+$/.test(rawPart)) value = parseInt(rawPart, 10);
    else return null;
    if (!Number.isFinite(value) || value < 0) return null;
    nums.push(value);
  }
  if (nums.length === 1) {
    // Bare integer form, e.g. http://2130706433/
    const n = nums[0];
    if (n > 0xffffffff) return null;
    return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  }
  if (nums.length === 2) {
    // a.b form: a is the high byte, b is the low 24 bits
    const [a, b] = nums;
    if (a > 255 || b > 0xffffff) return null;
    return [a & 255, (b >>> 16) & 255, (b >>> 8) & 255, b & 255];
  }
  if (nums.length === 3) {
    const [a, b, c] = nums;
    if (a > 255 || b > 255 || c > 0xffff) return null;
    return [a & 255, b & 255, (c >>> 8) & 255, c & 255];
  }
  if (nums.some((n) => n > 255)) return null;
  return nums;
}

function isBlockedIPv4(bytes: number[]): boolean {
  const [a, b] = bytes;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast + reserved
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (!h.includes(':')) return false;
  if (h === '::' || h === '::1') return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local
  if (/^fe[89ab]/.test(h)) return true; // link local
  if (h.startsWith('ff')) return true; // multicast
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (mapped) {
    const bytes = ipv4ToBytes(mapped[1]);
    return bytes ? isBlockedIPv4(bytes) : true;
  }
  // ::ffff:7f00:1 style mapped addresses
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hexMapped) {
    const high = parseInt(hexMapped[1], 16);
    const low = parseInt(hexMapped[2], 16);
    return isBlockedIPv4([(high >>> 8) & 255, high & 255, (low >>> 8) & 255, low & 255]);
  }
  return false;
}

/**
 * Validate a user-supplied OpenAI-compatible endpoint.
 * Rejects non-HTTPS, credentials in the URL, non-standard ports, private and
 * link-local addresses (including octal/hex/integer-encoded forms), and
 * internal-only hostnames.
 */
export function checkCustomEndpoint(raw: string): EndpointCheck {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'No endpoint URL supplied.' };
  if (trimmed.length > 300) return { ok: false, reason: 'Endpoint URL is too long.' };

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL.' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'Only HTTPS endpoints are allowed.' };
  if (url.username || url.password) return { ok: false, reason: 'Credentials in the URL are not allowed.' };
  if (url.port && url.port !== '443') return { ok: false, reason: 'Only the default HTTPS port is allowed.' };
  if (url.hash) return { ok: false, reason: 'Fragments are not allowed in endpoints.' };

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'The endpoint has no host.' };
  if (BLOCKED_HOSTNAMES.has(host)) return { ok: false, reason: 'That host is not reachable from the public internet.' };
  if (BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: 'Internal hostnames are not allowed.' };
  }
  if (isBlockedIPv6(host)) return { ok: false, reason: 'Private and loopback addresses are not allowed.' };
  const bytes = ipv4ToBytes(host);
  if (bytes && isBlockedIPv4(bytes)) {
    return { ok: false, reason: 'Private and loopback addresses are not allowed.' };
  }
  // A hostname must be either a public IP literal or a resolvable-looking name.
  const looksLikeName = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host);
  if (!bytes && !looksLikeName) return { ok: false, reason: 'The endpoint host is not valid.' };

  return { ok: true, origin: url.origin };
}

/** True when the resolved provider base URL points at a fixed allowlisted host. */
export function isAllowlistedProviderHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return Object.values(PROVIDER_HOSTS).some((h) => host === h);
  } catch {
    return false;
  }
}
