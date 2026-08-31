# Blaze Flow — Core Domain Features

This document summarizes the features currently locked for the first five Blaze Flow domains.

---

## 1. Identity & Authentication

The Identity & Authentication domain manages the global identity of every registered Blaze Flow user. A user exists independently of any workspace and can authenticate using a password or a supported OAuth provider. Authentication credentials and external identities are separated from the core user profile so additional authentication methods can be introduced without changing the user model.

### Features

#### Global User Identity
Each user has one global account identified by a unique email address. The user profile stores core information such as first name, last name, avatar, timezone, account status, email verification time, and last login time.

#### Email and Password Authentication
Users can authenticate using their email address and password. Password credentials are maintained separately from the main user record, allowing an account to exist without password authentication when it was originally created through OAuth.

#### Google OAuth Authentication
Google OAuth is supported through a generic OAuth identity model. A verified Google email can be automatically linked to an existing account with the same email, while a first-time Google login can create a new Blaze Flow user automatically.

#### Multiple Authentication Methods
A user created through Google OAuth can later configure a password and use either authentication method. Authentication mechanisms remain independent while resolving to the same global user identity.

#### Password Reset
Password reset uses expiring, hashed reset tokens. Creating a new reset request invalidates previous unused reset tokens so that only the latest valid recovery flow can be completed.

#### Account Status Management
User accounts support `ACTIVE`, `SUSPENDED`, and `DELETED` lifecycle states. Deleted accounts are soft-deleted and anonymized so the original email and OAuth identity can later be reused safely.

#### Guest Identity
External reviewers can participate through lightweight Guest Sessions without becoming registered users. Guest sessions use a high-entropy browser-held access key while only its secure hash is stored by the backend.

---

## 2. Workspace

A Workspace is Blaze Flow's primary tenant and organizational boundary. Projects, teams, roles, workflows, and other collaborative resources operate within a workspace. The workspace stores only its core identity and lifecycle information, while optional business information is maintained separately through a workspace profile.

### Features

#### Workspace Creation
Registered users can create workspaces with a name and globally unique slug. Workspace names do not need to be globally unique, while slug collisions are resolved by the application.

#### Immutable Workspace Creator
Each workspace records the user who originally created it. This creator reference is immutable and provides permanent provenance even if workspace ownership or memberships change later.

#### Workspace Timezone
Every workspace has its own required timezone. This provides a consistent temporal context for project deadlines, tasks, activities, and other workspace-specific scheduling behavior.

#### Workspace Lifecycle
Workspaces support `ACTIVE`, `SUSPENDED`, and `PENDING_DELETION` states. Pending deletion can include a scheduled deletion time, allowing the application to implement a grace period before permanent removal.

#### Workspace Business Profile
Optional organization information is stored in a separate one-to-one workspace profile. It can include business name, description, contact details, website, structured address, and country information without bloating the core workspace record.

#### Unique Workspace Slug
Each workspace receives a globally unique slug suitable for routing and human-readable URLs. Slug collision and suffix generation are handled at the application layer.

---

## 3. Workspace Membership & Principal Model

The Workspace Membership domain defines which authorization principals participate in a workspace. A membership can represent either an individual registered user or an entire Client Team, allowing Blaze Flow to use the same authorization structure for internal collaborators and organizational client access.

### Features

#### Multiple Principal Types
A workspace membership can represent either a `USER` or a `CLIENT_TEAM`. Exactly one corresponding reference is present, providing a unified membership abstraction without duplicating authorization infrastructure.

#### Direct User Membership
A registered user can have a direct membership in a workspace. This membership can carry the user's role and project-access configuration independently from any Client Team memberships they may also have.

#### Client Team Membership Principal
A Client Team can itself become a workspace authorization principal. The team receives role and resource grants once, and active members of that team inherit those grants without requiring duplicate workspace membership rows for every team member.

#### Additive Access Inheritance
A user may inherit permissions from one or more Client Teams while also having a direct user membership. Effective grants are additive: direct grants and inherited team grants are combined without an explicit deny mechanism in the MVP.

#### Primary Workspace Owner
The primary owner is represented by a boolean ownership flag on a direct user membership rather than by a special role. Only a user principal can be the primary owner, and each workspace has exactly one active primary owner.

#### Membership Lifecycle
Workspace memberships have their own lifecycle state, allowing access to be suspended or removed without deleting the underlying user or Client Team. Membership history can therefore remain available while effective authorization is disabled.

#### Project Access Mode
A membership can use either `ALL` or `SELECTED` project access mode. `ALL` provides the membership with the workspace-level project boundary, while `SELECTED` relies on explicit Resource Access records.

---

## 4. Roles & Permissions (RBAC)

The Roles & Permissions domain defines what an authorized workspace principal is allowed to do. Roles are reusable workspace-specific permission bundles, while individual permissions use application-defined keys so the permission vocabulary can evolve without requiring a database enum migration.

### Features

#### Workspace-Specific Roles
Roles belong to individual workspaces and can be created according to each organization's operational structure. Blaze Flow does not require predefined business roles such as Admin, Editor, or Client.

#### Reusable Permission Bundles
A role groups multiple permission keys into a reusable authorization policy. The same role can then be assigned through workspace memberships instead of repeatedly configuring individual permissions.

#### Application-Defined Permission Keys
Permissions are represented by application-defined keys such as `project.create`, `media.read`, or `team.read`. The backend owns the permission registry, validation rules, and semantics rather than hardcoding the complete vocabulary into the database schema.

#### Flexible Role Assignment
A Workspace Membership can reference a role regardless of whether its principal is a direct User or Client Team. This allows the same RBAC infrastructure to govern both individual and team-based access.

#### Role Lifecycle
Roles support active and archived states. An obsolete role can therefore be retired without immediately destroying its historical identity or references.

#### Workspace-Scoped Role Names
Role names are unique within their workspace but do not need to be globally unique. Different organizations can independently define roles that match their own terminology and operational structure.

---

## 5. Resource Access / Project Access

The Resource Access domain defines where a Workspace Membership can exercise its granted permissions. Roles answer **what** a principal may do, while Resource Access answers **where** those permissions apply. For the MVP, Project is the primary granular resource boundary.

### Features

#### Project-Level Access Scope
Resource Access connects a Workspace Membership to a specific Project. This provides granular project authorization without introducing separate project-member tables or duplicating the workspace membership model.

#### Separation of Permission and Scope
A role does not automatically determine which projects are accessible. The role provides action permissions, while Resource Access independently provides the project boundary on which those actions may be exercised.

