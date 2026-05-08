import type {
  ProjectRiskLevel,
  ProjectSummaryStatus,
  ProjectTrack,
  ProjectType,
  RequirementPriority,
  RequirementStatus,
  RequirementType,
  TeamRole,
  UserPermission,
} from "@/lib/constants";

export type ProjectTrackSummary = {
  progress: number;
  summary: string;
  completed: string;
  pending: string;
};

export type User = {
  id: string;
  name: string;
  email: string;
  loginCode: string;
  role: TeamRole;
  permission: UserPermission;
  createdAt: string;
  updatedAt: string;
};

export type UserWithPassword = User & {
  passwordHash: string;
};

export type Project = {
  id: string;
  name: string;
  projectType: ProjectType | "";
  description: string;
  status: "active" | "archived";
  summaryStatus: ProjectSummaryStatus;
  ownerId: string | null;
  ownerName?: string | null;
  priority: RequirementPriority;
  startDate: string | null;
  targetDate: string | null;
  completedDate: string | null;
  overallProgress: number;
  department: string;
  budget: number | null;
  actualSpend: number | null;
  riskLevel: ProjectRiskLevel;
  milestone: string;
  documentLink: string;
  note: string;
  trackSummaries: Record<ProjectTrack, ProjectTrackSummary>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  requirementCount?: number;
  blockedCount?: number;
  doneCount?: number;
};

export type Requirement = {
  id: string;
  projectId: string;
  code: string;
  title: string;
  bookName: string;
  type: RequirementType;
  background: string;
  source: string;
  acceptanceCriteria: string;
  version: string;
  ownerId: string;
  ownerName: string;
  participantRoles: TeamRole[];
  priority: RequirementPriority;
  status: RequirementStatus;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  latestProgress: string;
  nextStep: string;
  blocker: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
};

export type ProgressUpdate = {
  id: string;
  requirementId: string;
  userId: string;
  userName: string;
  progress: string;
  nextStep: string;
  blocker: string;
  previousStatus: RequirementStatus;
  newStatus: RequirementStatus;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
  createdAt: string;
};

export type ImportErrorDetail = {
  row: number;
  field: string;
  message: string;
};

export type ImportPreviewRow = {
  code: string;
  title: string;
  bookName: string;
  type: string;
  background: string;
  source: string;
  acceptanceCriteria: string;
  version: string;
  ownerName: string;
  participantRoles: TeamRole[];
  priority: string;
  status: string;
  startDate: string | null;
  dueDate: string | null;
  estimatedHours: number | null;
  actualHours: number | null;
  latestProgress: string;
  nextStep: string;
  blocker: string;
};

export type ImportResult = {
  success: boolean;
  created: number;
  updated: number;
  errors: ImportErrorDetail[];
};
