import type {
  runs,
  tasks,
  attempts,
  approvals,
  artifacts,
  events,
  workspaces,
  connections,
  settings,
} from "@orbit/database/schema";
export type RunRow = typeof runs.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type AttemptRow = typeof attempts.$inferSelect;
export type ApprovalRow = typeof approvals.$inferSelect;
export type ArtifactRow = typeof artifacts.$inferSelect;
export type EventRow = typeof events.$inferSelect;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type SettingsRow = typeof settings.$inferSelect;
export type FileRow = Pick<
  ArtifactRow,
  | "id"
  | "name"
  | "kind"
  | "version"
  | "sha256"
  | "size_bytes"
  | "created_at"
  | "mode"
  | "task_id"
  | "source_ids"
>;
export type Detail = {
  run: RunRow;
  tasks: TaskRow[];
  dependencies: { task_id: string; depends_on_id: string }[];
  attempts: AttemptRow[];
  approvals: ApprovalRow[];
  artifacts: FileRow[];
  logs: EventRow[];
};
export type Bootstrap = {
  workspaces: WorkspaceRow[];
  runs: RunRow[];
  connections: ConnectionRow[];
  settings: SettingsRow;
  stats: { completed_tasks: number; waiting_approvals: number };
  activity: EventRow[];
};
