import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db.ts";
import { parseLink } from "../src/link.ts";

type Signup = {
  origin: { channel: string; campaign_id: string | null; referrer_id: string | null };
  touches: Array<{ tid: string; reason: string }>;
  window: { starts_at: string; ends_at: string; measured_from: string } | null;
  rule_version: string;
};

describe("contrato do link e da primeira abertura", () => {
  let app: ReturnType<typeof createApp>;
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const signup = async (body: unknown) => (await (await post("/signups", body)).json()) as Signup;

  beforeEach(() => {
    app = createApp(openDatabase());
  });

  it("lê src, cid, ref e tid dos links de campanha, indicação e comunidade", () => {
    expect(parseLink("https://app.conty.com/join?src=campaign&cid=cmp_verao&tid=clk_01")).toEqual({ tid: "clk_01", channel: "campaign", campaign_id: "cmp_verao", referrer_id: null });
    expect(parseLink("https://app.conty.com/join?src=referral&ref=crt_ana&tid=clk_02")).toEqual({ tid: "clk_02", channel: "referral", campaign_id: null, referrer_id: "crt_ana" });
    expect(parseLink("https://app.conty.com/join?src=community&cid=comunidade_sp&tid=clk_03")).toMatchObject({ channel: "community", campaign_id: "comunidade_sp" });
  });

  it.each([
    ["sem src", "https://app.conty.com/join?cid=x&tid=t"],
    ["src inventado", "https://app.conty.com/join?src=tiktok&cid=x&tid=t"],
    ["sem tid", "https://app.conty.com/join?src=campaign&cid=x"],
    ["indicação sem ref", "https://app.conty.com/join?src=referral&tid=t"],
    ["campanha sem cid", "https://app.conty.com/join?src=campaign&tid=t"],
    ["não é URL", "app.conty.com join"],
  ])("link %s é 400 e não grava toque", async (_name, link) => {
    expect((await post("/touches", { link, device_id: "dev_1", opened_at: "2026-06-01T10:00:00.000Z" })).status).toBe(400);
    expect((await signup({ device_id: "dev_1", creator_id: "crt_x", signed_up_at: "2026-06-02T00:00:00.000Z" })).touches).toEqual([]);
  });

  it("o app manda o link inteiro e o cadastro usa o que veio nele", async () => {
    const res = await post("/touches", { link: "https://app.conty.com/join?src=referral&ref=crt_ana&tid=clk_02", device_id: "dev_1", opened_at: "2026-06-01T10:00:00.000Z" });
    expect(res.status).toBe(201);
    const body = await signup({ device_id: "dev_1", creator_id: "crt_nova", signed_up_at: "2026-06-02T00:00:00.000Z" });
    expect(body.origin).toMatchObject({ channel: "referral", referrer_id: "crt_ana" });
    expect(body.rule_version).toBe("origem-v2");
  });

  it("link junto com os campos separados é 400", async () => {
    const res = await post("/touches", { link: "https://app.conty.com/join?src=campaign&cid=c&tid=t", channel: "campaign", device_id: "dev_1", opened_at: "2026-06-01T10:00:00.000Z" });
    expect(res.status).toBe(400);
  });

  it("a janela conta da primeira abertura do app, não do primeiro toque", async () => {
    expect((await post("/installs", { device_id: "dev_1", first_open_at: "2026-06-01T00:00:00.000Z" })).status).toBe(201);
    await post("/touches", { link: "https://app.conty.com/join?src=campaign&cid=cmp_verao&tid=clk_01", device_id: "dev_1", opened_at: "2026-06-08T00:00:01.000Z" });
    const body = await signup({ device_id: "dev_1", creator_id: "crt_nova", signed_up_at: "2026-06-09T00:00:00.000Z" });
    expect(body.window).toEqual({ starts_at: "2026-06-01T00:00:00.000Z", ends_at: "2026-06-08T00:00:00.000Z", measured_from: "install" });
    expect(body.origin.channel).toBe("organic");
    expect(body.touches[0]?.reason).toBe("fora da janela de 7 dias contada da primeira abertura");
  });

  it("toque no último milissegundo da janela ainda vale", async () => {
    await post("/installs", { device_id: "dev_1", first_open_at: "2026-06-01T00:00:00.000Z" });
    await post("/touches", { link: "https://app.conty.com/join?src=campaign&cid=cmp_verao&tid=clk_01", device_id: "dev_1", opened_at: "2026-06-08T00:00:00.000Z" });
    const body = await signup({ device_id: "dev_1", creator_id: "crt_nova", signed_up_at: "2026-06-09T00:00:00.000Z" });
    expect(body.origin.channel).toBe("campaign");
  });

  it("repetir a primeira abertura não move o início da janela; sem install, a janela conta do primeiro toque", async () => {
    await post("/installs", { device_id: "dev_1", first_open_at: "2026-06-01T00:00:00.000Z" });
    const again = await post("/installs", { device_id: "dev_1", first_open_at: "2026-06-05T00:00:00.000Z" });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ first_open_at: "2026-06-01T00:00:00.000Z" });

    await post("/touches", { tid: "clk_9", device_id: "dev_2", channel: "community", campaign_id: "sp", opened_at: "2026-06-03T00:00:00.000Z" });
    const body = await signup({ device_id: "dev_2", creator_id: "crt_b", signed_up_at: "2026-06-04T00:00:00.000Z" });
    expect(body.window).toMatchObject({ starts_at: "2026-06-03T00:00:00.000Z", measured_from: "first_touch" });
  });
});
