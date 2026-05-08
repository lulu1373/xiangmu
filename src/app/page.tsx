import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { hasUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!hasUsers()) redirect("/setup");
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  redirect("/projects");
}
