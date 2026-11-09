import { Router } from "express";
import { prisma } from "../services/db";

export const dashboardRoutes = Router();

dashboardRoutes.get("/overview", async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const since = new Date(Date.now() - days * 86400_000);

    let orgId = req.auth?.orgId;
    if (!orgId) {
      const demoOrg = await prisma.org.findUnique({ where: { slug: "demo-bfsi" } });
      orgId = demoOrg?.id;
    }

    const calls = await prisma.call.findMany({
      where: {
        ...(orgId ? { orgId } : {}),
        startedAt: { gte: since },
      },
      select: {
        id: true,
        externalCallId: true,
        complianceScore: true,
        escalated: true,
        startedAt: true,
        talkListenRatio: true,
        deadAirPct: true,
        durationS: true,
        crmPrefillJson: true,
        disposition: true,
      },
      orderBy: { startedAt: "desc" },
    });

    const n = calls.length || 1;
    const sum = (fn: (c: any) => number) => calls.reduce((s, c) => s + (fn(c) || 0), 0);

    // Trend by day
    const byDay = new Map<string, { count: number; totalScore: number; escalations: number }>();
    for (const c of calls) {
      const day = c.startedAt.toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { count: 0, totalScore: 0, escalations: 0 };
      d.count++;
      d.totalScore += c.complianceScore ?? 0;
      if (c.escalated) d.escalations++;
      byDay.set(day, d);
    }

    // Leaderboard by agent
    const byAgent = new Map<string, { calls: number; totalScore: number; escalations: number }>();
    for (const c of calls) {
      let agentName = "Priya Sharma";
      if (c.crmPrefillJson) {
        try {
          const parsed = JSON.parse(c.crmPrefillJson);
          if (parsed.agent) agentName = parsed.agent;
        } catch {}
      }
      const entry = byAgent.get(agentName) ?? { calls: 0, totalScore: 0, escalations: 0 };
      entry.calls++;
      entry.totalScore += c.complianceScore ?? 0;
      if (c.escalated) entry.escalations++;
      byAgent.set(agentName, entry);
    }

    const leaderboard = Array.from(byAgent.entries())
      .map(([agent, v]) => ({
        agent,
        calls: v.calls,
        avgScore: v.calls > 0 ? Math.round((v.totalScore / v.calls) * 10) / 10 : 0,
        escalations: v.escalations,
      }))
      .sort((a, b) => b.avgScore - a.avgScore);

    // Last 10 calls for histogram chart
    const recent10 = calls.slice(0, 10).map((c) => ({
      call_id: c.externalCallId,
      score: c.complianceScore ?? 0,
      escalated: c.escalated,
      startedAt: c.startedAt,
    }));

    res.json({
      totalCalls: calls.length,
      avgCompliance: Math.round((sum((c) => c.complianceScore ?? 0) / n) * 10) / 10,
      avgTalkListen: Math.round((sum((c) => c.talkListenRatio ?? 0) / n) * 100) / 100,
      avgDeadAir: Math.round((sum((c) => c.deadAirPct ?? 0) / n) * 10) / 10,
      escalations: calls.filter((c) => c.escalated).length,
      trend: Array.from(byDay.entries())
        .map(([day, v]) => ({
          day,
          calls: v.count,
          avgScore: v.count > 0 ? Math.round((v.totalScore / v.count) * 10) / 10 : 0,
          escalations: v.escalations,
        }))
        .sort((a, b) => a.day.localeCompare(b.day)),
      leaderboard,
      recent10,
    });
  } catch (e) {
    next(e);
  }
});

dashboardRoutes.get("/escalations", async (req, res, next) => {
  try {
    const limit = Math.min(100, parseInt(req.query.limit as string) || 20);
    let orgId = req.auth?.orgId;
    if (!orgId) {
      const demoOrg = await prisma.org.findUnique({ where: { slug: "demo-bfsi" } });
      orgId = demoOrg?.id;
    }

    const calls = await prisma.call.findMany({
      where: {
        ...(orgId ? { orgId } : {}),
        escalated: true,
      },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
    res.json({ calls });
  } catch (e) {
    next(e);
  }
});