#### Selected Project Access
Memberships configured with `SELECTED` project access receive access only to explicitly granted projects. Each grant is represented by a Resource Access record connecting that membership to the target project.

#### All-Project Access
Memberships using `ALL` project access do not require individual Resource Access records for every project. Their workspace membership establishes the project boundary across the workspace, while their role still determines permitted actions.

#### Client Team Project Access
Client Teams receive project access through their `CLIENT_TEAM` Workspace Membership. There is no direct Client Team-to-Project relationship, keeping team authorization consistent with the same Resource Access mechanism used for direct users.

#### Inherited User Access
When a Client Team has project access, active members of that team inherit the team's project grants. A user's direct membership may additionally grant access to other projects, and the effective resource scope is the union of applicable grants.

#### No Per-Media ACL in MVP
Resource Access stops at the Project boundary for normal workspace authorization. Individual Media Versions do not maintain separate member ACLs, keeping the MVP authorization model predictable and manageable.

## 6. Projects

The Projects domain is the primary operational container inside a Workspace. A project groups reviewable media, tasks, supporting files, workflow activity, and access boundaries around a specific body of work. Projects maintain their own lifecycle and priority while remaining fully scoped to a workspace.

### Features

#### Workspace-Scoped Projects
Every project belongs to exactly one Workspace. Project names may be duplicated within the same workspace, allowing teams to use natural project naming without artificial uniqueness constraints.

#### Project Lifecycle
Projects support `DRAFT`, `ACTIVE`, `ON_HOLD`, `COMPLETED`, `ARCHIVED`, and `PENDING_DELETION` states. This allows projects to move through operational, completed, archival, and deletion phases without immediately removing their data.

#### Project Priority
Each project has a priority of `LOW`, `MEDIUM`, or `HIGH`, with `MEDIUM` as the default. Priority provides a lightweight way to indicate operational importance without introducing a separate prioritization system.

#### Project Scheduling
Projects may optionally define `start_at` and `due_at` timestamps. These dates provide scheduling context while allowing projects without strict deadlines to remain valid.

#### Immutable Creator
Every project records the user who originally created it. The creator reference remains immutable and serves as provenance rather than representing current ownership or authorization.

#### Project-Wide Media Version Sequence
Each project maintains its own `next_media_version_number` counter. Every new reviewable Media Version receives a monotonically increasing project-wide version number such as V1, V2, V3, regardless of whether the uploaded content is logically related.

#### Safe Version Number Allocation
Media version numbers are allocated transactionally using the project's counter rather than calculating `MAX(version_number) + 1`. This prevents duplicate version numbers when concurrent uploads occur.

#### Scheduled Deletion
A project entering `PENDING_DELETION` may have a `deletion_scheduled_at` timestamp. This supports delayed cleanup and recovery policies without requiring immediate permanent deletion.

---

## 7. Media Versions

The Media Versions domain represents reviewable video or image uploads inside a Project. Every reviewable upload becomes a distinct Media Version with a project-wide sequential version number. Media Versions act as the central target for workflow progression, review comments, annotations, and approval-related activity.

### Features

#### Reviewable Video and Image Uploads
A Media Version represents an uploaded video or image intended for review. The actual media object is referenced through the centralized File domain rather than storing storage information directly on the Media Version.

#### Project-Wide Sequential Versioning
Every reviewable upload receives the next version number within its Project. Version identity is determined by upload order, so V2 does not necessarily mean it is a revision of V1.

#### Required Original File
Each Media Version references one immutable original File. The referenced File must represent supported reviewable media, such as video or image content, as determined from its MIME type.

#### Immutable Original Media
The original file of an existing Media Version is not replaced. Uploading replacement or revised content creates a new Media Version, preserving the integrity of previously reviewed versions.

#### Media Priority
Each Media Version independently supports `LOW`, `MEDIUM`, or `HIGH` priority. This allows individual reviewable outputs to have different urgency even when they belong to the same Project.

#### Controlled Downloading
`allow_download` controls whether the original reviewable media may be downloaded. Effective download access also depends on the requesting principal's permissions, so the flag alone does not grant authorization.

#### Media Lifecycle
Media Versions support `ACTIVE` and `PENDING_DELETION` states. A deletion schedule can be associated with pending deletion so media can follow controlled retention and cleanup behavior.

#### Required Initial Workflow Stage
Creating a Media Version requires explicitly selecting its initial Workflow Stage. The first stage-history entry is created in the same transaction, ensuring that every Media Version begins with a valid workflow state.

---

## 8. Workflow Stages & Statuses

The Workflow domain defines customizable review and production processes within a Workspace. Instead of hardcoding workflow stages into database enums, stages and their optional statuses are represented as data. This allows each workspace to adapt its workflow while Blaze Flow can still provision protected system stages.

### Features

#### Workspace-Specific Workflow Stages
Workflow Stages belong to a Workspace and can be arranged using `sort_order`. Each workspace can therefore maintain its own production and review workflow.

#### System-Provisioned Stages
Blaze Flow can provision standard stages such as Queued, In Progress, In Review, Revision, Approval, and Approved. These are regular database rows rather than enum values, allowing flexible ordering while preserving application-defined system behavior.

#### Custom Workflow Stages
Workspaces may create additional stages to match their own operational processes. Custom stages use the same workflow infrastructure as system-provisioned stages.

#### Stable Stage Slugs
Each stage has a slug that is unique within its Workspace. Slugs provide a stable application-facing identifier while names remain suitable for human-readable presentation.

#### Stage Ordering
`sort_order` controls the visual or conventional ordering of workflow stages. Ordering does not impose a mandatory transition sequence, allowing Media Versions to move flexibly between stages.

#### Optional Stage Statuses
A Workflow Stage can contain zero or more additional statuses. These provide finer-grained state representation inside a stage without requiring every stage to use sub-statuses.

#### Flexible Status Selection
Selecting a Workflow Stage Status is optional. A Media Version may therefore be associated with a stage alone or with both a stage and one of that stage's statuses.

#### Workflow Lifecycle
Stages and statuses support `ACTIVE` and `ARCHIVED` states. Historically used workflow configuration can be retained without continuing to expose it as an active workflow option.

#### Protected System Configuration
System-created stages and statuses can be distinguished through their creator information. Application rules can prevent destructive modifications to protected system workflow definitions while still allowing safe configuration such as ordering.

---

## 9. Media Version Stage History

