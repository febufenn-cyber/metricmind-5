# Phase 4: Production identity, tenancy, and durable stores

## Objective

Phase 4 replaces actor headers and process-local state with verified identity, organization membership, role authorization, durable metadata persistence, and database-enforced tenant isolation.

## Authentication modes

1. **Supabase JWT**: production mode. Use `AUTH_VERIFIER.verify(token)` for asymmetric signing keys or `SUPABASE_JWT_SECRET` for legacy HS256 tokens. Issuer, audience, expiry, not-before, subject, organization, and membership are validated.
2. **Bootstrap token**: migration and controlled testing only. `API_TOKEN` grants organization-administrator access and records `authenticationMode=bootstrap_token`.
3. **Unverified development mode**: available only when no auth configuration exists. It preserves local tests and is reported as `development_unverified`; it must not be used for production deployment.

Production JWT requests select an organization using `X-Metricmind-Organization`, the `organization_id` claim, or `app_metadata.default_organization_id`. Membership is resolved from `MEMBERSHIP_STORE`, `METADATA_DB`, or signed app metadata. Missing membership fails closed.

## Roles

- viewer: read analytics, semantic definitions, and investigations;
- analyst: create and review investigations;
- metric editor: create and submit semantic drafts;
- metric approver: verify and activate semantic versions;
- organization administrator: all organization permissions.

## Durable storage

`METADATA_DB` is a separate application metadata database binding. It must not point to the customer analytics warehouse. The concrete adapters persist organization memberships, semantic catalog snapshots with optimistic revisions, full investigation records and safe warehouse mappings that reference Hyperdrive configurations without storing origin passwords.

## RLS

Migration `005_phase4_identity_tenancy.sql` adds organization membership and tenant policies. Database access remains deny-by-default when no membership exists. Application authorization and RLS are independent controls.

## Trust invariants

- JWT verification and membership checks fail closed.
- Organization identity comes from verified context, not an untrusted body field.
- Cross-organization reads and writes are blocked in application queries and RLS.
- Metric editors and metric approvers are separate roles.
- Production mutations require durable stores.
- Customer warehouse credentials are never stored in application tables.

## Exit gate

All production reads and writes have a verified principal, organization membership, role permission, durable store path and RLS policy. Local unverified mode remains clearly labelled and is not a production configuration.
