// Cloudflare Pages Function
// Route: POST /api/ask

const LANG_NAMES = {
    el: "Greek", en: "English", fr: "French", de: "German", es: "Spanish",
    it: "Italian", zh: "Chinese", ja: "Japanese", ru: "Russian"
};

// 1. ΕΔΩ ΒΑΖΕΙΣ ΤΙΣ "ΑΠΟΘΗΚΕΥΜΕΝΕΣ" ΕΡΩΤΗΣΕΙΣ ΚΑΙ ΑΠΑΝΤΗΣΕΙΣ
// Γράψε τις ερωτήσεις με πεζά γράμματα και χωρίς τόνους (για πιο εύκολο ταίριασμα)
const SAVED_ANSWERS = {
    "κωδικος wifi": "Ο κωδικός για το Wi-Fi (TP-Link_84FE) είναι 22170811.",
    "τηλεφωνο ιδιοκτητη": "Μπορείτε να καλέσετε τον Γιώργο ή τη Δέσποινα στο +30 6936362169.",
    "που ειναι το σουπερ μαρκετ": "Υπάρχει σούπερ μάρκετ στην οδό Ιωλκού, περίπου 3-5 λεπτά με το αυτοκίνητο."
};

const SYSTEM_PROMPT = `Είσαι ο ψηφιακός θυρωρός (AI concierge) του καταλύματος "Λόφος Επισκοπής" στην Επισκοπή, Άνω Βόλος, Ελλάδα (οδός Επισκοπής 43), περίπου στο 5ο χλμ. της διαδρομής Βόλου-Πορταριάς, σε υψόμετρο ~140μ.

ΒΑΣΙΚΑ ΣΤΟΙΧΕΙΑ ΚΑΤΑΛΥΜΑΤΟΣ:
- Ιδιοκτήτες: Γιώργος και Δέσποινα. Επικοινωνία: +30 6936362169 (Viber/WhatsApp/Messenger).
- Check-in/check-out: Ευέλικτο, κατόπιν συνεννόησης με τον ιδιοκτήτη.
- Wi-Fi: Δίκτυο "TP-Link_84FE", κωδικός "22170811".
- Σούπερ μάρκετ/φαρμακείο: οδός Ιωλκού, 3-5 λεπτά με το αυτοκίνητο.
- Ταξί: Ραδιοταξί Βόλου, τηλέφωνο 24210-27777 (~6€ προς το κέντρο).

ΠΡΟΤΕΙΝΟΜΕΝΑ ΜΕΡΗ (ενδεικτικά, ανάλογα με την ερώτηση):
- Φαγητό/τσίπουρο: Μεζέν, Δεμίρης, Κάβουρας, Φιλαράκι, Ιώδιο, Παπαδής (Βόλος)· Κρίτσα, Ορτανσίες, Το Κατώφλι της Καίτης (Πορταριά/Κατηχώρι)· Ταβέρνα Θωμά (Αγριά)· Ιππόκαμπος (Αλυκές).
- Παραλίες: Αναύρου (πιο κοντινή), Καλά Νερά, Άφησσος, Άγιοι Σαράντα, Μυλοπόταμος, Άγιος Ιωάννης.
- Εκδρομές/χωριά: Πορταριά, Μακρινίτσα, Μηλιές, Παλαιό Τρίκερι (νησάκι, χρειάζεται πλοιάριο), Μετέωρα (~1.5-2 ώρες οδικώς).

ΚΑΝΟΝΕΣ:
1. Απάντα ΠΑΝΤΑ στη γλώσσα που σου ζητείται, ανεξαρτήτως της γλώσσας της ερώτησης.
2. Οι απαντήσεις σου εκφωνούνται φωνητικά (text-to-speech): γράψε 1-3 σύντομες, φυσικές προτάσεις. ΜΗΝ χρησιμοποιείς markdown (αστεράκια, παύλες λίστας, κλπ) ούτε emoji.
3. Αν δεν ξέρεις κάτι με σιγουριά για το κατάλυμα, πρότεινε να επικοινωνήσει ο επισκέπτης με τους ιδιοκτήτες.
4. Αν ο επισκέπτης ρωτήσει κάτι άσχετο με το κατάλυμα (π.χ. γενικές γνώσεις, τοπικές πληροφορίες, οτιδήποτε άλλο), απάντα κανονικά χρησιμοποιώντας τις γενικές σου γνώσεις - μην αρνηθείς ποτέ και μην πεις ότι γνωρίζεις μόνο για το κατάλυμα.`;

export async function onRequestPost(context) {
    const { request, env } = context;

    try {
        const apiKey = env.GEMINI_API_KEY;
        if (!apiKey) {
            return json({ error: "Το API key δεν έχει ρυθμιστεί ακόμα στον server (GEMINI_API_KEY)." }, 500);
        }

        let body;
        try {
            body = await request.json();
        } catch (e) {
            return json({ error: "Invalid JSON body" }, 400);
        }

        const userMessage = (body && body.message ? String(body.message) : "").trim().slice(0, 500);
        const lang = (body && body.lang ? String(body.lang) : "el").toLowerCase();

        if (!userMessage) {
            return json({ error: "Empty message" }, 400);
        }

        // 2. ΕΛΕΓΧΟΣ ΑΝ ΥΠΑΡΧΕΙ ΗΔΗ Η ΕΡΩΤΗΣΗ ΣΤΙΣ ΑΠΟΘΗΚΕΥΜΕΝΕΣ
        // Καθαρίζουμε το μήνυμα του χρήστη για να κάνουμε πιο εύκολη την αναζήτηση
        const normalizedMessage = userMessage.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

        for (const [key, savedAnswer] of Object.entries(SAVED_ANSWERS)) {
            if (normalizedMessage.includes(key)) {
                // Αν βρέθηκε έτοιμη απάντηση, την επιστρέφουμε αμέσως και ΤΕΡΜΑΤΙΖΟΥΜΕ τη συνάρτηση.
                // Το Gemini ΔΕΝ καλείται καθόλου, γλιτώνοντας χρόνο και API calls.
                return json({ reply: savedAnswer }, 200);
            }
        }

        // 3. ΑΝ ΔΕΝ ΥΠΑΡΧΕΙ ΣΤΙΣ ΑΠΟΘΗΚΕΥΜΕΝΕΣ, ΡΩΤΑΜΕ ΤΟ AI
        const targetLanguage = LANG_NAMES[lang] || "Greek";
        const fullSystemPrompt = `${SYSTEM_PROMPT}\n\nΑπάντα ΑΠΟΚΛΕΙΣΤΙΚΑ στα ${targetLanguage}, ό,τι γλώσσα κι αν χρησιμοποίησε ο επισκέπτης.`;

        const payload = {
            contents: [{ role: "user", parts: [{ text: userMessage }] }],
            systemInstruction: { parts: [{ text: fullSystemPrompt }] },
            generationConfig: { maxOutputTokens: 200, temperature: 0.4 }
        };

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
        const geminiResponse = await fetch(apiUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        const data = await geminiResponse.json();

        if (!geminiResponse.ok || data.error) {
            console.error("Gemini API error:", data.error || geminiResponse.status);
            // ΠΡΟΣΩΡΙΝΟ: δείχνουμε το ακριβές μήνυμα του Google στον client, μόνο για διάγνωση.
            const detail = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + geminiResponse.status);
            return json({ error: "Gemini API error", detail }, 502);
        }

        const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (!reply.trim()) {
            return json({ error: "Empty reply from model" }, 502);
        }

        return json({ reply: reply.trim() }, 200);
    } catch (err) {
        console.error("Proxy error:", err);
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
