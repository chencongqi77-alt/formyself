export type LoadJsonOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
};

type ResolvedLoadJsonOptions = Required<LoadJsonOptions>;

const defaultOptions: ResolvedLoadJsonOptions = {
  timeoutMs: 12000,
  retries: 2,
  retryDelayMs: 500,
};

// Module pages share static release files. Retain successful responses for the
// current client session and share an in-flight request so switching reading
// views does not download and parse the same JSON again.
const requestCache = new Map<string, Promise<unknown>>();
const maxCachedRequests = 24;

function cacheKey(path: string, options: ResolvedLoadJsonOptions) {
  return [
    path,
    options.timeoutMs,
    options.retries,
    options.retryDelayMs,
  ].join("\u0000");
}

export function loadJson<T>(
  path: string,
  options: LoadJsonOptions = {},
): Promise<T> {
  const resolvedOptions = { ...defaultOptions, ...options };
  const key = cacheKey(path, resolvedOptions);
  const cached = requestCache.get(key);
  if (cached) {
    // Refresh the insertion order so frequently revisited reading modules stay
    // warm without retaining every corpus file for an entire long session.
    requestCache.delete(key);
    requestCache.set(key, cached);
    return cached as Promise<T>;
  }

  const request = requestJson<T>(path, resolvedOptions);
  requestCache.set(key, request);
  while (requestCache.size > maxCachedRequests) {
    const oldestKey = requestCache.keys().next().value;
    if (typeof oldestKey !== "string") break;
    requestCache.delete(oldestKey);
  }
  void request.catch(() => {
    // Failed requests must remain retryable when the user revisits a module.
    if (requestCache.get(key) === request) requestCache.delete(key);
  });
  return request;
}

// Fetch JSON with an abort timeout and bounded retries so a stalled request
// cannot leave the page stuck on its loading shell forever.
async function requestJson<T>(
  path: string,
  { timeoutMs, retries, retryDelayMs }: ResolvedLoadJsonOptions,
): Promise<T> {
  let lastError: unknown = new Error("请求未发出");

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, { signal: controller.signal });
      if (!response.ok) {
        throw new Error("无法读取 " + path + "（HTTP " + response.status + "）");
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, retryDelayMs * (attempt + 1)),
        );
      }
    } finally {
      window.clearTimeout(timer);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("无法读取 " + path);
}
