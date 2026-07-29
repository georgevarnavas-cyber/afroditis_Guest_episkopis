// Cloudflare Pages Function
// Route: POST /api/speak
//
// Κρυφό proxy προς το ElevenLabs Text-to-Speech API. Το πραγματικό key διαβάζεται
// από Cloudflare secret (env.ELEVENLABS_API_KEY) - ΔΕΝ εμφανίζεται ποτέ στον client.
//
// ΡΥΘΜΙΣΗ (μία φορά, στο Cloudflare dashboard, ΣΤΟ ΙΔΙΟ project όπου έβαλες και το GEMINI_API_KEY):
//   Settings -> Environment variables -> Add variable
//   Name: ELEVENLABS_API_KEY   Value: <το key σου>   Type: Secret
//   Μετά, νέο deployment για να ενεργοποιηθεί.
//
// Ο client (index.html) καλεί: fetch('/api/speak', { method:'POST', body: {text} })
// και παίρνει πίσω απευθείας τον ήχο (audio/mpeg), όχι JSON.

// Φυσική, ζεστή γυναικεία φωνή (προεπιλογή ElevenLabs "Rachel"). Μπορείς να την αλλάξεις:
// πήγαινε στο elevenlabs.io -> Voice Library, βρες μια φωνή που σου αρέσει, αντίγραψε το
// Voice ID της, και άλλαξέ το εδώ.
const VOICE_ID = "221m00Tcm4TlvDq8ikWAM";

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

        // Περιορισμός μήκους για έλεγχο κόστους (οι απαντήσεις μας είναι ούτως ή άλλως σύντομες)
        const text = (body && body.text ? String(body.text) : "").trim().slice(0, 800);
        if (!text) {
            return json({ error: "Empty text" }, 400);
        }

        const elevenResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
            method: "POST",
            headers: {
                "xi-api-key": apiKey,
                "Content-Type": "application/json",
                "Accept": "audio/mpeg"
            },
            body: JSON.stringify({
                text: text,
                // eleven_multilingual_v2: υποστηρίζει Ελληνικά + όλες τις υπόλοιπες 8 γλώσσες μας,
                // ανιχνεύει αυτόματα τη γλώσσα από το ίδιο το κείμενο.
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.5, similarity_boost: 0.75 }
            })
        });

        if (!elevenResponse.ok) {
            const errText = await elevenResponse.text().catch(() => "");
            console.error("ElevenLabs API error:", elevenResponse.status, errText);
            return json({ error: "ElevenLabs API error", detail: errText.slice(0, 300) || ("HTTP " + elevenResponse.status) }, 502);
        }

        // Επιστρέφουμε τον ήχο απευθείας στον client (όχι JSON)
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
