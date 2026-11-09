export interface KbDoc {
  kb_id: string;
  intent: string;
  title: string;
  keywords: string[];
  doc: string;
}

export const KB_DOCS: KbDoc[] = [
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

export interface SearchHit {
  kb_id: string;
  intent: string;
  title: string;
  doc: string;
}

export function ragSearch(query: string, intent?: string): SearchHit | null {
  const q = query.toLowerCase();
  // Stopwords poison the substring scorer: e.g. tiny tokens like "is"
  // substring-match "paise"/"disclosure" and make ANY question look like a
  // KB hit, which then routes it to the strict KB-grounded prompt instead of
  // the general Q&A mode.
  const STOPWORDS = new Set([
    "a", "an", "the", "is", "are", "am", "be", "was", "were", "do", "does",
    "did", "i", "you", "he", "she", "it", "we", "they", "my", "me", "what",
    "when", "how", "why", "which", "kya", "hai", "hoga", "ho", "ka", "ke",
    "ki", "yeh", "ye", "aur", "and", "or", "for", "on", "in", "to", "of",
    "can", "please", "mera", "meri", "this", "that",
  ]);
  const tokens = q
    .split(/[\s,.;:!?\-+]+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
  let best: { hit: KbDoc; score: number } | null = null;

  for (const doc of KB_DOCS) {
    let score = 0;
    if (intent && doc.intent === intent) score += 8;
    for (const kw of doc.keywords) {
      for (const tok of tokens) {
        if (tok === kw) {
          score += 4;
        } else if (
          tok.length >= 4 &&
          kw.length >= 4 &&
          (tok.includes(kw) || kw.includes(tok))
        ) {
          score += kw.length >= 5 ? 2 : 1;
        }
      }
    }
    if (!best || score > best.score) {
      best = { hit: doc, score };
    }
  }

  // General questions (no whitelisted intent) must clear a real-match bar
  // (>=4: one exact keyword, or equivalent partial evidence) or they fall
  // through to the LLM general Q&A mode instead of a junk KB grounding.
  const generalMode = !intent || intent === "general.qna";
  if (!best || best.score === 0 || (generalMode && best.score < 4)) return null;
  return {
    kb_id: best.hit.kb_id,
    intent: best.hit.intent,
    title: best.hit.title,
    doc: best.hit.doc,
  };
}