The Media Version Stage History domain records the complete workflow timeline of every Media Version. Rather than storing only the current stage directly on the Media Version, Blaze Flow uses immutable stage-entry records as the canonical workflow history. The currently open entry represents the Media Version's present workflow position.

### Features

#### Complete Stage Timeline
Every workflow transition creates a new `media_version_stage_entries` record. This preserves the chronological sequence of stages through which a Media Version has passed.

#### Canonical Current Stage
The current workflow state is determined by the stage entry whose `exited_at` is `NULL`. This avoids maintaining duplicated current-stage state on the Media Version itself.

#### Single Open Stage Entry
A Media Version may have exactly one open stage entry at a time. A PostgreSQL partial unique index can enforce this invariant at the database level.

#### Transactional Stage Transition
When a Media Version changes stage, the existing open entry is closed and a new entry is created. Both operations should occur in the same transaction to prevent inconsistent workflow state.

#### Optional Workflow Status
A stage-history entry may reference an optional Workflow Stage Status. This allows the timeline to preserve both high-level stage transitions and finer-grained status selections.

#### Historical Snapshot
Each stage entry stores a JSON snapshot of relevant stage/status information. Historical records therefore remain understandable even if workflow configuration is later renamed, archived, or otherwise changed.

#### Actor Tracking
Each stage transition records the user responsible for the change. This provides workflow provenance independently from the generic action-level audit system.

#### Historical Reference Preservation
Stage and status references may remain nullable where necessary for lifecycle preservation. The stored snapshot ensures historical workflow information can still be interpreted when referenced configuration is no longer available.

---

## 10. Review Comments

The Review Comments domain provides threaded discussion directly on a Media Version. Comments may be general or associated with a specific point or range in time, and both registered users and authorized guests can participate. Threads support arbitrary reply depth, resolution, editing, and controlled soft deletion.

### Features

#### Media Version Discussion
Every Review Comment belongs directly to a Media Version. This keeps review conversations associated with the exact version of the creative content being discussed.

#### Registered and Guest Authors
Comments may be authored by either a registered User or a Guest Session. Exactly one author type must be present, allowing external reviewers to participate without becoming workspace members.

#### Nested Comment Threads
Comments support arbitrary-depth replies through a self-referencing parent relationship. This enables focused discussion threads rather than limiting conversations to a single reply level.

#### General Comments
A top-level comment may omit timing information entirely. This supports feedback that applies to the overall video or image rather than a specific visual moment.

#### Point-in-Time Comments
A comment can specify `start_time_ms` without an end time. This represents feedback attached to a precise moment in a video.

#### Time-Range Comments
A comment may include both `start_time_ms` and `end_time_ms`. This represents feedback that applies to a specific temporal range of reviewable media.

#### Reply Context Inheritance
Only top-level comments carry explicit timestamp context. Replies inherit the context of their parent discussion and do not maintain separate timestamp targeting.

#### Resolvable Threads
Review threads can be marked resolved and later reopened. Resolution is collaborative workflow state and does not prevent additional replies from being added to the thread.

#### Controlled Resolution
Registered authorized users may resolve or reopen comments according to application permissions. Guest reviewers cannot independently resolve or reopen review threads.

#### Author-Only Editing
Only the original author may edit their own comment. Historical revisions are retained separately so editing does not destroy the previous content state.

#### Permission-Based Deletion
Deletion is governed by permissions rather than being restricted exclusively to the original author. Deleting a parent comment also logically removes its descendant subtree.

#### Soft Deletion
Comments are soft-deleted using deletion timestamps and actor references. This preserves review history and revision records while removing deleted content from normal active views.

---

## 11. Review Comment Contents

The Review Comment Contents domain allows a single review comment to contain one or more content items. Instead of limiting comments to plain text, Blaze Flow supports text, audio, images, and arbitrary file attachments within the same review message.

### Features

#### Multi-Content Comments
A Review Comment may contain multiple content records. This allows a reviewer to combine different forms of feedback within one logical comment.

#### Text Content
`TEXT` content stores its value directly in `text_content`. Text entries do not require a File record and can coexist with other content types.

#### Audio Feedback
`AUDIO` content references a File containing recorded or uploaded audio feedback. This enables richer reviewer communication without introducing a separate audio-comment model.

#### Image Attachments
`IMAGE` content references an image through the centralized File domain. Reviewers can therefore attach visual references or examples directly to a discussion.

#### General File Attachments
`FILE` content supports arbitrary non-text attachments. File storage and technical metadata remain centralized in the File domain rather than duplicated in comment content.

#### Content Integrity
Text content requires `text_content` and no `file_id`, while non-text content requires a File and no text value. These rules keep content representation unambiguous.

#### Ordered Content
Each content record includes `sort_order`. Multiple content elements can therefore be rendered in a deterministic sequence within the parent comment.

#### Minimum Content Requirement
A Review Comment must contain at least one content item. Empty comments are prevented at the application/transaction level.

---

## 12. Review Comment Revisions

The Review Comment Revisions domain preserves historical versions of edited review comments. Before an existing comment is modified, its previous complete content state is captured as an immutable revision. This allows Blaze Flow to maintain review accountability without preventing users from correcting or refining their comments.

### Features

#### Immutable Revision History
Every meaningful comment edit can create a new revision containing the previous state. Existing revision records are not modified after creation.

#### Complete Content Snapshot
A revision stores the previous comment content state as JSON rather than only storing changed fields. This makes each historical revision independently interpretable.

#### User Edit Tracking
When a registered User edits a comment, the revision records that user as the editor. This preserves who was responsible for each historical modification.

#### Guest Edit Tracking
Guest-authored comments can also retain revision history. A Guest Session may be recorded as the editor instead of a registered User.

#### Exclusive Editor Identity
Each revision is associated with either a registered User or Guest Session, never both. This mirrors the author identity model used by Review Comments.

#### History Retention After Deletion
Comment revisions remain available even if the parent comment is later soft-deleted. Deletion therefore does not erase the historical evolution of review feedback.

---

## 13. Annotations

The Annotations domain represents visual markup placed on reviewable media. An annotation is an independent review object that may optionally be associated with a Review Comment, allowing visual markup to exist alone or complement written/audio feedback. One annotation can contain multiple graphical elements.

### Features

#### Media Version Targeting
Every Annotation belongs to one Media Version. Visual feedback is therefore permanently associated with the exact creative version on which it was created.

#### Independent Annotation Objects
Annotations do not require a Review Comment. A reviewer may create visual markup without also creating explanatory text.

