## Goal

Make Platform Console tenant onboarding idempotent: the console creates the tenant once, and the first account created through its signup link is attached to that exact tenant without creating another workspace.

## Confirmed flow and failure mode

- The Platform Console creates an empty tenant first through `platform-admin` (`create_tenant`).
- Its signup link currently identifies that tenant only with `?tenant=<slug>`.
- The deployed signup page does pass that slug as `join_tenant_slug` in Supabase user metadata.
- The database signup trigger attempts to find that slug. If the metadata is absent, altered, stale, or does not resolve to a tenant, it silently continues into the normal self-signup branch and creates a new tenant using `company_name`.
- That fallback accounts for the observed shape: the console-created tenant remains empty while the new user is attached to a second tenant with the same display name.

The exact reason a particular signup's slug failed to resolve cannot be confirmed from this session because direct database reads are unavailable. The fix will remove the unsafe fallback rather than relying on the slug always surviving every redirect.

## Implementation

1. **Use the tenant UUID in console-generated onboarding links**
   - Include the created tenant ID alongside the human-readable slug in the signup URL.
   - Preserve both values through the login/signup screen and email confirmation redirect.
   - Store the tenant ID in signup metadata as the primary join reference; retain the slug only for readable URLs and backwards compatibility.

2. **Make the signup trigger fail closed**
   - Update `handle_new_user_tenant()` to resolve link-based signups by tenant ID first, then by slug for existing links.
   - If either join marker is present but no matching tenant exists, raise a clear error instead of creating a new tenant.
   - Keep automatic tenant creation only for genuine standalone signups that contain no join marker.
   - Keep membership insertion idempotent so retries cannot create duplicate memberships.

3. **Assign the first linked user correctly**
   - When the console-created tenant has no members, attach the signup user as tenant `owner`.
   - If it already has members, attach later signup-link users as `member`, preserving the existing shared-link behavior.
   - Ensure confirmation-time staff-role assignment uses the tenant membership that was created.

4. **Handle existing empty duplicates safely**
   - Add a read-only diagnostic query to identify same-name tenants, their slugs, creation times, and member counts.
   - Do not automatically delete existing duplicates because they may already contain business data; provide a targeted cleanup query only for confirmed empty tenants after reviewing the diagnostic result.

5. **Validate the complete flow**
   - Create one tenant in the Platform Console.
   - Open its generated signup link, register and confirm the first user.
   - Verify the tenant count remains unchanged, the user belongs to the original tenant as owner, and the confirmation redirect returns to that tenant.
   - Verify a normal signup without a tenant link still creates exactly one new tenant.

## Technical changes

- `src/components/platform/AddTenantDialog.tsx`: add the tenant ID to generated onboarding URLs.
- `src/pages/Login.tsx`: preserve the immutable tenant reference from the URL.
- `src/hooks/useAuth.tsx`: include tenant ID and slug in signup metadata and the confirmation redirect.
- `src/pages/AuthCallback.tsx`: preserve tenant context when redirecting after confirmation.
- Supabase migration: replace `handle_new_user_tenant()` with the fail-closed, ID-first, idempotent implementation.
- Add focused trigger-flow verification covering linked signup, invalid linked signup, retry, and standalone signup.

## Out of scope

- No automatic deletion or merging of existing tenant records without first confirming that the duplicate tenant has no orders, settings, staff, inventory, expenses, or other business data.
