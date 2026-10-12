import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { body, BodyError, MAX_BODY_BYTES } from "./body.ts";
import { recordInstall, recordSignup, recordTouch } from "./origin.ts";

export function createApp(db: DatabaseSync) {
  const app = new Hono();

  app.use("*", bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: "corpo acima de 64 KB" }, 413) }));
  app.onError((error, c) => {
    if (error instanceof BodyError) return c.json(error.payload, error.status);
    // Erro inesperado: 500 em JSON genérico, sem stack na resposta; o detalhe vai para o log.
    console.error(error);
    return c.json({ error: "erro interno" }, 500);
  });

  app.post("/installs", async (c) => {
    const outcome = recordInstall(db, await body(c, ["device_id", "first_open_at"]));
    return c.json(outcome.body, outcome.status);
  });

  app.post("/touches", async (c) => {
    const outcome = recordTouch(db, await body(c, ["tid", "device_id", "channel", "campaign_id", "referrer_id", "opened_at", "link"]));
    return c.json(outcome.body, outcome.status);
  });

  app.post("/signups", async (c) => {
    const outcome = recordSignup(db, await body(c, ["device_id", "creator_id", "signed_up_at"]));
    return c.json(outcome.body, outcome.status);
  });

  return app;
}
