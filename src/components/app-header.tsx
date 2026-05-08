"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { User } from "@/lib/types";

export function AppHeader({ user }: { user: User }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="shell flex items-center justify-between py-5">
      <Link href="/projects" className="group flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-[#1d1d1f] text-sm font-semibold text-white shadow-[0_12px_30px_rgba(29,29,31,0.16)]">
          T
        </span>
        <span>
          <span className="block text-base font-semibold tracking-[-0.02em]">团队项目进度后台</span>
          <span className="block text-xs font-medium text-[var(--muted)]">运营 · 产品 · 技术同步台账</span>
        </span>
      </Link>
      <nav className="flex items-center gap-2">
        <Link href="/projects" className="btn-secondary hidden sm:inline-flex">
          项目
        </Link>
        {user.permission === "admin" ? (
          <Link href="/users" className="btn-secondary hidden sm:inline-flex">
            成员
          </Link>
        ) : null}
        <span className="hidden rounded-full border border-[var(--line)] bg-white/50 px-3 py-2 text-sm font-bold text-[var(--muted)] md:inline-flex">
          {user.name} · {user.role}
        </span>
        <button onClick={logout} className="btn-secondary">
          退出
        </button>
      </nav>
    </header>
  );
}
