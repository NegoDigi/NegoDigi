export const SETUP_LIFETIME_MS = 30 * 60 * 1000;

export function normalizeSetupEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function createSetupSecret(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createSetupReference(): string {
  const value = createSetupSecret().slice(0, 8).toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4)}`;
}

export async function hashSetupSecret(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function validSetupProof(id: unknown, secret: unknown): boolean {
  return typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
    && typeof secret === "string" && /^[0-9a-f]{64}$/.test(secret);
}

export function validSetupPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && new TextEncoder().encode(value).length <= 72;
}

