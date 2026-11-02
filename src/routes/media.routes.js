
import { Router } from "express";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { requireAuth } from "../middleware/requireAuth.js";

const router = Router();

const uploadDir = path.resolve("src/uploads/chat");

fs.mkdirSync(uploadDir, { recursive: true });

const allowedTypes = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov"
};

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },

  filename: (_req, file, cb) => {
    const extension = allowedTypes[file.mimetype];

    cb(null, `${randomUUID()}${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 4
  },
  fileFilter: (_req, file, cb) => {
    if (!allowedTypes[file.mimetype]) {
      return cb(new Error("Formato de arquivo não permitido."));
    }

    cb(null, true);
  }
});

router.post(
  "/",
  requireAuth,
  (req, res, next) => {
    upload.array("files", 4)(req, res, error => {
      if (error) {
        return res.status(400).json({
          error: error.message
        });
      }

      next();
    });
  },
  (req, res) => {
    const attachments = (req.files || []).map(file => ({
      url: `/uploads/chat/${file.filename}`,
      name: file.originalname,
      type: file.mimetype.startsWith("image/")
        ? "image"
        : "video"
    }));

    res.json({
      ok: true,
      attachments
    });
  }
);

export default router;
