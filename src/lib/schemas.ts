import { z } from "zod";
import {
  PROJECT_RISK_LEVELS,
  PROJECT_SUMMARY_STATUSES,
  PROJECT_TRACKS,
  PROJECT_TYPES,
  REQUIREMENT_PRIORITIES,
  REQUIREMENT_STATUSES,
  REQUIREMENT_TYPES,
  TEAM_ROLES,
  USER_PERMISSIONS,
} from "@/lib/constants";

const loginCodeSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9]{6}$/)
  .transform((value) => value.toUpperCase());

const optionalEmailSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().email().max(120).transform((value) => value.toLowerCase()).optional(),
);

const optionalDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .or(z.literal(""))
  .nullable()
  .optional()
  .transform((value) => (value ? value : null));

const optionalNumber = z
  .number()
  .finite()
  .min(0)
  .max(100000)
  .nullable()
  .optional()
  .or(
    z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : Number(value)))
      .pipe(z.number().finite().min(0).max(100000).nullable()),
  );

const projectTrackSummarySchema = z.object({
  progress: optionalNumber.transform((value) => (typeof value === "number" ? Math.round(value) : null)),
  summary: z.string().trim().max(1000).optional().default(""),
  completed: z.string().trim().max(2000).optional().default(""),
  pending: z.string().trim().max(2000).optional().default(""),
});

const projectTrackShape = Object.fromEntries(
  PROJECT_TRACKS.map((track) => [track, projectTrackSummarySchema]),
);

export const setupSchema = z.object({
  name: z.string().trim().min(1).max(60),
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(120),
});

export const loginSchema = z.object({
  loginCode: loginCodeSchema.optional(),
  email: z.string().trim().email().max(120).transform((value) => value.toLowerCase()).optional(),
  password: z.string().min(1).max(120),
}).refine((value) => value.loginCode || value.email);

export const userInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  loginCode: loginCodeSchema,
  email: optionalEmailSchema,
  password: z.string().min(8).max(120).optional().or(z.literal("")),
  role: z.enum(TEAM_ROLES),
  permission: z.enum(USER_PERMISSIONS).default("member"),
});

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  projectType: z.enum(PROJECT_TYPES).or(z.literal("")).optional().default(""),
  description: z.string().trim().max(1000).optional().default(""),
  status: z.enum(["active", "archived"]).default("active"),
  summaryStatus: z.enum(PROJECT_SUMMARY_STATUSES).default("进行中"),
  ownerId: z.string().trim().nullable().optional(),
  priority: z.enum(REQUIREMENT_PRIORITIES).default("中"),
  startDate: optionalDate,
  targetDate: optionalDate,
  completedDate: optionalDate,
  overallProgress: optionalNumber.transform((value) => (typeof value === "number" ? Math.round(value) : null)),
  department: z.string().trim().max(80).optional().default(""),
  budget: optionalNumber,
  actualSpend: optionalNumber,
  riskLevel: z.enum(PROJECT_RISK_LEVELS).default("中"),
  milestone: z.string().trim().max(1000).optional().default(""),
  documentLink: z.string().trim().max(1000).optional().default(""),
  note: z.string().trim().max(2000).optional().default(""),
  trackSummaries: z.object(projectTrackShape).partial().optional(),
});

export const requirementInputSchema = z.object({
  code: z.string().trim().max(40).optional().nullable(),
  title: z.string().trim().min(1).max(140),
  bookName: z.string().trim().max(80).optional().default(""),
  type: z.enum(REQUIREMENT_TYPES).default("需求"),
  background: z.string().trim().max(3000).optional().default(""),
  source: z.string().trim().max(200).optional().default(""),
  acceptanceCriteria: z.string().trim().max(3000).optional().default(""),
  version: z.string().trim().max(40).optional().default(""),
  ownerId: z.string().trim().min(1).max(80),
  participantRoles: z.array(z.enum(TEAM_ROLES)).min(1).max(3),
  priority: z.enum(REQUIREMENT_PRIORITIES).default("中"),
  status: z.enum(REQUIREMENT_STATUSES).default("待开始"),
  startDate: optionalDate,
  dueDate: optionalDate,
  estimatedHours: optionalNumber,
  actualHours: optionalNumber,
  latestProgress: z.string().trim().max(2000).optional().default(""),
  nextStep: z.string().trim().max(2000).optional().default(""),
  blocker: z.string().trim().max(2000).optional().default(""),
});

export const progressInputSchema = z.object({
  progress: z.string().trim().max(2000).optional().default(""),
  nextStep: z.string().trim().max(2000).optional().default(""),
  blocker: z.string().trim().max(2000).optional().default(""),
  status: z.enum(REQUIREMENT_STATUSES).optional(),
}).refine((input) => input.progress || input.nextStep || input.blocker, {
  message: "至少填写一项任务更新",
});

export const statusInputSchema = z.object({
  status: z.enum(REQUIREMENT_STATUSES),
});

export const listQuerySchema = z.object({
  status: z.enum(REQUIREMENT_STATUSES).optional(),
  ownerId: z.string().trim().optional(),
  role: z.enum(TEAM_ROLES).optional(),
  bookName: z.string().trim().optional(),
  search: z.string().trim().max(120).optional(),
});
