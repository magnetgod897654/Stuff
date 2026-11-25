import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_BYTES = 10 * 1024 * 1024;

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));

app.get("/", (_req, res) => res.sendFile(path.join(process.cwd(), "index.html")));
app.get("/api/health", (_req, res) => res.json({ ok: true, service: "UploadStuff V2" }));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (![".rbxl", ".rbxlx"].includes(path.extname(file.originalname).toLowerCase())) {
      return cb(new Error("Only .rbxl and .rbxlx files are supported."));
    }
    cb(null, true);
  }
});

function validId(value) {
  return typeof value === "string" && /^\d{1,24}$/.test(value.trim());
}

function robloxError(status, body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed.message || parsed.error || parsed.detail || body;
  } catch {}
  const messages = {
    400: "Roblox rejected the request. Check the IDs, file format, and API key permissions.",
    401: "Roblox did not accept this API key.",
    403: "The API key owner does not have permission to publish to this place.",
    404: "Roblox could not find that place. Check the Place ID.",
    429: "Roblox rate-limited the request. Wait and try again."
  };
  return `${messages[status] || `Roblox returned HTTP ${status}.`} ${String(detail).slice(0, 300)}`;
}

app.post("/api/publish", limiter, (req, res) => {
  upload.single("placeFile")(req, res, async (uploadError) => {
    if (uploadError) {
      return res.status(400).json({
        error: uploadError.code === "LIMIT_FILE_SIZE"
          ? "File is too large. Maximum size is 10 MB."
          : uploadError.message
      });
    }

    try {
      const apiKey = String(req.body.apiKey || "").trim();
      const universeId = String(req.body.universeId || "").trim();
      const placeId = String(req.body.placeId || "").trim();
      const publishMode = String(req.body.publishMode || "published");

      if (!req.file) return res.status(400).json({ error: "Choose a .rbxl or .rbxlx file." });
      if (!apiKey || apiKey.length > 512) return res.status(400).json({ error: "Enter a valid API key." });
      if (!validId(universeId) || !validId(placeId)) return res.status(400).json({ error: "Enter numeric Universe ID and Place ID values." });
      if (!["published", "saved"].includes(publishMode)) return res.status(400).json({ error: "Invalid upload mode." });

      const form = new FormData();
      form.append("request", JSON.stringify({
        assetId: Number(placeId),
        assetType: "Place",
        published: publishMode === "published"
      }));
      const mime = path.extname(req.file.originalname).toLowerCase() === ".rbxlx"
        ? "application/xml" : "application/octet-stream";
      form.append("fileContent", new Blob([req.file.buffer], { type: mime }), req.file.originalname);

      const publishResponse = await fetch(`https://apis.roblox.com/assets/v1/assets/${encodeURIComponent(placeId)}`, {
        method: "PATCH",
        headers: { "x-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(45000)
      });
      const publishText = await publishResponse.text();
      if (!publishResponse.ok) return res.status(502).json({ error: robloxError(publishResponse.status, publishText) });

      let operation;
      try { operation = JSON.parse(publishText); } catch {}
      if (!operation?.path || !/^operations\/[A-Za-z0-9._:-]+$/.test(operation.path)) {
        return res.status(502).json({ error: "Roblox returned an unexpected operation response. Check Creator Dashboard before retrying." });
      }

      const operationUrl = `https://apis.roblox.com/assets/v1/${operation.path}`;
      let result;
      for (let i = 0; i < 15; i++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusResponse = await fetch(operationUrl, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000)
        });
        if (!statusResponse.ok) {
          return res.status(202).json({ pending: true, message: "Roblox accepted the upload, but status checking failed. Check Creator Dashboard before retrying." });
        }
        result = await statusResponse.json();
        if (result.done) break;
      }

      if (!result?.done) return res.status(202).json({ pending: true, message: "Roblox is still processing this upload. Check Creator Dashboard before retrying." });
      if (result.error) return res.status(502).json({ error: `Roblox processing failed: ${result.error.message || "Unknown error"}` });

      const response = result.response || {};
      res.json({
        success: true,
        placeId,
        universeId,
        revisionId: response.revisionId || null,
        isPublished: response.isPublished === true,
        fileName: req.file.originalname,
        note: "Dashboard name and description are labels only; this publishing endpoint does not change Roblox metadata."
      });
    } catch (error) {
      res.status(500).json({
        error: error.name === "TimeoutError" || error.name === "AbortError"
          ? "Request timed out. Roblox may still be processing; check Creator Dashboard before retrying."
          : "The server could not complete the request."
      });
    }
  });
});

app.use((error, _req, res, _next) => res.status(500).json({ error: "Unexpected server error." }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UploadStuff V2 running on port ${PORT}`);
});
