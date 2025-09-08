# PlanMate MCP (Minimal)

Basic MCP server exposing a single tool `search-venues` using Google Places.

## Prerequisites
- Node.js 18+
- Google Maps API key available in `backend/.env` as `GOOGLE_MAPS_API_KEY`

## Install

```bash
npm install --prefix mcp
npm run --prefix mcp build
```

## Run (stdio)

```bash
node mcp/dist/index.js
```

This prints to stderr that the server is running. It exposes one tool:

- search-venues
  - inputs: `{ query, lat, lng, category?, radius?, limit? }`
  - returns: JSON string of `{ count, venues: [...] }`

## Notes
- Env is loaded from `backend/.env` automatically if present.
- Uses stdio transport; integrate with your existing host/runtime as needed.
