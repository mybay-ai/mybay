import { Router } from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { dbAdapter } from "../db";
import { getHostResourceConfig } from "../services/hostResourceGuardV2";
import { authenticateToken, AuthenticatedRequest } from "../middlewares/auth";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { JWT_SECRET } from "../utils/authSecrets";
import { localEditionCapabilities } from "../../shared/editionCapabilities";
import { detectSafeImageType, isDeclaredImageTypeCompatible } from "../utils/imageUploadSecurity";

const router = Router();

const adminUsername = () => process.env.LOCAL_ADMIN_USERNAME || "admin";
const adminPassword = () => {
  const configured = process.env.LOCAL_ADMIN_PASSWORD;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("LOCAL_ADMIN_PASSWORD is required in production.");
  }
  return "mybay-local-development-password";
};

let synchronizedAdminPassword: string | undefined;

export function reconcileConfiguredAdminPassword(
  currentHash: string | undefined,
  configuredPassword: string,
): string | null {
  const verification = currentHash
    ? verifyPassword(configuredPassword, currentHash)
    : { match: false, needsRehash: false };

  if (verification.match && !verification.needsRehash) return null;
  return hashPassword(configuredPassword);
}

export async function ensureLocalAdmin() {
  const username = adminUsername();
  const normalizedUsername = username.trim().toLowerCase();

  // Find existing single admin by fixed ID or legacy single account
  let admin = await dbAdapter.getUserById("local-admin");

  if (!admin) {
    const existingAdmins = await dbAdapter.getUserByUsername(username);
    if (existingAdmins) {
      admin = existingAdmins;
      // Ensure ID is normalized to local-admin
      await dbAdapter.updateUserProfile(admin.id, { id: "local-admin", status: "active", role: "admin" });
      admin = await dbAdapter.getUserById("local-admin");
    }
  }

  if (!admin) {
    // Check if any existing user can be migrated
    const allUsers = (await dbAdapter.getUserCount()) > 0;
    if (!allUsers) {
      admin = await dbAdapter.createUser({
        id: "local-admin",
        username,
        username_normalized: normalizedUsername,
        password_hash: hashPassword(adminPassword()),
        role: "admin",
        status: "active"
      });
    } else {
      admin = await dbAdapter.createUser({
        id: "local-admin",
        username,
        username_normalized: normalizedUsername,
        password_hash: hashPassword(adminPassword()),
        role: "admin",
        status: "active"
      });
    }
  } else {
    const updates: Record<string, string> = {};

    // Reconcile the persisted hash once per configured password and process.
    // This makes .env password changes effective without deleting local data.
    const configuredPassword = adminPassword();
    const shouldSynchronizePassword = synchronizedAdminPassword !== configuredPassword;
    if (shouldSynchronizePassword) {
      const passwordHash = reconcileConfiguredAdminPassword(
        admin.password_hash,
        configuredPassword,
      );
      if (passwordHash) updates.password_hash = passwordHash;
    }

    // If username in .env changed, update admin username.
    if (admin.username !== username || admin.username_normalized !== normalizedUsername) {
      updates.username = username;
      updates.username_normalized = normalizedUsername;
    }

    if (Object.keys(updates).length > 0) {
      await dbAdapter.updateUserProfile(admin.id, updates);
      Object.assign(admin, updates);
    }
    if (shouldSynchronizePassword) synchronizedAdminPassword = configuredPassword;
  }

  return admin;
}

