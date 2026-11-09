import { Router } from "express";
import { prisma } from "../services/db";

export const qaRoutes = Router();

qaRoutes.get("/calls", async (req, res, next) => {
  try {
    const limit = Math.min(200, parseInt(req.query.limit as string) || 50);
    const offset = parseInt(req.query.offset as string) || 0;
    const escalated = req.query.escalated === "true" ? true : undefined;

    let orgId = req.auth?.orgId;
    if (!orgId) {
      const demoOrg = await prisma.org.findUnique({ where: { slug: "demo-bfsi" } });
      orgId = demoOrg?.id;
    }

    const where: any = {
      ...(orgId ? { orgId } : {}),
      ...(escalated !== undefined ? { escalated } : {}),
    };

    const [calls, total] = await Promise.all([
      prisma.call.findMany({
        where,
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.call.count({ where }),
    ]);

    const formattedCalls = calls.map((c) => {
      let agent = "Priya Sharma";
      let customerMasked = "Rajesh Sharma";
      if (c.crmPrefillJson) {
        try {
          const parsed = JSON.parse(c.crmPrefillJson);
          if (parsed.agent) agent = parsed.agent;
          if (parsed.customer_masked) customerMasked = parsed.customer_masked;
          else if (parsed.customer_name) customerMasked = parsed.customer_name;
        } catch {}
      }
      return {
        ...c,
        call_id: c.externalCallId,
        agent,
        customer_masked: customerMasked,
        duration_s: c.durationS,
        talk_listen_ratio: c.talkListenRatio,
        dead_air_pct: c.deadAirPct,
        compliance_score: c.complianceScore,
        date: c.startedAt.toISOString(),
      };
    });

    res.json({ calls: formattedCalls, total, limit, offset });
  } catch (e) {
    next(e);
  }
});

qaRoutes.get("/calls/:id", async (req, res, next) => {
  try {
    let orgId = req.auth?.orgId;
    if (!orgId) {
      const demoOrg = await prisma.org.findUnique({ where: { slug: "demo-bfsi" } });
      orgId = demoOrg?.id;
    }

    const call = await prisma.call.findFirst({
      where: {
        OR: [{ id: req.params.id }, { externalCallId: req.params.id }],
        ...(orgId ? { orgId } : {}),
      },
    });

    if (!call) {
      return res.status(404).json({ error: "call not found" });
    }

    let agent = "Priya Sharma";
    let customerMasked = "Rajesh Sharma";
    if (call.crmPrefillJson) {
      try {
        const parsed = JSON.parse(call.crmPrefillJson);
        if (parsed.agent) agent = parsed.agent;
        if (parsed.customer_masked) customerMasked = parsed.customer_masked;
        else if (parsed.customer_name) customerMasked = parsed.customer_name;
      } catch {}
    }

    res.json({
      call: {
        ...call,
        call_id: call.externalCallId,
        agent,
        customer_masked: customerMasked,
        duration_s: call.durationS,
        talk_listen_ratio: call.talkListenRatio,
        dead_air_pct: call.deadAirPct,
        compliance_score: call.complianceScore,
        date: call.startedAt.toISOString(),
      },
    });
  } catch (e) {
    next(e);
  }
});

