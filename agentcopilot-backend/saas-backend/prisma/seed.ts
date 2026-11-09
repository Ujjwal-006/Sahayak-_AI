import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.org.upsert({
    where: { slug: "demo-bfsi" },
    update: {},
    create: {
      name: "Demo BFSI Bank",
      slug: "demo-bfsi",
      plan: "GROWTH",
      seats: 10,
      qaCallsIncl: 5000,
    },
  });

  const passwordHash = await bcrypt.hash("password123", 10);

  const priya = await prisma.user.upsert({
    where: { email: "priya@demo-bfsi.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "priya@demo-bfsi.com",
      name: "Priya Sharma",
      role: "AGENT",
      passwordHash,
    },
  });

  await prisma.user.upsert({
    where: { email: "compliance@demo-bfsi.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "compliance@demo-bfsi.com",
      name: "Cyril Compliance",
      role: "COMPLIANCE_OFFICER",
      passwordHash,
    },
  });

  // Additional agent users for historical data
  const rohan = await prisma.user.upsert({
    where: { email: "rohan@demo-bfsi.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "rohan@demo-bfsi.com",
      name: "Rohan Mehta",
      role: "AGENT",
      passwordHash,
    },
  });

  const ananya = await prisma.user.upsert({
    where: { email: "ananya@demo-bfsi.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "ananya@demo-bfsi.com",
      name: "Ananya Roy",
      role: "AGENT",
      passwordHash,
    },
  });

  const vikram = await prisma.user.upsert({
    where: { email: "vikram@demo-bfsi.com" },
    update: {},
    create: {
      orgId: org.id,
      email: "vikram@demo-bfsi.com",
      name: "Vikram Singh",
      role: "AGENT",
      passwordHash,
    },
  });

  const agentUserMap: Record<string, string> = {
    "Priya Sharma": priya.id,
    "Rohan Mehta": rohan.id,
    "Ananya Roy": ananya.id,
    "Vikram Singh": vikram.id,
  };

  // Seed 7 historical calls so the supervisor dashboard isn't empty
  const seedCalls = [
    { agent: "Priya Sharma", customer: "Anita R.", dur: 258, ratio: 1.12, dead: 4.8, score: 100, disp: "Card Fee Waiver — Resolved", esc: false },
    { agent: "Rohan Mehta", customer: "Suresh K.", dur: 405, ratio: 1.48, dead: 9.4, score: 68, disp: "Escalated — Disputed Surcharge", esc: true },
    { agent: "Priya Sharma", customer: "Meena D.", dur: 135, ratio: 0.95, dead: 2.1, score: 100, disp: "Address Verification Success", esc: false },
    { agent: "Ananya Roy", customer: "Vikram P.", dur: 310, ratio: 1.25, dead: 5.6, score: 88, disp: "EMI Conversion Request", esc: false },
    { agent: "Vikram Singh", customer: "Farhan A.", dur: 450, ratio: 1.62, dead: 11.2, score: 74, disp: "Card Block & Stolen Reporting", esc: false },
    { agent: "Priya Sharma", customer: "Geeta S.", dur: 220, ratio: 1.05, dead: 3.8, score: 94, disp: "Credit Limit Enhancement", esc: false },
    { agent: "Ananya Roy", customer: "Karan T.", dur: 295, ratio: 1.18, dead: 4.2, score: 92, disp: "International Roaming Activation", esc: false },
  ];

  // Clean existing seed calls if any
  await prisma.call.deleteMany({
    where: { externalCallId: { startsWith: "call_seed_" } },
  });

  for (let i = 0; i < seedCalls.length; i++) {
    const c = seedCalls[i];
    const offsetMs = (seedCalls.length - i) * 3600000 * 6; // staggered across recent days
    const startedAt = new Date(Date.now() - offsetMs);
    const endedAt = new Date(startedAt.getTime() + c.dur * 1000);

    await prisma.call.create({
      data: {
        orgId: org.id,
        externalCallId: `call_seed_${Math.random().toString(36).slice(2, 10)}`,
        agentUserId: agentUserMap[c.agent] ?? priya.id,
        startedAt,
        endedAt,
        durationS: c.dur,
        talkListenRatio: c.ratio,
        deadAirPct: c.dead,
        complianceScore: c.score,
        sentimentFrom: "Neutral",
        sentimentTo: c.score >= 80 ? "Positive" : "Strained",
        disposition: c.disp,
        escalated: c.esc,
        language: "Hinglish",
        crmPrefillJson: JSON.stringify({
          agent: c.agent,
          customer_masked: c.customer,
        }),
      },
    });
  }

  console.log("Seed complete. Logins:");
  console.log("  priya@demo-bfsi.com / password123 (AGENT -> /cockpit)");
  console.log("  compliance@demo-bfsi.com / password123 (COMPLIANCE_OFFICER -> /supervisor)");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

