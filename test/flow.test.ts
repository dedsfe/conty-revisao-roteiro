import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.ts";
import type { Script } from "../src/scripts.ts";

type App = ReturnType<typeof createApp>;

// Relógio controlado: os testes mexem nele, nunca no relógio da máquina.
let now = new Date("2026-03-12T15:00:00.000Z");
let counter = 0;

function setup(): App {
  counter = 0;
  return createApp({ clock: () => now, newId: () => `id_${++counter}` });
}

async function send(app: App, path: string, body?: unknown, method = "POST") {
  const res = await app.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function newScript(app: App): Promise<string> {
  const res = await send(app, "/scripts", { campaign_id: "cmp_1", content: "Roteiro v1" });
  expect(res.status).toBe(201);
  return (res.body as Script).id;
}

beforeEach(() => {
  now = new Date("2026-03-12T15:00:00.000Z");
});

describe("fluxo completo", () => {
  it("envia, pede alteração, reenvia e aprova, mantendo as versões antigas", async () => {
    const app = setup();
    const id = await newScript(app);

    const change = await send(app, `/scripts/${id}/change-requests`, {
      reason: "Abrir com o produto na mão",
      deadline_date: "2026-03-15",
    });
    expect(change.status).toBe(201);
    expect(change.body.status).toBe("changes_requested");

    const v2 = await send(app, `/scripts/${id}/versions`, { content: "Roteiro v2" });
    expect(v2.status).toBe(201);
    expect(v2.body.status).toBe("awaiting_review");

    const approved = await send(app, `/scripts/${id}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body.status).toBe("approved");
    expect(approved.body.approved_at).toBe("2026-03-12T15:00:00.000Z");

    const final = await send(app, `/scripts/${id}`, undefined, "GET");
    expect(final.body.versions.map((v: any) => [v.number, v.content])).toEqual([
      [1, "Roteiro v1"],
      [2, "Roteiro v2"],
    ]);
    expect(final.body.change_requests).toHaveLength(1);
    expect(final.body.change_requests[0]).toMatchObject({ version_number: 1, deadline_date: "2026-03-15" });
  });

  it("guarda todos os pedidos de alteração de várias rodadas", async () => {
    const app = setup();
    const id = await newScript(app);
    await send(app, `/scripts/${id}/change-requests`, { reason: "r1", deadline_date: "2026-03-13" });
    await send(app, `/scripts/${id}/versions`, { content: "v2" });
    await send(app, `/scripts/${id}/change-requests`, { reason: "r2", deadline_date: "2026-03-14" });
    await send(app, `/scripts/${id}/versions`, { content: "v3" });
    const res = await send(app, `/scripts/${id}`, undefined, "GET");
    expect(res.body.versions).toHaveLength(3);
    expect(res.body.change_requests.map((r: any) => [r.version_number, r.reason])).toEqual([
      [1, "r1"],
      [2, "r2"],
    ]);
  });
});

describe("pedido de alteração exige motivo e prazo", () => {
  it.each([
    ["sem motivo", { deadline_date: "2026-03-15" }],
    ["motivo vazio", { reason: "   ", deadline_date: "2026-03-15" }],
    ["motivo que não é texto", { reason: 42, deadline_date: "2026-03-15" }],
    ["sem prazo", { reason: "Trocar o gancho" }],
    ["prazo em formato errado", { reason: "x", deadline_date: "15/03/2026" }],
    ["prazo com data inexistente", { reason: "x", deadline_date: "2026-02-30" }],
    ["prazo com horário", { reason: "x", deadline_date: "2026-03-15T10:00:00Z" }],
  ])("recusa %s", async (_name, payload) => {
    const app = setup();
    const id = await newScript(app);
    const res = await send(app, `/scripts/${id}/change-requests`, payload);
    expect(res.status).toBe(400);
    const after = await send(app, `/scripts/${id}`, undefined, "GET");
    expect(after.body.status).toBe("awaiting_review");
    expect(after.body.change_requests).toEqual([]);
  });
});

describe("prazo no fuso da marca (America/Sao_Paulo)", () => {
  async function requestWithDeadline(deadline: string) {
    const app = setup();
    const id = await newScript(app);
    return send(app, `/scripts/${id}/change-requests`, { reason: "Ajustar", deadline_date: deadline });
  }

  it("aceita no último instante do dia do prazo (23:59:59.999 em São Paulo)", async () => {
    now = new Date("2026-03-13T02:59:59.999Z");
    expect((await requestWithDeadline("2026-03-12")).status).toBe(201);
  });

  it("recusa no primeiro instante do dia seguinte (00:00:00.000 em São Paulo)", async () => {
    now = new Date("2026-03-13T03:00:00.000Z");
    const res = await requestWithDeadline("2026-03-12");
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("deadline_passed");
  });

  it("não vira o dia errado quando o UTC já virou mas São Paulo não", async () => {
    now = new Date("2026-03-13T01:02:00.000Z"); // 22:02 de 12/03 em São Paulo
    expect((await requestWithDeadline("2026-03-12")).status).toBe(201);
  });

  it("recusa prazo de ontem e aceita prazo de hoje ou futuro", async () => {
    now = new Date("2026-03-12T15:00:00.000Z");
    expect((await requestWithDeadline("2026-03-11")).status).toBe(422);
    expect((await requestWithDeadline("2026-03-12")).status).toBe(201);
    expect((await requestWithDeadline("2026-03-20")).status).toBe(201);
  });
});

describe("estado explícito", () => {
  it("roteiro aprovado não aceita nova versão nem novo pedido, e não reabre", async () => {
    const app = setup();
    const id = await newScript(app);
    expect((await send(app, `/scripts/${id}/approve`)).status).toBe(200);

    const version = await send(app, `/scripts/${id}/versions`, { content: "v2" });
    const change = await send(app, `/scripts/${id}/change-requests`, { reason: "x", deadline_date: "2026-03-20" });
    const again = await send(app, `/scripts/${id}/approve`);
    expect([version.status, change.status, again.status]).toEqual([409, 409, 409]);

    const after = await send(app, `/scripts/${id}`, undefined, "GET");
    expect(after.body.status).toBe("approved");
    expect(after.body.versions).toHaveLength(1);
    expect(after.body.change_requests).toEqual([]);
  });

  it("não aceita nova versão sem pedido de alteração aberto", async () => {
    const app = setup();
    const id = await newScript(app);
    expect((await send(app, `/scripts/${id}/versions`, { content: "v2" })).status).toBe(409);
  });

  it("não aceita dois pedidos seguidos, nem aprovar com pedido aberto", async () => {
    const app = setup();
    const id = await newScript(app);
    await send(app, `/scripts/${id}/change-requests`, { reason: "r1", deadline_date: "2026-03-15" });
    expect((await send(app, `/scripts/${id}/change-requests`, { reason: "r2", deadline_date: "2026-03-16" })).status).toBe(409);
    expect((await send(app, `/scripts/${id}/approve`)).status).toBe(409);
  });

  it("recusa conteúdo vazio e roteiro inexistente", async () => {
    const app = setup();
    expect((await send(app, "/scripts", { campaign_id: "cmp_1", content: " " })).status).toBe(400);
    expect((await send(app, "/scripts", { content: "x" })).status).toBe(400);
    expect((await send(app, "/scripts/nao_existe", undefined, "GET")).status).toBe(404);
    expect((await send(app, "/scripts/nao_existe/approve")).status).toBe(404);
  });

  it("pedido recusado não altera o roteiro", async () => {
    now = new Date("2026-03-13T03:00:00.000Z");
    const app = setup();
    const id = await newScript(app);
    await send(app, `/scripts/${id}/change-requests`, { reason: "x", deadline_date: "2026-03-12" });
    const after = await send(app, `/scripts/${id}`, undefined, "GET");
    expect(after.body.status).toBe("awaiting_review");
    expect(after.body.change_requests).toEqual([]);
  });
});
