# RLS Regression Checklist — Tenants, Members, Invitations

Run each check from the Supabase SQL Editor while impersonating different
roles via the `set request.jwt.claim.sub = '<user_uuid>'` pattern, or by
signing in as the relevant user in the app.

Symbols: ✅ allowed, ❌ blocked (RLS denies / returns 0 rows).

## 1. Cross-tenant isolation
Setup: user `A` is owner of tenant `T1` only. Tenant `T2` exists with user `B`.

| Action as user `A`                                                  | Expected |
|---------------------------------------------------------------------|----------|
| `select * from tenants where id = T2`                               | ❌ 0 rows |
| `select * from tenant_members where tenant_id = T2`                 | ❌ 0 rows |
| `select * from tenant_invitations where tenant_id = T2`             | ❌ 0 rows |
| `select * from membership_audit_log where tenant_id = T2`           | ❌ 0 rows |
| `select * from orders where tenant_id = T2`                         | ❌ 0 rows |
| `insert into tenant_members(tenant_id,user_id,tenant_role) values (T2, A, 'owner')` | ❌ |
| `insert into tenant_invitations(tenant_id,email,tenant_role) values (T2,'x@x','admin')` | ❌ |
| `update tenants set name='hacked' where id = T2`                    | ❌ |

## 2. Role-based writes within own tenant
Setup: `O` (owner), `Ad` (admin), `M` (member) all in tenant `T`.

| Action                                                  | O | Ad | M |
|---------------------------------------------------------|---|----|---|
| `select * from tenant_members where tenant_id=T`        | ✅ | ✅ | ✅ |
| `select * from tenant_invitations where tenant_id=T`    | ✅ | ✅ | ❌ |
| `select * from membership_audit_log where tenant_id=T`  | ✅ | ✅ | ❌ |
| insert invitation                                       | ✅ | ✅ | ❌ |
| delete invitation                                       | ✅ | ✅ | ❌ |
| update member.tenant_role to `admin` (target=M)         | ✅ | ✅ | ❌ |
| update member.tenant_role to `owner` (target=M)         | ✅ | ❌ | ❌ |
| delete member (target=M)                                | ✅ | ✅ | ❌ |
| delete self (`user_id = auth.uid()`)                    | ✅ | ✅ | ✅ |
| update tenants set name=...                             | ✅ | ❌ | ❌ |

## 3. Invitation enumeration
A signed-out (anon) or unrelated user MUST NOT be able to:

| Action                                                       | Expected |
|--------------------------------------------------------------|----------|
| `select * from tenant_invitations where token='<valid>'`     | ❌ |
| `select email from tenant_invitations`                       | ❌ |

The `accept-invite` edge function looks up tokens with the service role
key — clients never read invitations by token directly.

## 4. JWT claim spoofing
Setup: user `A` belongs only to `T1` but sets a forged JWT
`app_metadata.active_tenant_id = T2`.

| Action                                                       | Expected |
|--------------------------------------------------------------|----------|
| `current_tenant_id()` returns `T2`                           | ✅ (claim is honoured) |
| `select * from orders` (RLS uses `current_tenant_id()`)      | ❌ 0 rows — `is_tenant_member(T2)` is false, so writes still fail, and `select` checks `tenant_id = current_tenant_id()` AND membership where applicable |
| insert into orders with `tenant_id = T2`                     | ❌ |

> ⚠️ `current_tenant_id()` trusts the claim. The actual safety comes from
> `is_tenant_member()` / `tenant_has_role()` on every membership-sensitive
> policy. Never rely on `current_tenant_id()` alone for write checks.

## 5. Audit log integrity

| Action                                                       | Expected |
|--------------------------------------------------------------|----------|
| Member updates their role in `tenant_members`                | trigger inserts `member.role_updated` row |
| Owner deletes a member                                       | trigger inserts `member.removed` row |
| Member deletes self                                          | trigger inserts `member.left` row |
| Any authenticated user `insert into membership_audit_log`    | ❌ (no policy) |
| Any authenticated user `delete from membership_audit_log`    | ❌ (no policy) |

## 6. Platform admin escape hatch
Setup: `P` is in `platform_admins`.

| Action                                          | Expected |
|-------------------------------------------------|----------|
| `select * from tenants` (no filter)             | ✅ all rows |
| `select * from tenant_members` (no filter)      | ✅ all rows |
| `select * from membership_audit_log` (any T)    | ✅ |
| update any tenant                               | ✅ |

## Smoke commands

```sql
-- Run as authenticated user, swap UUIDs accordingly.
set local role authenticated;
set local request.jwt.claim.sub = '<user-uuid>';
set local request.jwt.claims = '{"sub":"<user-uuid>","app_metadata":{"active_tenant_id":"<tenant-uuid>"}}';

select current_setting('request.jwt.claim.sub', true) as me,
       public.current_tenant_id()                     as active_tenant;
```
