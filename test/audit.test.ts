import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";

describe("replay idêntico contra conflito de identidade", () => {
  let db: ReturnType<typeof openDatabase>;
  let app: ReturnType<typeof createApp>;
  const post = (path: string, payload: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const touch = { tid: "clk_01", device_id: "dev_1", channel: "campaign", campaign_id: "cmp_verao", opened_at: "2026-06-01T10:00:00.000Z" };

  beforeEach(() => {
    db = openDatabase();
    app = createApp(db);
  });

  it("o mesmo tid com o mesmo conteúdo, em outro fuso, é replay 200", async () => {
    expect((await post("/touches", touch)).status).toBe(201);
    expect((await post("/touches", { ...touch, opened_at: "2026-06-01T07:00:00-03:00" })).status).toBe(200);
  });

  it("o mesmo tid em outro aparelho ou com outro canal, campanha ou horário é 409 e não muda o toque", async () => {
    expect((await post("/touches", touch)).status).toBe(201);
    const before = db.prepare("SELECT * FROM touches").all();
    for (const changed of [
      { device_id: "dev_2" },
      { channel: "referral" },
      { campaign_id: "cmp_outra" },
      { referrer_id: "crt_ana" },
      { opened_at: "2026-06-01T11:00:00.000Z" },
    ]) {
      const res = await post("/touches", { ...touch, ...changed });
      expect([changed, res.status]).toEqual([changed, 409]);
    }
    expect(db.prepare("SELECT * FROM touches").all()).toEqual(before);
  });

  it("o novo aparelho que reusou um tid não herda o toque: seu cadastro sai orgânico com motivo", async () => {
    await post("/touches", touch);
    await post("/touches", { ...touch, device_id: "dev_2" });
    const res = await post("/signups", { device_id: "dev_2", creator_id: "crt_b", signed_up_at: "2026-06-02T10:00:00.000Z" });
    expect(await res.json()).toMatchObject({ origin: { channel: "organic" }, touches: [] });
  });

  it("cadastro repetido igual é 200 com a mesma decisão; com outro aparelho ou instante é 409", async () => {
    await post("/touches", touch);
    const signup = { device_id: "dev_1", creator_id: "crt_a", signed_up_at: "2026-06-02T10:00:00.000Z" };
    const first = await post("/signups", signup);
    expect(first.status).toBe(201);
    const replay = await post("/signups", { ...signup, signed_up_at: "2026-06-02T07:00:00-03:00" });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(await first.json());
    expect((await post("/signups", { ...signup, device_id: "dev_9" })).status).toBe(409);
    expect((await post("/signups", { ...signup, signed_up_at: "2026-06-03T10:00:00.000Z" })).status).toBe(409);
  });
});
