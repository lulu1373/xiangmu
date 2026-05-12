import { render, screen } from "@testing-library/react";
import { ProjectWorkspace } from "@/components/project-workspace";
import type { Project, Requirement, User } from "@/lib/types";

const replace = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/project-1",
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(),
}));

const baseUsers: User[] = [
  {
    id: "user-1",
    name: "梦培",
    email: "",
    loginCode: "MENG01",
    role: "产品",
    permission: "admin",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
  },
];

const baseRequirement: Requirement = {
  id: "req-1",
  projectId: "project-1",
  code: "REQ-0001",
  title: "导师入驻与核心功能优化",
  bookName: "",
  type: "需求",
  background: "",
  source: "",
  acceptanceCriteria: "",
  version: "v1",
  ownerId: "user-1",
  ownerName: "梦培",
  participantRoles: ["产品"],
  priority: "中",
  status: "进行中",
  startDate: null,
  dueDate: null,
  estimatedHours: null,
  actualHours: null,
  latestProgress: "已完成核心流程梳理",
  nextStep: "继续推进",
  blocker: "",
  createdBy: "user-1",
  updatedBy: "user-1",
  createdAt: "2026-05-08T00:00:00.000Z",
  updatedAt: "2026-05-08T00:00:00.000Z",
};

function makeProject(overrides: Partial<Project>): Project {
  return {
    id: "project-1",
    name: "亲智聊项目",
    projectType: "AI教育类",
    description: "",
    status: "active",
    summaryStatus: "进行中",
    ownerId: "user-1",
    ownerName: "梦培",
    priority: "中",
    startDate: null,
    targetDate: null,
    completedDate: null,
    overallProgress: 0,
    department: "",
    budget: null,
    actualSpend: null,
    riskLevel: "中",
    milestone: "",
    documentLink: "",
    note: "",
    trackSummaries: {
      研发: { progress: 0, summary: "", completed: "", pending: "" },
      产品: { progress: 0, summary: "", completed: "", pending: "" },
      技术: { progress: 0, summary: "", completed: "", pending: "" },
      运营: { progress: 0, summary: "", completed: "", pending: "" },
    },
    createdBy: "user-1",
    createdAt: "2026-05-08T00:00:00.000Z",
    updatedAt: "2026-05-08T00:00:00.000Z",
    requirementCount: 1,
    blockedCount: 0,
    doneCount: 0,
    ...overrides,
  };
}

function renderWorkspace(project: Project, requirement: Requirement) {
  return render(
    <ProjectWorkspace project={project} initialRequirements={[requirement]} users={baseUsers} />,
  );
}

describe("ProjectWorkspace", () => {
  beforeEach(() => {
    replace.mockReset();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: { progressUpdates: [] } }),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the task workspace directly for non-book projects", async () => {
    renderWorkspace(
      makeProject({}),
      baseRequirement,
    );

    expect(screen.getByText("亲智聊项目")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /表格/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /看板/ })).toBeInTheDocument();
    expect(screen.getAllByText("导师入驻与核心功能优化").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox", { name: "已完成" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox", { name: "待完成" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox", { name: "预期时间" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("textbox", { name: "卡点" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "本次进展" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "阻塞问题" })).not.toBeInTheDocument();
    expect(await screen.findByText("暂无进度记录。")).toBeInTheDocument();
    expect(screen.queryByText("未归书籍的内容")).not.toBeInTheDocument();
  }, 15000);

  it("keeps the book overview for the book-assessment project", () => {
    renderWorkspace(
      makeProject({
        id: "project-2",
        name: "书包测评项目",
        projectType: "测评类",
      }),
      {
        ...baseRequirement,
        projectId: "project-2",
        title: "亲子关系全面技巧测评内容反馈与定稿",
        bookName: "亲子关系全面技巧",
      },
    );

    expect(screen.getByText("亲子关系全面技巧")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /表格/ })).not.toBeInTheDocument();
  });
});
