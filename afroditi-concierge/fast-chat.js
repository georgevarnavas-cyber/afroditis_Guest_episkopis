(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const answerCache = new Map();
  const pendingRequests = new Map();
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 30;
  const REQUEST_TIMEOUT_MS = 15000;
  const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

  function isAskRequest(input) {
    try {
      const rawUrl = typeof input === 'string' ? input : input.url;
      return new URL(rawUrl, location.href).pathname === '/api/ask';
    } catch {
      return false;
    }
  }

  function requestKey(init) {
    try {
      const payload = JSON.parse(init?.body || '{}');
      const message = String(payload.message || '').trim().toLocaleLowerCase();
      const language = String(payload.lang || 'en');
      return message ? `${language}\u0000${message}` : '';
    } catch {
      return '';
    }
  }

  function jsonResponse(data) {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Var-Var-Cache': 'HIT'
      }
    });
  }

  function pruneCache(now) {
    for (const [key, entry] of answerCache) {
      if (now - entry.savedAt > CACHE_TTL_MS) answerCache.delete(key);
    }
    while (answerCache.size > MAX_CACHE_ENTRIES) {
      answerCache.delete(answerCache.keys().next().value);
    }
  }

  function combinedSignal(callerSignal, timeoutSignal) {
    if (!callerSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([callerSignal, timeoutSignal]);
    }
    return timeoutSignal;
  }

  async function fetchWithTimeout(input, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const options = {
      ...init,
      signal: combinedSignal(init?.signal, controller.signal)
    };

    try {
      let response = await originalFetch(input, options);
      if (RETRYABLE_STATUS.has(response.status) && !controller.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 180));
        response = await originalFetch(input, options);
      }
      return response;
    } finally {
      clearTimeout(timer);
    }
  }

  window.fetch = function fastFetch(input, init = {}) {
    if (!isAskRequest(input)) return originalFetch(input, init);

    const key = requestKey(init);
    const now = Date.now();
    pruneCache(now);

    const cached = key && answerCache.get(key);
    if (cached && now - cached.savedAt <= CACHE_TTL_MS) {
      return Promise.resolve(jsonResponse(cached.data));
    }

    if (key && pendingRequests.has(key)) {
      return pendingRequests.get(key).then(response => response.clone());
    }

    const request = fetchWithTimeout(input, init).then(async response => {
      if (key && response.ok) {
        try {
          const data = await response.clone().json();
          if (data && typeof data.reply === 'string' && data.reply.trim()) {
            answerCache.set(key, { data, savedAt: Date.now() });
            pruneCache(Date.now());
          }
        } catch {
          // A valid network response should still reach the chat if it is not JSON.
        }
      }
      return response;
    });

    if (key) {
      pendingRequests.set(key, request);
      request.then(
        () => pendingRequests.delete(key),
        () => pendingRequests.delete(key)
      );
    }

    return request.then(response => response.clone());
  };
})();
