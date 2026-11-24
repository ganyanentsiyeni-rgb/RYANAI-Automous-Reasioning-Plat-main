import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PrismaClient } from '@prisma/client';
import { resolveConnectionUrls } from '../server/startupConfig.js';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const nodeEnv = process.env.NODE_ENV || 'development';
const { databaseUrl } = resolveConnectionUrls(
  nodeEnv,
  process.env.DATABASE_URL,
  process.env.REDIS_URL,
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SESSION_POOLER_HOST,
  process.env.SUPABASE_SSL_ROOT_CERT_PATH,
  process.env.RYANAI_LOCAL_COMPOSE === 'true',
  process.env.RYANAI_DISPOSABLE_SUPABASE === '1',
);

export const db = globalForPrisma.prisma ?? new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

const DB_PATH = path.resolve(process.cwd(), 'data');
const USERS_FILE = path.join(DB_PATH, 'users.json');

// Ensure database directory and storage file exist
if (!fs.existsSync(DB_PATH)) {
  fs.mkdirSync(DB_PATH, { recursive: true });
}

if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
}

export interface UserRecord {
  id: string;
  fullName?: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export function getUsers(): UserRecord[] {
  try {
    if (!fs.existsSync(USERS_FILE)) return [];
    const data = fs.readFileSync(USERS_FILE, 'utf-8');
    return JSON.parse(data) as UserRecord[];
  } catch (error) {
    console.error('Failed to read users file:', error);
    return [];
  }
}

export function saveUser(user: UserRecord): void {
  const users = getUsers();
  users.push(user);
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}