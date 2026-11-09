const DEAD_AIR_THRESHOLD_S = 3.0;
const WORDS_PER_SECOND = 2.6;

interface SpeechSpan {
  speaker: string;
  startS: number;
  durS: number;
}

export class TimelineTracker {
  private spans: SpeechSpan[] = [];
  private lastEnd = 0;

  onUtterance(speaker: string, text: string, tS: number) {
    const dur = Math.max(1.0, text.split(/\s+/).length / WORDS_PER_SECOND);
    const start = Math.max(tS, this.lastEnd);
    this.spans.push({ speaker, startS: start, durS: dur });
    this.lastEnd = start + dur;
  }

  durationS(): number {
    return Math.round(this.lastEnd * 10) / 10;
  }

  computeMetrics(): { talk_listen_ratio: number; dead_air_pct: number } {
    const total = this.durationS() || 1;
    let agent = 0,
      customer = 0;
    for (const s of this.spans) {
      if (s.speaker === "agent") agent += s.durS;
      else customer += s.durS;
    }
    const ordered = [...this.spans].sort((a, b) => a.startS - b.startS);
    let cursor = 0,
      deadAir = 0;
    for (const span of ordered) {
      if (span.startS - cursor > DEAD_AIR_THRESHOLD_S) {
        deadAir += span.startS - cursor;
      }
      cursor = Math.max(cursor, span.startS + span.durS);
    }
    return {
      talk_listen_ratio: customer > 0 ? Math.round((agent / customer) * 100) / 100 : 1.0,
      dead_air_pct: Math.round((deadAir / total) * 1000) / 10,
    };
  }
}

