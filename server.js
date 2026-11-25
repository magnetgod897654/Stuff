import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_API_KEY_CHARS = 512;

app.disable("x-powered-by");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "same-origin" },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const publishLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many publish requests. Wait a little and try again." }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter(_req, file, callback) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (![".rbxl", ".rbxlx"].includes(ext)) {
      return callback(new Error("Only .rbxl and .rbxlx files are supported."));
    }
    callback(null, true);
  }
});

function validId(value) {
  return typeof value === "string" && /^\d{1,24}$/.test(value.trim());
}

function safeRobloxError(status, bodyText) {
  let detail = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    detail = parsed.message || parsed.error || parsed.detail || bodyText;
  } catch {}
  const friendly = {
    400: "Roblox rejected the request or the place file. Check the IDs, file format, and API permissions.",
    401: "Roblox did not accept this API key. Check that it is active and copied correctly.",
    403: "This key or its owner does not have permission to publish to this experience/place.",
    404: "Roblox could not find that place or asset. Confirm the Place ID.",
    409: "The Place ID may not belong to the specified experience. Check the Universe ID and Place ID together.",
    429: "Roblox rate-limited the request. Wait and try again.",
    500: "Roblox returned a server error. Try again later."
  };
  return `${friendly[status] || `Roblox returned HTTP ${status}.`} ${String(detail).slice(0, 350)}`;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "UploadStuff V2",
    publishing: "Roblox Assets API",
    createExperienceApi: false,
    createPlaceApi: false
  });
});

/*
 * Roblox's documented Open Cloud place publishing workflow updates an EXISTING
 * place asset using PATCH /assets/v1/assets/{assetId}. It returns an operation
 * path, which this server polls until Roblox reports completion.
 *
 * Creating a brand-new universe/experience or a new place is not exposed as a
 * documented API-key Open Cloud operation in the Creator Hub API reference
 * checked for this release. Create it in Studio/Creator Dashboard first, then
 * paste its IDs here. The dashboard never pretends it created one.
 */
app.post("/api/publish", publishLimiter, (req, res) => {
  upload.single("placeFile")(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError.code === "LIMIT_FILE_SIZE"
        ? "File is too large. This build allows up to 10 MB."
        : uploadError.message || "File upload failed.";
      return res.status(400).json({ error: message });
    }

    try {
      const apiKey = String(req.body.apiKey || "").trim();
      const universeId = String(req.body.universeId || "").trim();
      const placeId = String(req.body.placeId || "").trim();
      const publishMode = String(req.body.publishMode || "published");
      const displayName = String(req.body.displayName || "").trim();
      const description = String(req.body.description || "").trim();
      const ownership = String(req.body.ownership || "personal");

      if (!req.file) return res.status(400).json({ error: "Choose a .rbxl or .rbxlx file." });
      if (!apiKey || apiKey.length > MAX_API_KEY_CHARS) {
        return res.status(400).json({ error: "Enter a valid Roblox API key." });
      }
      if (!validId(universeId)) return res.status(400).json({ error: "Universe ID must contain digits only." });
      if (!validId(placeId)) return res.status(400).json({ error: "Place ID must contain digits only." });
      if (!["published", "saved"].includes(publishMode)) {
        return res.status(400).json({ error: "Invalid publish mode." });
      }
      if (!["personal", "group"].includes(ownership)) {
        return res.status(400).json({ error: "Choose personal or group ownership." });
      }
      if (displayName.length > 100 || description.length > 1000) {
        return res.status(400).json({ error: "Name must be 100 characters or fewer; description must be 1,000 characters or fewer." });
      }

      const assetId = encodeURIComponent(placeId);
      const requestId = crypto.randomUUID();
      const form = new FormData();
      const requestInfo = {
        assetId: Number(placeId),
        assetType: "Place",
        published: publishMode === "published"
      };

      form.append("request", JSON.stringify(requestInfo));
      const mime = path.extname(req.file.originalname).toLowerCase() === ".rbxlx"
        ? "application/xml"
        : "application/octet-stream";
      form.append("fileContent", new Blob([req.file.buffer], { type: mime }), req.file.originalname);

      const robloxResponse = await fetch(`https://apis.roblox.com/assets/v1/assets/${assetId}`, {
        method: "PATCH",
        headers: { "x-api-key": apiKey },
        body: form,
        signal: AbortSignal.timeout(45000)
      });

      const responseText = await robloxResponse.text();
      if (!robloxResponse.ok) {
        return res.status(robloxResponse.status === 429 ? 429 : 502).json({
          error: safeRobloxError(robloxResponse.status, responseText),
          requestId
        });
      }

      let operation;
      try { operation = JSON.parse(responseText); }
      catch {
        return res.status(502).json({
          error: "Roblox accepted the request but returned an unexpected response. Check the place in Creator Dashboard before retrying.",
          requestId
        });
      }

      const operationPath = typeof operation.path === "string" ? operation.path : "";
      if (!/^operations\/[A-Za-z0-9._:-]+$/.test(operationPath)) {
        return res.status(502).json({
          error: "Roblox returned an unexpected operation reference. Check Creator Dashboard before retrying.",
          requestId
        });
      }

      const operationUrl = `https://apis.roblox.com/assets/v1/${operationPath}`;
      let finalOperation = null;

      for (let attempt = 0; attempt < 15; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const statusResponse = await fetch(operationUrl, {
          headers: { "x-api-key": apiKey },
          signal: AbortSignal.timeout(15000)
        });
        const statusText = await statusResponse.text();

        if (!statusResponse.ok) {
          return res.status(502).json({
            error: `Roblox accepted the upload, but checking its status failed (HTTP ${statusResponse.status}). Check Creator Dashboard before uploading again.`,
            requestId,
            operationPending: true
          });
        }

        try { finalOperation = JSON.parse(statusText); }
        catch { finalOperation = null; }

        if (finalOperation?.done === true) break;
      }

      if (!finalOperation || finalOperation.done !== true) {
        return res.status(202).json({
          accepted: true,
          pending: true,
          requestId,
          message: "Roblox accepted the file and is still processing it. Check Creator Dashboard before retrying.",
          operation: operationPath
        });
      }

      if (finalOperation.error) {
        return res.status(502).json({
          error: `Roblox processing failed: ${finalOperation.error.message || "Unknown processing error."}`,
          requestId
        });
      }

      const result = finalOperation.response || {};
      return res.json({
        success: true,
        requestId,
        placeId,
        universeId,
        publishMode,
        revisionId: result.revisionId || null,
        isPublished: result.isPublished === true,
        fileName: req.file.originalname,
        displayName: displayName || null,
        description: description || null,
        ownership,
        note: "The name and description entered here are dashboard labels only; this upload endpoint does not apply them as Roblox metadata."
      });
    } catch (error) {
      const timeout = error.name === "TimeoutError" || error.name === "AbortError";
      return res.status(500).json({
        error: timeout
          ? "The request timed out. Roblox may still be processing the upload; check Creator Dashboard before retrying."
          : "The server could not complete the request. Check your connection and server logs.",
      });
    }
  });
});

app.use((error, _req, res, _next) => {
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`UploadStuff V2 running at http://localhost:${PORT}`);
  console.log("API keys are handled in memory and are not written to disk or logs.");
});
