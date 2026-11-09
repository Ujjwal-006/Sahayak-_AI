export type RuleStatus = "PASSED" | "FAILED" | "PENDING";
export type RuleKind = "phrase" | "negative_phrase";

export interface Rule {
  id: string;
  item: string;
  kind: RuleKind;
  target: "agent" | "customer";
  pattern: string;
  reference?: string;
  threshold?: number;
}

export interface ChecklistItemData {
  item: string;
  rule_id: string;
  completed: boolean;
  status: RuleStatus;
  passed_at_s: number | null;
}

interface RuleState {
  rule: Rule;
  status: RuleStatus;
  evidence: string[];
  passedAtS: number | null;
}

export const RULES: Rule[] = [
  {
    id: "RULE_DISCLOSE_RECORDING",
    item: "Call Recording Consent Disclosed",
    kind: "phrase",
    target: "agent",
    pattern: "record(ed|ing) for (quality|training)|monitored for regulatory|recorded for quality",
  },
  {
    id: "RULE_IDENTITY_VERIFICATION",
    item: "Identity & OTP Verified",
    kind: "phrase",
    target: "agent",
    pattern: "(date of birth|dob|last (4|four) digits|verify.*(identity|kyc)|account security profile|secondary verification)",
  },
  {
    id: "RULE_FEE_DISCLOSURE",
    item: "Annual Fee Waiver Policy Stated",
    kind: "phrase",
    target: "agent",
    pattern: "(waive|250 rupees|rs\\.? ?250|charges.*lagenge|charges lagega|zero charges|priority privileges|maintenance fee|exemption)",
  },
  {
    id: "RULE_RESOLUTION_TAT",
    item: "Card Replacement TAT (3-5 Days)",
    kind: "phrase",
    target: "agent",
    pattern: "(24 (working )?hours|3-5 (working )?days|tat|turnaround|sms|effective immediately)",
  },
  {
    id: "RULE_NO_GUARANTEED_RETURNS",
    item: "Final Grievance Escalation Window",
    kind: "negative_phrase",
    target: "agent",
    pattern: "(guaranteed (returns|profit)|pakka (profit|return)|100% (profit|return))",
  },
];

export class ComplianceEngine {
  private states = new Map<string, RuleState>();
  private t0 = Date.now();

  constructor(rules: Rule[] = RULES) {
    for (const r of rules) {
      this.states.set(r.id, {
        rule: r,
        status: "PENDING",
        evidence: [],
        passedAtS: null,
      });
    }
  }

  onTranscript(speaker: string, text: string) {
    const fired: Array<{ rule_id: string; status: RuleStatus; checklist: ChecklistItemData[] }> = [];
    for (const s of this.states.values()) {
      if (s.status !== "PENDING" || s.rule.target !== speaker) continue;
      if (this.matches(s.rule, text)) {
        const passed = s.rule.kind !== "negative_phrase";
        s.status = passed ? "PASSED" : "FAILED";
        s.evidence.push(text);
        s.passedAtS = Math.round((Date.now() - this.t0) / 100) / 10;
        fired.push({
          rule_id: s.rule.id,
          status: s.status,
          checklist: this.checklist(),
        });
      }
    }
    return fired;
  }

  finalize() {
    const fired: Array<{ rule_id: string; status: RuleStatus; checklist: ChecklistItemData[] }> = [];
    for (const s of this.states.values()) {
      if (s.status === "PENDING") {
        if (s.rule.kind === "negative_phrase") {
          // Negative phrase rule passed if agent avoided forbidden phrase
          s.status = "PASSED";
          s.passedAtS = Math.round((Date.now() - this.t0) / 100) / 10;
          fired.push({
            rule_id: s.rule.id,
            status: "PASSED",
            checklist: this.checklist(),
          });
        } else {
          s.status = "FAILED";
          fired.push({
            rule_id: s.rule.id,
            status: "FAILED",
            checklist: this.checklist(),
          });
        }
      }
    }
    return fired;
  }

  checklist(): ChecklistItemData[] {
    return Array.from(this.states.values()).map((s) => ({
      item: s.rule.item,
      rule_id: s.rule.id,
      completed: s.status === "PASSED",
      status: s.status,
      passed_at_s: s.passedAtS,
    }));
  }

  score(): number {
    if (this.states.size === 0) return 100;
    let passed = 0;
    for (const s of this.states.values()) {
      if (s.status === "PASSED") passed++;
    }
    return Math.round((passed / this.states.size) * 1000) / 10;
  }

  failedCritical(): boolean {
    for (const s of this.states.values()) {
      if (s.status === "FAILED" && s.rule.kind === "negative_phrase") return true;
    }
    return false;
  }

  private matches(rule: Rule, text: string): boolean {
    return new RegExp(rule.pattern, "i").test(text);
  }
}

