import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Survive transient database drops: a terminated/dropped *idle* connection
// emits an `error` event on the pool. With no listener attached, Node treats
// it as an unhandled 'error' and crashes the whole process (this took the
// published app down with a 502 crash loop when the platform recycled a
// backend: "terminating connection due to administrator command"). Log the
// event loudly and let the pool discard the bad connection — subsequent
// queries transparently get a fresh one.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error(
    "[db-pool] idle client error (connection dropped; pool will discard it and recover):",
    err,
  );
});

export const db = drizzle(pool, { schema });

export * from "./schema";
export * from "./atelier-reference-mapping";
