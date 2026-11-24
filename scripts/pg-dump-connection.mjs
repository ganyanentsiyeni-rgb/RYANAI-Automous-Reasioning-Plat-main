/**
 * Translate a PostgreSQL URL into libpq environment variables for pg_dump.
 * Keep credentials out of argv and error messages.
 */
export function buildPgDumpEnvironment(connectionString, baseEnvironment = process.env) {
  let database;
  try {
    database = new URL(connectionString || "");
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname) {
      throw new Error("Invalid PostgreSQL connection URL");
    }
    if (!database.pathname || database.pathname === "/") {
      throw new Error("PostgreSQL database name is missing");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL; credentials are not logged.");
  }

  let databaseName;
  let username;
  let password;
  try {
    databaseName = decodeURIComponent(database.pathname.slice(1));
    username = decodeURIComponent(database.username);
    password = decodeURIComponent(database.password);
  } catch {
    throw new Error("DATABASE_URL contains invalid URL encoding; credentials are not logged.");
  }
  if (!databaseName) {
    throw new Error("PostgreSQL database name is missing.");
  }

  const query = database.searchParams;
  const env = { ...baseEnvironment };
  env.PGHOST = database.hostname.replace(/^\[|\]$/g, "");
  env.PGPORT = database.port || "5432";
  env.PGDATABASE = databaseName;
  if (username) env.PGUSER = username;
  if (password) env.PGPASSWORD = password;

  const mappings = [
    ["sslmode", "PGSSLMODE"],
    ["sslrootcert", "PGSSLROOTCERT"],
    ["sslcert", "PGSSLCERT"],
    ["sslkey", "PGSSLKEY"],
    ["application_name", "PGAPPNAME"],
    ["connect_timeout", "PGCONNECT_TIMEOUT"],
    ["options", "PGOPTIONS"],
  ];
  for (const [source, target] of mappings) {
    if (query.has(source)) env[target] = query.get(source);
  }
  return env;
}
