export type ChecklistItem = {
  item: string;
  rule_id: string;
  completed: boolean;
  status: "PASSED" | "FAILED" | "PENDING";
  passed_at_s: number | null;
};

export type QaCallRecord = {
  call_id: string;
  agent: string;
  customer_masked: string;
  date: string;
  duration_s: number;
  talk_listen_ratio: number;
  dead_air_pct: number;
  compliance_score: number;
  disposition: string;
  escalated: boolean;
  language: string;
};

export type AgentEvent =
  | {
      event_type: "CALL_STARTED";
      call_id: string;
      payload: {
        customer_name: string;
        phone_masked: string;
        language: string;
        script_name: string;
      };
    }
  | {
      event_type: "TRANSCRIPTION_DELTA";
      call_id: string;
      latency_ms: number;
      payload: {
        speaker: "agent" | "customer";
        text: string;
        confidence: number;
        is_final: boolean;
        seq: number;
        source?: "asr" | "injected";
      };
    }
  | {
      event_type: "KNOWLEDGE_SURFACED";
      call_id: string;
      latency_ms: number;
      payload: {
        intent: string;
        primary_recommendation: {
          title: string;
          direct_answer: string;
          kb_article_id: string;
        };
        suggested_quick_reply: string;
        // Multilingual pipeline
        original_query?: string;
        english_query?: string;
        detected_language?: string;
        detected_language_label?: string;
        stage_latencies?: {
          translate_ms: number;
          llm_ms: number;
        };
      };
    }
  | {
      event_type: "COMPLIANCE_SIGNAL";
      call_id: string;
      latency_ms: number;
      payload: {
        rule_id: string;
        status: "PASSED" | "FAILED" | "PENDING";
        checklist: ChecklistItem[];
      };
    }
  | {
      event_type: "CALL_SUMMARY";
      call_id: string;
      payload: {
        duration_s: number;
        bullets: string[];
        disposition: string;
        metrics: {
          talk_listen_ratio: number;
          dead_air_pct: number;
          compliance_score: number;
          sentiment_from: string;
          sentiment_to: string;
        };
        crm: {
          customer_name: string;
          phone_masked: string;
          card_last4: string;
          category: string;
          subcategory: string;
          resolution: string;
          follow_up_required: boolean;
          notes: string;
        };
      };
    }
  | {
      event_type: "QA_CALL_SCORED";
      call_id: string;
      payload: QaCallRecord;
    }
  | {
      event_type: "AUDIO_LEVEL";
      call_id: string;
      payload: {
        level: number;
        speaker: "agent" | "customer";
      };
    };

export type ClientCommand =
  | { type: "start_call" }
  | { type: "start_sample"; sampleId: string; durationSec?: number }
  | { type: "end_call" }
  | { type: "use_reply"; text: string }
  | {
      type: "synthesize";
      text: string;
      requestId?: string | number;
      language?: string;
    }
  | { type: "reset" }
  | { type: "list_samples" }
  | { type: "get_scored_calls" };

