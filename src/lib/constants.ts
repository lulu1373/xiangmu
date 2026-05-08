export const TEAM_ROLES = ["运营", "产品", "技术"] as const;
export const USER_PERMISSIONS = ["admin", "member"] as const;
export const REQUIREMENT_STATUSES = ["待开始", "进行中", "阻塞", "待验收", "已完成"] as const;
export const REQUIREMENT_PRIORITIES = ["低", "中", "高", "紧急"] as const;
export const REQUIREMENT_TYPES = ["需求", "任务", "缺陷", "优化"] as const;
export const PROJECT_TRACKS = ["研发", "产品", "技术", "运营"] as const;
export const PROJECT_RISK_LEVELS = ["低", "中", "高", "紧急"] as const;
export const PROJECT_TYPES = ["测评类", "销售转化类", "增长运营类", "AI教育类", "书籍编辑运营类", "其他"] as const;
export const PROJECT_SUMMARY_STATUSES = ["规划中", "进行中", "待验收", "已完成", "暂停"] as const;

export const DEFAULT_PROJECTS = [
  "书包测评项目",
  "销转课项目",
  "流量测评项目",
  "刻意练习项目",
  "亲智聊项目",
  "《最好的孩子在我家》书籍编辑运营项目",
] as const;

export const BOOK_GROUPED_PROJECTS = ["书包测评项目"] as const;

export const IMPORT_HEADERS = [
  "编号",
  "标题",
  "所属书籍",
  "类型",
  "背景",
  "来源",
  "验收标准",
  "版本",
  "负责人",
  "参与角色",
  "优先级",
  "状态",
  "开始日期",
  "截止日期",
  "预估工时",
  "实际工时",
  "最近进展",
  "下一步",
  "阻塞问题",
] as const;

export type TeamRole = (typeof TEAM_ROLES)[number];
export type UserPermission = (typeof USER_PERMISSIONS)[number];
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type RequirementType = (typeof REQUIREMENT_TYPES)[number];
export type ProjectTrack = (typeof PROJECT_TRACKS)[number];
export type ProjectRiskLevel = (typeof PROJECT_RISK_LEVELS)[number];
export type ProjectType = (typeof PROJECT_TYPES)[number];
export type ProjectSummaryStatus = (typeof PROJECT_SUMMARY_STATUSES)[number];

export const STATUS_TONE: Record<RequirementStatus, string> = {
  待开始: "slate",
  进行中: "blue",
  阻塞: "red",
  待验收: "amber",
  已完成: "green",
};