#### Optional Comment Association
An Annotation may optionally reference a Review Comment belonging to the same Media Version. This allows visual markup and conversational feedback to be presented together when useful.

#### Multi-Element Annotation Groups
One Annotation acts as a logical drawing or markup session and may contain multiple Annotation Elements. A reviewer can therefore combine arrows, shapes, strokes, or other visual elements into one annotation.

#### User and Guest Authors
Annotations may be created by either registered Users or Guest Sessions. Exactly one author identity is associated with each annotation.

#### Temporal Targeting
Annotations can optionally target a point or range in time using millisecond timestamps. This enables frame-specific markup for video while allowing image annotations to omit temporal information.

#### Author-Only Editing
Only the original annotation author may modify the annotation. Authorization for creating annotations remains governed by the effective user or guest permissions.

#### Permission-Based Deletion
Deletion is permission-driven rather than strictly author-only. Authorized collaborators can therefore moderate annotations according to workspace review policies.

#### Soft Deletion
Annotations are soft-deleted and retain deletion actor information. Their historical revisions remain preserved after deletion.

#### Comment Link Flexibility
An annotation can be linked to or unlinked from an appropriate Review Comment without changing its fundamental identity. The application ensures that linked comments and annotations target the same Media Version.

---

## 14. Annotation Elements

The Annotation Elements domain stores the individual graphical components that make up an Annotation. Elements use flexible JSON structures for geometry, style, and element-specific payloads so Blaze Flow can introduce new drawing tools without repeatedly changing the database schema.

### Features

#### Extensible Element Types
Each element contains an application-defined `element_type` rather than a database enum. The backend controls the supported annotation tool registry and can introduce new element types without schema migrations.

#### Flexible Geometry
Element geometry is stored as JSON. Different annotation tools can therefore represent points, rectangles, paths, arrows, polygons, or other geometric structures using the format appropriate to each element type.

#### Normalized Coordinates
Where applicable, geometry uses normalized coordinates in the `0..1` range. This allows annotations to remain correctly positioned across different display resolutions and rendered media sizes.

#### Flexible Styling
Visual properties are stored in a dedicated `style` JSON object. Individual element types can define properties such as stroke characteristics, opacity, or other presentation settings without introducing dedicated database columns.

#### Element-Specific Payload
A separate `payload` JSON object can store additional data required by a particular annotation element type. This keeps extensibility separate from common geometry and styling concerns.

#### Multiple Elements per Annotation
An Annotation can contain any number of Annotation Elements. Complex visual feedback can therefore be represented as a single logical annotation composed of multiple drawings.

#### Deterministic Ordering
Elements contain a `sort_order` value. The client can use this ordering when rendering overlapping or sequential annotation elements.

---

## 15. Annotation Revisions

The Annotation Revisions domain maintains historical states of edited annotations. Similar to comment revisions, it preserves previous annotation structures as immutable snapshots so visual feedback can be changed without losing its earlier form.

### Features

#### Annotation Edit History
When an Annotation is modified, its previous state can be captured as a revision. This provides historical accountability for changes to visual review feedback.

#### Complete Annotation Snapshot
Each revision stores the previous annotation state as JSON. The snapshot can include the annotation's relevant targeting information and element configuration required to represent its earlier form.

#### Registered User Editor Tracking
Revisions created from edits by registered Users record the responsible user. This allows historical annotation modifications to be attributed correctly.

#### Guest Editor Tracking
Guest-created annotations receive the same revision capability. A Guest Session can be recorded as the editor when an authorized guest modifies their annotation.

#### Exclusive Editor Identity
A revision identifies either a User or Guest Session as its editor, never both. This maintains consistent actor semantics across the review system.

#### Revision Preservation
Annotation revisions remain retained even after the Annotation itself is soft-deleted. Historical visual feedback is therefore not silently destroyed by later moderation or cleanup actions.

## 16. Tasks & Task Assignees

The Tasks domain provides lightweight work management at both Workspace and Project levels. Tasks can represent general workspace work or work associated with a specific Project. Assignment is handled separately so one task can be assigned to multiple workspace authorization principals.

### Features

#### Workspace-Level Tasks

Every Task belongs to a Workspace and may exist without a Project. This supports operational tasks that are relevant to the organization but not tied to a specific creative project.

#### Project-Level Tasks

A Task may optionally reference a Project. This allows project-specific work to be managed alongside the project's media, review, and supporting resources.

#### Task Lifecycle

Tasks support `TODO`, `IN_PROGRESS`, `COMPLETED`, and `CANCELLED` states. The lifecycle remains intentionally simple for the MVP while covering the primary task-management states.

#### Task Priority

Each Task supports `LOW`, `MEDIUM`, or `HIGH` priority, with `MEDIUM` as the default. This provides lightweight prioritization without introducing a more complex ranking system.

#### Task Scheduling

Tasks may optionally define `start_at` and `due_at`. Tasks without fixed schedules remain valid, while scheduled work can participate in future calendar and deadline views.

#### Completion Tracking

A completed Task can record `completed_at`. This preserves when the work was actually completed independently from its original due date.

#### Multiple Assignees

Task assignment is represented through `task_assignees`, allowing multiple Workspace Memberships to be assigned to the same Task.

#### Membership-Based Assignment

Assignees reference Workspace Memberships rather than global Users. This ensures task assignment remains within the authorization and tenancy context of the Workspace.

#### Creator Tracking

Each Task records the Workspace Membership that created it. This preserves the workspace-context identity of the creator rather than only storing a global user reference.

#### Soft Deletion

Tasks support logical deletion through `deleted_at`. Deleted tasks can be removed from normal operational views without immediately destroying historical information.

#### Manual Ordering

Tasks contain a `sort_order` value for deterministic or manually controlled presentation within task views.

---

## 17. Task Attachments

The Task Attachments domain connects existing Files to Tasks. It allows documents, images, references, or other supporting files to be associated with work items while keeping physical storage and file metadata centralized in the File domain.

### Features

#### File-Based Attachments

Every Task Attachment references an existing File. Storage information is not duplicated inside the task system.

#### Multiple Attachments

A Task can contain multiple attachments. This allows all supporting resources required to complete a task to remain associated with the work item.

#### Attachment Provenance

Each attachment records the Workspace Membership responsible for attaching the File. This provides contextual provenance for collaborative task management.

#### Duplicate Prevention

The same File can only be attached once to the same Task. A unique `(task_id, file_id)` constraint prevents redundant attachment records.

#### File Reuse

The attachment relationship does not imply ownership of the underlying File. The same File may participate in other supported domain relationships without creating duplicate physical objects.

