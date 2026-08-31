# Blaze Flow Implementation Log

This is a living, chronological record of completed engineering work and consequential decisions. Add an entry in the same pull request as any material architecture, infrastructure, schema, or product change.

Each entry should state what changed, why, verification performed, known limitations, and the recommended next step. Product aspirations belong in `docs/implementations/domain_and_features.md`, not here.

## 2026-08-31 — Custom roles and explicit project-access administration

### Delivered

- Added protected-system metadata to workspace roles and a data migration that marks existing `Owner` and `Member` roles as system-managed.
- Added a case-insensitive workspace role-name constraint.
- Centralized the accepted application permission vocabulary in `app/permissions.py`.
- Added custom role creation, permission replacement, descriptive updates, and lifecycle archival APIs.
- Prevented modification or archival of system roles.
- Prevented archival of a custom role while active memberships still reference it.
- Added explicit project grant listing, creation, and revocation for `SELECTED` memberships.
- Enforced active-membership, selected-scope, duplicate-grant, and same-workspace rules in the resource-access service.
- Added migration `0004` for system-role metadata, legacy-role backfill, and case-insensitive uniqueness.

### Decisions

- Permission keys must come from the application registry; arbitrary database strings are not accepted by public APIs.
- System roles are provisioned and protected by the application. Organizations customize authorization by creating separate roles.
- Role deletion archives the role. It never destroys historical role identity.
- Explicit project grants are managed by workspace member managers and apply only to `SELECTED` memberships.

### Known limitations

- Permission keys are still a compact MVP vocabulary and will grow as media, files, comments, and tasks become executable domains.
- Role and access changes do not emit durable audit events yet.
- Grant APIs are not paginated and there is no bulk grant operation.

### Verification

- Thirty-five tests pass against a clean fully migrated database.
- Tests cover system-role protection, custom role lifecycle, case-insensitive names, unauthorized permission escalation, grant duplication, selected-scope requirements, access activation, and immediate revocation.
- Django checks, migration drift checks, Compose validation, and patch whitespace checks pass.

### Next recommended milestone

Implement the storage adapter and transactional media upload flow, including safe project-level version allocation and the required initial workflow-stage entry.

## 2026-08-31 — Permission engine, member invitations, and project API

### Delivered

- Added a central permission-key registry and effective-access evaluator for active direct memberships and inherited Client Team memberships.
- Implemented additive workspace permission checks plus `ALL` and explicit `SELECTED` project scope evaluation.
- Provisioned a limited system `Member` role alongside the existing `Owner` role for every new workspace.
- Added workspace role and membership listing plus protected role, project-scope, and lifecycle updates.
- Protected the primary-owner membership from modification through the general membership endpoint.
- Added single-use, expiring workspace invitations. Raw tokens are returned once; only SHA-256 hashes are stored.
- Made invitation acceptance email-bound and transactional, with support for reactivating removed direct memberships.
- Added authorized workspace listing and project list/create/detail/update/archive endpoints.
- Made project creation grant the creating `SELECTED` membership explicit access in the same transaction.
- Added cross-workspace and mismatched-route protections to project access.
- Added migration `0003` for workspace invitations and acceptance consistency.

### Decisions

- Permission grants are additive; Blaze Flow still has no explicit deny mechanism.
- Client Team members inherit the active team's workspace membership rather than receiving duplicate direct grants.
- Invitation delivery is outside the current backend slice. The raw token must never be logged or stored after delivery.
- Project deletion is soft lifecycle archival through `ProjectStatus.ARCHIVED`.
- A user's permission key and project scope must both authorize a project action.

### Known limitations

- There is no email provider integration, invitation resend UI, or invitation revocation API.
- Fine-grained media/file permission keys are not implemented.
- Project responses are not paginated and there is no activity/audit event emitted yet.
- Concurrent authorization changes are protected by database state but do not yet use a permission cache or audit trail.

### Verification

- Twenty-eight tests pass against a clean database with all migrations applied.
- Tests cover direct and inherited permissions, hashed and email-bound invitations, token reuse, primary-owner protection, project action permissions, selected scope, creator grants, and cross-tenant denial.
- System checks and migration drift checks pass.

### Next recommended milestone

