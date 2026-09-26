export function isStrictMmDdYy(value) {
  if (typeof value !== "string") return false;
  const match = /^(0[1-9]|1[0-2])([/-])(0[1-9]|[12]\d|3[01])\2(\d{2})$/.exec(value.trim());
  if (!match) return false;

  const month = Number(match[1]);
  const day = Number(match[3]);
  const year = 2000 + Number(match[4]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function hasValue(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isNA(value) {
  return typeof value === "string" && /^n\s*\/?\s*a$/i.test(value.trim());
}
