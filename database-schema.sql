CREATE TYPE "user_status" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'DELETED'
);

CREATE TYPE "oauth_provider" AS ENUM (
  'GOOGLE'
);

CREATE TYPE "workspace_status" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'PENDING_DELETION'
);

CREATE TYPE "workspace_member_type" AS ENUM (
  'INTERNAL',
  'CLIENT'
);

CREATE TYPE "workspace_membership_status" AS ENUM (
  'ACTIVE',
  'SUSPENDED',
  'REMOVED'
);

CREATE TYPE "role_status" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "project_access_mode" AS ENUM (
  'ALL',
  'SELECTED'
);

CREATE TYPE "workspace_principal_type" AS ENUM (
  'USER',
  'CLIENT_TEAM'
);

CREATE TYPE "project_status" AS ENUM (
  'DRAFT',
  'ACTIVE',
  'ON_HOLD',
  'COMPLETED',
  'ARCHIVED',
  'PENDING_DELETION'
);

CREATE TYPE "priority_level" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH'
);

CREATE TYPE "media_version_status" AS ENUM (
  'ACTIVE',
  'PENDING_DELETION'
);

CREATE TYPE "workflow_stage_status_state" AS ENUM (
  'ACTIVE',
  'ARCHIVED'
);

CREATE TYPE "review_comment_content_type" AS ENUM (
  'TEXT',
  'AUDIO',
  'IMAGE',
  'FILE'
);

