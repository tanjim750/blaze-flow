"use client";

import { useActionState, useState, useTransition } from "react";
import { BadgePlus, Copy, MailPlus, ShieldCheck, TriangleAlert, UserRoundCog, Users, X } from "lucide-react";
import type { Role, WorkspaceMembership } from "@/lib/api";
import type { TeamView } from "@/lib/team-view";
import { createRoleAction, grantProjectAction, inviteMemberAction, revokeProjectAction, updateMemberAction, type TeamActionState } from "./actions";

const initial: TeamActionState = { error: null, message: null };

export function TeamPanel({ view }: { view: TeamView }) {
  const [dialog, setDialog] = useState<"invite" | "role" | null>(null);
  return <div className="team-page">
    {view.notice && <p className="team-notice"><TriangleAlert />{view.notice}</p>}
    <header className="team-heading"><div><p className="eyebrow">Workspace administration</p><h1>Team & Roles</h1><p>Manage who can enter {view.workspaceName} and what they can do.</p></div><div><button onClick={() => setDialog("role")}><BadgePlus />New role</button><button className="primary" onClick={() => setDialog("invite")}><MailPlus />Invite member</button></div></header>
    <section className="team-stats"><article><Users /><span><strong>{view.members.length}</strong> members</span></article><article><ShieldCheck /><span><strong>{view.roles.filter((role) => role.status === "ACTIVE").length}</strong> active roles</span></article><article><UserRoundCog /><span><strong>{view.members.filter((member) => member.status === "ACTIVE").length}</strong> active access</span></article></section>
    <section className="team-card"><header><h2>Workspace members</h2><span>Role and project scope changes apply immediately.</span></header><div className="member-list">
      {view.members.map((member) => <MemberRow key={member.id} member={member} roles={view.roles} />)}
      {!view.members.length && <p className="team-empty">No memberships are visible.</p>}
    </div></section>
    <ProjectAccessPanel view={view} />
    <section className="team-card"><header><h2>Roles</h2><span>System roles are protected; custom roles can be tailored through the API.</span></header><div className="role-grid">{view.roles.map((role) => <article key={role.id}><div><ShieldCheck /><strong>{role.name}</strong>{role.is_system && <b>System</b>}</div><p>{role.description || "No description"}</p><small>{role.permissions.length} permissions</small></article>)}</div></section>
    {dialog === "invite" && <InviteDialog roles={view.roles} close={() => setDialog(null)} />}
    {dialog === "role" && <RoleDialog roles={view.roles} close={() => setDialog(null)} />}
  </div>;
}

function ProjectAccessPanel({ view }: { view: TeamView }) {
  const [state, action, pending] = useActionState(grantProjectAction, initial);
  const [revokeError, setRevokeError] = useState("");
  const [revoking, startRevoke] = useTransition();
  const selectedMembers = view.members.filter((member) => member.project_access_mode === "SELECTED" && member.status === "ACTIVE");
  return <section className="team-card"><header><h2>Selected project access</h2><span>Explicit grants for selected-scope memberships.</span></header><form action={action} className="access-form"><select name="membership_id" required><option value="">Choose member…</option>{selectedMembers.map((member) => <option key={member.id} value={member.id}>{member.user?.email ?? member.client_team?.name}</option>)}</select><select name="project_id" required><option value="">Choose project…</option>{view.projects.map(({ project }) => <option key={project.id} value={project.id}>{project.name}</option>)}</select><button disabled={pending}>Grant access</button></form><Feedback state={state} />{revokeError && <p className="form-error">{revokeError}</p>}<div className="grant-list">{view.projects.flatMap(({ project, grants }) => grants.map((grant) => <article key={grant.id}><span><strong>{project.name}</strong><small>{grant.membership.user?.email ?? grant.membership.client_team?.name}</small></span><button disabled={revoking} onClick={() => startRevoke(async () => { const result = await revokeProjectAction(project.id, grant.id); if (result.error) setRevokeError(result.error); })}>Revoke</button></article>))}{!view.projects.some(({ grants }) => grants.length) && <p className="team-empty">No explicit project grants.</p>}</div></section>;
}

function MemberRow({ member, roles }: { member: WorkspaceMembership; roles: Role[] }) {
  const [editing, setEditing] = useState(false); const [state, action, pending] = useActionState(updateMemberAction, initial);
  const identity = member.user ? `${member.user.first_name} ${member.user.last_name}`.trim() || member.user.email : member.client_team?.name ?? "Client team";
  return <article className="member-row"><span className="member-avatar">{identity.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase()}</span><div><strong>{identity}</strong><small>{member.user?.email ?? member.principal_type}</small></div>
    {editing && !member.is_primary_owner ? <form action={action} className="member-editor"><input type="hidden" name="membership_id" value={member.id} /><select name="role_id" defaultValue={member.role?.id}>{roles.filter((role) => role.status === "ACTIVE").map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select><select name="project_access_mode" defaultValue={member.project_access_mode}><option value="ALL">All projects</option><option value="SELECTED">Selected only</option></select><select name="status" defaultValue={member.status}><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option><option value="REMOVED">Removed</option></select><button disabled={pending}>Save</button>{state.error && <small className="team-error">{state.error}</small>}</form> : <><span className="member-role">{member.role?.name ?? "No role"}</span><span className={`member-status ${member.status.toLowerCase()}`}>{member.status.toLowerCase()}</span></>}
    {!member.is_primary_owner && <button className="member-edit" onClick={() => setEditing(!editing)}>{editing ? "Cancel" : "Edit"}</button>}
  </article>;
}

function InviteDialog({ roles, close }: { roles: Role[]; close: () => void }) {
  const [state, action, pending] = useActionState(inviteMemberAction, initial);
  return <Modal title="Invite workspace member" close={close}><form action={action} className="team-form"><label>Email<input name="email" type="email" required autoFocus placeholder="editor@studio.com" /></label><label>Role<select name="role_id" required>{roles.filter((role) => role.status === "ACTIVE").map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label><label>Project access<select name="project_access_mode"><option value="ALL">All projects</option><option value="SELECTED">Selected projects only</option></select></label><Feedback state={state} />{state.token && <div className="invite-token"><code>{state.token}</code><button type="button" onClick={() => navigator.clipboard.writeText(state.token!)}><Copy />Copy</button></div>}<button className="team-submit" disabled={pending}>{pending ? "Creating…" : "Create invitation"}</button></form></Modal>;
}

function RoleDialog({ roles, close }: { roles: Role[]; close: () => void }) {
  const [state, action, pending] = useActionState(createRoleAction, initial); const permissions = [...new Set(roles.flatMap((role) => role.permissions))].sort();
  return <Modal title="Create custom role" close={close}><form action={action} className="team-form"><label>Name<input name="name" required autoFocus placeholder="Senior reviewer" /></label><label>Description<input name="description" placeholder="Can review and approve client work" /></label><fieldset><legend>Permissions</legend><div className="permission-grid">{permissions.map((permission) => <label key={permission}><input type="checkbox" name="permission_keys" value={permission} />{permission}</label>)}</div></fieldset><Feedback state={state} /><button className="team-submit" disabled={pending}>{pending ? "Creating…" : "Create role"}</button></form></Modal>;
}

function Feedback({ state }: { state: TeamActionState }) { return state.error ? <p className="form-error">{state.error}</p> : state.message ? <p className="team-success">{state.message}</p> : null; }
function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) { return <div className="team-modal"><button className="team-backdrop" onClick={close} aria-label="Close" /><section><header><h2>{title}</h2><button onClick={close} aria-label="Close"><X /></button></header>{children}</section></div>; }
