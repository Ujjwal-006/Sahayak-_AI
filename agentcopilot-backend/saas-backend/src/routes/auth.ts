import { Router } from "express";
import { prisma } from "../services/db";
import { signToken, verifyPassword, verifyToken } from "../services/auth";

export const authRoutes = Router();

authRoutes.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { org: true },
    });

    if (!user) {
      return res.status(401).json({ error: "invalid credentials" });
    }
    if (user.status !== "ACTIVE") {
      return res.status(403).json({ error: "user suspended" });
    }
    if (!(await verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: "invalid credentials" });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // Audit log
    await prisma.auditLog.create({
      data: {
        orgId: user.orgId,
        actorUserId: user.id,
        action: "USER_LOGIN",
        targetType: "User",
        targetId: user.id,
        metadataJson: JSON.stringify({ role: user.role, email: user.email }),
        ipAddr: req.ip || req.socket.remoteAddress || "127.0.0.1",
        userAgent: req.headers["user-agent"] || "unknown",
      },
    }).catch((err) => console.warn("[audit log error]", err));

    const token = signToken({
      userId: user.id,
      orgId: user.orgId,
      role: user.role,
      email: user.email,
      name: user.name,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      org: user.org,
    });
  } catch (e) {
    next(e);
  }
});

authRoutes.get("/me", async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "no token" });
    }
    const ctx = verifyToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: ctx.userId },
      include: { org: true },
    });
    if (!user) {
      return res.status(404).json({ error: "user not found" });
    }
    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      org: user.org,
    });
  } catch (e) {
    next(e);
  }
});

