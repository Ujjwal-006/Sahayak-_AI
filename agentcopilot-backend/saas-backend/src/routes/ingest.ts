import { Router } from "express";
import { prisma } from "../services/db";

export const ingestRoutes = Router();

ingestRoutes.post("/call", async (req, res, next) => {
  try {
    const b = req.body;
    // Look up org by hardcoded demo slug for the competition
    const org = await prisma.org.findUnique({ where: { slug: "demo-bfsi" } });
    if (!org) return res.status(404).json({ error: "org not found" });

    const startedAt = b.date ? new Date(b.date) : new Date();
    const durationS = b.duration_s ?? 0;
    const endedAt = new Date(startedAt.getTime() + durationS * 1000);

    const crmPrefillJson = JSON.stringify({
      agent: b.agent ?? "Priya Sharma",
      customer_masked: b.customer_masked ?? "Rajesh Sharma",
    });

    const callData = {
      orgId: org.id,
      externalCallId: b.call_id,
      startedAt,
      endedAt,
      durationS,
      talkListenRatio: b.talk_listen_ratio,
      deadAirPct: b.dead_air_pct,
      complianceScore: b.compliance_score,
      sentimentFrom: "Neutral",
      sentimentTo: (b.compliance_score ?? 0) >= 80 ? "Positive" : "Strained",
      disposition: b.disposition ?? "Card Services -> Unblock Request - Resolved",
      escalated: Boolean(b.escalated),
      language: b.language ?? "Hinglish",
      crmPrefillJson,
    };

    const call = await prisma.call.upsert({
      where: { externalCallId: b.call_id },
      update: callData,
      create: callData,
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId: org.id,
        action: "CALL_INGESTED",
        targetType: "Call",
        targetId: call.id,
        metadataJson: JSON.stringify({
          callId: b.call_id,
          score: b.compliance_score,
          escalated: b.escalated,
        }),
        ipAddr: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "call-engine",
      },
    }).catch((err) => console.warn("[audit log error]", err));

    res.status(201).json({ call });
  } catch (e) {
    next(e);
  }
});

