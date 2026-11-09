"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TimelineTracker = void 0;
const DEAD_AIR_THRESHOLD_S = 3.0;
const WORDS_PER_SECOND = 2.6;
class TimelineTracker {
    spans = [];
    lastEnd = 0;
    onUtterance(speaker, text, tS) {
        const dur = Math.max(1.0, text.split(/\s+/).length / WORDS_PER_SECOND);
        const start = Math.max(tS, this.lastEnd);
        this.spans.push({ speaker, startS: start, durS: dur });
        this.lastEnd = start + dur;
    }
    durationS() {
        return Math.round(this.lastEnd * 10) / 10;
    }
    computeMetrics() {
        const total = this.durationS() || 1;
        let agent = 0, customer = 0;
        for (const s of this.spans) {
            if (s.speaker === "agent")
                agent += s.durS;
            else
                customer += s.durS;
        }
        const ordered = [...this.spans].sort((a, b) => a.startS - b.startS);
        let cursor = 0, deadAir = 0;
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
exports.TimelineTracker = TimelineTracker;
