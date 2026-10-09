# Revisão de roteiro

API pequena para o fluxo de roteiro da Conty: o criador envia, a marca pede alteração (com motivo e prazo), o criador reenvia, a marca aprova. Node 22, Hono, TypeScript. Sem interface.

```bash
npm install
npm test        # 18 testes, relógio controlado
npm run dev     # http://127.0.0.1:3003
```

Por onde ler: `src/scripts.ts` (todas as regras de estado, puras) → `src/app.ts` (HTTP fino) → `test/flow.test.ts`.

## Estados

```
            POST /scripts
                 │
                 ▼
        ┌─ awaiting_review ◄──────────────┐
        │        │                         │ POST /scripts/:id/versions
        │        │ POST .../change-requests│
        │        ▼                         │
        │  changes_requested ──────────────┘
        │
        │ POST .../approve
        ▼
     approved   (final: não aceita versão, pedido nem nova aprovação)
```

| Ação | Só vale em | Erro fora do estado |
|---|---|---|
| `POST /scripts/:id/versions` | `changes_requested` | 409 |
| `POST /scripts/:id/change-requests` | `awaiting_review` | 409 |
| `POST /scripts/:id/approve` | `awaiting_review` | 409 |

Códigos: `400` entrada inválida, `404` roteiro inexistente, `409` ação fora do estado, `422` prazo que já passou.

## Prazo

`deadline_date` é um dia (`YYYY-MM-DD`) no fuso da marca, `America/Sao_Paulo`. O dia vale inteiro: às 23:59:59.999 de São Paulo o prazo desse dia ainda vale; à 00:00:00.000 do dia seguinte não vale mais. A comparação é entre o dia civil de São Paulo "agora" e o prazo, nunca pelo dia em UTC (às 22:02 em São Paulo o UTC já está no dia seguinte). Datas inexistentes (`2026-02-30`) e formatos com horário são recusados.

## Exemplos

Criar (criador envia a v1):

```bash
curl -s -X POST localhost:3003/scripts -H 'content-type: application/json' \
  -d '{"campaign_id":"cmp_verao","content":"Abro com o produto na mão e mostro o antes e depois."}'
```
```json
{
  "id": "2a477671-92ce-405d-b3a0-210dea7a5f82",
  "campaign_id": "cmp_verao",
  "status": "awaiting_review",
  "versions": [{ "number": 1, "content": "Abro com o produto na mão e mostro o antes e depois.", "submitted_at": "2026-10-09T18:43:39.643Z" }],
  "change_requests": [],
  "approved_at": null
}
```

Pedido sem motivo (400):

```bash
curl -s -X POST localhost:3003/scripts/$ID/change-requests -H 'content-type: application/json' \
  -d '{"deadline_date":"2099-01-10"}'
# {"error":"invalid","message":"reason (motivo) é obrigatório (até 2000 caracteres)"}
```

Pedido válido (201): o roteiro vai para `changes_requested` e o pedido fica ligado à versão que ele avaliou.

```bash
curl -s -X POST localhost:3003/scripts/$ID/change-requests -H 'content-type: application/json' \
  -d '{"reason":"Abrir com o produto na mão","deadline_date":"2099-01-10"}'
```
```json
{
  "id": "2a477671-92ce-405d-b3a0-210dea7a5f82",
  "campaign_id": "cmp_verao",
  "status": "changes_requested",
  "versions": [{ "number": 1, "content": "Abro com o produto na mão e mostro o antes e depois.", "submitted_at": "2026-10-09T18:43:39.643Z" }],
  "change_requests": [
    { "id": "ba509db1-b752-48ea-8cb5-8e910914f4c9", "version_number": 1, "reason": "Abrir com o produto na mão", "deadline_date": "2099-01-10", "requested_at": "2026-10-09T18:43:39.750Z" }
  ],
  "approved_at": null
}
```

Reenviar (201, versão 2; a 1 continua no histórico), aprovar (200) e tentar depois (409):

```bash
curl -s -X POST localhost:3003/scripts/$ID/versions -H 'content-type: application/json' -d '{"content":"Nova abertura: produto na mão nos 2 primeiros segundos."}'
curl -s -X POST localhost:3003/scripts/$ID/approve        # status "approved", approved_at preenchido
curl -s -X POST localhost:3003/scripts/$ID/versions -H 'content-type: application/json' -d '{"content":"x"}'
# {"error":"wrong_state","message":"roteiro já aprovado: não aceita nova versão"}
```

Prazo que já passou (422):

```bash
curl -s -X POST localhost:3003/scripts/$ID/change-requests -H 'content-type: application/json' -d '{"reason":"x","deadline_date":"2020-01-01"}'
# {"error":"deadline_passed","message":"o prazo já passou"}
```

`GET /scripts/:id` devolve o roteiro com todas as versões e todos os pedidos.

## Testes

`test/flow.test.ts` usa um relógio injetado (`createApp({ clock })`), nunca o da máquina. Cobre o fluxo completo, várias rodadas, motivo/prazo ausentes ou inválidos, os estados fora de ordem, roteiro aprovado imutável, e o prazo no último instante (`2026-03-13T02:59:59.999Z` vale), no primeiro do dia seguinte (`03:00:00.000Z` não vale) e com o UTC já virado.

## O que ficou de fora (e o que eu faria diferente com mais tempo)

- **Sem persistência.** Os roteiros ficam em memória e somem ao reiniciar. O armazenamento é um `Map` em `src/app.ts`; trocar por SQLite/Postgres é local, porque as regras em `src/scripts.ts` não conhecem o armazenamento. Com banco, a transição de estado precisaria de transação ou update condicional (`WHERE status = ...`) para dois cliques simultâneos não passarem os dois.
- **Sem autenticação nem papéis.** Qualquer chamador age como criador ou marca. O desenho certo é amarrar cada ação ao papel (só a marca pede alteração e aprova, só o criador envia versão).
- **Reenvio depois do prazo é aceito.** O enunciado só invalida pedido de alteração com prazo vencido. Não decidi sozinho o que acontece com o criador que atrasa (marcar como atrasado, escalar). O prazo está guardado no pedido, então dá para derivar isso depois.
- **Prazo é só a data.** Não calculo o instante exato de expiração, e não há lembrete nem job que avise de prazo chegando.
- **Sem paginação, sem lista de roteiros, sem edição de pedido.** Só o necessário para demonstrar o fluxo.
- **Sem limite de taxa e sem versão do contrato (`/v1`).**

## Uso de IA

Feito com Claude Code: desenho dos estados, código, testes e este README. Revisado por mim: as regras de estado, os casos de prazo (último e primeiro instante, UTC virado), a execução dos testes e do typecheck, e os exemplos acima, que são respostas reais da API rodando. O enunciado pediu para ignorar arquivos dirigidos a ferramenta, e este repositório não tem nenhum.