---

## 18. File & Storage Management

The File & Storage domain provides Blaze Flow's centralized abstraction for uploaded and generated files. Logical File records are separated from storage-provider configuration and derived variants, allowing media and documents to be referenced consistently regardless of where their physical objects are stored.

### Features

#### Provider-Independent Files

Application domains reference a generic File instead of directly depending on AWS, Cloudflare, or another storage provider. This isolates business models from storage infrastructure decisions.

#### Multiple Storage Backends

Blaze Flow can configure multiple platform-managed Storage Backends. Each backend identifies its provider and stores non-secret configuration required by the storage integration.

#### Application-Defined Providers

Storage provider identifiers are application-defined rather than represented by a rigid database enum. Additional providers can therefore be introduced without changing the core schema.

#### Global Storage Configuration

Storage Backends are platform-level infrastructure and do not belong to individual Workspaces. Storage routing and backend selection are handled by the service layer.

#### Original Object Storage

A File directly identifies its original physical object using a Storage Backend and object key. There is no separate storage-object table for the original upload.

#### Unique Object Identity

The combination of Storage Backend and object key uniquely identifies a physical original object. This prevents duplicate database references to the same backend location.

#### File Metadata

Files maintain technical information such as original filename, MIME type, byte size, optional checksum, checksum algorithm, and extensible JSON metadata.

#### MIME-Based Content Identification

Files do not maintain a separate content-category field. Whether a File is video, image, audio, or another type is determined from its MIME type.

#### File Processing Lifecycle

Files support `PENDING`, `READY`, and `FAILED` states. This allows asynchronous uploads, processing, or storage operations to expose their current readiness.

#### Logical File Deletion

Files support logical deletion through `deleted_at`. Domain relationships can therefore be managed independently from eventual physical storage cleanup.

#### Derived File Variants

`FileVariant` represents derived physical representations of an original File. Examples may include transformed, optimized, preview, or processing-generated objects without hardcoding variant categories into the database.

#### Independent Variant Storage

A File Variant may use a different Storage Backend from its original File. This allows original media and delivery-optimized derivatives to be distributed across different infrastructure.

#### Extensible Variant Metadata

Variants maintain their own MIME type, size, checksum, metadata, processing status, and object location. No fixed `variant_type` enum is required.

---

## 19. Project Files & Folders

The Project Files & Folders domain manages supporting project resources that are not reviewable Media Versions. It provides a nested folder hierarchy over centralized Files, allowing teams to organize documents, references, assets, and other project materials without duplicating physical file storage.

### Features

#### Supporting Project Files

Files can be attached to a Project independently from Media Versions. This separates reviewable creative outputs from general project documents and assets.

#### Arbitrary Folder Nesting

Project Folders support a self-referencing parent relationship. This allows arbitrary folder depth rather than limiting projects to a predefined folder hierarchy.

#### Root-Level Files and Folders

Both folders and files may exist directly at the Project root. A parent folder is optional when no nested location is required.

#### Folder-Scoped Naming

Folder names are unique among siblings within the same Project. Root-level uniqueness requires appropriate PostgreSQL handling because the parent reference is `NULL`.

#### Centralized File Reuse

A Project File references the centralized File domain rather than creating another storage record. Physical storage remains independent from project organization.

#### One File per Project

The same File may only appear once within a particular Project. A unique `(project_id, file_id)` constraint prevents the same physical/logical File from being placed repeatedly in different project folders.

#### Cross-Project File Reuse

The same File may be associated with different Projects. Project organization therefore does not imply exclusive ownership of the underlying File.

#### Folder Creation Provenance

Every Project Folder records the Workspace Membership that created it. This maintains actor context within the Workspace authorization model.

#### File Addition Provenance

Every Project File records the Workspace Membership that added it to the Project.

#### Folder Subtree Deletion

Deleting a folder logically removes its descendant folders and Project File associations. The underlying centralized File records are not automatically deleted.

#### Soft Deletion

Folders and Project File associations support soft deletion. Organizational removal is therefore separated from physical File lifecycle management.

#### Original File Naming

Project File records do not maintain a separate display name. The original filename from the referenced File is used for MVP presentation.

---

## 20. Client Teams

The Client Teams domain represents external client organizations or groups collaborating within a Workspace. A Client Team stores organizational information and groups registered Users, while authorization remains delegated to the Workspace Membership, Role, and Resource Access infrastructure.

### Features

#### Workspace-Scoped Client Organizations

Every Client Team belongs to one Workspace. This provides an organizational representation of a client without turning the Client Team itself into a separate tenant.

#### Flexible Team Naming

Client Team names do not need to be unique within a Workspace. The system does not require artificial slugs or client codes for MVP.

#### Client Profile Information

A Client Team can store an optional description, website, email, phone number, and other general contact information.

#### Structured Address

Optional address information is represented through structured fields including address lines, city, state/region, postal code, and country code.

#### Client Logo

A Client Team may reference a File as its logo. Logo storage therefore uses the same centralized File infrastructure as the rest of Blaze Flow.

#### Extensible Metadata

Optional JSON metadata allows future client-specific information to be stored without immediately expanding the core schema.

#### Team Lifecycle

Client Teams support `ACTIVE`, `ARCHIVED`, and `DELETED` states. Lifecycle changes are separate from the status of individual Client Team Members.

#### Optional Creator

A Client Team may record the Workspace Membership responsible for creating it. The reference remains nullable to support system-created, imported, or invite-driven creation scenarios.

#### Authorization Separation

Client Team business information does not directly contain roles or project permissions. Authorization is provided through a `CLIENT_TEAM` Workspace Membership.

#### Optional Workspace Authorization

A Client Team may exist without having a Workspace Membership. Creating an organizational Client Team therefore does not automatically grant it access to Workspace resources.

#### No Direct Project Relationship

Client Teams do not reference Projects directly. Project access is granted through the team's Workspace Membership and Resource Access records.

---

## 21. Client Team Members

The Client Team Members domain connects registered Blaze Flow Users to Client Teams. It represents organizational membership rather than authorization itself, allowing a User to participate in multiple client organizations while inheriting access through each team's authorization principal.

### Features

#### User-to-Team Membership

Each Client Team Member directly references a global User and a Client Team. It does not require the User to have a separate direct Workspace Membership.

#### Multiple Client Teams per User

A User may belong to multiple Client Teams. This supports consultants, stakeholders, or collaborators who participate in more than one client organization.

#### Duplicate Membership Prevention