Add custom role and project-access administration, then implement the storage adapter and transactional media upload/version allocation flow.

## 2026-08-31 — Authentication and workspace vertical slice

### Delivered

- Added public registration and session-login endpoints plus authenticated logout and current-user endpoints.
- Added password-policy validation, case-insensitive email handling and database uniqueness, duplicate-account protection, and safe response serializers that never expose password hashes.
- Added authenticated workspace creation with IANA timezone and slug validation.
- Implemented workspace creation as one transaction that provisions the workspace, system `Owner` role, initial owner permissions, and active primary-owner membership.
- Added database check constraints for membership principal shape, owner eligibility, and exactly-one comment/annotation authorship.
- Added conditional unique constraints for one active workspace owner, one open media stage entry, and one current user subscription.
- Added tenant-consistency validation for membership roles/client teams, resource access, workflow entries, tasks, task members, attachments, project folders, and project files.
- Added migration `0002` without rewriting the completed authentication foundation migration.
- Expanded the suite to cover API authentication, password safety, CSRF enforcement, duplicate and suspended accounts, anonymous access, workspace owner provisioning, transactional rollback, duplicate ownership, authorship, workflow, subscription, and cross-workspace failures.

### Decisions

- Session authentication is the current browser-facing authentication mechanism. Token/JWT authentication will only be introduced for a concrete non-browser client requirement.
- Workspace creation owns all initial authorization provisioning; callers cannot create a workspace without its primary owner.
- Cross-row invariants are database constraints whenever PostgreSQL can express them. Cross-table tenant consistency remains explicit model/service validation because SQL check constraints cannot reference related tables.
- Owner permissions use application-defined keys and are provisioned as role-permission records.

### Known limitations

- Login and registration throttling, email verification, password reset, and OAuth callbacks are not implemented.
- The workspace endpoint currently creates workspaces only; listing and detail APIs are pending.
- There is no workspace permission-evaluation service yet, so project and membership APIs must not be exposed until it exists.
- A frontend must implement Django session-cookie and CSRF handling correctly.

### Verification

- Django system checks pass.
- Migration drift checks report no changes.
- Twenty tests pass against a clean migrated test database.
- PostgreSQL execution remains configured in CI.

### Next recommended milestone

Implement permission evaluation and workspace membership administration, then expose workspace-scoped project CRUD with cross-tenant denial tests.

## 2026-08-31 — Backend foundation and unified authentication

### Delivered

- Removed generated Python bytecode and macOS AppleDouble files from the checkout and Git object store.
- Added ignore rules for Python build artifacts, local environments, coverage output, and AppleDouble metadata.
- Moved Django secret, debug, host, and PostgreSQL configuration to environment variables.
- Made non-debug startup fail clearly when `DJANGO_SECRET_KEY` is missing.
- Converted `app.User` into the project's Django custom user model using a UUID primary key and email login.
- Added a migration-safe custom user manager with password hashing and superuser validation.
- Connected user lifecycle states to Django authentication so suspended and deleted users cannot log in.
- Added Django admin creation and editing support for the custom user.
- Removed the separate `PasswordCredential` model. Django's encoded password field is now authoritative.
- Regenerated the pre-production initial migration around the custom user model.
- Added tests for password hashing, email authentication, suspended-user rejection, superuser flags, and the health endpoint.
- Added PostgreSQL-backed CI checks for system configuration, migration drift, migrations, and tests.
- Declared Django models and migrations as the executable schema source of truth. The hand-written SQL file is historical reference only.

### Decisions

- Registered identities must not be split between Django's built-in user and a separate domain user.
- Password handling will use Django's maintained, versioned hashing framework.
- OAuth identities remain separate provider records, but always resolve to `app.User`.
- The initial migration can be regenerated because the project is still pre-production and no shared data migration contract has been established.

### Known limitations

- Registration, login/logout, password reset, and OAuth HTTP APIs are not implemented.
- Most documented cross-row and cross-tenant invariants still need database constraints or service validation.
- The in-process event dispatcher is not durable.
- Docker BuildKit may fail when the checkout is kept on the current external-drive filesystem because macOS recreates unreadable AppleDouble metadata.

### Next recommended milestone

Add database constraints for principal/authorship/ownership invariants, followed by a tested registration and workspace-creation transaction.
