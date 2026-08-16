import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { dbAdapter } from "../db";
import { JWT_SECRET } from "../utils/authSecrets";

export interface AuthenticatedRequest extends Request {
  user?: any;
  token?: string;
}

export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admin role required." });
  }
};

export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers["authorization"];
  let token = authHeader && authHeader.split(" ")[1];
  
  if (token) {
    const trimmed = token.trim();
    if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
      token = undefined;
    }
  }
  
  // Fallback to cookie if token is not found in the Authorization header
  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/(?:^|; )mybay_auth_token=([^;]*)/);
    if (match) {
      const candidate = match[1].trim();
      if (candidate !== "" && candidate !== "null" && candidate !== "undefined") {
        token = candidate;
      }
    }
  }
  
  if (!token) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  jwt.verify(token, JWT_SECRET, async (err: any, decoded: any) => {
    if (err) {
      console.warn(`[Auth] JWT Verification failed: ${err.message}`);
      return res.status(401).json({ error: "Unauthorized" });
    }
    
    try {
      const user = await dbAdapter.getUserById(decoded.id);
      if (!user) {
        console.warn(`[Auth] User decoded from token not found in database: id=${decoded.id}`);
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      if (user.status === 'disabled') {
        console.warn(`[Auth] Disabled user tried to authenticate: ${user.username}`);
        return res.status(401).json({ error: "Unauthorized" });
      }
      
      req.user = user;
      req.token = token;
      next();
    } catch (e) {
      console.error("[Auth] Database or internal error during authenticateToken:", e);
      res.status(500).json({ error: "Authentication server error" });
    }
  });
};
