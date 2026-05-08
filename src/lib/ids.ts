import { randomUUID } from "node:crypto";

export function newId(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export function nowIso() {
  return new Date().toISOString();
}
