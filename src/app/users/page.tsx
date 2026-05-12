import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { MemberManager } from "@/components/member-manager";
import { getCurrentUser } from "@/lib/auth";
import { listUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.permission !== "admin") redirect("/");

  return (
    <div className="app-frame">
      <AppHeader user={user} />
      <MemberManager initialUsers={await listUsers()} />
    </div>
  );
}
