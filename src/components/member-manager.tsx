"use client";

import { useState } from "react";
import { TEAM_ROLES, USER_PERMISSIONS } from "@/lib/constants";
import type { User } from "@/lib/types";

export function MemberManager({ initialUsers }: { initialUsers: User[] }) {
  const [users, setUsers] = useState(initialUsers);
  const [message, setMessage] = useState("");

  async function createMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: String(form.get("name") ?? ""),
        loginCode: String(form.get("loginCode") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        role: String(form.get("role") ?? "产品"),
        permission: String(form.get("permission") ?? "member"),
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      setMessage(data?.error === "duplicate_record" ? "登录码或邮箱已存在。" : "创建成员失败。");
      return;
    }
    setUsers((current) => [...current, data.data.user]);
    event.currentTarget.reset();
    setMessage("成员已创建。");
  }

  return (
    <main className="shell page-enter grid gap-5 pb-14 lg:grid-cols-[0.7fr_1.3fr]">
      <form onSubmit={createMember} className="glass-panel grid content-start gap-4 rounded-[34px] p-6">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-[var(--copper)]">Members</p>
          <h1 className="mt-2 text-3xl font-black tracking-[-0.05em]">成员管理</h1>
        </div>
        <label className="field">
          <span>姓名</span>
          <input className="input" name="name" required />
        </label>
        <label className="field">
          <span>登录码</span>
          <input
            className="input uppercase"
            name="loginCode"
            required
            minLength={6}
            maxLength={6}
            pattern="[A-Za-z0-9]{6}"
            placeholder="6 位字母数字"
          />
        </label>
        <label className="field">
          <span>邮箱（可选）</span>
          <input className="input" name="email" type="email" placeholder="不填则自动生成内部邮箱" />
        </label>
        <label className="field">
          <span>初始密码</span>
          <input className="input" name="password" minLength={8} placeholder="不填则为 ChangeMe123" />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">
            <span>角色</span>
            <select className="input" name="role" defaultValue="产品">
              {TEAM_ROLES.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>权限</span>
            <select className="input" name="permission" defaultValue="member">
              {USER_PERMISSIONS.map((permission) => (
                <option key={permission}>{permission}</option>
              ))}
            </select>
          </label>
        </div>
        {message ? <p className="rounded-2xl bg-white/70 px-4 py-2 text-sm font-bold">{message}</p> : null}
        <button className="btn-primary">新增成员</button>
      </form>
      <section className="glass-panel overflow-hidden rounded-[34px]">
        <div className="border-b border-[var(--line)] p-6">
          <h2 className="text-2xl font-black tracking-[-0.04em]">团队账号</h2>
          <p className="mt-2 text-sm text-[var(--muted)]">成员管理仅管理员可操作，业务数据全员可编辑。</p>
        </div>
        <div className="overflow-auto">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead className="bg-white/40 text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
              <tr>
                <th className="px-5 py-4">姓名</th>
                <th className="px-5 py-4">登录码</th>
                <th className="px-5 py-4">邮箱</th>
                <th className="px-5 py-4">角色</th>
                <th className="px-5 py-4">权限</th>
                <th className="px-5 py-4">创建时间</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-[var(--line)]">
                  <td className="px-5 py-4 font-black">{user.name}</td>
                  <td className="px-5 py-4 font-black">{user.loginCode}</td>
                  <td className="px-5 py-4 text-[var(--muted)]">{user.email}</td>
                  <td className="px-5 py-4">{user.role}</td>
                  <td className="px-5 py-4">{user.permission}</td>
                  <td className="px-5 py-4 text-[var(--muted)]">{new Date(user.createdAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
