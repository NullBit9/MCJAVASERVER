# MCJAVASERVER

Scaffold for a Minecraft Java 1.26.2 (Paper) server with a web frontend. The site allows the very first visitor to register (single initial admin). That admin can log in from any computer and control the server console, seed, chat commands via the web UI.

Quick start:
1. Install Node 18+.
2. npm install
   - postinstall will try to download Paper 1.26.2 server jar into ./minecraft/server.jar and write eula.txt.
   - If download fails, place a server jar at ./minecraft/server.jar manually.
3. npm start
4. Open http://localhost:3000
   - If you are the first visitor, you'll see registration.
   - After registering, log in and start the server from the web UI.

Notes & security:
- This is a minimal scaffold. Do NOT expose to the open internet without adding:
  - HTTPS (TLS)
  - Strong JWT secret via env var JWT_SECRET
  - Proper session expiry and CSRF protections
  - Rate-limiting and hardened authentication
- Production deployments should run the Minecraft server in a managed container or VM with adequate memory and CPU, and persistent volumes for world data.

Files of interest:
- server.js — Express backend + websocket console
- scripts/setupServer.js — downloads Paper jar on `npm install`
- public/* — frontend
- data/db.sqlite — (created on first run) stores user info

If you want, I can:
- Push these files to a new repository named MCJAVASERVER under your account (give owner/repo).
- Add a Dockerfile + docker-compose for deployment.
- Harden auth (CSRF, HTTPS), add password reset, roles, or multiple admins.
- Swap to RCON-based command handling instead of stdin for a more robust setup.
