"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/paths";

type AuthFormProps = {
  mode: "setup" | "login";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    const form = new FormData(event.currentTarget);
    const payload =
      mode === "setup"
        ? {
            name: String(form.get("name") ?? ""),
            email: String(form.get("email") ?? ""),
            password: String(form.get("password") ?? ""),
          }
        : {
            loginCode: String(form.get("loginCode") ?? ""),
            password: String(form.get("password") ?? ""),
          };

    const response = await fetch(apiPath(mode === "setup" ? "/api/setup" : "/api/auth/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null);
      setError(data?.error === "invalid_credentials" ? "登录码或密码不正确。" : "提交失败，请检查输入。");
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {mode === "setup" ? (
        <label className="field">
          <span>管理员姓名</span>
          <input className="input" name="name" required placeholder="例如：项目负责人" />
        </label>
      ) : null}
      {mode === "setup" ? (
        <label className="field">
          <span>邮箱</span>
          <input className="input" name="email" type="email" required placeholder="name@team.com" />
        </label>
      ) : (
        <label className="field">
          <span>登录码</span>
          <input
            className="input uppercase"
            name="loginCode"
            required
            maxLength={6}
            minLength={6}
            pattern="[A-Za-z0-9]{6}"
            placeholder="6 位字母数字"
          />
        </label>
      )}
      <label className="field">
        <span>密码</span>
        <input
          className="input"
          name="password"
          type="password"
          required
          minLength={mode === "setup" ? 8 : 1}
          placeholder={mode === "setup" ? "至少 8 位" : "输入密码"}
        />
      </label>
      {error ? <p className="rounded-2xl bg-red-100 px-4 py-3 text-sm font-semibold text-red-800">{error}</p> : null}
      <button className="btn-primary w-full" disabled={loading}>
        {loading ? "提交中..." : mode === "setup" ? "创建管理员并进入后台" : "登录后台"}
      </button>
    </form>
  );
}
