import type { DatabaseSync } from "node:sqlite";
import { CHANNELS, decideOrigin } from "./decide.ts";
import { parseLink } from "./link.ts";
import type { Decision, Touch } from "./decide.ts";

export type Outcome = { status: 200 | 201 | 400 | 409; body: unknown };

// BEGIN IMMEDIATE: a checagem do id já visto e a gravação são um passo só,
// também entre processos no mesmo arquivo.
function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function instant(value: unknown): string | null {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

type TouchRow = Touch & { device_id: string };

// O app pode mandar o link inteiro que abriu, em vez dos campos já separados.
function fromLink(input: Record<string, unknown>): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (input.link === undefined) return { ok: true, value: input };
  if (typeof input.link !== "string") return { ok: false, error: "link deve ser texto" };
  const mixed = ["tid", "channel", "campaign_id", "referrer_id"].find((key) => input[key] !== undefined);
  if (mixed) return { ok: false, error: `mande link ou ${mixed}, não os dois` };
  const parsed = parseLink(input.link);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  return { ok: true, value: { ...input, ...parsed } };
}

export function recordTouch(db: DatabaseSync, raw: Record<string, unknown>): Outcome {
  const link = fromLink(raw);
  if (!link.ok) return { status: 400, body: { error: link.error } };
  const input = link.value;
  const tid = text(input.tid);
  const deviceId = text(input.device_id);
  const channel = CHANNELS.find((c) => c === input.channel);
  const openedAt = instant(input.opened_at);
  if (!tid) return { status: 400, body: { error: "tid é obrigatório" } };
  if (!deviceId) return { status: 400, body: { error: "device_id é obrigatório" } };
  if (!channel) return { status: 400, body: { error: "canal desconhecido" } };
  if (!openedAt) return { status: 400, body: { error: "opened_at inválido" } };

  const touch: TouchRow = {
    tid,
    device_id: deviceId,
    channel,
    campaign_id: text(input.campaign_id),
    referrer_id: text(input.referrer_id),
    opened_at: openedAt,
  };
  return transaction(db, (): Outcome => {
    // O mesmo tid com o mesmo conteúdo é a mesma abertura: 200, sem segunda
    // linha. Com outro aparelho, canal, campanha, indicação ou horário é outro
    // toque usando um tid já gasto: 409, e o toque original não muda.
    const existing = db.prepare("SELECT * FROM touches WHERE tid = ?").get(tid) as TouchRow | undefined;
    if (existing) {
      const same = (Object.keys(touch) as Array<keyof TouchRow>).every((key) => existing[key] === touch[key]);
      if (!same) return { status: 409, body: { error: "tid já registrado com outro aparelho ou conteúdo", tid } };
      return { status: 200, body: existing };
    }
    db.prepare(
      `INSERT INTO touches (tid, device_id, channel, campaign_id, referrer_id, opened_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(touch.tid, touch.device_id, touch.channel, touch.campaign_id, touch.referrer_id, touch.opened_at);
    return { status: 201, body: touch };
  });
}

export function recordSignup(db: DatabaseSync, input: Record<string, unknown>): Outcome {
  const deviceId = text(input.device_id);
  const creatorId = text(input.creator_id);
  const signedUpAt = instant(input.signed_up_at);
  if (!deviceId) return { status: 400, body: { error: "device_id é obrigatório" } };
  if (!creatorId) return { status: 400, body: { error: "creator_id é obrigatório" } };
  if (!signedUpAt) return { status: 400, body: { error: "signed_up_at inválido" } };

  return transaction(db, (): Outcome => {
    // Cadastro repetido igual devolve a decisão já gravada, sem recalcular. O
    // mesmo criador com outro aparelho ou instante é conflito: a origem gravada
    // não é trocada por um replay diferente.
    const existing = db.prepare("SELECT * FROM signups WHERE creator_id = ?").get(creatorId) as
      | { device_id: string; signed_up_at: string; decision_json: string }
      | undefined;
    if (existing) {
      if (existing.device_id !== deviceId || existing.signed_up_at !== signedUpAt) {
        return { status: 409, body: { error: "criador já cadastrado com outro aparelho ou instante", creator_id: creatorId } };
      }
      return {
        status: 200,
        body: {
          creator_id: creatorId,
          device_id: existing.device_id,
          signed_up_at: existing.signed_up_at,
          ...(JSON.parse(existing.decision_json) as Decision),
        },
      };
    }

    const touches = db
      .prepare("SELECT tid, channel, campaign_id, referrer_id, opened_at FROM touches WHERE device_id = ?")
      .all(deviceId) as Touch[];
    const install = db.prepare("SELECT first_open_at FROM installs WHERE device_id = ?").get(deviceId) as
      | { first_open_at: string }
      | undefined;
    const decision = decideOrigin(touches, signedUpAt, install?.first_open_at);
    db.prepare("INSERT INTO signups (creator_id, device_id, signed_up_at, decision_json) VALUES (?, ?, ?, ?)").run(
      creatorId,
      deviceId,
      signedUpAt,
      JSON.stringify(decision),
    );
    return { status: 201, body: { creator_id: creatorId, device_id: deviceId, signed_up_at: signedUpAt, ...decision } };
  });
}

// Primeira abertura do app no aparelho: início da janela de 7 dias. Repetir o
// registro não muda o horário gravado.
export function recordInstall(db: DatabaseSync, input: Record<string, unknown>): Outcome {
  const deviceId = text(input.device_id);
  const firstOpenAt = instant(input.first_open_at);
  if (!deviceId) return { status: 400, body: { error: "device_id é obrigatório" } };
  if (!firstOpenAt) return { status: 400, body: { error: "first_open_at inválido" } };
  return transaction(db, (): Outcome => {
    const existing = db.prepare("SELECT * FROM installs WHERE device_id = ?").get(deviceId);
    if (existing) return { status: 200, body: existing };
    db.prepare("INSERT INTO installs (device_id, first_open_at) VALUES (?, ?)").run(deviceId, firstOpenAt);
    return { status: 201, body: { device_id: deviceId, first_open_at: firstOpenAt } };
  });
}
