import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth";
import { hasUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (!(await hasUsers())) redirect("/setup");
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <main className="app-frame grid min-h-screen place-items-center px-4 py-10">
      <section className="glass-panel page-enter w-full max-w-[500px] rounded-[32px] p-8">
        <p className="mb-3 text-sm font-black uppercase tracking-[0.24em] text-[var(--copper)]">Team Sync</p>
        <h1 className="mb-3 text-4xl font-black tracking-[-0.04em]">登录项目进度后台</h1>
        <p className="mb-8 text-sm leading-7 text-[var(--muted)]">运营、产品、技术在同一个项目空间里同步需求和进展。</p>
        <AuthForm mode="login" />
      </section>
    </main>
  );
}
