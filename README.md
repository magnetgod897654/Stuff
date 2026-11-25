# UploadStuff V2

A local, mobile-friendly dashboard for publishing Roblox `.rbxl` and `.rbxlx` place files to an **existing** Roblox place using the Roblox Open Cloud Assets API.

## Important API limitation

This release intentionally does **not** claim to create a brand-new Roblox experience (universe) or a new sub-place automatically. The documented Open Cloud API reference checked for this version exposes place publishing and experience/place management operations, but not a supported API-key operation to create a new universe or add a new place.

For a new experience:
1. Create and publish the experience in Roblox Studio / Creator Dashboard.
2. For a sub-place, use Studio's **File → Publish As → Add as a new place** workflow.
3. Copy the Universe ID and Place ID from Creator Dashboard.
4. Enter those IDs in UploadStuff and publish the `.rbxl` / `.rbxlx` file.

Roblox guide: https://create.roblox.com/docs/production/publishing/publish-games-and-places

## Requirements

- Node.js 20 or newer
- A Roblox Open Cloud API key
- An existing Roblox experience and target place
- The API key must have the required Assets API access and write permission for the target place/experience
- For group-owned experiences, the API key owner must have sufficient group permissions

Roblox API key guide: https://create.roblox.com/docs/cloud/auth/api-keys

## Install and run

1. Extract the ZIP.
2. Open a terminal in the extracted `UploadStuff-V2` folder.
3. Run:

   ```bash
   npm install
   npm start
   ```

4. Open `http://localhost:3000` in your browser.

For development with automatic restart:

```bash
npm run dev
```

## How publishing works

The server uses Roblox's documented Assets API workflow:

- `PATCH https://apis.roblox.com/assets/v1/assets/{placeId}`
- Multipart form fields:
  - `request`: `{ "assetId": <placeId>, "assetType": "Place", "published": true|false }`
  - `fileContent`: the `.rbxl` or `.rbxlx` file
- Roblox returns an operation path. The server polls `GET https://apis.roblox.com/assets/v1/operations/{operationId}` until completion or timeout.

A completed operation returns a revision ID and publication status. The dashboard displays those values.

Official guide: https://create.roblox.com/docs/cloud/guides/usage-place-publishing

## API key safety

- The key is submitted to the local server over the local web app.
- It is not stored in localStorage, cookies, a database, or a file.
- It is not written to application logs.
- It is forwarded to Roblox over HTTPS.
- The server holds it in request memory only.

**Do not expose this local server publicly as-is.** A public multi-user deployment needs authentication, per-user authorization, secure secret management, CSRF protection appropriate to its auth model, and operational monitoring. Use HTTPS behind a trusted reverse proxy if you deploy it.

## Current limits

- Maximum upload size: 10 MB in this build.
- Supported extensions: `.rbxl`, `.rbxlx`.
- Upload target must already exist.
- Dashboard label and description are internal labels only. They are not applied as Roblox metadata.
- Group selection does not grant permissions. Roblox checks the API key and the key owner's actual access.
- If Roblox accepts an upload but status polling times out, check Creator Dashboard before retrying to avoid duplicate work.

## Project structure

```text
UploadStuff-V2/
├── package.json
├── server.js
├── README.md
├── .gitignore
└── public/
    ├── index.html
    ├── style.css
    └── app.js
```
