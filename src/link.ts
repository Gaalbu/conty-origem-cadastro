import { CHANNELS } from "./decide.ts";
import type { Channel } from "./decide.ts";

// O que viaja no link: src (canal), cid (campanha ou comunidade), ref (quem
// indicou) e tid (id do clique). O webview não manda referrer, então o link é a
// única fonte da origem.
//   https://app.conty.com/join?src=campaign&cid=cmp_verao&tid=clk_01
//   https://app.conty.com/join?src=referral&ref=crt_ana&tid=clk_02
export type ParsedLink = { tid: string; channel: Channel; campaign_id: string | null; referrer_id: string | null };

export function parseLink(value: string): ParsedLink | { error: string } {
  if (!URL.canParse(value)) return { error: "link inválido" };
  const params = new URL(value).searchParams;
  const channel = CHANNELS.find((c) => c === params.get("src"));
  if (!channel) return { error: "link sem src conhecido (campaign, referral ou community)" };
  const tid = params.get("tid")?.trim();
  if (!tid) return { error: "link sem tid" };
  const campaign = params.get("cid")?.trim() || null;
  const referrer = params.get("ref")?.trim() || null;
  if (channel === "referral" && !referrer) return { error: "link de indicação sem ref" };
  if (channel !== "referral" && !campaign) return { error: "link de campanha ou comunidade sem cid" };
  return { tid, channel, campaign_id: campaign, referrer_id: referrer };
}
