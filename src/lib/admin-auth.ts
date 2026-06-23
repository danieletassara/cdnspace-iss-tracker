import { timingSafeEqual } from "node:crypto";

/**
 * Verify the Bearer token on an admin request against the ADMIN_TOKEN env var.
 *
 * Fails CLOSED when ADMIN_TOKEN is unset — there is deliberately no insecure
 * default (the old `?? "changeme"` fallback let anyone in on a misconfigured
 * deployment). Uses a constant-time comparison so the token can't be recovered
 * byte-by-byte via response timing.
 */
export function isAdminAuthorized(request: Request): boolean {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;

  const header = request.headers.get("Authorization");
  if (!header) return false;

  const [scheme, token] = header.split(" ");
  if (scheme !== "Bearer" || !token) return false;

  const provided = Buffer.from(token);
  const secret = Buffer.from(expected);
  // timingSafeEqual throws if lengths differ, so length-check first. The length
  // of the token is not itself secret, so this short-circuit is acceptable.
  if (provided.length !== secret.length) return false;
  return timingSafeEqual(provided, secret);
}
