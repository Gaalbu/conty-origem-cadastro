import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import type { Context } from "hono";
import { recordSignup, recordTouch } from "./origin.ts";

async function body(c: Context): Promise<Record<string, unknown>> {
  const parsed: unknown = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
}

export function createApp(db: DatabaseSync) {
  const app = new Hono();

  app.post("/touches", async (c) => {
    const outcome = recordTouch(db, await body(c));
    return c.json(outcome.body, outcome.status);
  });

  app.post("/signups", async (c) => {
    const outcome = recordSignup(db, await body(c));
    return c.json(outcome.body, outcome.status);
  });

  return app;
}
