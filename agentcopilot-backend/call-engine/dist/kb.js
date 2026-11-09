"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KB_DOCS = void 0;
exports.ragSearch = ragSearch;
exports.KB_DOCS = [
    {
        kb_id: "KB-BFSI-9021",
        intent: "card.unblock_fees",
        title: "Card Unblock & Fee Waiver Policy",
        keywords: [
            "card",
            "block",
            "unblock",
            "charges",
            "fee",
            "waiver",
            "maintenance",
            "annual",
            "reverse",
            "3500",
            "lagenge",
            "kitne",
            "paise",
            "charge",
            "zero",
            "250",
        ],
        doc: "Unblock charges are ₹250 + GST, fully waived when annual spends exceed ₹1,00,000 in the last 12 months. Maintenance fees may be waived under Priority Privileges exemption code EX-771.",
    },
    {
        kb_id: "KB-BFSI-9024",
        intent: "card.unblock_tat",
        title: "Unblock Turnaround Time & Notifications",
        keywords: [
            "unblock",
            "tat",
            "24",
            "hours",
            "working",
            "kitna",
            "time",
            "kab",
            "lagega",
            "sms",
            "notification",
            "request",
            "emergency",
            "contactless",
            "roaming",
        ],
        doc: "Standard TAT is 24 working hours; SMS confirmations go out on request raise and on completion. Emergency travel locks can be unblocked immediately for POS terminals.",
    },
    {
        kb_id: "KB-BFSI-9051",
        intent: "call.opening_disclosure",
        title: "Call Recording Disclosure",
        keywords: [
            "recording",
            "disclosure",
            "record",
            "shuruaat",
            "opening",
            "quality",
            "training",
            "monitored",
            "regulatory",
            "archival",
        ],
        doc: "Yes, this call is being recorded for quality and training purposes. Recording is used only for quality and training, and your privacy is respected.",
    },
    {
        kb_id: "KB-BFSI-9102",
        intent: "kyc.verify_identity",
        title: "Customer Identity Verification (KYC) on Calls",
        keywords: [
            "kyc",
            "identity",
            "verification",
            "pehchan",
            "verify",
            "date",
            "birth",
            "janm",
            "tithi",
            "last",
            "digits",
            "otp",
            "security",
        ],
        doc: "For your security, we verify your identity using your date of birth and the last 4 digits of your card, or an OTP. We ask for these details before sharing any account-specific information.",
    },
];
function ragSearch(query, intent) {
    const q = query.toLowerCase();
    const tokens = q.split(/[\s,.;:!?\-+]+/).filter((t) => t.length >= 2);
    let best = null;
    for (const doc of exports.KB_DOCS) {
        let score = 0;
        if (intent && doc.intent === intent)
            score += 8;
        for (const kw of doc.keywords) {
            for (const tok of tokens) {
                if (tok === kw) {
                    score += 4;
                }
                else if (tok.includes(kw) || kw.includes(tok)) {
                    score += kw.length >= 5 ? 2 : 1;
                }
            }
        }
        if (!best || score > best.score) {
            best = { hit: doc, score };
        }
    }
    if (!best || best.score === 0)
        return null;
    return {
        kb_id: best.hit.kb_id,
        intent: best.hit.intent,
        title: best.hit.title,
        doc: best.hit.doc,
    };
}
