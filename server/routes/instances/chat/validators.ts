export function isValidUUID(val: any): boolean {
  if (typeof val !== "string") return false;
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(val);
}

export function isValidInstanceId(val: any): boolean {
  if (typeof val !== "string") return false;
  return /^[A-Za-z0-9-]{1,128}$/.test(val);
}