import { defaultLogger } from "@config/log.server";
import { deleteAuthSession, readAuthSession, saveAuthSession } from "@server/utils/auth-session";
import express from "express";
import { SiweMessage, generateNonce } from "siwe";

const logger = defaultLogger.child({ module: "auth" });

const router = express.Router();

router.get("/nonce", (req, res) => {
  const nonce = generateNonce();
  saveAuthSession(req, { nonce });
  res.setHeader("Content-Type", "text/plain");
  res.send(nonce);
});

router.post("/verify", async (req, res) => {
  try {
    const { message, signature } = req.body;
    const siweMessage = new SiweMessage(message);

    const siwe = await siweMessage.verify({ signature });
    const session = readAuthSession(req);

    if (!session || siwe.data.nonce !== session.nonce) {
      logger.warn("Invalid nonce.");
      return res.status(422).json({ message: "Invalid nonce." });
    }

    saveAuthSession(req, { siwe });
    res.json({ ok: true });
  } catch (err) {
    logger.warn(err, "Failed to verify signed message.");
    res.status(400).json({ message: "Failed to verify signed message." });
  }
});

router.get("/logout", (req, res) => {
  deleteAuthSession(req);
  res.status(204).end();
});

export default router;
