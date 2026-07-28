import { createHash } from "node:crypto";
import type { ActionExecutor } from "@eauto/application";
import {
  assertMercadoLibreWriteAllowed,
  type BusinessAction,
  type MercadoLibreQuestionAnswerWriteGrant,
} from "@eauto/domain";

const MAXIMUM_ANSWER_CHARACTERS = 2_000;

export type MercadoLibreQuestionAnswerCredential = Readonly<{
  accessToken: string;
  sellerId: string;
}>;

export type ForReadingMercadoLibreQuestionAnswerCredential = Readonly<{
  get(accountId: string): Promise<MercadoLibreQuestionAnswerCredential>;
}>;

export type MercadoLibreQuestionAnswerExecutorConfig = Readonly<{
  apiBaseUrl: string;
  allowedAccountId: string;
  policyVersion: string;
  timeoutMs: number;
  maximumResponseBytes: number;
}>;

type AnswerCommand = Readonly<{
  questionId: string;
  questionIdNumber: number;
  text: string;
  answerHash: string;
}>;

type RemoteAnswer = Readonly<{
  text: string;
  status: string;
  dateCreated: string;
}>;

type RemoteQuestion = Readonly<{
  questionId: string;
  itemId: string;
  sellerId: string;
  status: string;
  answer: RemoteAnswer | null;
  sourceHash: string;
}>;

export class MercadoLibreQuestionAnswerExecutor implements ActionExecutor {
  private readonly apiBaseUrl: URL;
  private readonly grant: MercadoLibreQuestionAnswerWriteGrant;

  constructor(
    private readonly credentials: ForReadingMercadoLibreQuestionAnswerCredential,
    private readonly config: MercadoLibreQuestionAnswerExecutorConfig,
  ) {
    this.apiBaseUrl = validateApiBaseUrl(config.apiBaseUrl);
    if (!config.allowedAccountId.trim()) throw new Error("Allowed MercadoLibre account is required.");
    if (!config.policyVersion.trim()) throw new Error("Question answer policy version is required.");
    if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1_000) {
      throw new Error("MercadoLibre question answer timeout must be at least 1000 ms.");
    }
    if (!Number.isSafeInteger(config.maximumResponseBytes) || config.maximumResponseBytes < 1_024) {
      throw new Error("MercadoLibre question answer response limit must be at least 1024 bytes.");
    }
    this.grant = Object.freeze({
      action: "question.answer",
      policyVersion: config.policyVersion,
    });
  }

  async execute(action: BusinessAction): Promise<{ providerReceipt: unknown }> {
    const command = this.readCommand(action, "executing");
    const credential = await this.readCredential(action.accountId);
    const current = await this.getQuestion(command.questionId, credential.accessToken);
    this.assertSeller(current, credential.sellerId);

    if (current.answer !== null) {
      if (current.answer.text !== command.text) {
        throw new Error("MercadoLibre question already has a different answer.");
      }
      return {
        providerReceipt: this.receipt(action, current, command.answerHash, true),
      };
    }
    if (current.status.toLowerCase() !== "unanswered") {
      throw new Error(`MercadoLibre question cannot be answered from status ${current.status}.`);
    }

    const answered = await this.postAnswer(command, credential.accessToken);
    this.assertSeller(answered, credential.sellerId);
    if (answered.questionId !== command.questionId) {
      throw new Error("MercadoLibre answered a different question than requested.");
    }
    if (answered.answer?.text !== command.text) {
      throw new Error("MercadoLibre did not return the approved answer text.");
    }

    return {
      providerReceipt: this.receipt(action, answered, command.answerHash, false),
    };
  }

  async verify(action: BusinessAction): Promise<{ verified: boolean; observedState: unknown }> {
    const command = this.readCommand(action, "executed");
    const credential = await this.readCredential(action.accountId);
    const observed = await this.getQuestion(command.questionId, credential.accessToken);
    this.assertSeller(observed, credential.sellerId);
    const verified =
      observed.questionId === command.questionId &&
      observed.answer?.text === command.text &&
      observed.answer.status.toLowerCase() === "active";
    return {
      verified,
      observedState: Object.freeze({
        provider: "mercadolibre",
        operation: "question.answer",
        questionId: observed.questionId,
        itemId: observed.itemId,
        sellerId: observed.sellerId,
        questionStatus: observed.status,
        answerStatus: observed.answer?.status ?? null,
        answerHash: observed.answer ? hashText(observed.answer.text) : null,
        sourceHash: observed.sourceHash,
      }),
    };
  }

  private readCommand(action: BusinessAction, expectedStatus: "executing" | "executed"): AnswerCommand {
    if (action.accountId !== this.config.allowedAccountId) {
      throw new Error(`MercadoLibre question answers are not enabled for account ${action.accountId}.`);
    }
    if (action.policyVersion !== this.config.policyVersion) {
      throw new Error("MercadoLibre question answer policy version does not match runtime policy.");
    }
    assertMercadoLibreWriteAllowed(action.kind, this.grant);
    if (action.status !== expectedStatus) {
      throw new Error(`MercadoLibre question answer requires action status ${expectedStatus}.`);
    }
    if (!/^\d+$/.test(action.target)) {
      throw new Error("MercadoLibre question target must be a numeric question ID.");
    }
    const questionIdNumber = Number(action.target);
    if (!Number.isSafeInteger(questionIdNumber) || questionIdNumber <= 0) {
      throw new Error("MercadoLibre question ID exceeds the safe integer range.");
    }
    if (action.exactChanges.length !== 1) {
      throw new Error("MercadoLibre question answer requires exactly one approved change.");
    }
    const change = action.exactChanges[0];
    if (change?.field !== "answer.text" || change.from !== null || typeof change.to !== "string") {
      throw new Error("MercadoLibre question answer change must be answer.text from null to text.");
    }
    const text = change.to.trim();
    if (!text) throw new Error("MercadoLibre answer text cannot be empty.");
    if (text.length > MAXIMUM_ANSWER_CHARACTERS) {
      throw new Error(`MercadoLibre answer text cannot exceed ${MAXIMUM_ANSWER_CHARACTERS} characters.`);
    }
    return Object.freeze({
      questionId: action.target,
      questionIdNumber,
      text,
      answerHash: hashText(text),
    });
  }

  private async readCredential(accountId: string): Promise<MercadoLibreQuestionAnswerCredential> {
    const credential = await this.credentials.get(accountId);
    if (!credential.accessToken.trim()) throw new Error("MercadoLibre access token is unavailable.");
    if (!/^\d+$/.test(credential.sellerId)) {
      throw new Error("MercadoLibre seller identity is invalid.");
    }
    return credential;
  }

  private assertSeller(question: RemoteQuestion, expectedSellerId: string): void {
    if (question.sellerId !== expectedSellerId) {
      throw new Error(
        `MercadoLibre question belongs to seller ${question.sellerId}, expected ${expectedSellerId}.`,
      );
    }
  }

  private getQuestion(questionId: string, accessToken: string): Promise<RemoteQuestion> {
    const path = `/questions/${encodeURIComponent(questionId)}?api_version=4`;
    return this.requestQuestion(path, accessToken, { method: "GET" });
  }

  private postAnswer(command: AnswerCommand, accessToken: string): Promise<RemoteQuestion> {
    return this.requestQuestion("/answers", accessToken, {
      method: "POST",
      body: JSON.stringify({ question_id: command.questionIdNumber, text: command.text }),
    });
  }

  private async requestQuestion(
    path: string,
    accessToken: string,
    init: Readonly<{ method: "GET" | "POST"; body?: string }>,
  ): Promise<RemoteQuestion> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.apiBaseUrl), {
        method: init.method,
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          ...(init.body ? { "content-type": "application/json; charset=utf-8" } : {}),
        },
        ...(init.body ? { body: init.body } : {}),
        redirect: "error",
        signal: controller.signal,
      });
      const text = await readLimitedText(response, this.config.maximumResponseBytes);
      if (!response.ok) {
        throw new Error(
          `MercadoLibre question ${init.method} failed with HTTP ${response.status}: ${sanitize(text)}`,
        );
      }
      if (!text) throw new Error("MercadoLibre question response was empty.");
      let payload: unknown;
      try {
        payload = JSON.parse(text) as unknown;
      } catch {
        throw new Error("MercadoLibre question response was not valid JSON.");
      }
      return normalizeQuestion(payload);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`MercadoLibre question request timed out after ${this.config.timeoutMs} ms.`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private receipt(
    action: BusinessAction,
    question: RemoteQuestion,
    answerHash: string,
    idempotent: boolean,
  ): unknown {
    return Object.freeze({
      provider: "mercadolibre",
      operation: "question.answer",
      actionId: action.id,
      accountId: action.accountId,
      questionId: question.questionId,
      itemId: question.itemId,
      sellerId: question.sellerId,
      questionStatus: question.status,
      answerStatus: question.answer?.status ?? null,
      answerHash,
      sourceHash: question.sourceHash,
      idempotent,
      externalMutation: !idempotent,
    });
  }
}

function validateApiBaseUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "api.mercadolibre.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("MercadoLibre question answer API must use https://api.mercadolibre.com.");
  }
  return new URL("/", url);
}

function normalizeQuestion(value: unknown): RemoteQuestion {
  const question = asRecord(value, "MercadoLibre question");
  const rawAnswer = question.answer;
  const answer =
    rawAnswer === null || rawAnswer === undefined
      ? null
      : normalizeAnswer(asRecord(rawAnswer, "MercadoLibre answer"));
  const normalized = {
    questionId: readStringOrNumber(question, "id"),
    itemId: readString(question, "item_id"),
    sellerId: readStringOrNumber(question, "seller_id"),
    status: readString(question, "status"),
    answer,
  };
  return Object.freeze({ ...normalized, sourceHash: hashCanonical(normalized) });
}

function normalizeAnswer(answer: Record<string, unknown>): RemoteAnswer {
  return Object.freeze({
    text: readString(answer, "text"),
    status: readString(answer, "status"),
    dateCreated: readString(answer, "date_created"),
  });
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a string.`);
  return value;
}

function readStringOrNumber(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  throw new Error(`${field} must be a string or safe integer.`);
}

async function readLimitedText(response: Response, maximumBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error(`MercadoLibre question response exceeds ${maximumBytes} bytes.`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > maximumBytes) {
    throw new Error(`MercadoLibre question response exceeds ${maximumBytes} bytes.`);
  }
  return new TextDecoder().decode(buffer);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hashCanonical(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function sanitize(value: string): string {
  return value.replaceAll(/[\r\n\t]+/g, " ").slice(0, 500);
}