A User can have only one membership record within a specific Client Team. The unique `(client_team_id, user_id)` constraint provides stable membership identity.

#### Membership Lifecycle

Client Team membership supports `ACTIVE` and `REMOVED` states. Removing a member does not delete the historical membership record.

#### Membership Reactivation

If a previously removed User rejoins the same Client Team, the existing membership row is reactivated instead of creating a duplicate membership.

#### Join History

`joined_at` preserves the member's original join time. Reactivation does not overwrite this first membership timestamp.

#### Removal Tracking

`removed_at` records when an active membership was removed. Reactivation clears the removal timestamp while retaining the same membership identity.

#### Optional Member Title

A Client Team Member may have a free-text title such as Marketing Manager or Creative Director. The title is descriptive only and has no authorization semantics.

#### Addition Provenance

The membership may record the Workspace Membership responsible for adding the User. This field remains nullable for invite-driven or system-driven membership creation.

#### Team Permission Inheritance

An active Client Team Member inherits effective authorization from the Client Team's Workspace Membership. Role and Project access are not duplicated onto the Client Team Member row.

#### Additive Individual Grants

A User may additionally receive a direct `USER` Workspace Membership. Those direct grants are combined with inherited Client Team grants rather than replacing them.

---

## 22. Client Team Invites

The Client Team Invite domain handles onboarding Users into Client Teams. It supports recipient-specific email invitations and reusable shareable links while keeping authorization configuration outside the invitation itself. Successful acceptance creates or reactivates Client Team membership.

### Features

#### Email Invitations

An `EMAIL` invite targets one normalized recipient email address. It is recipient-bound and single-use, providing controlled onboarding for a specific client participant.

#### Shareable Link Invitations

A `LINK` invite is not tied to a recipient email. The link may be shared with multiple participants and can optionally define a maximum number of successful uses.

#### Secure Invite Tokens

Raw invitation tokens are never persisted in the database. Blaze Flow stores only a secure token hash used to validate the presented invitation secret.

#### Mandatory Expiration

Every Client Team Invite has an expiration time. Invitations therefore cannot remain valid indefinitely without explicit lifecycle management.

#### Invite Revocation

An active invitation may be revoked before expiration. Revocation is represented through `revoked_at` rather than a redundant status enum.

#### Derived Validity

Invite validity is determined from its type, expiration, revocation state, and usage constraints. There is no separate invite-status field that could become inconsistent with these underlying values.

#### Usage Tracking

Invites maintain `use_count`. Email invites are limited to one use, while link invites may define `max_uses` or remain unlimited until expiration/revocation.

#### Multiple Team Links

A Client Team may have multiple active or historical link invitations. This allows different distribution channels or onboarding campaigns to use independent revocable links.

#### Optional Link Labels

An invite may contain a descriptive label. This helps administrators distinguish shareable links without affecting authorization or acceptance behavior.

#### Invite Creator Tracking

Invites may record the Workspace Membership that created them. The field can remain nullable for system-driven invitation scenarios.

#### Revocation Actor Tracking

When applicable, the Workspace Membership responsible for revoking an invitation is retained for provenance.

#### No Embedded Authorization

Client Team Invites do not contain roles, Project access, or permission grants. Invite acceptance only establishes organizational Client Team membership.

#### New or Existing User Acceptance

An invitation may be accepted by an existing Blaze Flow User or participate in onboarding a new User. Both ultimately resolve to the same Client Team Member model.

#### Removed Member Reactivation

If the accepting User previously belonged to the Client Team but was removed, successful acceptance reactivates the existing membership instead of creating a new one.

#### Acceptance History

Successful invite consumption is recorded through `client_team_invite_acceptances`. This is especially important for reusable link invites where multiple Users can accept the same invitation.

#### No Automatic Direct Workspace Membership

Accepting a Client Team Invite does not create a direct `USER` Workspace Membership. The User normally inherits authorization through the Client Team's own Workspace Membership.

---

## 23. Guest Sessions

The Guest Sessions domain provides lightweight identity for external reviewers who should not become registered Blaze Flow Users. A Guest Session represents a browser-recognizable reviewer identity within a Workspace and can participate in guest review access, comments, and annotations.

### Features

#### Lightweight Guest Identity

Guests can participate without creating a full Blaze Flow account. A Guest Session provides sufficient identity for attributing review activity while avoiding normal user authentication requirements.

#### Workspace Scope

Every Guest Session belongs to a Workspace. Guest identity is therefore contextual rather than a global registered identity.

#### Guest Name and Email

Guest Sessions store reviewer name and email information for attribution and review collaboration. These details do not imply email verification or account ownership.

#### Browser-Held Access Key

A high-entropy access key is held by the guest's browser. Possession of this key allows the browser to recover the same Guest Session for subsequent interactions.

#### Hashed Key Storage

The raw guest access key is never stored by the backend. Only its secure hash is persisted, reducing exposure if database contents are compromised.

#### Guest Activity Attribution

Review Comments and Annotations can reference a Guest Session as their author. This keeps external review contributions attributable without creating global User records.

#### Session Recovery

Returning with the same valid browser-held key restores the same guest identity and associated review history.

#### Device Independence by Design

A guest using another device without the original access key is treated as a new Guest Session. Cross-device identity merging is outside the MVP scope.

#### Last-Seen Tracking

`last_seen_at` records recent guest activity. This provides lightweight operational visibility without introducing a full authentication-session subsystem.

#### No Workspace Membership

A Guest Session is not a Workspace Membership principal. Guest authorization is handled independently through Guest Review Access.

---

## 24. Guest Invites

The Guest Invites domain provides shareable Project review links for external participants. Unlike Client Team invitations, Guest Invites do not onboard participants into organizational membership. They establish a controlled entry point through which Guest Sessions can receive Project-scoped review access.

### Features

#### Project-Scoped Invitations

Every Guest Invite targets exactly one Project. Workspace-wide, Client Team-wide, and individual Media Version guest invites are intentionally outside the MVP model.

#### Link-Only Access

Guest Invites are shareable links rather than recipient-specific email invitations. Anyone possessing a valid link may establish Guest Review Access subject to backend validation.

#### Secure Token Handling

Guest invite secrets are represented by high-entropy tokens, while only their hashes are stored in the database. Raw tokens are not persisted.

#### Optional Expiration

A Guest Invite may define `expires_at`, but expiration is not mandatory. A link with no expiration remains usable until explicitly revoked.

#### Invite Revocation

Guest links can be invalidated through `revoked_at`. This allows access through a distributed link to be stopped without deleting its historical record.

