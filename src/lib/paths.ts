export const APP_BASE_PATH = "/projects";

export function apiPath(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE_PATH}${normalized}`;
}
