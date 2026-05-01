/**
 * Thin Static Ads Lab HTTP client (api.staticadslab.com).
 * API rules and behavior: https://www.staticadslab.com/llms.txt
 */

import { createHash } from "node:crypto";
import { recipeLog, recipeWarn } from "./debug-log.js";

/** Production host; matches Base URL in https://www.staticadslab.com/llms.txt (not configurable here). */
const BASE_URL = "https://api.staticadslab.com";

/**
 * Reference helpers for scripts or CLIs that block until a single job or image ad finishes.
 * The Express recipe uses batched `GET /v1/image-ads?ids=...` instead; see llms.txt.
 */
const DEFAULT_JOB_POLL_MAX_ATTEMPTS = 160;
const DEFAULT_JOB_POLL_INTERVAL_MS = 3000;
const DEFAULT_IMAGE_AD_POLL_MAX_ATTEMPTS = 120;
const DEFAULT_IMAGE_AD_POLL_INTERVAL_MS = 3000;

type ApiEnvelope<T> = { data: T; meta: Record<string, unknown> };

export type SalAudience = {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  details: unknown;
  created_at: string;
  updated_at: string;
};

export type SalImageAd = {
  id: string;
  /** Queue job backing generation — poll `GET /v1/jobs/{job_id}` until terminal status (if absent, fall back to image-ad polling). */
  job_id?: string;
  status: "processing" | "completed" | "failed";
  image_url: string | null;
  error: { code: string; message: string } | null;
  design_template_id: string;
  brand_id: string;
  product_id: string;
  audience_id: string;
  prompt: string | null;
  progress?: {
    step: string;
    message: string;
    percentage: number;
  } | null;
  created_at?: string;
  completed_at?: string | null;
  duration_ms?: number | null;
};

type ImageAdListPayload = {
  data: SalImageAd[];
  has_more: boolean;
  meta: Record<string, unknown>;
};

/** Job row shape from `GET /v1/jobs/:id` — see llms.txt / async jobs. */
export type SalJobStatus = {
  job_id: string;
  type: string;
  status: "pending" | "processing" | "completed" | "failed" | "cancelled";
  progress?: number;
  result?: unknown;
  error?: string;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  updated_at: string;
};

export type CreateImageAdPayload = {
  design_template_id: string;
  brand_id: string;
  product_id: string;
  audience_id: string;
  product_variant_id?: string;
  prompt?: string;
  options?: { generate_ai_images?: boolean; generate_copy?: boolean };
};

/** Stable idempotency key from the exact JSON body sent on POST (llms.txt: Idempotency-Key). */
function idempotencyKeyForJsonBody(jsonBody: string): string {
  return createHash("sha256").update(jsonBody, "utf8").digest("hex");
}

function parseTopUpHint(errObj: Record<string, unknown>): string {
  const candidates = [
    errObj.top_up_url,
    errObj.topUpUrl,
    errObj.topup_url,
    (errObj.details as Record<string, unknown> | undefined)?.top_up_url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return "";
}

/** Build a concise message from SAL `{ error, meta }` (llms.txt response shape). */
function formatSalHttpError(
  status: number,
  body: unknown,
  fallbackText: string,
): string {
  if (typeof body !== "object" || body === null) {
    return fallbackText.slice(0, 900);
  }
  const root = body as Record<string, unknown>;
  const err = root.error;
  const parts: string[] = [];

  if (typeof err === "object" && err !== null) {
    const e = err as Record<string, unknown>;
    const code = typeof e.code === "string" ? e.code : "";
    const message = typeof e.message === "string" ? e.message : "";
    if (code) parts.push(`[${code}]`);
    if (message) parts.push(message);
    if (status === 402 || code === "INSUFFICIENT_BALANCE") {
      const url = parseTopUpHint(e);
      if (url) parts.push(`Top up: ${url}`);
    }
  }

  const meta = root.meta;
  if (typeof meta === "object" && meta !== null) {
    const rid = (meta as Record<string, unknown>).request_id;
    if (typeof rid === "string" && rid) parts.push(`request_id=${rid}`);
  }

  if (parts.length > 0) {
    return parts.join(" ").slice(0, 900);
  }
  return fallbackText.slice(0, 900);
}

async function salJson<T>(
  apiKey: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(
      `Static Ads Lab returned non-JSON (${res.status}): ${text.slice(0, 400)}`,
    );
  }

  if (!res.ok) {
    const msg = formatSalHttpError(res.status, body, text);
    recipeWarn(
      "SAL request error",
      init.method ?? "GET",
      path,
      res.status,
      msg.slice(0, 200),
    );
    throw new Error(
      `Static Ads Lab ${init.method ?? "GET"} ${path} (${res.status}): ${msg}`,
    );
  }

  // Avoid logging every GET (image-ad polling would spam the terminal).
  const method = init.method ?? "GET";
  if (method !== "GET") {
    recipeLog("SAL", method, path, res.status);
  }

  return body as T;
}

export async function createAudience(
  apiKey: string,
  body: { product_id: string; name: string; description?: string },
): Promise<SalAudience> {
  const jsonBody = JSON.stringify(body);
  const out = await salJson<ApiEnvelope<SalAudience>>(apiKey, "/v1/audiences", {
    method: "POST",
    body: jsonBody,
    headers: {
      "Idempotency-Key": idempotencyKeyForJsonBody(jsonBody),
    },
  });
  return out.data;
}

