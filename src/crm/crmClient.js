const DEFAULT_BASE_URL = "https://crm.example.com/v1";
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_ATTEMPTS = 4;
const BASE_BACKOFF_MS = 250;

export class CrmClientError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, retryable?: boolean, cause?: unknown }} [meta]
   */
  constructor(message, meta = {}) {
    super(message);
    this.name = "CrmClientError";
    this.status = meta.status;
    this.retryable = Boolean(meta.retryable);
    this.cause = meta.cause;
  }
}

function sleep(ms, wait = setTimeout) {
  return new Promise((resolve) => wait(resolve, ms));
}

function redactSecrets(value) {
  if (value == null) return value;
  return String(value).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");
}

function buildIdempotencyKey(lead) {
  // Stable pour un même lead métier : évite un doublon CRM sur retry réseau.
  const raw = [lead.listingId, lead.email, lead.phone, lead.message ?? ""]
    .map((p) => String(p ?? "").trim().toLowerCase())
    .join("|");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `lead-${hash.toString(16)}`;
}

function isRetryableStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503;
}

function computeBackoffMs(attempt, retryAfterHeader) {
  if (retryAfterHeader != null && retryAfterHeader !== "") {
    const seconds = Number.parseInt(String(retryAfterHeader), 10);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }
  }
  const exp = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 100);
  return exp + jitter;
}

/**
 * Client CRM : timeout, retries, Idempotency-Key, token hors logs.
 *
 * @param {object} [options]
 * @param {string} [options.token]
 * @param {string} [options.baseUrl]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxAttempts]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {typeof setTimeout} [options.sleepImpl]
 */
export function createCrmClient(options = {}) {
  const token = options.token ?? process.env.CRM_API_TOKEN;
  const baseUrl = (options.baseUrl ?? process.env.CRM_API_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/$/,
    ""
  );
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const sleepImpl = options.sleepImpl ?? setTimeout;

  if (!token) {
    throw new CrmClientError("CRM_API_TOKEN manquant");
  }

  /**
   * @param {{ listingId: string|number, name: string, phone: string, email: string, message?: string }} lead
   * @returns {Promise<{ id: string, createdAt: string }>}
   */
  async function createLead(lead) {
    if (!lead?.listingId || !lead?.name || !lead?.phone || !lead?.email) {
      throw new CrmClientError("lead invalide: listingId, name, phone, email requis", {
        status: 400,
        retryable: false,
      });
    }

    const idempotencyKey = buildIdempotencyKey(lead);
    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(`${baseUrl}/leads`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            listingId: lead.listingId,
            name: lead.name,
            phone: lead.phone,
            email: lead.email,
            message: lead.message ?? "",
          }),
          signal: controller.signal,
        });

        if (response.status === 201) {
          return await response.json();
        }

        const retryable = isRetryableStatus(response.status);
        const safeStatus = response.status;
        lastError = new CrmClientError(`CRM createLead échoué (HTTP ${safeStatus})`, {
          status: safeStatus,
          retryable,
        });

        if (!retryable || attempt === maxAttempts) {
          throw lastError;
        }

        const waitMs = computeBackoffMs(attempt, response.headers.get("Retry-After"));
        await sleep(waitMs, sleepImpl);
      } catch (err) {
        if (err instanceof CrmClientError) {
          throw err;
        }

        const aborted = err?.name === "AbortError";
        lastError = new CrmClientError(
          aborted ? "CRM createLead timeout" : redactSecrets(err?.message ?? "CRM createLead erreur réseau"),
          { retryable: true, cause: err }
        );

        if (attempt === maxAttempts) {
          throw lastError;
        }
        await sleep(computeBackoffMs(attempt), sleepImpl);
      } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new CrmClientError("CRM createLead abandonné");
  }

  return { createLead, buildIdempotencyKey };
}

export { buildIdempotencyKey };
