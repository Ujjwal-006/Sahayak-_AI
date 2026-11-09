import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me-for-production";
const rawTtl = process.env.JWT_TTL_DAYS ?? "7d";
const JWT_TTL = /^\d+$/.test(rawTtl) ? `${rawTtl}d` : rawTtl;

export interface AuthContext {
  userId: string;
  orgId: string;
  role: string;
  email: string;
  name: string;
}

export function signToken(ctx: AuthContext): string {
  return jwt.sign(ctx, JWT_SECRET, { expiresIn: JWT_TTL as any });
}

export function verifyToken(token: string): AuthContext {
  return jwt.verify(token, JWT_SECRET) as AuthContext;
}

export async function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, 10);
}

export async function verifyPassword(p: string, hash: string): Promise<boolean> {
  return bcrypt.compare(p, hash);
}