export async function createImageAd(
  apiKey: string,
  payload: CreateImageAdPayload,
): Promise<SalImageAd> {
  const jsonBody = JSON.stringify(payload);
  const out = await salJson<ApiEnvelope<SalImageAd>>(apiKey, "/v1/image-ads", {
    method: "POST",
    body: jsonBody,
    headers: {
      "Idempotency-Key": idempotencyKeyForJsonBody(jsonBody),
    },
  });
  return out.data;
}

export async function getImageAd(
  apiKey: string,
  id: string,
): Promise<SalImageAd> {
  const out = await salJson<ApiEnvelope<SalImageAd>>(
    apiKey,
    `/v1/image-ads/${encodeURIComponent(id)}`,
  );
  return out.data;
}

const IMAGE_AD_IDS_CHUNK = 80;

/**
 * Batched read: `GET /v1/image-ads?ids=...` (comma-separated). Chunks to stay under URL limits.
 * One client poll round-trip can refresh every row with a single SAL list call per chunk.
 */
export async function listImageAdsByIds(
  apiKey: string,
  ids: string[],
): Promise<Map<string, SalImageAd>> {
  const unique = [...new Set(ids.filter(Boolean))];
  const map = new Map<string, SalImageAd>();
  for (let i = 0; i < unique.length; i += IMAGE_AD_IDS_CHUNK) {
    const chunk = unique.slice(i, i + IMAGE_AD_IDS_CHUNK);
    const q = chunk.map((id) => encodeURIComponent(id)).join(",");
    const out = await salJson<ImageAdListPayload>(
      apiKey,
      `/v1/image-ads?ids=${q}`,
    );
    for (const ad of out.data) {
      map.set(ad.id, ad);
    }
  }
  return map;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getJob(
  apiKey: string,
  jobId: string,
): Promise<SalJobStatus> {
  const out = await salJson<ApiEnvelope<SalJobStatus>>(
    apiKey,
    `/v1/jobs/${encodeURIComponent(jobId)}`,
  );
  return out.data;
}

/**
 * Poll `GET /v1/jobs/{id}` until the job finishes.
 * Not used by the Express app (which uses batched image-ad listing); handy for one-off scripts.
 */
export async function waitForJobComplete(
  apiKey: string,
  jobId: string,
  options: {
    maxAttempts?: number;
    intervalMs?: number;
    /** For logs only */
    imageAdId?: string;
  } = {},
): Promise<SalJobStatus> {
  const maxAttempts =
    options.maxAttempts ?? DEFAULT_JOB_POLL_MAX_ATTEMPTS;
  const intervalMs =
    options.intervalMs ?? DEFAULT_JOB_POLL_INTERVAL_MS;

  recipeLog("SAL poll job start", {
    jobId,
    imageAdId: options.imageAdId,
    maxAttempts,
    intervalMs,
  });
  const pollStarted = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const job = await getJob(apiKey, jobId);
    if (
      job.status === "completed" ||
      job.status === "failed" ||
      job.status === "cancelled"
    ) {
      recipeLog("SAL poll job done", {
        jobId,
        status: job.status,
        attempts: attempt + 1,
        ms: Date.now() - pollStarted,
        progress: job.progress,
      });
      return job;
    }
    if (attempt === 0 || attempt % 25 === 0) {
      recipeLog("SAL job still running", {
        jobId,
        attempt: attempt + 1,
        maxAttempts,
        status: job.status,
        progress: job.progress,
      });
    }
    await sleep(intervalMs);
  }

  recipeWarn("SAL poll job timed out", { jobId, maxAttempts });
  throw new Error(`Timed out waiting for job ${jobId}`);
}

/**
 * Poll `GET /v1/image-ads/:id` until terminal. Not used by the Express app.
 */
export async function waitForImageAdComplete(
  apiKey: string,
  imageAdId: string,
  options: { maxAttempts?: number; intervalMs?: number } = {},
): Promise<SalImageAd> {
  const maxAttempts =
    options.maxAttempts ?? DEFAULT_IMAGE_AD_POLL_MAX_ATTEMPTS;
  const intervalMs =
    options.intervalMs ?? DEFAULT_IMAGE_AD_POLL_INTERVAL_MS;

  recipeLog("SAL poll image-ad start", {
    imageAdId,
    maxAttempts,
    intervalMs,
  });
  const pollStarted = Date.now();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const ad = await getImageAd(apiKey, imageAdId);
    if (ad.status === "completed" || ad.status === "failed") {
      recipeLog("SAL poll image-ad done", {
        imageAdId,
        status: ad.status,
        attempts: attempt + 1,
        ms: Date.now() - pollStarted,
      });
      return ad;
    }
    if (attempt === 0 || attempt % 15 === 0) {
      recipeLog("SAL poll image-ad still processing", {
        imageAdId,
        attempt: attempt + 1,
        maxAttempts,
        status: ad.status,
      });
    }
    await sleep(intervalMs);
  }

  recipeWarn("SAL poll image-ad timed out", { imageAdId, maxAttempts });
  throw new Error(
    `Timed out waiting for image ad ${imageAdId} to finish processing`,
  );
}
