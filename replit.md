# Running this project on Replit

This is the imported npm-workspaces React/Express app. Keep the existing `client/` and `server/` structure.

- The **Start application** workflow runs `npm run build && PORT=5000 NODE_ENV=production npm start`. Use Run to open the web preview.
- Dependencies are installed with npm from the repository root; `package-lock.json` records resolved versions.
- The application uses Replit's managed PostgreSQL connection (`DATABASE_URL`) and the existing `SESSION_SECRET` secret. Do not store their values in files. `ADMIN_RECOVERY_CODE` is optional; without it, emergency admin recovery is unavailable.
- On a fresh development database, the server applies its SQL migration and inserts demo data. The demo accounts and initial password are documented in `docs/RUN.md`. Change demo passwords before allowing real users access.
- Express sessions are stored in PostgreSQL so staff remain signed in across server restarts and instances. The existing cookie is HTTP-only and secure in production.

See `docs/RUN.md` for the project's original local run instructions.