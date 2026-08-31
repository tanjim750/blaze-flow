# Blaze Flow Developer Guide

This is the starting point for anyone developing or reviewing Blaze Flow. Keep this guide current whenever setup, architecture, or team conventions change. Record material implementation work in `docs/implementation-log.md`.

## Current state

Blaze Flow is a Django REST Framework backend in its foundation phase. The repository contains a broad domain model, but most product APIs and business services are not implemented yet. Product intent lives in `docs/implementations/domain_and_features.md`; it must not be mistaken for delivered functionality.

The currently supported behavior is:

- PostgreSQL-backed Django startup and migrations
- registration and session login/logout using one custom email-based user identity
- Django password hashing, authentication, permissions, and admin integration
- atomic workspace creation with an owner role, permission bundle, and primary-owner membership
- hashed-token workspace invitations, membership role/status management, and client-team permission inheritance
- additive workspace/project permission evaluation with `ALL` and `SELECTED` project scope
- authorized project listing, creation, detail, update, and archival
- protected system roles, custom role administration, and explicit project-access grants
- database constraints for principal, author, ownership, workflow, and subscription invariants
- a public `GET /api/health/` endpoint
- automated foundation checks and tests

## Repository map

| Path | Purpose |
| --- | --- |
| `blazeflow/settings.py` | Environment-driven Django configuration |
| `blazeflow/urls.py` | Root URL routing |
| `app/models.py` | Executable domain schema |
| `app/managers.py` | Custom user creation rules |
| `app/admin.py` | Django admin integration |
| `app/events/` | Minimal synchronous domain-event mechanism |
| `app/migrations/` | Authoritative database history |
| `app/tests.py` | Current foundation tests; split by domain as the suite grows |
| `docs/implementations/` | Product/domain intent |
| `docs/implementation-log.md` | Chronological delivery and decision record |
| `database-schema.sql` | Historical design reference, not an executable schema source |

## Local setup with Docker

Requirements: Docker Desktop with Compose v2.

1. Copy `.env.example` to `.env`.
2. Replace every `change-me` value. Local values must never be reused in production.
3. Run `docker compose up --build`.
4. Open `http://localhost:8000/api/health/` and expect `{"message":"ok"}`.

Useful commands:

```bash
docker compose run --rm web python manage.py check
docker compose run --rm web python manage.py makemigrations --check --dry-run
docker compose run --rm web python manage.py test
docker compose run --rm web python manage.py createsuperuser
```

For a fast host-side unit-test pass when PostgreSQL is unavailable, install `requirements.txt` in a virtual environment and run:

```bash
DJANGO_DEBUG=true DJANGO_SETTINGS_MODULE=blazeflow.test_settings python manage.py test
```

This uses an in-memory SQLite database and a fast test-only password hasher. It does not replace the PostgreSQL CI run, particularly for constraints and transaction behavior.

To rebuild the local database from scratch, remove the Compose volume only when losing local data is acceptable:

```bash
docker compose down --volumes
docker compose up --build
```

## External-drive warning

This repository has previously been hosted on a filesystem that creates macOS AppleDouble (`._*`) files. These files can corrupt Git pack reads and make Docker BuildKit fail while reading extended attributes. The durable fix is to keep the active checkout on an APFS volume. If an external drive must be used, verify regularly with:

```bash
git status --short
git fsck --full
```

The ignore files prevent metadata from being committed, but ignore rules cannot protect files created inside `.git`.

## Configuration

| Variable | Required | Meaning |
| --- | --- | --- |
| `DJANGO_SECRET_KEY` | Yes outside debug mode | Unique secret per environment |
| `DJANGO_DEBUG` | No; defaults false | Enables Django development diagnostics |
| `DJANGO_ALLOWED_HOSTS` | Yes in deployments | Comma-separated hostnames |
| `POSTGRES_DB` | Yes | PostgreSQL database |
| `POSTGRES_USER` | Yes | PostgreSQL user |
| `POSTGRES_PASSWORD` | Yes | PostgreSQL password |
| `POSTGRES_HOST` | No | Defaults to `localhost`; Compose sets `db` |
| `POSTGRES_PORT` | No | Defaults to `5432` |

Never commit `.env`. Deployment secrets belong in the target platform's secret manager.

## Authentication architecture

`app.User` is the one authoritative registered-user identity and is configured through `AUTH_USER_MODEL`. Email is the login identifier. Passwords are stored in Django's built-in encoded password field and must only be set through `set_password()`, `create_user()`, or `create_superuser()`.

User lifecycle status controls authentication: only `ACTIVE` users are considered active by Django's default authentication backend. `SUSPENDED` and `DELETED` users cannot authenticate.

OAuth providers should link through `OAuthIdentity`. An OAuth-only account must use `set_unusable_password()` until the owner configures a password. Do not introduce a second user or password table.

## Current API

