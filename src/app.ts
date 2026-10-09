import { Hono } from "hono";
import type { Context } from "hono";
import * as flow from "./scripts.ts";
import type { Result, Script } from "./scripts.ts";

export type AppOptions = {
  clock?: () => Date;
  newId?: () => string;
};

const STATUS_BY_ERROR = { invalid: 400, wrong_state: 409, deadline_passed: 422 } as const;

async function readBody(c: Context): Promise<Record<string, unknown>> {
  const body = await c.req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

export function createApp(options: AppOptions = {}) {
  const clock = options.clock ?? (() => new Date());
  const newId = options.newId ?? (() => crypto.randomUUID());
  const scripts = new Map<string, Script>();
  const app = new Hono();

  function respond(c: Context, result: Result<Script>, onOk: (script: Script) => Script, okStatus: 200 | 201 = 200) {
    if (!result.ok) {
      return c.json({ error: result.error.kind, message: result.error.message }, STATUS_BY_ERROR[result.error.kind]);
    }
    const script = onOk(result.value);
    scripts.set(script.id, script);
    return c.json(script, okStatus);
  }

  app.get("/health", (c) => c.json({ ok: true }));

  app.post("/scripts", async (c) => {
    const result = flow.createScript(newId(), await readBody(c), clock());
    return respond(c, result, (script) => script, 201);
  });

  app.get("/scripts/:id", (c) => {
    const script = scripts.get(c.req.param("id"));
    return script ? c.json(script) : c.json({ error: "not_found", message: "roteiro não encontrado" }, 404);
  });

  app.post("/scripts/:id/versions", async (c) => {
    const script = scripts.get(c.req.param("id"));
    if (!script) return c.json({ error: "not_found", message: "roteiro não encontrado" }, 404);
    return respond(c, flow.submitVersion(script, await readBody(c), clock()), (next) => next, 201);
  });

  app.post("/scripts/:id/change-requests", async (c) => {
    const script = scripts.get(c.req.param("id"));
    if (!script) return c.json({ error: "not_found", message: "roteiro não encontrado" }, 404);
    return respond(c, flow.requestChange(script, newId(), await readBody(c), clock()), (next) => next, 201);
  });

  app.post("/scripts/:id/approve", (c) => {
    const script = scripts.get(c.req.param("id"));
    if (!script) return c.json({ error: "not_found", message: "roteiro não encontrado" }, 404);
    return respond(c, flow.approve(script, clock()), (next) => next);
  });

  return app;
}