CREATE TYPE "task_status" AS ENUM (
  'TODO',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "file_status" AS ENUM (
  'PENDING',
  'READY',
  'FAILED'
);

CREATE TYPE "storage_backend_status" AS ENUM (
  'ACTIVE',
  'DISABLED'
);

CREATE TYPE "client_team_status" AS ENUM (
  'ACTIVE',
  'ARCHIVED',
  'DELETED'
);

CREATE TYPE "client_team_member_status" AS ENUM (
  'ACTIVE',
  'REMOVED'
);

CREATE TYPE "client_team_invite_type" AS ENUM (
  'EMAIL',
  'LINK'
);

CREATE TYPE "audit_actor_type" AS ENUM (
  'USER',
  'GUEST',
  'SYSTEM'
);

CREATE TYPE "subscription_plan" AS ENUM (
  'FREE',
  'PRO'
);

CREATE TYPE "subscription_status" AS ENUM (
  'ACTIVE',
  'CANCELLED',
  'EXPIRED',
  'PAST_DUE'
);

-- HISTORICAL DESIGN REFERENCE ONLY.
-- Django models and migrations are the executable schema source of truth.
-- See docs/DEVELOPMENT.md before changing the database schema.

CREATE TABLE "users" (
  "id" uuid PRIMARY KEY,
  "email" varchar(255) UNIQUE NOT NULL,
  "first_name" varchar(150) NOT NULL,
  "last_name" varchar(150) NOT NULL,
  "avatar_url" text,
  "status" user_status NOT NULL DEFAULT 'ACTIVE',
  "email_verified_at" timestamp,
  "timezone" varchar(100),
  "last_login_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "password_credentials" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid UNIQUE NOT NULL,
  "password_hash" varchar(255) NOT NULL,
  "password_set_at" timestamp NOT NULL,
  "password_changed_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "oauth_identities" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "provider" oauth_provider NOT NULL,
  "provider_subject" varchar(255) NOT NULL,
  "provider_email" varchar(255),
  "provider_email_verified" boolean NOT NULL DEFAULT false,
  "provider_first_name" varchar(150),
  "provider_last_name" varchar(150),
  "provider_avatar_url" text,
  "profile_metadata" jsonb,
  "linked_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "password_reset_tokens" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "token_hash" varchar(255) UNIQUE NOT NULL,
  "expires_at" timestamp NOT NULL,
  "used_at" timestamp,
  "invalidated_at" timestamp,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY,
  "name" varchar(150) NOT NULL,
  "slug" varchar(150) UNIQUE NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "timezone" varchar(100) NOT NULL,
  "status" workspace_status NOT NULL DEFAULT 'ACTIVE',
  "deletion_scheduled_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "workspace_profiles" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid UNIQUE NOT NULL,
  "business_name" varchar(200),
  "description" text,
  "email" varchar(255),
  "phone" varchar(50),
  "website_url" text,
  "address_line_1" varchar(255),
  "address_line_2" varchar(255),
  "city" varchar(100),
  "state" varchar(100),
  "postal_code" varchar(30),
  "country_code" varchar(2),
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "guest_sessions" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "name" varchar(150) NOT NULL,
  "email" varchar(255) NOT NULL,
  "access_key_hash" varchar(255) UNIQUE NOT NULL,
  "last_seen_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "roles" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "description" text,
  "status" role_status NOT NULL DEFAULT 'ACTIVE',
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "role_permissions" (
  "role_id" uuid NOT NULL,
  "permission_key" varchar(100) NOT NULL,
  PRIMARY KEY ("role_id", "permission_key")
);

CREATE TABLE "workspace_memberships" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "principal_type" workspace_principal_type NOT NULL,
  "user_id" uuid,
  "client_team_id" uuid,
  "role_id" uuid,
  "project_access_mode" project_access_mode NOT NULL DEFAULT 'SELECTED',
  "is_primary_owner" boolean NOT NULL DEFAULT false,
  "status" workspace_membership_status NOT NULL,
  "joined_at" timestamp NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "resource_access" (
  "id" uuid PRIMARY KEY,
  "workspace_membership_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "created_by_user_id" uuid NOT NULL,
  "name" varchar(200) NOT NULL,
  "description" text,
  "status" project_status NOT NULL DEFAULT 'DRAFT',
  "priority" priority_level NOT NULL DEFAULT 'MEDIUM',
  "start_at" timestamp,
  "due_at" timestamp,
  "deletion_scheduled_at" timestamp,
  "next_media_version_number" integer NOT NULL DEFAULT 1,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "workflow_stages" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "sort_order" integer NOT NULL,
  "created_by_user_id" uuid,
  "status" workflow_stage_status_state NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "workflow_stage_statuses" (
  "id" uuid PRIMARY KEY,
  "workflow_stage_id" uuid NOT NULL,
  "name" varchar(100) NOT NULL,
  "slug" varchar(120) NOT NULL,
  "sort_order" integer NOT NULL,
  "created_by_user_id" uuid,
  "status" workflow_stage_status_state NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "media_versions" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "original_file_id" uuid NOT NULL,
  "version_number" integer NOT NULL,
  "title" varchar(200) NOT NULL,
  "note" text,
  "priority" priority_level NOT NULL DEFAULT 'MEDIUM',
  "allow_download" boolean NOT NULL DEFAULT false,
  "status" media_version_status NOT NULL DEFAULT 'ACTIVE',
  "deletion_scheduled_at" timestamp,
  "created_by_user_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "media_version_stage_entries" (
  "id" uuid PRIMARY KEY,
  "media_version_id" uuid NOT NULL,
  "workflow_stage_id" uuid,
  "workflow_stage_status_id" uuid,
  "snapshot" jsonb NOT NULL,
  "entered_at" timestamp NOT NULL,
  "exited_at" timestamp,
  "changed_by_user_id" uuid NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "review_comments" (
  "id" uuid PRIMARY KEY,
  "media_version_id" uuid NOT NULL,
  "parent_comment_id" uuid,
  "author_user_id" uuid,
  "author_guest_session_id" uuid,
  "start_time_ms" bigint,
  "end_time_ms" bigint,
  "resolved" boolean NOT NULL DEFAULT false,
  "resolved_by_user_id" uuid,
  "resolved_at" timestamp,
  "deleted_at" timestamp,
  "deleted_by_user_id" uuid,
  "deleted_by_guest_session_id" uuid,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "review_comment_contents" (
  "id" uuid PRIMARY KEY,
  "review_comment_id" uuid NOT NULL,
  "content_type" review_comment_content_type NOT NULL,
  "text_content" text,
  "file_id" uuid,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "review_comment_revisions" (
  "id" uuid PRIMARY KEY,
  "review_comment_id" uuid NOT NULL,
  "edited_by_user_id" uuid,
  "edited_by_guest_session_id" uuid,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "annotations" (
  "id" uuid PRIMARY KEY,
  "media_version_id" uuid NOT NULL,
  "review_comment_id" uuid,
  "author_user_id" uuid,
  "author_guest_session_id" uuid,
  "start_time_ms" bigint,
  "end_time_ms" bigint,
  "deleted_at" timestamp,
  "deleted_by_user_id" uuid,
  "deleted_by_guest_session_id" uuid,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "annotation_elements" (
  "id" uuid PRIMARY KEY,
  "annotation_id" uuid NOT NULL,
  "element_type" varchar(100) NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "geometry" jsonb,
  "style" jsonb,
  "payload" jsonb,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "annotation_revisions" (
  "id" uuid PRIMARY KEY,
  "annotation_id" uuid NOT NULL,
  "edited_by_user_id" uuid,
  "edited_by_guest_session_id" uuid,
  "snapshot" jsonb NOT NULL,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "tasks" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "project_id" uuid,
  "created_by_workspace_membership_id" uuid NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text,
  "status" task_status NOT NULL DEFAULT 'TODO',
  "priority" priority_level NOT NULL DEFAULT 'MEDIUM',
  "start_at" timestamp,
  "due_at" timestamp,
  "completed_at" timestamp,
  "sort_order" integer NOT NULL DEFAULT 0,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "task_assignees" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL,
  "workspace_membership_id" uuid NOT NULL,
  "assigned_at" timestamp NOT NULL
);

CREATE TABLE "task_attachments" (
  "id" uuid PRIMARY KEY,
  "task_id" uuid NOT NULL,
  "file_id" uuid NOT NULL,
  "attached_by_workspace_membership_id" uuid NOT NULL,
  "attached_at" timestamp NOT NULL
);

CREATE TABLE "storage_backends" (
  "id" uuid PRIMARY KEY,
  "name" varchar(150) NOT NULL,
  "provider" varchar(100) NOT NULL,
  "config" jsonb,
  "status" storage_backend_status NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "files" (
  "id" uuid PRIMARY KEY,
  "storage_backend_id" uuid NOT NULL,
  "object_key" varchar(1024) NOT NULL,
  "original_name" varchar(512) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "checksum" varchar(512),
  "checksum_algorithm" varchar(50),
  "metadata" jsonb,
  "status" file_status NOT NULL DEFAULT 'PENDING',
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "file_variants" (
  "id" uuid PRIMARY KEY,
  "file_id" uuid NOT NULL,
  "storage_backend_id" uuid NOT NULL,
  "object_key" varchar(1024) NOT NULL,
  "original_name" varchar(512) NOT NULL,
  "mime_type" varchar(255) NOT NULL,
  "size_bytes" bigint NOT NULL,
  "checksum" varchar(512),
  "checksum_algorithm" varchar(50),
  "metadata" jsonb,
  "status" file_status NOT NULL DEFAULT 'PENDING',
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "project_folders" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "parent_folder_id" uuid,
  "name" varchar(255) NOT NULL,
  "created_by_workspace_membership_id" uuid NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "project_files" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "folder_id" uuid,
  "file_id" uuid NOT NULL,
  "added_by_workspace_membership_id" uuid NOT NULL,
  "deleted_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "client_teams" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "created_by_workspace_membership_id" uuid,
  "name" varchar(255) NOT NULL,
  "description" text,
  "logo_file_id" uuid,
  "website" varchar(500),
  "email" varchar(255),
  "phone" varchar(100),
  "address_line_1" varchar(255),
  "address_line_2" varchar(255),
  "city" varchar(150),
  "state_region" varchar(150),
  "postal_code" varchar(50),
  "country_code" varchar(10),
  "metadata" jsonb,
  "status" client_team_status NOT NULL DEFAULT 'ACTIVE',
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "client_team_members" (
  "id" uuid PRIMARY KEY,
  "client_team_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" varchar(255),
  "status" client_team_member_status NOT NULL DEFAULT 'ACTIVE',
  "joined_at" timestamp NOT NULL,
  "removed_at" timestamp,
  "added_by_workspace_membership_id" uuid,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "client_team_invites" (
  "id" uuid PRIMARY KEY,
  "client_team_id" uuid NOT NULL,
  "invite_type" client_team_invite_type NOT NULL,
  "recipient_email" varchar(255),
  "label" varchar(255),
  "token_hash" varchar(255) UNIQUE NOT NULL,
  "max_uses" int,
  "use_count" int NOT NULL DEFAULT 0,
  "expires_at" timestamp NOT NULL,
  "revoked_at" timestamp,
  "created_by_workspace_membership_id" uuid,
  "revoked_by_workspace_membership_id" uuid,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "client_team_invite_acceptances" (
  "id" uuid PRIMARY KEY,
  "invite_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "client_team_member_id" uuid NOT NULL,
  "accepted_at" timestamp NOT NULL
);

CREATE TABLE "guest_invites" (
  "id" uuid PRIMARY KEY,
  "project_id" uuid NOT NULL,
  "label" varchar(255),
  "token_hash" varchar(255) UNIQUE NOT NULL,
  "expires_at" timestamp,
  "revoked_at" timestamp,
  "created_by_workspace_membership_id" uuid NOT NULL,
  "revoked_by_workspace_membership_id" uuid,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "guest_invite_permissions" (
  "guest_invite_id" uuid NOT NULL,
  "permission_key" varchar(255) NOT NULL,
  "created_at" timestamp NOT NULL,
  PRIMARY KEY ("guest_invite_id", "permission_key")
);

CREATE TABLE "guest_review_access" (
  "id" uuid PRIMARY KEY,
  "guest_invite_id" uuid NOT NULL,
  "guest_session_id" uuid NOT NULL,
  "revoked_at" timestamp,
  "revoked_by_workspace_membership_id" uuid,
  "last_accessed_at" timestamp,
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE TABLE "guest_review_access_permissions" (
  "guest_review_access_id" uuid NOT NULL,
  "permission_key" varchar(255) NOT NULL,
  "created_at" timestamp NOT NULL,
  PRIMARY KEY ("guest_review_access_id", "permission_key")
);

CREATE TABLE "audit_logs" (
  "id" uuid PRIMARY KEY,
  "workspace_id" uuid,
  "actor_type" audit_actor_type NOT NULL,
  "actor_user_id" uuid,
  "actor_guest_session_id" uuid,
  "action" varchar(255) NOT NULL,
  "entity_type" varchar(100),
  "entity_id" varchar(255),
  "request_method" varchar(10),
  "request_path" varchar(1000),
  "request_id" varchar(255),
  "metadata" jsonb,
  "created_at" timestamp NOT NULL
);

CREATE TABLE "user_subscriptions" (
  "id" uuid PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "plan" subscription_plan NOT NULL DEFAULT 'FREE',
  "status" subscription_status NOT NULL DEFAULT 'ACTIVE',
  "started_at" timestamp NOT NULL,
  "current_period_start" timestamp,
  "current_period_end" timestamp,
  "cancel_at_period_end" boolean NOT NULL DEFAULT false,
  "cancelled_at" timestamp,
  "provider" varchar(100),
  "provider_subscription_id" varchar(255),
  "created_at" timestamp NOT NULL,
  "updated_at" timestamp NOT NULL
);

CREATE UNIQUE INDEX ON "oauth_identities" ("provider", "provider_subject");

CREATE UNIQUE INDEX ON "oauth_identities" ("user_id", "provider");

CREATE INDEX ON "password_reset_tokens" ("user_id", "created_at");

CREATE INDEX ON "workspaces" ("created_by_user_id");

CREATE INDEX ON "guest_sessions" ("workspace_id");

CREATE INDEX ON "guest_sessions" ("workspace_id", "email");

CREATE UNIQUE INDEX ON "roles" ("workspace_id", "name");

CREATE INDEX ON "workspace_memberships" ("workspace_id");

CREATE INDEX ON "workspace_memberships" ("user_id");

CREATE INDEX ON "workspace_memberships" ("client_team_id");

CREATE UNIQUE INDEX ON "workspace_memberships" ("workspace_id", "user_id");

CREATE UNIQUE INDEX ON "workspace_memberships" ("workspace_id", "client_team_id");

CREATE UNIQUE INDEX ON "resource_access" ("workspace_membership_id", "project_id");

CREATE INDEX ON "resource_access" ("project_id");

CREATE INDEX ON "projects" ("workspace_id");

CREATE INDEX ON "projects" ("created_by_user_id");

CREATE INDEX ON "projects" ("status");

CREATE UNIQUE INDEX ON "workflow_stages" ("workspace_id", "slug");

CREATE INDEX ON "workflow_stages" ("workspace_id");

CREATE INDEX ON "workflow_stages" ("sort_order");

CREATE UNIQUE INDEX ON "workflow_stage_statuses" ("workflow_stage_id", "slug");

CREATE INDEX ON "workflow_stage_statuses" ("workflow_stage_id");

CREATE INDEX ON "workflow_stage_statuses" ("sort_order");

CREATE UNIQUE INDEX ON "media_versions" ("project_id", "version_number");

CREATE INDEX ON "media_versions" ("project_id");

CREATE INDEX ON "media_versions" ("original_file_id");

CREATE INDEX ON "media_versions" ("created_by_user_id");

CREATE INDEX ON "media_version_stage_entries" ("media_version_id");

CREATE INDEX ON "media_version_stage_entries" ("workflow_stage_id");

CREATE INDEX ON "media_version_stage_entries" ("workflow_stage_status_id");

CREATE INDEX ON "media_version_stage_entries" ("media_version_id", "entered_at");

CREATE INDEX ON "review_comments" ("media_version_id");

CREATE INDEX ON "review_comments" ("parent_comment_id");

CREATE INDEX ON "review_comments" ("author_user_id");

CREATE INDEX ON "review_comments" ("author_guest_session_id");

CREATE INDEX ON "review_comments" ("resolved");

CREATE INDEX ON "review_comments" ("deleted_at");

CREATE INDEX ON "review_comment_contents" ("review_comment_id");

CREATE INDEX ON "review_comment_contents" ("file_id");

CREATE INDEX ON "review_comment_contents" ("review_comment_id", "sort_order");

CREATE INDEX ON "review_comment_revisions" ("review_comment_id");

CREATE INDEX ON "review_comment_revisions" ("edited_by_user_id");

CREATE INDEX ON "review_comment_revisions" ("edited_by_guest_session_id");

CREATE INDEX ON "annotations" ("media_version_id");

CREATE INDEX ON "annotations" ("review_comment_id");

CREATE INDEX ON "annotations" ("author_user_id");

CREATE INDEX ON "annotations" ("author_guest_session_id");

CREATE INDEX ON "annotations" ("deleted_at");

CREATE INDEX ON "annotation_elements" ("annotation_id");

CREATE INDEX ON "annotation_elements" ("element_type");

CREATE INDEX ON "annotation_elements" ("annotation_id", "sort_order");

CREATE INDEX ON "annotation_revisions" ("annotation_id");

CREATE INDEX ON "annotation_revisions" ("edited_by_user_id");

CREATE INDEX ON "annotation_revisions" ("edited_by_guest_session_id");

CREATE INDEX ON "tasks" ("workspace_id");

CREATE INDEX ON "tasks" ("project_id");

CREATE INDEX ON "tasks" ("created_by_workspace_membership_id");

CREATE INDEX ON "tasks" ("status");

CREATE INDEX ON "tasks" ("priority");

CREATE INDEX ON "tasks" ("due_at");

CREATE INDEX ON "tasks" ("deleted_at");

CREATE INDEX ON "tasks" ("workspace_id", "status");

CREATE INDEX ON "tasks" ("project_id", "status");

CREATE INDEX ON "task_assignees" ("task_id");

CREATE INDEX ON "task_assignees" ("workspace_membership_id");

CREATE UNIQUE INDEX ON "task_assignees" ("task_id", "workspace_membership_id");

CREATE INDEX ON "task_attachments" ("task_id");

CREATE INDEX ON "task_attachments" ("file_id");

CREATE INDEX ON "task_attachments" ("attached_by_workspace_membership_id");

CREATE UNIQUE INDEX ON "task_attachments" ("task_id", "file_id");

CREATE INDEX ON "storage_backends" ("provider");

CREATE INDEX ON "storage_backends" ("status");

CREATE INDEX ON "files" ("storage_backend_id");

CREATE INDEX ON "files" ("mime_type");

CREATE INDEX ON "files" ("status");

CREATE INDEX ON "files" ("deleted_at");

CREATE UNIQUE INDEX ON "files" ("storage_backend_id", "object_key");

CREATE INDEX ON "file_variants" ("file_id");

CREATE INDEX ON "file_variants" ("storage_backend_id");

CREATE INDEX ON "file_variants" ("mime_type");

CREATE INDEX ON "file_variants" ("status");

CREATE INDEX ON "file_variants" ("deleted_at");

CREATE UNIQUE INDEX ON "file_variants" ("storage_backend_id", "object_key");

CREATE INDEX ON "project_folders" ("project_id");

CREATE INDEX ON "project_folders" ("parent_folder_id");

CREATE INDEX ON "project_folders" ("created_by_workspace_membership_id");

CREATE INDEX ON "project_folders" ("deleted_at");

CREATE UNIQUE INDEX ON "project_folders" ("project_id", "parent_folder_id", "name");

CREATE INDEX ON "project_files" ("project_id");

CREATE INDEX ON "project_files" ("folder_id");

CREATE INDEX ON "project_files" ("file_id");

CREATE INDEX ON "project_files" ("added_by_workspace_membership_id");

CREATE INDEX ON "project_files" ("deleted_at");

CREATE UNIQUE INDEX ON "project_files" ("project_id", "file_id");

CREATE INDEX ON "client_teams" ("workspace_id");

CREATE INDEX ON "client_teams" ("status");

CREATE INDEX ON "client_team_members" ("client_team_id");

CREATE INDEX ON "client_team_members" ("user_id");

CREATE INDEX ON "client_team_members" ("status");

CREATE UNIQUE INDEX ON "client_team_members" ("client_team_id", "user_id");

CREATE INDEX ON "client_team_invites" ("client_team_id");

CREATE INDEX ON "client_team_invites" ("recipient_email");

CREATE INDEX ON "client_team_invites" ("expires_at");

CREATE INDEX ON "client_team_invites" ("revoked_at");

CREATE INDEX ON "client_team_invite_acceptances" ("invite_id");

CREATE INDEX ON "client_team_invite_acceptances" ("user_id");

CREATE INDEX ON "client_team_invite_acceptances" ("client_team_member_id");

CREATE UNIQUE INDEX ON "client_team_invite_acceptances" ("invite_id", "user_id");

CREATE INDEX ON "guest_invites" ("project_id");

CREATE INDEX ON "guest_invites" ("expires_at");

CREATE INDEX ON "guest_invites" ("revoked_at");

CREATE INDEX ON "guest_review_access" ("guest_invite_id");

CREATE INDEX ON "guest_review_access" ("guest_session_id");

CREATE INDEX ON "guest_review_access" ("revoked_at");

CREATE UNIQUE INDEX ON "guest_review_access" ("guest_session_id", "guest_invite_id");

CREATE INDEX ON "audit_logs" ("workspace_id", "created_at");

CREATE INDEX ON "audit_logs" ("entity_type", "entity_id");

CREATE INDEX ON "audit_logs" ("actor_user_id");

CREATE INDEX ON "audit_logs" ("actor_guest_session_id");

CREATE INDEX ON "audit_logs" ("action");

CREATE INDEX ON "audit_logs" ("request_id");

CREATE INDEX ON "user_subscriptions" ("user_id");

CREATE INDEX ON "user_subscriptions" ("provider_subscription_id");

CREATE INDEX ON "user_subscriptions" ("user_id", "status");

COMMENT ON TABLE "users" IS 'User stores account identity only. Users are never hard deleted.';

COMMENT ON TABLE "oauth_identities" IS 'Google sub is the stable OAuth identity. One identity per provider per user.';

COMMENT ON TABLE "password_reset_tokens" IS 'Creating a new reset request invalidates previous unused reset tokens.';

COMMENT ON TABLE "workspaces" IS 'Workspace is the tenant boundary. created_by_user_id remains immutable.';

COMMENT ON TABLE "guest_sessions" IS 'Browser keeps the raw guest key; database stores only its hash. Email is not a guest identity key.';

COMMENT ON TABLE "roles" IS 'Roles are workspace-defined; no predefined Admin, Editor, Viewer, or Client roles are required.';

COMMENT ON TABLE "role_permissions" IS 'Valid permission keys are defined and enforced by the application.';

COMMENT ON TABLE "workspace_memberships" IS 'principal_type USER requires user_id and forbids client_team_id.
principal_type CLIENT_TEAM requires client_team_id and forbids user_id.
ClientTeam has at most one WorkspaceMembership per workspace.
Primary ownership is valid only for USER principals.
User effective grants are additive:
direct USER membership grants + inherited active ClientTeam grants.
';

COMMENT ON TABLE "resource_access" IS 'Rows are used when project_access_mode = SELECTED.';

COMMENT ON TABLE "projects" IS 'Project creator and primary workspace owner have implicit project boundary access.';

COMMENT ON TABLE "workflow_stages" IS 'System-created stages have created_by_user_id = NULL; their name, slug, and deletion are application-locked.';

COMMENT ON TABLE "workflow_stage_statuses" IS 'A stage may have no statuses. System-created statuses have created_by_user_id = NULL.';

COMMENT ON TABLE "media_versions" IS 'original_file_id is immutable. MediaVersion supports video/image files only; MIME validation is application-level.';

COMMENT ON TABLE "media_version_stage_entries" IS 'At most one open entry per MediaVersion. snapshot preserves the complete historical workflow state.';

COMMENT ON TABLE "review_comments" IS 'Exactly one author is required:
author_user_id XOR author_guest_session_id.

parent_comment_id supports unlimited nested replies.

Media timestamps are intended for top-level comments.
Replies inherit thread context.

Resolved comments can still receive replies.
Guests cannot resolve/reopen comments.

Comment deletion is permission-based.
Deleting a parent soft-deletes its entire descendant subtree.
';

COMMENT ON TABLE "review_comment_contents" IS 'A comment can contain multiple content items and multiple content types.

TEXT uses text_content.
AUDIO, IMAGE and FILE use file_id.

A ReviewComment must contain at least one content item.
';

COMMENT ON TABLE "review_comment_revisions" IS 'Stores the previous complete comment-content state before an edit.

Exactly one editor identity is required:
edited_by_user_id XOR edited_by_guest_session_id.

Only the original comment author can edit.

Revisions are retained internally even after the comment is deleted.
';

COMMENT ON TABLE "annotations" IS 'Exactly one author is required:
author_user_id XOR author_guest_session_id.

One annotation targets exactly one MediaVersion.

review_comment_id is optional and may be linked/unlinked by the application.

Temporal anchoring:
static/image media -> start_time_ms and end_time_ms may be NULL
video point/frame -> start_time_ms set, end_time_ms NULL
video range -> start_time_ms and end_time_ms set

Annotation is a logical group/session and may contain multiple AnnotationElements.

Annotation is soft-deletable.
';

COMMENT ON TABLE "annotation_elements" IS 'Each row is one independently editable visual annotation element.

element_type is application-defined and extensible.
It is intentionally not a DB enum.

geometry uses normalized coordinates where applicable.

geometry, style and payload schemas are validated by the
application-defined AnnotationElement registry.

geometry is nullable because not every future element type
must be spatial.
';

COMMENT ON TABLE "annotation_revisions" IS 'Stores a complete historical annotation state snapshot.

Exactly one editor identity is required:
edited_by_user_id XOR edited_by_guest_session_id.

Revision records are retained internally even if the
annotation is deleted.
';

COMMENT ON TABLE "tasks" IS 'Task always belongs to a Workspace.

project_id is optional:
NULL = workspace-level task
NOT NULL = project-level task.

Only current task status is stored.
No task status history table.

Task deletion uses deleted_at soft deletion.
';

COMMENT ON TABLE "task_assignees" IS 'A task may have multiple assignees.

Assignment eligibility and authorization are
application/backend responsibilities.
';

COMMENT ON TABLE "task_attachments" IS 'Task attachments reuse the central files table.

attached_by_workspace_membership_id represents
who attached the file to the task, which may differ
from the original file creator.
';

COMMENT ON TABLE "storage_backends" IS 'Global platform-managed storage backend.

No workspace ownership.

provider is application-defined and not a DB enum.

config stores non-secret provider-specific configuration.
Credentials/secrets must not be stored here in plaintext.
';

COMMENT ON TABLE "files" IS 'Independent logical/original file record.

File does not belong directly to a workspace or application domain.
Domain entities reference File when they need it.

The original physical object is represented directly by this row.

File category such as video/image/audio/document is derived
from mime_type and is not duplicated in the database.
';

COMMENT ON TABLE "file_variants" IS 'Represents a derived physical representation of a File.

Examples may include proxies, thumbnails, previews,
transcoded media or other generated derivatives.

Variant purpose/type is not constrained by the database.

A variant may be stored in a different StorageBackend
from its original File.
';

COMMENT ON TABLE "project_folders" IS 'Supports nested project folders through parent_folder_id.

parent_folder_id = NULL means a root-level folder.

Deleting a parent folder deletes its descendant folders
and ProjectFiles as part of the subtree.

Folder rename/move history is not stored.
';

COMMENT ON TABLE "project_files" IS 'Represents a File attached to a Project.

folder_id = NULL means the file is stored at the project root.

ProjectFile does not duplicate file name/type metadata.
File.original_name and File.mime_type remain the source of truth.

The same File may be referenced by different Projects,
but only once within the same Project.

No manual sort order or ProjectFile location history is stored.
';

COMMENT ON TABLE "client_teams" IS 'Represents a client-side organization/team within a workspace.
Team names are not unique within a workspace.
A ClientTeam may exist without a WorkspaceMembership.
Project access is granted only through its CLIENT_TEAM WorkspaceMembership.
';

COMMENT ON TABLE "client_team_members" IS 'Associates a global User with a ClientTeam.
A User may belong to multiple ClientTeams.
Removed memberships are preserved and the same row is reactivated on rejoin.
title is descriptive only and does not affect authorization.
ACTIVE requires removed_at = NULL.
REMOVED requires removed_at IS NOT NULL.
';

COMMENT ON TABLE "client_team_invites" IS 'Represents an invitation to join a ClientTeam.

EMAIL invites are bound to a specific recipient email
and are single-use.

LINK invites are generic/shareable and may be multi-use.

Raw invite tokens must never be stored.
Only a secure token hash is persisted.

Invite usability is derived from:
revoked_at IS NULL,
expires_at > current time,
and usage limit not being exhausted.

No explicit invite status is stored.

Invite acceptance only creates or reactivates
ClientTeam membership.
Role and project access are inherited from the
ClientTeam WorkspaceMembership.

ClientTeam invites do not directly grant
role or project permissions.
';

COMMENT ON TABLE "client_team_invite_acceptances" IS 'Records successful invite consumption.

EMAIL invite normally has one acceptance.

LINK invite may have multiple acceptances.

A User may consume the same invite at most once.

If the User already has an ACTIVE ClientTeamMember row,
no duplicate membership is created.

If the existing membership is REMOVED,
the same ClientTeamMember row is reactivated.
';

COMMENT ON TABLE "guest_invites" IS 'Represents a shareable Guest review link for a Project.

Guest invites are link-only and always target a Project.

Raw invite tokens are never stored.
Only a secure token hash is persisted.

Multiple GuestInvites may exist for the same Project.

Invite validity is derived from revocation and expiration state.

Permissions are application-defined and stored separately
in guest_invite_permissions.
';

COMMENT ON TABLE "guest_invite_permissions" IS 'Stores application-defined permissions granted by a GuestInvite.

Permission vocabulary, validation, dependencies, and authorization
semantics are managed by the application/backend.

These permissions act as the default permission set when creating
a GuestReviewAccess.
';

COMMENT ON TABLE "guest_review_access" IS 'Represents an individual GuestSession''s access obtained
through a GuestInvite.

Project scope is derived through:
GuestReviewAccess -> GuestInvite -> Project.

A GuestSession may obtain access through multiple GuestInvites.

Reopening the same GuestInvite from the same GuestSession
reuses the existing GuestReviewAccess.

Individual Guest access may be revoked independently
without revoking the shared GuestInvite.

Effective authorization also depends on the GuestInvite
remaining valid.
';

COMMENT ON TABLE "guest_review_access_permissions" IS 'Stores the effective application-defined permissions
for an individual GuestReviewAccess.

Permissions are initially derived from the GuestInvite''s
permission set and may later be customized independently.

Permission vocabulary and authorization rules are managed
by the application/backend.
';

COMMENT ON TABLE "audit_logs" IS 'Generic append-only action-level audit log.

Business actions are explicitly declared at the DRF/ViewSet level
and recorded through a shared audit layer.

action and entity_type are application-defined.

Intended for meaningful business/security actions,
not general HTTP access logging.

Database field-level mutation history is outside the MVP scope.
';

COMMENT ON TABLE "user_subscriptions" IS 'User-level subscription.

Plan resource limits and capabilities are managed through
application configuration/environment variables for MVP.

Workspace effective limits are derived from its primary owner''s
active subscription.

Provider fields are optional and support future external
subscription/payment provider integration.
';

ALTER TABLE "workspace_memberships" ADD FOREIGN KEY ("client_team_id") REFERENCES "client_teams" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "password_credentials" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "oauth_identities" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "password_reset_tokens" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workspaces" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workspaces" ADD FOREIGN KEY ("id") REFERENCES "workspace_profiles" ("workspace_id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_sessions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "roles" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "roles" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "role_permissions" ADD FOREIGN KEY ("role_id") REFERENCES "roles" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workspace_memberships" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workspace_memberships" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workspace_memberships" ADD FOREIGN KEY ("role_id") REFERENCES "roles" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "resource_access" ADD FOREIGN KEY ("workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "projects" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "projects" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workflow_stages" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workflow_stages" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workflow_stage_statuses" ADD FOREIGN KEY ("workflow_stage_id") REFERENCES "workflow_stages" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "workflow_stage_statuses" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_versions" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_version_stage_entries" ADD FOREIGN KEY ("media_version_id") REFERENCES "media_versions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_version_stage_entries" ADD FOREIGN KEY ("workflow_stage_id") REFERENCES "workflow_stages" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_version_stage_entries" ADD FOREIGN KEY ("workflow_stage_status_id") REFERENCES "workflow_stage_statuses" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_version_stage_entries" ADD FOREIGN KEY ("changed_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "media_versions" ADD FOREIGN KEY ("original_file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "resource_access" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("media_version_id") REFERENCES "media_versions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("parent_comment_id") REFERENCES "review_comments" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("author_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("resolved_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("deleted_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comments" ADD FOREIGN KEY ("deleted_by_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comment_contents" ADD FOREIGN KEY ("review_comment_id") REFERENCES "review_comments" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comment_contents" ADD FOREIGN KEY ("file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comment_revisions" ADD FOREIGN KEY ("review_comment_id") REFERENCES "review_comments" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comment_revisions" ADD FOREIGN KEY ("edited_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "review_comment_revisions" ADD FOREIGN KEY ("edited_by_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("media_version_id") REFERENCES "media_versions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("review_comment_id") REFERENCES "review_comments" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("author_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("author_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("deleted_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotations" ADD FOREIGN KEY ("deleted_by_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotation_elements" ADD FOREIGN KEY ("annotation_id") REFERENCES "annotations" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotation_revisions" ADD FOREIGN KEY ("annotation_id") REFERENCES "annotations" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotation_revisions" ADD FOREIGN KEY ("edited_by_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "annotation_revisions" ADD FOREIGN KEY ("edited_by_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tasks" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tasks" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "tasks" ADD FOREIGN KEY ("created_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "task_assignees" ADD FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "task_assignees" ADD FOREIGN KEY ("workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "task_attachments" ADD FOREIGN KEY ("task_id") REFERENCES "tasks" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "task_attachments" ADD FOREIGN KEY ("file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "task_attachments" ADD FOREIGN KEY ("attached_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "files" ADD FOREIGN KEY ("storage_backend_id") REFERENCES "storage_backends" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_variants" ADD FOREIGN KEY ("file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "file_variants" ADD FOREIGN KEY ("storage_backend_id") REFERENCES "storage_backends" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_folders" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_folders" ADD FOREIGN KEY ("parent_folder_id") REFERENCES "project_folders" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_folders" ADD FOREIGN KEY ("created_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_files" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_files" ADD FOREIGN KEY ("folder_id") REFERENCES "project_folders" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_files" ADD FOREIGN KEY ("file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "project_files" ADD FOREIGN KEY ("added_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_teams" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_teams" ADD FOREIGN KEY ("created_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_teams" ADD FOREIGN KEY ("logo_file_id") REFERENCES "files" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_members" ADD FOREIGN KEY ("client_team_id") REFERENCES "client_teams" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_members" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_members" ADD FOREIGN KEY ("added_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invites" ADD FOREIGN KEY ("client_team_id") REFERENCES "client_teams" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invites" ADD FOREIGN KEY ("created_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invites" ADD FOREIGN KEY ("revoked_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invite_acceptances" ADD FOREIGN KEY ("invite_id") REFERENCES "client_team_invites" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invite_acceptances" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "client_team_invite_acceptances" ADD FOREIGN KEY ("client_team_member_id") REFERENCES "client_team_members" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_invites" ADD FOREIGN KEY ("project_id") REFERENCES "projects" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_invites" ADD FOREIGN KEY ("created_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_invites" ADD FOREIGN KEY ("revoked_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_invite_permissions" ADD FOREIGN KEY ("guest_invite_id") REFERENCES "guest_invites" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_review_access" ADD FOREIGN KEY ("guest_invite_id") REFERENCES "guest_invites" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_review_access" ADD FOREIGN KEY ("guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_review_access" ADD FOREIGN KEY ("revoked_by_workspace_membership_id") REFERENCES "workspace_memberships" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "guest_review_access_permissions" ADD FOREIGN KEY ("guest_review_access_id") REFERENCES "guest_review_access" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("actor_user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "audit_logs" ADD FOREIGN KEY ("actor_guest_session_id") REFERENCES "guest_sessions" ("id") DEFERRABLE INITIALLY IMMEDIATE;

ALTER TABLE "user_subscriptions" ADD FOREIGN KEY ("user_id") REFERENCES "users" ("id") DEFERRABLE INITIALLY IMMEDIATE;
