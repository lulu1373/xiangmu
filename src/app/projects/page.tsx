import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProjectDashboard } from "@/components/project-dashboard";
import { getCurrentUser } from "@/lib/auth";
import { hasUsers, listProjects, listUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  if (!hasUsers()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="app-frame">
      <AppHeader user={user} />
      <ProjectDashboard initialProjects={listProjects()} users={listUsers()} />
    </div>
  );
}
