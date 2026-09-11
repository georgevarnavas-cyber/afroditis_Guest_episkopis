(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);
  const answerCache = new Map();
  const pendingRequests = new Map();
  const CACHE_TTL_MS = 30 * 60 * 1000;
  const MAX_CACHE_ENTRIES = 30;
  const PRIMARY_QUESTIONS = 3;
  const PRIMARY_HEDGE_DELAY_MS = 2800;
  const FALLBACK_HEDGE_DELAY_MS = 3200;
  const PRIMARY_TIMEOUT_MS = 9000;
  const FALLBACK_TIMEOUT_MS = 11000;
  const SESSION_COUNTER_KEY = 'varvar.ai.freeQuestionCount.v8';
  const FALLBACK_URL = '/api/ask-fallback';
  let memoryQuestionCount = 0;

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

  function jsonResponse(data, source = 'memory') {
    return new Response(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Var-Var-AI': source
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

  function nextQuestionNumber() {
    try {
      const previous = Number.parseInt(sessionStorage.getItem(SESSION_COUNTER_KEY) || '0', 10);
      const next = Number.isFinite(previous) ? previous + 1 : 1;
      sessionStorage.setItem(SESSION_COUNTER_KEY, String(next));
      return next;
    } catch {
      memoryQuestionCount += 1;
      return memoryQuestionCount;
    }
  }

  function combinedSignal(callerSignal, timeoutSignal) {
    if (!callerSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([callerSignal, timeoutSignal]);
    }
    return timeoutSignal;
  }

  async function timedFetch(input, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await originalFetch(input, {
        ...init,
        signal: combinedSignal(init?.signal, controller.signal)
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function requireSuccess(promise) {
    const response = await promise;
    if (!response.ok) {
      const error = new Error(`AI request failed (${response.status})`);
      error.response = response;
      throw error;
    }
    return response;
  }

  async function primaryWithHedgedFallback(input, init) {
    let releaseFallback;
    let fallbackReleased = false;
    const fallbackGate = new Promise(resolve => {
      releaseFallback = () => {
        if (!fallbackReleased) {
          fallbackReleased = true;
          resolve();
        }
      };
    });
    const hedgeTimer = setTimeout(releaseFallback, PRIMARY_HEDGE_DELAY_MS);

    const primary = requireSuccess(timedFetch(input, init, PRIMARY_TIMEOUT_MS)).catch(error => {
      releaseFallback();
      throw error;
    });
    const fallback = fallbackGate.then(() =>
      requireSuccess(timedFetch(FALLBACK_URL, init, FALLBACK_TIMEOUT_MS))
    );

    try {
      return await Promise.any([primary, fallback]);
    } catch (aggregateError) {
      const errors = aggregateError?.errors || [];
      const responseError = errors.find(error => error?.response);
      if (responseError) return responseError.response;
      throw errors[0] || aggregateError;
    } finally {
      clearTimeout(hedgeTimer);
    }
  }

  async function fallbackWithHedgedPrimary(input, init) {
    let releasePrimary;
    let primaryReleased = false;
    const primaryGate = new Promise(resolve => {
      releasePrimary = () => {
        if (!primaryReleased) {
          primaryReleased = true;
          resolve();
        }
      };
    });
    const hedgeTimer = setTimeout(releasePrimary, FALLBACK_HEDGE_DELAY_MS);

    const fallback = requireSuccess(timedFetch(FALLBACK_URL, init, FALLBACK_TIMEOUT_MS)).catch(error => {
      releasePrimary();
      throw error;
    });
    const primary = primaryGate.then(() =>
      requireSuccess(timedFetch(input, init, PRIMARY_TIMEOUT_MS))
    );

    try {
      return await Promise.any([fallback, primary]);
    } catch (aggregateError) {
      const errors = aggregateError?.errors || [];
      const responseError = errors.find(error => error?.response);
      if (responseError) return responseError.response;
      throw errors[0] || aggregateError;
    } finally {
      clearTimeout(hedgeTimer);
    }
  }

  async function fetchAI(input, init) {
    const questionNumber = nextQuestionNumber();
    if (questionNumber <= PRIMARY_QUESTIONS) {
      return primaryWithHedgedFallback(input, init);
    }
    return fallbackWithHedgedPrimary(input, init);
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

    const request = fetchAI(input, init).then(async response => {
      if (key && response.ok) {
        try {
          const data = await response.clone().json();
          if (data && typeof data.reply === 'string' && data.reply.trim()) {
            answerCache.set(key, { data, savedAt: Date.now() });
            pruneCache(Date.now());
          }
        } catch {
          // Return the original response even if an upstream service sent non-JSON data.
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
