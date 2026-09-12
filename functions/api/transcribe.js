const MODELS = [
  '@cf/openai/whisper-large-v3-turbo',
  '@cf/openai/whisper'
];
const MAX_AUDIO_BYTES = 4 * 1024 * 1024;

const LANGUAGES = new Set(['en', 'el', 'fr', 'de', 'es', 'it', 'ro', 'zh', 'ja', 'ru']);
const ALLOWED_MIME_TYPES = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'video/webm',
  'application/octet-stream'
]);

function json(data, status = 200, extraHeaders = {}) {
  return Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    }
  });
}

function baseMimeType(value) {
  return String(value || '').split(';', 1)[0].trim().toLowerCase();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function extractText(result) {
  if (typeof result?.text === 'string') return result.text;
  if (typeof result?.transcription_info?.text === 'string') return result.transcription_info.text;
  if (typeof result?.result?.text === 'string') return result.result.text;
  return '';
}

function cleanTranscript(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

async function transcribe(ai, model, audioBuffer, language) {
  if (model === '@cf/openai/whisper-large-v3-turbo') {
    return ai.run(model, {
      audio: arrayBufferToBase64(audioBuffer),
      task: 'transcribe',
      language,
      vad_filter: true,
      beam_size: 1,
      condition_on_previous_text: false,
      initial_prompt: language === 'el'
        ? "Σύντομη ερώτηση επισκέπτη προς το Afroditi's Guest House στο Πήλιο."
        : "A guest's short question to Afroditi's Guest House in Pelion, Greece."
    });
  }

  return ai.run(model, {
    audio: Array.from(new Uint8Array(audioBuffer))
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestUrl = new URL(request.url);
  const origin = request.headers.get('Origin');

  if (origin && origin !== requestUrl.origin) {
    return json({ error: 'Cross-origin requests are not allowed.' }, 403);
  }

  if (!env?.AI || typeof env.AI.run !== 'function') {
    return json({ error: 'Workers AI binding is not configured.', code: 'AI_BINDING_MISSING' }, 503);
  }

  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > MAX_AUDIO_BYTES + 100000) {
    return json({ error: 'Audio recording is too large.' }, 413);
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'Expected multipart audio data.' }, 400);
  }

  const audioFile = form.get('audio');
  const requestedLanguage = String(form.get('lang') || 'en').toLowerCase();
  const language = LANGUAGES.has(requestedLanguage) ? requestedLanguage : 'en';

  if (!audioFile || typeof audioFile.arrayBuffer !== 'function') {
    return json({ error: 'Audio recording is required.' }, 400);
  }
  if (audioFile.size < 128 || audioFile.size > MAX_AUDIO_BYTES) {
    return json({ error: 'Audio recording has an invalid size.' }, audioFile.size > MAX_AUDIO_BYTES ? 413 : 400);
  }

  const mimeType = baseMimeType(audioFile.type);
  if (mimeType && !ALLOWED_MIME_TYPES.has(mimeType)) {
    return json({ error: 'Unsupported audio format.' }, 415);
  }

  const audioBuffer = await audioFile.arrayBuffer();
  const failures = [];

  for (const model of MODELS) {
    try {
      const result = await transcribe(env.AI, model, audioBuffer, language);
      const text = cleanTranscript(extractText(result));
      if (text) {
        return json({ text }, 200, { 'X-Var-Var-Voice': model });
      }
      failures.push({ model, message: 'Empty transcription' });
    } catch (error) {
      failures.push({ model, name: error?.name, message: error?.message });
    }
  }

  console.error('All voice transcription models failed', failures);
  return json({ error: 'Voice transcription is temporarily unavailable.' }, 503);
}

export function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: 'POST, OPTIONS',
      'Cache-Control': 'no-store'
    }
  });
}

export function onRequest() {
  return json({ error: 'Method not allowed.' }, 405, { Allow: 'POST, OPTIONS' });
}