#### Derived Invite Validity

There is no explicit Guest Invite status enum. Effective validity is derived from revocation and expiration state.

#### Multiple Links per Project

A Project can have multiple Guest Invites. Different review audiences or distribution channels can therefore use separate links with independent revocation.

#### Optional Invite Labels

Each link may have a descriptive label. Labels help Workspace members identify the purpose or audience of multiple guest links.

#### Creator Attribution

A Guest Invite records the Workspace Membership that created it. This identifies who intentionally exposed the Project through external review access.

#### Revocation Attribution

If a link is revoked, the responsible Workspace Membership can be recorded separately from its original creator.

#### No Usage Counter in MVP

Guest Invites do not track `max_uses` or enforce a usage limit in the MVP. Access remains governed by token validity, expiration, revocation, and guest authorization.

#### No Embedded Fixed Permissions

The Guest Invite itself does not contain hardcoded `can_view`, `can_comment`, or similar boolean columns. Granted capabilities are represented separately through application-defined permission keys.

---

## 25. Guest Invite Permissions

The Guest Invite Permissions domain defines the default capabilities granted through a Guest Invite. Permissions are normalized into application-defined keys rather than hardcoded database columns, allowing the guest authorization vocabulary to evolve without changing the schema.

### Features

#### Application-Defined Permission Keys

Each permission is represented by a string key controlled by the backend. The application defines which guest permissions exist and what each key means.

#### No Permission Enum

Permission vocabulary is intentionally not represented by a database enum. New guest capabilities can be introduced without requiring schema migrations.

#### No Fixed Boolean Permissions

Guest capabilities are not modeled as columns such as `can_view` or `can_comment`. This avoids schema expansion whenever the authorization system gains another capability.

#### Multiple Permissions per Invite

A Guest Invite can contain any number of granted permission keys. Together, these rows represent the default permission set associated with the shareable link.

#### Duplicate Permission Prevention

The combination of `guest_invite_id` and `permission_key` forms the unique identity of a grant. The same permission cannot be granted to the same invite more than once.

#### Backend Validation

The backend owns the valid permission registry and rejects unsupported keys. Database storage remains generic while permission semantics remain centralized in application logic.

#### Permission Dependency Handling

Dependencies between permissions are enforced by the application rather than the database. For example, if one capability logically requires another, the permission service is responsible for maintaining that rule.

#### Default Guest Access Template

Guest Invite Permissions act as the permission template for guests entering through the link. When Guest Review Access is established, these permissions can be copied or derived into that guest's effective permission set.

#### Separation from Individual Guest Grants

Invite permissions describe the link's default capabilities, not necessarily the permanent permissions of every Guest Session that has previously used it. Individual effective permissions are maintained by the Guest Review Access permission domain.

## 26. Guest Review Access

The Guest Review Access domain represents the actual Project access obtained by a specific Guest Session through a Guest Invite. While a Guest Invite is a shareable entry point, Guest Review Access creates an individual access relationship for each guest who uses that link. It enables per-guest tracking, revocation, and permission customization without converting guests into Workspace Members.

### Features

#### Individual Guest Access

Each Guest Review Access connects one Guest Session to one Guest Invite. This transforms a shared invitation link into an identifiable access relationship for a specific external reviewer.

#### Project Scope Inheritance

The accessible Project is derived through `GuestReviewAccess → GuestInvite → Project`. Project identity is not duplicated on Guest Review Access, avoiding redundant scope information.

#### Reusable Access Relationship

If the same Guest Session uses the same Guest Invite again, the existing Guest Review Access is reused. A unique `(guest_session_id, guest_invite_id)` constraint prevents duplicate access records.

#### Multiple Guest Invites per Guest

A Guest Session may obtain access through multiple Guest Invites. This allows the same external reviewer identity to participate in multiple Projects or through independently managed review links.

#### Individual Access Revocation

A specific Guest Review Access can be revoked without revoking the underlying Guest Invite. Administrators can therefore remove one guest while allowing the shared link to remain available to others.

#### Revocation Attribution

When individual guest access is revoked, the responsible Workspace Membership may be recorded. This preserves administrative provenance for access-control actions.

#### Invite Validity Dependency

Guest Review Access remains effective only while its parent Guest Invite is valid. Revoking or expiring the invite invalidates effective access obtained through that link even though historical access rows remain stored.

#### Historical Access Preservation

Revoking a Guest Invite or individual Guest Review Access does not delete the access relationship. Historical information remains available for review and auditing purposes.

#### Access Activity Tracking

`last_accessed_at` records the most recent use of the guest access relationship. This provides lightweight visibility into external review participation.

#### No Independent Expiration

Guest Review Access does not maintain a separate expiration timestamp in the MVP. Expiration is inherited from the Guest Invite unless the individual access is explicitly revoked.

#### No Workspace Membership

Creating Guest Review Access does not create a `USER` or `CLIENT_TEAM` Workspace Membership. Guest authorization remains isolated from the normal workspace RBAC system.

#### Project Child Resource Access

Guest access applies to eligible review resources under the Project. Separate per-Media-Version guest ACLs are not required for the MVP.

---

## 27. Guest Review Access Permissions

The Guest Review Access Permissions domain stores the effective application-defined permission set for an individual Guest Review Access. Permissions normally originate from the Guest Invite but are materialized separately so a specific guest's capabilities can later be customized without changing the shared invitation.

### Features

#### Individual Guest Permissions

Each permission grant belongs to one Guest Review Access. This provides a guest-specific authorization layer rather than repeatedly evaluating only the shared Guest Invite configuration.

#### Application-Defined Permission Keys

Permissions are stored using backend-defined string keys. The application owns the permission vocabulary, validation, dependencies, and authorization semantics.

#### No Hardcoded Permission Columns

The schema does not contain fixed booleans such as `can_view`, `can_comment`, `can_annotate`, or `can_download`. New capabilities can therefore be introduced without altering the table structure.

#### Permission Initialization from Invite

When Guest Review Access is created, its effective permissions can initially be copied or derived from the corresponding Guest Invite Permissions.

#### Independent Permission Customization

After access has been established, an individual guest's permission set may be customized independently. Changing one guest does not require modifying the permissions granted to everyone using the same invite.

#### Permission Snapshot Behavior

Existing Guest Review Access permissions do not automatically change when the Guest Invite's default permission set is later modified. The access-level permissions represent the guest's effective granted set unless the backend explicitly propagates changes.

#### Duplicate Permission Prevention

