import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { hasUsers } from "@/lib/repository";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await hasUsers()) redirect("/login");

  return (
    <main className="app-frame grid min-h-screen place-items-center px-4 py-10">
      <section className="glass-panel page-enter w-full max-w-[520px] rounded-[32px] p-8">
        <p className="mb-3 text-sm font-black uppercase tracking-[0.24em] text-[var(--copper)]">First Run</p>
        <h1 className="mb-3 text-4xl font-black tracking-[-0.04em]">初始化团队进度后台</h1>
        <p className="mb-8 text-sm leading-7 text-[var(--muted)]">
          创建第一个管理员后，系统会自动生成五个默认项目：书包测评、销转课、流量测评、刻意练习、亲智聊。
        </p>
        <AuthForm mode="setup" />
      </section>
    </main>
  );
}
