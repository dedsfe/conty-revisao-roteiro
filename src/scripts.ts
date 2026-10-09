import { civilDayInBrandZone, isValidCivilDay } from "./civil-day.ts";

export type ScriptStatus = "awaiting_review" | "changes_requested" | "approved";

export type ScriptVersion = {
  number: number;
  content: string;
  submitted_at: string;
};

export type ChangeRequest = {
  id: string;
  version_number: number;
  reason: string;
  deadline_date: string;
  requested_at: string;
};

export type Script = {
  id: string;
  campaign_id: string;
  status: ScriptStatus;
  versions: ScriptVersion[];
  change_requests: ChangeRequest[];
  approved_at: string | null;
};

export type DomainError =
  | { kind: "invalid"; message: string }
  | { kind: "wrong_state"; message: string }
  | { kind: "deadline_passed"; message: string };

export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

const MAX_CONTENT = 20_000;
const MAX_REASON = 2_000;

function invalid(message: string): Result<never> {
  return { ok: false, error: { kind: "invalid", message } };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

// Regras de estado puras. Sem HTTP, sem armazenamento: o relógio entra como argumento.
export function createScript(
  id: string,
  input: { campaign_id?: unknown; content?: unknown },
  now: Date,
): Result<Script> {
  const campaignId = cleanText(input.campaign_id, 200);
  if (!campaignId) return invalid("campaign_id é obrigatório");
  const content = cleanText(input.content, MAX_CONTENT);
  if (!content) return invalid(`content é obrigatório (até ${MAX_CONTENT} caracteres)`);
  return {
    ok: true,
    value: {
      id,
      campaign_id: campaignId,
      status: "awaiting_review",
      versions: [{ number: 1, content, submitted_at: now.toISOString() }],
      change_requests: [],
      approved_at: null,
    },
  };
}

export function submitVersion(script: Script, input: { content?: unknown }, now: Date): Result<Script> {
  if (script.status === "approved") {
    return { ok: false, error: { kind: "wrong_state", message: "roteiro já aprovado: não aceita nova versão" } };
  }
  if (script.status !== "changes_requested") {
    return {
      ok: false,
      error: { kind: "wrong_state", message: "só dá para enviar nova versão depois de um pedido de alteração" },
    };
  }
  const content = cleanText(input.content, MAX_CONTENT);
  if (!content) return invalid(`content é obrigatório (até ${MAX_CONTENT} caracteres)`);
  return {
    ok: true,
    value: {
      ...script,
      status: "awaiting_review",
      versions: [...script.versions, { number: script.versions.length + 1, content, submitted_at: now.toISOString() }],
    },
  };
}

export function requestChange(
  script: Script,
  id: string,
  input: { reason?: unknown; deadline_date?: unknown },
  now: Date,
): Result<Script> {
  if (script.status === "approved") {
    return { ok: false, error: { kind: "wrong_state", message: "roteiro já aprovado: não aceita pedido de alteração" } };
  }
  if (script.status !== "awaiting_review") {
    return {
      ok: false,
      error: { kind: "wrong_state", message: "já existe um pedido de alteração aberto; aguarde a nova versão" },
    };
  }
  const reason = cleanText(input.reason, MAX_REASON);
  if (!reason) return invalid(`reason (motivo) é obrigatório (até ${MAX_REASON} caracteres)`);
  if (!isValidCivilDay(input.deadline_date)) {
    return invalid("deadline_date (prazo) é obrigatório no formato YYYY-MM-DD, com data real");
  }
  // O dia do prazo vale inteiro no fuso da marca, até o último instante dele.
  if (input.deadline_date < civilDayInBrandZone(now)) {
    return { ok: false, error: { kind: "deadline_passed", message: "o prazo já passou" } };
  }
  const current = script.versions[script.versions.length - 1]!;
  return {
    ok: true,
    value: {
      ...script,
      status: "changes_requested",
      change_requests: [
        ...script.change_requests,
        {
          id,
          version_number: current.number,
          reason,
          deadline_date: input.deadline_date,
          requested_at: now.toISOString(),
        },
      ],
    },
  };
}

export function approve(script: Script, now: Date): Result<Script> {
  if (script.status === "approved") {
    return { ok: false, error: { kind: "wrong_state", message: "roteiro já aprovado" } };
  }
  if (script.status !== "awaiting_review") {
    return {
      ok: false,
      error: { kind: "wrong_state", message: "há um pedido de alteração aberto; só dá para aprovar uma versão enviada" },
    };
  }
  return { ok: true, value: { ...script, status: "approved", approved_at: now.toISOString() } };
}
