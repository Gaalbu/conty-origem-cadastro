export type Channel = "campaign" | "referral" | "community";
export const CHANNELS: readonly Channel[] = ["campaign", "referral", "community"];

export const ORIGIN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const PRIORITY: Record<Channel, number> = { campaign: 3, referral: 2, community: 1 };

export const REASONS = {
  winner: "último toque elegível dentro da janela de 7 dias contada da primeira abertura",
  tieWinner: "empate de horário resolvido pela prioridade campaign > referral > community",
  tieLoser: "empate de horário; perdeu para o canal de maior prioridade",
  afterSignup: "aberto depois do cadastro",
  outsideWindow: "fora da janela de 7 dias contada da primeira abertura",
  older: "há um toque elegível mais recente",
  organic: "nenhum toque elegível antes do cadastro dentro da janela de 7 dias contada da primeira abertura",
} as const;

export type Touch = {
  tid: string;
  channel: Channel;
  campaign_id: string | null;
  referrer_id: string | null;
  opened_at: string;
};

export type JudgedTouch = Touch & { won: boolean; reason: string };

export type Decision = {
  origin: {
    channel: Channel | "organic";
    reason: string;
    tid: string | null;
    campaign_id: string | null;
    referrer_id: string | null;
  };
  touches: JudgedTouch[];
};

function byTimeThenTid(left: Touch, right: Touch): number {
  const diff = Date.parse(left.opened_at) - Date.parse(right.opened_at);
  if (diff !== 0) return diff;
  return left.tid < right.tid ? -1 : left.tid > right.tid ? 1 : 0;
}

// Ordem de preferência entre elegíveis: maior opened_at, depois o canal de
// maior prioridade, depois o tid menor.
function preference(left: Touch, right: Touch): number {
  const diff = Date.parse(right.opened_at) - Date.parse(left.opened_at);
  if (diff !== 0) return diff;
  const priority = PRIORITY[right.channel] - PRIORITY[left.channel];
  if (priority !== 0) return priority;
  return left.tid < right.tid ? -1 : left.tid > right.tid ? 1 : 0;
}

// Decide a origem de um cadastro a partir dos toques daquele aparelho. A
// janela conta da primeira abertura, não do cadastro: quem abriu um link há
// mais de 7 dias e voltou sozinho não é atribuído a um link mais novo fora dela.
export function decideOrigin(touches: Touch[], signedUpAt: string): Decision {
  const ordered = [...touches].sort(byTimeThenTid);
  const signup = Date.parse(signedUpAt);
  const first = ordered[0];
  const windowEnd = first ? Date.parse(first.opened_at) + ORIGIN_WINDOW_MS : -Infinity;

  const outside = (touch: Touch) => Date.parse(touch.opened_at) > windowEnd;
  const after = (touch: Touch) => Date.parse(touch.opened_at) > signup;
  const eligible = ordered.filter((touch) => !outside(touch) && !after(touch));
  const winner = [...eligible].sort(preference)[0];
  const tied = winner ? eligible.filter((touch) => touch.opened_at === winner.opened_at) : [];
  const isTie = tied.length > 1;

  const judged = ordered.map((touch): JudgedTouch => {
    if (outside(touch)) return { ...touch, won: false, reason: REASONS.outsideWindow };
    if (after(touch)) return { ...touch, won: false, reason: REASONS.afterSignup };
    if (touch === winner) return { ...touch, won: true, reason: isTie ? REASONS.tieWinner : REASONS.winner };
    if (winner && touch.opened_at === winner.opened_at) return { ...touch, won: false, reason: REASONS.tieLoser };
    return { ...touch, won: false, reason: REASONS.older };
  });

  if (!winner) {
    return {
      origin: { channel: "organic", reason: REASONS.organic, tid: null, campaign_id: null, referrer_id: null },
      touches: judged,
    };
  }
  return {
    origin: {
      channel: winner.channel,
      reason: isTie ? REASONS.tieWinner : REASONS.winner,
      tid: winner.tid,
      campaign_id: winner.campaign_id,
      referrer_id: winner.referrer_id,
    },
    touches: judged,
  };
}