All request and response bodies use JSON. Authentication uses Django's session cookie. A successful login returns a `csrf_token` and sets the corresponding CSRF cookie. Browser clients must retain both cookies and send the token in the `X-CSRFToken` header on authenticated unsafe requests.

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health/` | Public | Application health response |
| `POST` | `/api/auth/register/` | Public | Register an email/password user |
| `POST` | `/api/auth/login/` | Public | Start a session |
| `POST` | `/api/auth/logout/` | Authenticated | End the current session |
| `GET` | `/api/auth/me/` | Authenticated | Return the current user |
| `POST` | `/api/workspaces/` | Authenticated | Create a workspace and owner authorization graph |
| `GET/POST` | `/api/workspaces/{workspace_id}/roles/` | Reader/role manager | List or create roles |
| `PATCH/DELETE` | `/api/workspaces/{workspace_id}/roles/{role_id}/` | Role manager | Update or archive a custom role |
| `GET` | `/api/workspaces/{workspace_id}/members/` | Workspace reader | List workspace principals |
| `PATCH` | `/api/workspaces/{workspace_id}/members/{membership_id}/` | Member manager | Change a non-owner role, scope, or status |
| `POST` | `/api/workspaces/{workspace_id}/invitations/` | Member manager | Create a single-use invitation token |
| `POST` | `/api/workspace-invitations/accept/` | Authenticated | Accept an invitation matching the user's email |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/` | Authorized member | List accessible projects or create a project |
| `GET/PATCH/DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/` | Authorized member | Read, update, or archive a project |
| `GET/POST` | `/api/workspaces/{workspace_id}/projects/{project_id}/access/` | Member manager | List or create explicit project grants |
| `DELETE` | `/api/workspaces/{workspace_id}/projects/{project_id}/access/{grant_id}/` | Member manager | Revoke an explicit grant |

Registration fields are `email`, `password`, `first_name`, `last_name`, and optional `timezone`. Workspace creation fields are `name`, optional `slug`, and a required IANA `timezone` such as `Europe/London`.

Workspace creation is one database transaction. It provisions an `Owner` role, the initial permission keys, and an active direct-user membership with `ALL` project access and `is_primary_owner=True`. If any step fails, the entire workspace creation is rolled back.

It also provisions a limited `Member` role. Permissions are additive across a user's active direct membership and active Client Team memberships. A role answers what the principal may do; `project_access_mode` and `ResourceAccess` answer where project permissions apply.

Workspace invitation tokens are returned only by the creation response and stored only as SHA-256 hashes. Email delivery is not implemented yet. The caller must deliver the raw token through an approved secure channel. Acceptance is single-use, expires, must match the authenticated user's normalized email, and creates or reactivates a direct membership transactionally.

`DELETE` on a project is intentionally a lifecycle operation: it changes the project to `ARCHIVED` and does not physically delete data.

The permission registry in `app/permissions.py` is authoritative. Role APIs reject unknown keys. `Owner` and `Member` are protected system roles; custom roles may be updated or archived, but an active membership must be reassigned before its role can be archived. Role deletion is lifecycle archival rather than physical deletion.

Explicit project grants are valid only for active memberships using `SELECTED` scope. An `ALL` membership does not need grant rows. Grant creation validates workspace consistency, and revocation immediately removes that access unless another additive membership still authorizes the user.

## Schema and migrations

Django models and migrations are the database source of truth. `database-schema.sql` is retained only as historical design context.

For every schema change:

1. Update the model.
2. Generate a named migration.
3. Review the generated SQL and migration operations.
4. Run `makemigrations --check --dry-run`.
5. Run the complete test suite against PostgreSQL.
6. Update domain documentation and the implementation log when behavior changes.

Do not edit an already-deployed migration. The initial migration may only be replaced while no shared or production database depends on it.

## Design boundaries

- A workspace is the tenant boundary. Every service that handles tenant data must verify workspace consistency and authorization.
- Cross-table tenant checks are implemented with model `clean()` methods where SQL check constraints cannot follow foreign keys. Domain services must call `full_clean()` before saving these objects; bulk operations require equivalent explicit validation.
- Views should coordinate HTTP concerns; business transactions belong in domain service modules as they are introduced.
- Multi-row state transitions must use `transaction.atomic()` and database constraints where possible.
- Domain events are currently synchronous and process-local. They are not a durable queue and must not be used for work that cannot be lost.
- Use Django's password, permission, validation, and migration APIs instead of duplicating them.

## Testing and completion criteria

A change is complete when:

- behavior has positive and negative tests;
- tenant and permission boundaries are tested where relevant;
- `python manage.py check` passes;
- `python manage.py makemigrations --check --dry-run` reports no changes;
- `python manage.py test` passes against PostgreSQL;
- documentation reflects material architecture or setup changes.

CI runs these checks on every push and pull request.

## Suggested implementation order

1. Add email delivery, CSRF-aware frontend integration, authentication throttling, and password-reset APIs.
2. Implement the file-storage adapter and media upload transaction.
3. Add project-wide media version allocation and initial workflow-stage history.
4. Build workflow transitions and the media review experience.

Avoid implementing all documented domains at once. Complete and test one end-to-end workflow before expanding the surface area.