function issueToken(user: any) {
  return jwt.sign({ id: user.id, username: user.username, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
}

export function shouldUseSecureAuthCookie(env: NodeJS.ProcessEnv = process.env) {
  if (env.COOKIE_SECURE === "true") return true;
  if (env.COOKIE_SECURE === "false") return false;
  return env.DEPLOYMENT_MODE === "server"
    || /^https:\/\//i.test(env.PUBLIC_APP_URL || env.VITE_PUBLIC_APP_URL || "");
}

function setAuthCookie(res: any, token: string) {
  res.cookie("mybay_auth_token", token, {
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(),
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

router.get("/config", (_req, res) => {
  res.json({ captchaEnabled: false, singleAdminMode: true });
});

router.post("/register", (_req, res) => {
  res.status(403).json({
    code: "LOCAL_REGISTER_DISABLED",
    error: "The MyBay Open Source uses a local administrator account. Public registration is disabled."
  });
});

router.post("/promote", (_req, res) => {
  res.status(403).json({
    code: "LOCAL_PROMOTE_DISABLED",
    error: "The MyBay Open Source is in single-administrator mode. User promotion is disabled."
  });
});

router.post("/login", async (req, res) => {
  try {
    const username = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    if (!username || !password) {
      return res.status(400).json({ error: "Username and password are required." });
    }

    const admin = await ensureLocalAdmin();

    const normalizedInput = username.toLowerCase();
    const normalizedAdmin = String(admin.username || "").trim().toLowerCase();

    // Single admin enforcement: Reject any non-admin username attempt with standard error
    if (normalizedInput !== normalizedAdmin) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    const verification = admin.password_hash
      ? verifyPassword(password, admin.password_hash)
      : { match: false, needsRehash: false };

    if (!verification.match) {
      return res.status(401).json({ error: "Invalid username or password." });
    }

    if (verification.needsRehash) {
      await dbAdapter.updateUserProfile(admin.id, {
        password_hash: hashPassword(password)
      });
    }

    const token = issueToken(admin);
    setAuthCookie(res, token);
    res.json({
      success: true,
      id: admin.id,
      username: admin.username,
      role: "admin",
      avatar_url: admin.avatar_url
    });
  } catch (err: any) {
    console.error("[Local Auth] Login failed:", err);
    res.status(500).json({ error: "Login failed." });
  }
});

router.get("/me", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const admin = await ensureLocalAdmin();
  res.json({
    success: true,
    id: admin.id,
    username: admin.username,
    role: "admin",
    avatar_url: admin.avatar_url,
    status: "active"
  });
});

router.get("/me/quota", authenticateToken, async (_req: AuthenticatedRequest, res) => {
  const resourceConfig = getHostResourceConfig();
  res.json({
    plan: "local",
    instanceUsed: 0,
    activeInstances: 0,
    instanceLimit: resourceConfig.maxInstanceCount,
    maxActiveInstances: resourceConfig.maxInstanceCount,
    isUnlimited: resourceConfig.maxInstanceCount === null,
    features: { byok: true, platformModels: localEditionCapabilities.platformModels, billing: localEditionCapabilities.billing }
  });
});

router.put("/users/:id/profile", authenticateToken, async (req: AuthenticatedRequest, res) => {
  const admin = await ensureLocalAdmin();
  const updates: any = {};
  if (req.body?.avatar_url !== undefined) updates.avatar_url = req.body.avatar_url;
  if (req.body?.password) {
    updates.password_hash = hashPassword(String(req.body.password));
  }
  await dbAdapter.updateUserProfile(admin.id, updates);
  res.json({ success: true, ...updates, password_hash: undefined });
});

router.get("/avatar-presets", authenticateToken, (_req, res) => {
  res.json([]);
});

router.get("/diagnostics/ip", authenticateToken, (req: AuthenticatedRequest, res) => {
  res.json({ ip: req.ip, ips: req.ips, remoteAddress: req.socket.remoteAddress });
});

router.post("/logout", (_req, res) => {
  res.clearCookie("mybay_auth_token", {
    path: "/",
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(),
    sameSite: "lax"
  });
  res.json({ success: true });
});

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 }
}).single("avatarFile");

router.post("/me/avatar/upload", authenticateToken, (req: AuthenticatedRequest, res) => {
  uploadAvatar(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.code === "LIMIT_FILE_SIZE" ? "Image exceeds the 1 MB limit." : err.message });
    if (!req.file?.buffer) return res.status(400).json({ error: "No file uploaded." });

    const detected = detectSafeImageType(req.file.buffer);
    if (!detected || !isDeclaredImageTypeCompatible(req.file.mimetype, detected)) {
      return res.status(400).json({ error: "File content does not match an allowed image format." });
    }

    const avatarDir = path.join(process.cwd(), "data", "uploads", "avatars");
    fs.mkdirSync(avatarDir, { recursive: true });
    const filename = `${randomUUID()}${detected.extension}`;
    fs.writeFileSync(path.join(avatarDir, filename), req.file.buffer, { flag: "wx" });

    const avatar_url = `/uploads/avatars/${filename}`;
    const admin = await ensureLocalAdmin();
    await dbAdapter.updateUserProfile(admin.id, { avatar_url });
    res.json({ success: true, avatar_url });
  });
});

export default router;
