"use client";
/** Search, filter menus and the active-filter chips. Filters are multi-select except Due. */
import { useMemo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ChevronDown, Search, X } from "lucide-react";
import type { Task } from "@/lib/api";
import type { TasksView } from "@/lib/tasks-view";
import { activeFilterCount, DUE_OPTIONS, EMPTY_FILTERS, PRIORITIES, type DueFilter, type TaskFilters } from "@/lib/task-board";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { memberName } from "./task-dialogs";

type Option = { id: string; label: string };
type ListKey = "assignee" | "priority" | "client" | "project";

export function FilterBar({ filters, setFilters, searchRef, compact, tasks, view, clientOf }: {
  filters: TaskFilters; setFilters: Dispatch<SetStateAction<TaskFilters>>; searchRef: RefObject<HTMLInputElement | null>; compact: boolean;
  tasks: Task[]; view: TasksView; clientOf: (task: Task) => string | null;
}) {
  const options = useMemo(() => {
    const people = new Map<string, string>();
    for (const member of view.members) if (member.user) people.set(member.id, memberName(member));
    for (const task of tasks) for (const person of task.assignees) if (!people.has(person.id)) people.set(person.id, person.name);
    const assignee: Option[] = [...[...people].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)), { id: "none", label: "Unassigned" }];
    const usedClients = new Set(tasks.map(clientOf).filter(Boolean));
    const client: Option[] = view.clients.filter((item) => usedClients.has(item.id) || filters.client.includes(item.id)).map((item) => ({ id: item.id, label: item.name }));
    const project: Option[] = view.projects.filter((item) => !filters.client.length || filters.client.includes(item.client_team_id ?? "")).map((item) => ({ id: item.id, label: item.name }));
    return { assignee, client, project, priority: PRIORITIES.map((item) => ({ id: item.id, label: item.label })) };
  }, [clientOf, filters.client, tasks, view.clients, view.members, view.projects]);

  const toggle = (key: ListKey, id: string) => setFilters((current) => ({ ...current, [key]: current[key].includes(id) ? current[key].filter((value) => value !== id) : [...current[key], id] }));
  const setDue = (due: DueFilter) => setFilters((current) => ({ ...current, due: current.due === due ? "" : due }));
  const labelOf = (key: ListKey, id: string) => options[key].find((option) => option.id === id)?.label ?? "Unknown";
  const chips: { key: string; label: string; remove: () => void }[] = [
    ...(["assignee", "priority", "client", "project"] as const).flatMap((key) => filters[key].map((id) => ({ key: `${key}:${id}`, label: `${title(key)}: ${labelOf(key, id)}`, remove: () => toggle(key, id) }))),
    ...(filters.due ? [{ key: "due", label: `Due: ${DUE_OPTIONS.find((option) => option.id === filters.due)?.label}`, remove: () => setDue(filters.due) }] : []),
  ];
  const count = activeFilterCount(filters);

  return <div className="tb-filters">
    <div className="tb-filter-row">
      <label className="tb-search">
        <Search aria-hidden="true" />
        <input ref={searchRef} type="search" value={filters.q} aria-label="Search tasks" placeholder="Search tasks, projects, assignees…"
          onChange={(event) => { const q = event.target.value; setFilters((current) => ({ ...current, q })); }}
          onKeyDown={(event) => { if (event.key === "Escape") { if (filters.q) setFilters((current) => ({ ...current, q: "" })); else event.currentTarget.blur(); } }} />
        <kbd aria-hidden="true">/</kbd>
      </label>
      <FilterMenu label="Assignee" options={options.assignee} selected={filters.assignee} onToggle={(id) => toggle("assignee", id)} />
      <FilterMenu label="Priority" options={options.priority} selected={filters.priority} onToggle={(id) => toggle("priority", id)} />
      <FilterMenu label="Due" options={DUE_OPTIONS.map((option) => ({ id: option.id, label: option.label }))} selected={filters.due ? [filters.due] : []} onToggle={(id) => setDue(id as DueFilter)} />
      {!compact && options.client.length > 0 && <FilterMenu label="Client" options={options.client} selected={filters.client} onToggle={(id) => toggle("client", id)} />}
      {!compact && <FilterMenu label="Project" options={options.project} selected={filters.project} onToggle={(id) => toggle("project", id)} />}
    </div>
    {count > 0 && <div className="tb-chips" aria-label="Active filters">
      {chips.map((chip) => <span key={chip.key} className="tb-chip">{chip.label}<button type="button" aria-label={`Remove filter ${chip.label}`} onClick={chip.remove}><X aria-hidden="true" /></button></span>)}
      <button type="button" className="tb-button is-ghost is-sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear</button>
    </div>}
  </div>;
}

function FilterMenu({ label, options, selected, onToggle }: { label: string; options: Option[]; selected: string[]; onToggle: (id: string) => void }) {
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" className={`tb-filter ${selected.length ? "is-active" : ""}`} aria-label={`Filter by ${label.toLowerCase()}${selected.length ? `, ${selected.length} selected` : ""}`}>
        {label}{selected.length > 0 && <span className="tb-filter-count" aria-hidden="true">{selected.length}</span>}<ChevronDown aria-hidden="true" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" className="tb-menu">
      {options.length ? options.map((option) => <DropdownMenuCheckboxItem key={option.id} checked={selected.includes(option.id)} onSelect={(event) => event.preventDefault()} onCheckedChange={() => onToggle(option.id)}>{option.label}</DropdownMenuCheckboxItem>)
        : <p className="tb-menu-empty">Nothing to filter by</p>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

const title = (key: string) => key[0].toUpperCase() + key.slice(1);
