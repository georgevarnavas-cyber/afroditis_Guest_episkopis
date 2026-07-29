// Cloudflare Pages Function: POST /api/speak
// Proxy προς το ElevenLabs Text-to-Speech API.

// Προεπιλεγμένη ΔΩΡΕΑΝ φωνή "Rachel" (ElevenLabs)
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const apiKey = env.ELEVENLABS_API_KEY;
        if (!apiKey) {
            return json({ error: "Το ELEVENLABS_API_KEY δεν έχει ρυθμιστεί ακόμα στον server." }, 500);
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
            return json({ error: "Invalid JSON body" }, 400);
        }

        const text = (body && body.text ? String(body.text) : "").trim().slice(0, 800);
        if (!text) {
            return json({ error: "Empty text" }, 400);
        }

        // Χρήση του voiceId που στέλνει το frontend, αλλιώς fallback στη Rachel
        const targetVoiceId = body.voiceId || DEFAULT_VOICE_ID;

        const elevenResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${targetVoiceId}`, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg"
            },
            body: JSON.stringify({
                text: text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });

        if (!elevenResponse.ok) {
            const errText = await elevenResponse.text().catch(() => "");
            console.error("ElevenLabs API error:", elevenResponse.status, errText);
            return json({ error: "ElevenLabs API error", detail: errText.slice(0, 300) || ("HTTP " + elevenResponse.status) }, 502);
        }

        const audioBuffer = await elevenResponse.arrayBuffer();
        return new Response(audioBuffer, {
            status: 200,
            headers: {
                "Content-Type": "audio/mpeg",
                "Cache-Control": "no-store"
            }
        });
    } catch (err) {
        console.error("Speak proxy error:", err);
        return json({ error: "Server error" }, 500);
    }
}

export async function onRequestGet() {
    return json({ error: "Use POST" }, 405);
}

function json(obj, status) {
    return new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json" }
    });
}
