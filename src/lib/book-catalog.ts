export const BOOK_CATALOG = [
  {
    name: "亲子关系全面技巧",
    ownerName: "陈路",
  },
] as const;

export function normalizeBookName(bookName: string | null | undefined) {
  return (bookName ?? "").trim();
}

export function resolveBookOwnerName(bookName: string | null | undefined) {
  const normalized = normalizeBookName(bookName);
  if (!normalized) return "";
  return BOOK_CATALOG.find((item) => item.name === normalized)?.ownerName ?? "";
}
