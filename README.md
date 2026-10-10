# Origem do cadastro no app

O webview não manda referrer. Então o link carrega a origem, o app grava a abertura como um toque, e o cadastro consome os toques daquele `device_id` para decidir de onde o criador veio. Quem não tem toque elegível é `organic`, com motivo, nunca um campo vazio.

Comece a leitura por [`src/decide.ts`](src/decide.ts): a decisão é uma função pura, sem banco e sem relógio do servidor.

## Links

```text
https://app.conty.com/join?src=campaign&cid=cmp_verao&tid=clk_01
https://app.conty.com/join?src=referral&ref=crt_ana&tid=clk_02
https://app.conty.com/join?src=community&cid=comunidade_sp&tid=clk_03
```

O app lê `src`, `cid`/`ref` e `tid` e grava a abertura em `POST /touches`.

## Regras

- `POST /touches` `{tid, device_id, channel, campaign_id, referrer_id, opened_at}`. O mesmo `tid` responde 200 e não cria outra linha. Canal fora de `campaign`, `referral`, `community` → 400.
- `POST /signups` `{device_id, creator_id, signed_up_at}`. `signed_up_at` é o relógio do cadastro.
- Janela: 7 dias contados do menor `opened_at` daquele aparelho.
- Elegível: `opened_at <= signed_up_at` e `opened_at <= primeira_abertura + 7 dias`.
- Vencedor: o elegível de maior `opened_at`. Empate de horário: `campaign` > `referral` > `community`. Novo empate: `tid` menor.
- Cada toque volta com `won` e `reason`:

| Caso | Motivo |
| --- | --- |
| vencedor único | `último toque elegível dentro da janela de 7 dias contada da primeira abertura` |
| vencedor de empate | `empate de horário resolvido pela prioridade campaign > referral > community` |
| perdedor do empate | `empate de horário; perdeu para o canal de maior prioridade` |
| depois do cadastro | `aberto depois do cadastro` |
| além da janela | `fora da janela de 7 dias contada da primeira abertura` |
| elegível mais antigo | `há um toque elegível mais recente` |
| ninguém elegível | canal `organic`, `nenhum toque elegível antes do cadastro dentro da janela de 7 dias contada da primeira abertura` |

## Como rodar

Node 22 ou maior.

```bash
npm install
npm test
npm run typecheck
npm run dev
```

A API sobe em `http://127.0.0.1:43124`.

## Exemplo: a janela conta da primeira abertura

O teste `janela conta da primeira abertura: comunidade vence, indicação veio depois do cadastro, campanha fora da janela` executa estes requests.

```bash
curl -s -X POST http://127.0.0.1:43124/touches -H 'content-type: application/json' \
  -d '{"tid":"clk_03","device_id":"dev_1","channel":"community","campaign_id":"comunidade_sp","opened_at":"2026-06-01T00:00:00.000Z"}'
curl -s -X POST http://127.0.0.1:43124/touches -H 'content-type: application/json' \
  -d '{"tid":"clk_01","device_id":"dev_1","channel":"campaign","campaign_id":"cmp_verao","opened_at":"2026-06-09T00:00:01.000Z"}'
curl -s -X POST http://127.0.0.1:43124/touches -H 'content-type: application/json' \
  -d '{"tid":"clk_02","device_id":"dev_1","channel":"referral","referrer_id":"crt_ana","opened_at":"2026-06-04T00:00:00.000Z"}'

curl -s -X POST http://127.0.0.1:43124/signups -H 'content-type: application/json' \
  -d '{"device_id":"dev_1","creator_id":"crt_nova","signed_up_at":"2026-06-03T00:00:00.000Z"}'
```

Resposta do cadastro, `201`:

```json
{
  "creator_id": "crt_nova",
  "device_id": "dev_1",
  "signed_up_at": "2026-06-03T00:00:00.000Z",
  "origin": {
    "channel": "community",
    "reason": "último toque elegível dentro da janela de 7 dias contada da primeira abertura",
    "tid": "clk_03",
    "campaign_id": "comunidade_sp",
    "referrer_id": null
  },
  "touches": [
    { "tid": "clk_03", "channel": "community", "campaign_id": "comunidade_sp", "referrer_id": null,
      "opened_at": "2026-06-01T00:00:00.000Z", "won": true,
      "reason": "último toque elegível dentro da janela de 7 dias contada da primeira abertura" },
    { "tid": "clk_02", "channel": "referral", "campaign_id": null, "referrer_id": "crt_ana",
      "opened_at": "2026-06-04T00:00:00.000Z", "won": false, "reason": "aberto depois do cadastro" },
    { "tid": "clk_01", "channel": "campaign", "campaign_id": "cmp_verao", "referrer_id": null,
      "opened_at": "2026-06-09T00:00:01.000Z", "won": false,
      "reason": "fora da janela de 7 dias contada da primeira abertura" }
  ]
}
```

## Ficou de fora

Toque que atravessa aparelho.

## Nota da entrega

Comece por `src/decide.ts`, uma função pura que recebe os toques do aparelho e o instante do cadastro. A janela de 7 dias conta da primeira abertura daquele aparelho, não do cadastro. Elegível é o toque aberto até o cadastro e dentro da janela; vence o de maior `opened_at`, e empate de horário vai para `campaign` > `referral` > `community`, depois `tid` menor. Sem elegível, o canal é `organic` com motivo explícito. A resposta lista todos os toques, ganhos e perdidos, cada um com o motivo, então suporte e marketing leem por que um link não levou o cadastro. O mesmo `tid` não duplica: chave primária e checagem antes do insert.

Testes: `npm test` com 7 passando, `npm run typecheck` sem erro. O exemplo deste README é o request do teste da janela.

Ficou de fora: toque que atravessa aparelho.

IA: código, testes e README escritos com assistente de código (Claude Code), a partir de um plano com as regras do desafio. O assistente rodou os testes e o typecheck e colou a resposta real acima.
