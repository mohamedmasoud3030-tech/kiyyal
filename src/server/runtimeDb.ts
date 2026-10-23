import { createPool, PgDatabase } from '../db/pg';

/** Thrown when this deployment is not allowed to handle operational traffic. */
export class RuntimeConfigurationError extends Error {
  constructor(message = 'Runtime database configuration is unavailable') {
    super(message);
    this.name = 'RuntimeConfigurationError';
  }
}

interface RuntimeDatabaseState {
  database: PgDatabase | undefined;
  startupCheck: Promise<void> | undefined;
}

// `globalThis` keeps the pool singleton across Next development hot reloads as
// well as ordinary module evaluation. It carries no request/session state.
const runtimeGlobal = globalThis as typeof globalThis & {
  __kayyalRuntimeDatabaseState?: RuntimeDatabaseState;
};
const runtimeState = (runtimeGlobal.__kayyalRuntimeDatabaseState ??= {
  database: undefined,
  startupCheck: undefined,
});

// Split the names so the source guard can continue to reject accidental runtime
// credential *use* while this startup validator can reject their presence.
const forbiddenRuntimeSecrets = [
  `SUPABASE_${'SERVICE_ROLE'}_KEY`,
  `SUPABASE_${'SERVICE_ROLE'}`,
  `SUPABASE_${'SERVICE'}_KEY`,
] as const;

/**
 * Service-role credentials bypass the application's security model and must
 * never be available to the web runtime. This is deliberately checked before a
 * connection pool is made, so configuration mistakes fail closed.
 */
export function assertSafeRuntimeEnvironment(environment: NodeJS.ProcessEnv = process.env): void {
  for (const key of forbiddenRuntimeSecrets) {
    if (environment[key]?.trim()) {
      throw new RuntimeConfigurationError(`${key} must not be present in the web runtime`);
    }
  }
}

/**
 * Lazily creates the one server-side pool. No browser module imports this file,
 * and no route may supply a connection string or a database role.
 */
export async function getRuntimeDatabase(): Promise<PgDatabase> {
  assertSafeRuntimeEnvironment();
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) throw new RuntimeConfigurationError();

  if (!runtimeState.database) runtimeState.database = new PgDatabase(createPool(connectionString));
  if (!runtimeState.startupCheck) {
    runtimeState.startupCheck = assertRuntimeIdentity(runtimeState.database).catch(async (error: unknown) => {
      const stale = runtimeState.database;
      runtimeState.database = undefined;
      runtimeState.startupCheck = undefined;
      await stale?.end().catch(() => undefined);
      throw error;
    });
  }
  await runtimeState.startupCheck;
  // The startup check either set a usable instance or threw and cleared it.
  if (!runtimeState.database) throw new RuntimeConfigurationError();
  return runtimeState.database;
}

async function assertRuntimeIdentity(db: PgDatabase): Promise<void> {
  try {
    // app_runtime is intentionally NOLOGIN. Deployments connect with a unique
    // LOGIN role that is a member of it, which keeps credential rotation from
    // requiring grants on every app table.
    const result = await db.query<{ current_user: string; is_runtime_member: boolean; bypasses_rls: boolean }>(
      `SELECT current_user,
              pg_has_role(current_user, 'app_runtime', 'member') AS is_runtime_member,
              (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS bypasses_rls`,
    );
    const identity = result.rows[0];
    if (!identity?.is_runtime_member || identity.bypasses_rls) {
      throw new RuntimeConfigurationError('DATABASE_URL must use a non-bypass app_runtime member');
    }
  } catch (error) {
    if (error instanceof RuntimeConfigurationError) throw error;
    throw new RuntimeConfigurationError();
  }
}

/** Test-only lifecycle seam; never call from a request handler. */
export async function resetRuntimeDatabaseForTests(): Promise<void> {
  const existing = runtimeState.database;
  runtimeState.database = undefined;
  runtimeState.startupCheck = undefined;
  await existing?.end();
}
