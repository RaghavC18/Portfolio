# Video Portfolio

A single-page video portfolio with a private Creator Studio, Cloudflare R2 video/image storage, and server-side PIN authentication.

## Run locally

Prerequisites: Node.js 20+

1. Install dependencies:
   `npm install`
2. Configure the server environment variables from `.env.example`.
3. Start the development server:
   `npm run dev`

## Required environment variables

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME`
- `R2_PUBLIC_BASE_URL`
- `CREATOR_PIN`
- `CREATOR_SESSION_SECRET`

The R2 secret values and creator secrets must remain server-side. Do not put them in frontend source files.
