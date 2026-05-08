import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  createSession,
  deleteSession,
  getUserBySessionToken,
  publicUser,
  verifyPassword,
} from "@/lib/repository";
import type { User } from "@/lib/types";

export const SESSION_COOKIE = "team_progress_session";

export async function getCurrentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const user = getUserBySessionToken(token);
  return user ? publicUser(user) : null;
}

export async function requireCurrentUser() {
  const user = await getCurrentUser();
  if (!user) throw new Error("unauthorized");
  return user;
}

export async function requireAdminUser() {
  const user = await requireCurrentUser();
  if (user.permission !== "admin") throw new Error("forbidden");
  return user;
}

export async function createLoginResponse(userId: string) {
  const session = createSession(userId);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(session.expiresAt),
  });
  return response;
}

export async function clearSessionResponse() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function isPasswordValid(password: string, passwordHash: string) {
  return verifyPassword(password, passwordHash);
}

export function jsonUnauthorized() {
  return NextResponse.json({ success: false, error: "unauthorized" }, { status: 401 });
}

export function jsonForbidden() {
  return NextResponse.json({ success: false, error: "forbidden" }, { status: 403 });
}
