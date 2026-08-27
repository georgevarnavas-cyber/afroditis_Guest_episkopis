// Cloudflare Pages Function: POST /api/speak
// Secure proxy to the ElevenLabs Text-to-Speech API.

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";
const SUPPORTED_LANGUAGES = new Set([
    "en", "he", "el", "fr", "de", "es", "it", "zh", "ja", "ru"
]);

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const apiKey = env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return json({ error: "ELEVENLABS_API_KEY is not configured." }, 500);
        }

        let body;
        try {
            body = await request.json();
        } catch (error) {
            return json({ error: "Invalid JSON body." }, 400);
        }

        const text = String(body?.text || "").trim().slice(0, 800);
        if (!text) {
            return json({ error: "Empty text." }, 400);
        }

        const requestedLanguage = String(body?.lang || "en")
            .trim()
            .toLowerCase()
            .split("-")[0];
        const languageCode = SUPPORTED_LANGUAGES.has(requestedLanguage)
            ? requestedLanguage
            : "en";

        const requestedVoiceId = String(body?.voiceId || "").trim();
        const targetVoiceId = /^[A-Za-z0-9]{20}$/.test(requestedVoiceId)
            ? requestedVoiceId
            : DEFAULT_VOICE_ID;

        const elevenResponse = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}?output_format=mp3_44100_128`,
            {
                method: "POST",
                headers: {
                    "xi-api-key": apiKey,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg"
                },
                body: JSON.stringify({
                    text,
                    model_id: "eleven_v3",
                    language_code: languageCode,
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.75
                    }
                })
            }
        );

        if (!elevenResponse.ok) {
            const detail = await elevenResponse.text().catch(() => "");
            console.error("ElevenLabs API error:", elevenResponse.status, detail);
            return json({
                error: "ElevenLabs API error.",
                detail: detail.slice(0, 300) || `HTTP ${elevenResponse.status}`
            }, 502);
        }

        return new Response(await elevenResponse.arrayBuffer(), {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff"
            }
        });
    } catch (error) {
        console.error("Speak proxy error:", error);
        return json({ error: "Server error." }, 500);
    }
}

export async function onRequestGet() {
    return json({ error: "Use POST." }, 405);
}

function json(value, status) {
    return new Response(JSON.stringify(value), {
        status,
        headers: {
            "Content-Type": "application/json; charset=UTF-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff"
        }
    });
}
