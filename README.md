# UploadStuff V2 — no folders

This project has only three files at the repository root:
- `index.html` — the complete dashboard, with CSS and browser JavaScript embedded
- `server.js` — Node.js backend that forwards place uploads to Roblox Open Cloud
- `package.json` — dependencies and start command

## Render
Build command: `npm install`
Start command: `npm start`

## Important Roblox limitations
This publishes a place file to an existing Roblox place. It does not create a new experience/universe or add a new place automatically. Create new experiences and sub-places in Roblox Studio or Creator Dashboard, then use their Universe ID and Place ID here. The dashboard name/description are labels only and do not change Roblox metadata.

Use an API key with the required Assets API write permissions. For group-owned experiences, the key owner must already have appropriate group permissions.

This project is intended for a private, trusted deployment. It has no user login; do not publish the dashboard for public use without adding authentication and proper secret handling.
