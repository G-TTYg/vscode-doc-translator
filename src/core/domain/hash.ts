import { createHash } from "node:crypto";

export function sha256Hex(input: Buffer | string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function hashPrefix(hash: string, length = 8): string {
  return hash.slice(0, length);
}
