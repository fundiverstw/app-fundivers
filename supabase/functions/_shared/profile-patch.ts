// Sanitize a client-supplied profiles patch before applying it under
// service role. The public registration form (RegisterForm.tsx and
// MultiRegisterForm.tsx) sends a `profile_patch` object that
// create-registration forwards to the admin client — bypassing RLS.
// Without an allowlist, an attacker can include role: 'admin',
// status: 'active', or parent_account: <victim-uid> and self-promote
// in one HTTP call (security audit C2).
//
// The allowlist is the exact set of columns the SPA's
// registration-form patch builder emits, mirrored here as a contract.
// The unit test in profile-patch.test.ts pins both directions: every
// allowed key the SPA actually sends, and every blocked key from the
// audit's attack list. Update both files together when the SPA's
// patch shape changes.
//
// Plain TypeScript (no Deno-specific imports) so the same file is
// reachable from both the edge function (Deno) and the vitest unit
// suite (Node).

export const PROFILE_PATCH_ALLOW: ReadonlySet<string> = new Set<string>([
  'name',
  'nickname',
  'date_of_birth',
  'nationality',
  'gender',
  'id_number',
  'contact_method',
  'contact_id',
  'cert_agency',
  'cert_level',
  'logged_dives',
  'nitrox_certified',
  'nitrox_card_path',
  'deep_certified',
  'deep_card_path',
  'cert_card_path',
  'emergency_contact_name',
  'emergency_contact_phone',
])

/**
 * Return a new object containing only the allowlisted keys from
 * `patch`. Input is never mutated. Null values are preserved
 * (the SPA uses null to clear a column). Non-object inputs return {}.
 *
 * Drops are silent — no error response shape leaks back to the caller,
 * so a probe testing "did my injection land?" gets no schema hint.
 */
export function sanitizeProfilePatch(
  patch: unknown,
): Record<string, unknown> {
  if (patch === null || patch === undefined) return {}
  if (typeof patch !== 'object' || Array.isArray(patch)) return {}
  const src = patch as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(src)) {
    if (PROFILE_PATCH_ALLOW.has(k)) out[k] = src[k]
  }
  return out
}