The combination of `guest_review_access_id` and `permission_key` uniquely identifies a permission grant. The same capability cannot be granted twice to the same Guest Review Access.

#### Backend Authorization Rules

Permission validity and relationships are enforced by the backend permission service. The database remains responsible for storing grants rather than defining their business meaning.

#### Combined Access Evaluation

Possessing a permission does not automatically guarantee an operation is allowed. Effective authorization can additionally depend on Guest Invite validity, Guest Review Access revocation, Project state, and resource-level rules such as `MediaVersion.allow_download`.

---

## 28. Action-Level Audit Logs

The Action-Level Audit domain records meaningful business and security actions performed through Blaze Flow. Instead of capturing every database field mutation, the MVP records explicit application actions such as project creation, invite revocation, or team-member removal. Audit actions are declared at the DRF/ViewSet layer and persisted through a shared audit mechanism.

### Features

#### Generic Audit Log

All supported domains write audit events into one generic `audit_logs` table. This avoids maintaining separate audit tables for Projects, Client Teams, Guest Invites, and other business entities.

#### Explicit Business Actions

Audit actions use application-defined identifiers such as `project.created`, `guest_invite.revoked`, or `client_team.member_removed`. This captures business meaning rather than low-level ORM operations.

#### DRF-Level Action Declaration

Auditable actions are explicitly declared at the DRF View/ViewSet layer instead of being inferred solely from HTTP methods and URL paths. This keeps audit semantics intentional and predictable.

#### Shared Audit Infrastructure

Common audit persistence and request-context collection are centralized. Individual endpoints declare what happened without implementing their own audit-storage logic.

#### Multiple Actor Types

Audit events support `USER`, `GUEST`, and `SYSTEM` actors. User and Guest actors reference their respective identities, while system actions can exist without either reference.

#### Actor Integrity

A `USER` audit event contains only a User actor, a `GUEST` event contains only a Guest Session actor, and a `SYSTEM` event contains neither. Database checks can enforce this invariant.

#### Optional Workspace Context

An audit event may reference the Workspace in which the action occurred. The reference remains nullable so global or authentication-related actions can also be represented.

#### Optional Entity Target

Audit events may identify a target through application-defined `entity_type` and `entity_id` values. Both remain optional because some meaningful actions do not target one concrete domain entity.

#### Generic Entity Identification

`entity_id` is stored generically rather than requiring a foreign key to every possible audited table. This allows one audit table to reference different domain entities without polymorphic database relationships.

#### Request Context

Audit events may retain the HTTP request method, request path, and request identifier. This provides operational context without turning the audit system into a general HTTP access log.

#### Request Correlation

`request_id` can associate an audit event with the request that caused it. This can assist troubleshooting and correlation with application logs or observability systems.

#### Extensible Metadata

Optional JSON metadata can capture additional action-specific information that does not justify dedicated audit columns.

#### Successful Business Action Focus

The MVP audit system primarily records meaningful successful state-changing or security-sensitive operations. It is not intended to store every GET request or act as a web-server access log.

#### Append-Only History

Audit records are treated as append-only under normal application behavior. Historical audit events should not be modified to reflect later changes.

#### No Database Mutation History

Field-level old/new database mutation tracking is explicitly outside the MVP scope. Django model signals are therefore not required for the current audit architecture.

---

## 29. User Subscription

The User Subscription domain manages Blaze Flow subscription state at the registered User level. Subscription ownership does not belong directly to a Workspace; instead, a Workspace's effective resource limits and capabilities are determined from its primary owner's subscription. For the MVP, plan configuration and resource limits remain in environment/application configuration rather than database tables.

### Features

#### User-Level Subscription

Every subscription belongs to a registered User. This reflects the Blaze Flow commercial model where the subscribing account owns the plan rather than each Workspace maintaining an independent subscription.

#### Owner-Based Workspace Entitlements

A Workspace determines its effective subscription through its primary owner. The owner's active subscription becomes the source for evaluating that Workspace's available plan capabilities and resource limits.

#### Multiple Owned Workspaces

A subscribed User may own multiple Workspaces. Each owned Workspace derives its applicable plan configuration from that owner's subscription according to backend resource-limit policies.

#### MVP Plan Types

Subscription plan identity is represented using a small application-supported plan set such as `FREE` and `PRO`. More dynamic database-managed plans can be introduced after the MVP.

#### Subscription Lifecycle

Subscriptions support states such as `ACTIVE`, `CANCELLED`, `EXPIRED`, and `PAST_DUE`. Subscription state remains separate from Workspace lifecycle state.

#### Free Subscription Support

A User may operate under a Free subscription without requiring an external payment provider. This allows the same subscription-resolution mechanism to be used across free and paid accounts.

#### Subscription Period Tracking

Subscriptions can maintain `started_at`, `current_period_start`, and `current_period_end`. These fields provide the temporal boundaries needed for recurring subscription lifecycle management.

#### End-of-Period Cancellation

`cancel_at_period_end` allows a subscription to remain effective until the current billing period finishes. Cancellation can therefore be scheduled rather than always terminating access immediately.

#### Cancellation Tracking

`cancelled_at` records when cancellation occurred. This is distinct from the end of the current subscription period.

#### External Provider Support

Optional `provider` and `provider_subscription_id` fields allow Blaze Flow to associate a subscription with an external billing provider without making the core subscription schema dependent on one specific provider.

#### Single Current Subscription

A User should have at most one current subscription relationship at a time. A PostgreSQL partial unique constraint can prevent multiple simultaneous `ACTIVE` or `PAST_DUE` subscriptions.

#### Environment-Based Resource Limits

Resource limits are intentionally not stored in the database for the MVP. Limits such as maximum Projects, storage, or members are maintained through environment variables and centralized application configuration.

#### Environment-Based Capabilities

Plan capabilities can also be controlled through the centralized application configuration layer. Business code should consume this configuration through a common Plan Config service rather than directly reading environment variables throughout the codebase.

#### Centralized Plan Configuration

The backend should expose an abstraction such as `get_plan_limit(plan, key)` or an equivalent Plan Config service. This isolates business logic from the physical source of plan configuration.

#### Future Database Migration

The configuration abstraction allows resource limits and capabilities to move from environment variables to database-managed Plans and Entitlements later. Consumers of the Plan Config service should not need substantial changes when that migration occurs.

#### Workspace Ownership Dependency

Because Workspace limits depend on the primary owner's subscription, ownership changes may affect the Workspace's effective plan. The backend is responsible for enforcing the appropriate business policy when ownership is transferred.
