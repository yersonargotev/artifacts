import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { canonicalResource } from '@yargote/artifacts-contracts/http';

const registrationSchema = z.strictObject({ issuer: z.string(), clientId: z.string().min(1) });
const tokensSchema = z.strictObject({ accessToken: z.string().min(1), refreshToken: z.string().min(1).optional(), expiresAt: z.number().finite() });
const profileSchema = z.strictObject({
  epoch: z.number().int().nonnegative(),
  registration: registrationSchema.nullable(),
  tokens: tokensSchema.nullable(),
  refreshAttempt: z.string().nullable(),
});
export type Registration = z.infer<typeof registrationSchema>;
export type Tokens = z.infer<typeof tokensSchema>;
export type CredentialProfile = z.infer<typeof profileSchema>;

async function privateFile(path: string) {
  const file = await open(path, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Credential storage must be a private file owned by the current user');
    await file.chmod(0o600);
  } finally { await file.close(); }
}

export class CredentialStore {
  private constructor(private readonly data: DatabaseSync, private readonly lock: DatabaseSync) {}

  static async open(stateDir: string): Promise<CredentialStore> {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    const directory = await lstat(stateDir);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (process.getuid && directory.uid !== process.getuid())) throw new Error('Credential storage must be a private directory owned by the current user');
    await chmod(stateDir, 0o700);
    const dataPath = join(stateDir, 'credentials.sqlite');
    const lockPath = join(stateDir, 'credentials-lock.sqlite');
    await privateFile(dataPath);
    await privateFile(lockPath);
    const lock = new DatabaseSync(lockPath);
    let data: DatabaseSync | undefined;
    try {
      data = new DatabaseSync(dataPath);
      lock.exec('PRAGMA busy_timeout = 0;');
      const store = new CredentialStore(data, lock);
      await store.exclusive(() => {
        data!.exec('PRAGMA busy_timeout = 0; PRAGMA synchronous = FULL; PRAGMA secure_delete = ON;');
        data!.exec('CREATE TABLE IF NOT EXISTS profiles (resource TEXT PRIMARY KEY, profile TEXT NOT NULL) STRICT');
        data!.exec('CREATE TABLE IF NOT EXISTS selected_resource (id INTEGER PRIMARY KEY CHECK (id = 1), resource TEXT NOT NULL) STRICT');
      });
      return store;
    } catch (error) {
      data?.close();
      lock.close();
      throw error;
    }
  }

  async exclusive<T>(work: () => T | Promise<T>): Promise<T> {
    const deadline = Date.now() + 45_000;
    for (;;) {
      try { this.lock.exec('BEGIN IMMEDIATE'); break; }
      catch (error) {
        if (!(error instanceof Error) || !('errcode' in error) || (error.errcode !== 5 && error.errcode !== 6)) throw error;
        if (Date.now() >= deadline) throw new Error('Credential storage is busy. Try the command again');
        await delay(25);
      }
    }
    try { return await work(); }
    finally { this.lock.exec('ROLLBACK'); }
  }

  read(resource: string): CredentialProfile {
    const row = this.data.prepare('SELECT profile FROM profiles WHERE resource = ?').get(resource);
    if (!row) return { epoch: 0, registration: null, tokens: null, refreshAttempt: null };
    return profileSchema.parse(JSON.parse(String(row.profile)));
  }

  write(resource: string, profile: CredentialProfile): void {
    this.data.prepare('INSERT INTO profiles(resource, profile) VALUES (?, ?) ON CONFLICT(resource) DO UPDATE SET profile = excluded.profile').run(resource, JSON.stringify(profileSchema.parse(profile)));
  }

  readSelectedResource(): string | undefined {
    const row = this.data.prepare('SELECT resource FROM selected_resource WHERE id = 1').get();
    return row ? canonicalResource(String(row.resource)) : undefined;
  }

  commitLogin(resource: string, epoch: number, tokens: Tokens): void {
    canonicalResource(resource);
    this.data.exec('BEGIN IMMEDIATE');
    try {
      const profile = this.read(resource);
      if (profile.epoch !== epoch) throw new Error('Login was superseded by another login or logout');
      this.write(resource, { ...profile, tokens, refreshAttempt: null });
      this.data.prepare('INSERT INTO selected_resource(id, resource) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET resource = excluded.resource').run(resource);
      this.data.exec('COMMIT');
    } catch (error) {
      this.data.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void { this.data.close(); this.lock.close(); }
}
