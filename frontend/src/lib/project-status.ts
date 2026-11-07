/** Project statuses people can pick (ARCHIVED has its own action; PENDING_DELETION is internal). */
export const PROJECT_STATUSES = ["DRAFT", "ACTIVE", "ON_HOLD", "COMPLETED"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number] | "ARCHIVED";

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", ACTIVE: "Active", ON_HOLD: "On hold", COMPLETED: "Completed", ARCHIVED: "Archived", PENDING_DELETION: "Deleting",
};

export const isProjectStatus = (value: string): value is (typeof PROJECT_STATUSES)[number] =>
  (PROJECT_STATUSES as readonly string[]).includes(value);

export const statusLabel = (value: string | null | undefined) => (value ? STATUS_LABEL[value] ?? value : "Draft");
