import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { ProjectWorkspace } from "@/components/project-workspace";
import { getCurrentUser } from "@/lib/auth";
import { getProjectById, listRequirements, listUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ projectId: string }>;
};

export default async function ProjectDetailPage({ params }: PageProps) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { projectId } = await params;
  const project = getProjectById(projectId);
  if (!project) notFound();

  return (
    <div className="app-frame">
      <AppHeader user={user} />
      <ProjectWorkspace
        project={project}
        initialRequirements={listRequirements(project.id)}
        users={listUsers()}
      />
    </div>
  );
}
