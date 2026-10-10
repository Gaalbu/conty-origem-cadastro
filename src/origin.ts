import type { DatabaseSync } from "node:sqlite";
import { CHANNELS, decideOrigin } from "./decide.ts";
import type { Decision, Touch } from "./decide.ts";

export type Outcome = { status: 200 | 201 | 400; body: unknown };

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

type TouchRow = Touch & { device_id: string };

export function recordTouch(db: DatabaseSync, input: Record<string, unknown>): Outcome {
  const tid = text(input.tid);
  const deviceId = text(input.device_id);
  const channel = CHANNELS.find((c) => c === input.channel);
  const openedAt = instant(input.opened_at);
  if (!tid) return { status: 400, body: { error: "tid é obrigatório" } };
  if (!deviceId) return { status: 400, body: { error: "device_id é obrigatório" } };
  if (!channel) return { status: 400, body: { error: "canal desconhecido" } };
  if (!openedAt) return { status: 400, body: { error: "opened_at inválido" } };

  // O mesmo tid é a mesma abertura: a chave primária impede a segunda linha.
  const existing = db.prepare("SELECT * FROM touches WHERE tid = ?").get(tid) as TouchRow | undefined;
  if (existing) return { status: 200, body: existing };

  db.prepare(
    `INSERT INTO touches (tid, device_id, channel, campaign_id, referrer_id, opened_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (tid) DO NOTHING`,
  ).run(tid, deviceId, channel, text(input.campaign_id), text(input.referrer_id), openedAt);
  return { status: 201, body: db.prepare("SELECT * FROM touches WHERE tid = ?").get(tid) };
}

export function recordSignup(db: DatabaseSync, input: Record<string, unknown>): Outcome {
  const deviceId = text(input.device_id);
  const creatorId = text(input.creator_id);
  const signedUpAt = instant(input.signed_up_at);
  if (!deviceId) return { status: 400, body: { error: "device_id é obrigatório" } };
  if (!creatorId) return { status: 400, body: { error: "creator_id é obrigatório" } };
  if (!signedUpAt) return { status: 400, body: { error: "signed_up_at inválido" } };

  // Cadastro repetido devolve a decisão já gravada, sem recalcular.
  const existing = db.prepare("SELECT * FROM signups WHERE creator_id = ?").get(creatorId) as
    | { device_id: string; signed_up_at: string; decision_json: string }
    | undefined;
  if (existing) {
    return {
      status: 200,
      body: { creator_id: creatorId, device_id: existing.device_id, signed_up_at: existing.signed_up_at, ...(JSON.parse(existing.decision_json) as Decision) },
    };
  }

  const touches = db
    .prepare("SELECT tid, channel, campaign_id, referrer_id, opened_at FROM touches WHERE device_id = ?")
    .all(deviceId) as Touch[];
  const decision = decideOrigin(touches, signedUpAt);
  db.prepare(
    "INSERT INTO signups (creator_id, device_id, signed_up_at, decision_json) VALUES (?, ?, ?, ?)",
  ).run(creatorId, deviceId, signedUpAt, JSON.stringify(decision));
  return { status: 201, body: { creator_id: creatorId, device_id: deviceId, signed_up_at: signedUpAt, ...decision } };
}
