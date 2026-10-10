import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

type App = ReturnType<typeof createApp>;
type Signup = {
  origin: { channel: string; reason: string; tid: string | null };
  touches: Array<{ tid: string; channel: string; won: boolean; reason: string }>;
};

function post(app: App, path: string, payload: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function touch(app: App, tid: string, channel: string, openedAt: string, extra: Record<string, string> = {}) {
  return post(app, "/touches", { tid, device_id: "dev_1", channel, opened_at: openedAt, ...extra });
}

async function signup(app: App, signedUpAt: string): Promise<Signup> {
  const res = await post(app, "/signups", { device_id: "dev_1", creator_id: "crt_nova", signed_up_at: signedUpAt });
  expect(res.status).toBe(201);
  return (await res.json()) as Signup;
}

describe("origem do cadastro", () => {
  let app: App;

  beforeEach(() => {
    app = createApp(openDatabase());
  });

  it("cadastro sem toque é organic com motivo e lista vazia", async () => {
    const body = await signup(app, "2026-06-04T10:00:00.000Z");
    expect(body.origin.channel).toBe("organic");
    expect(body.origin.reason).toContain("nenhum toque elegível");
    expect(body.touches).toEqual([]);
  });

  it("o mesmo tid duas vezes vira um toque só no cadastro", async () => {
    expect((await touch(app, "clk_01", "campaign", "2026-06-01T10:00:00.000Z", { campaign_id: "cmp_verao" })).status).toBe(201);
    expect((await touch(app, "clk_01", "campaign", "2026-06-01T10:00:00.000Z", { campaign_id: "cmp_verao" })).status).toBe(200);
    const body = await signup(app, "2026-06-02T10:00:00.000Z");
    expect(body.touches).toHaveLength(1);
    expect(body.origin.channel).toBe("campaign");
  });

  it("indicação mais recente vence a comunidade aberta antes", async () => {
    await touch(app, "clk_03", "community", "2026-06-01T10:00:00.000Z", { campaign_id: "comunidade_sp" });
    await touch(app, "clk_02", "referral", "2026-06-03T10:00:00.000Z", { referrer_id: "crt_ana" });
    const body = await signup(app, "2026-06-04T10:00:00.000Z");
    expect(body.origin.channel).toBe("referral");
    expect(body.origin.reason).toBe("último toque elegível dentro da janela de 7 dias contada da primeira abertura");
    const community = body.touches.find((t) => t.tid === "clk_03");
    expect(community).toMatchObject({ won: false, reason: "há um toque elegível mais recente" });
  });

  it("empate de horário entre indicação e campanha fica com a campanha", async () => {
    await touch(app, "clk_02", "referral", "2026-06-03T10:00:00.000Z", { referrer_id: "crt_ana" });
    await touch(app, "clk_01", "campaign", "2026-06-03T10:00:00.000Z", { campaign_id: "cmp_verao" });
    const body = await signup(app, "2026-06-04T10:00:00.000Z");
    expect(body.origin.channel).toBe("campaign");
    expect(body.origin.reason).toContain("empate de horário");
    expect(body.touches.find((t) => t.tid === "clk_02")).toMatchObject({
      won: false,
      reason: "empate de horário; perdeu para o canal de maior prioridade",
    });
  });

  it("janela conta da primeira abertura: comunidade vence, indicação veio depois do cadastro, campanha fora da janela", async () => {
    await touch(app, "clk_03", "community", "2026-06-01T00:00:00.000Z", { campaign_id: "comunidade_sp" });
    await touch(app, "clk_01", "campaign", "2026-06-09T00:00:01.000Z", { campaign_id: "cmp_verao" });
    await touch(app, "clk_02", "referral", "2026-06-04T00:00:00.000Z", { referrer_id: "crt_ana" });
    const body = await signup(app, "2026-06-03T00:00:00.000Z");

    expect(body.origin.channel).toBe("community");
    expect(body.touches).toHaveLength(3);
    expect(body.touches.find((t) => t.tid === "clk_02")?.reason).toBe("aberto depois do cadastro");
    expect(body.touches.find((t) => t.tid === "clk_01")?.reason).toBe(
      "fora da janela de 7 dias contada da primeira abertura",
    );
    expect(body.touches.filter((t) => t.won).map((t) => t.tid)).toEqual(["clk_03"]);
  });

  it("toque só depois do cadastro não vira origem: organic", async () => {
    await touch(app, "clk_09", "campaign", "2026-06-05T00:00:00.000Z");
    const body = await signup(app, "2026-06-04T00:00:00.000Z");
    expect(body.origin.channel).toBe("organic");
    expect(body.touches[0]).toMatchObject({ won: false, reason: "aberto depois do cadastro" });
  });

  it("canal desconhecido é 400", async () => {
    expect((await touch(app, "clk_x", "tiktok_ads", "2026-06-01T00:00:00.000Z")).status).toBe(400);
  });
});
