# MCJAVASERVER

Scaffold for a Minecraft Java server with a web frontend. The site allows the very first visitor to register (single initial admin). That admin can log in from any computer and control the server console and commands via the web UI.

This update hardened the application and made several important fixes:
- Atomic registration to avoid race conditions (only the first visitor can register).
- Uses RCON for sending commands (more reliable than writing to stdin) and for retrieving seed/command responses.
- Keeps streaming server stdout to the web UI for real-time logs, but uses RCON for commands.
- Adds rate-limiting to auth endpoints to help prevent brute-force attacks.
- Adds safer cookie flags for the JWT cookie (SameSite=Strict, Secure in production).
- setup script now enables RCON by creating server.properties with a random RCON password if one does not exist.
- Download retries on server.jar fetch.

Quick start (local dev):
1. Install Java 17+ and Node 18+.
2. Set a strong JWT secret:
   export JWT_SECRET="replace-with-a-long-random-secret"
3. npm install
   - postinstall will download the current latest vanilla server.jar, write eula.txt and a server.properties with RCON enabled (if not present).
4. npm start
5. Open http://localhost:3000
   - If you are the first visitor, you'll see registration, create the first account, then log in and start the server.

Notes & security:
- Do NOT expose to the open internet without careful hardening.
- RCON password is stored in minecraft/server.properties. Treat it as a secret and do not commit it.
- In production run with NODE_ENV=production and set JWT_SECRET and consider setting COOKIE_SECURE=1 if behind HTTPS reverse proxy.
- Consider using Docker and running Minecraft in a dedicated container with persistent volumes for the world data.

If you want, I can also:
- Add a Dockerfile and docker-compose (two-container setup: web + minecraft) with RCON exposed only to the web container.
- Add checksum verification for downloaded server.jar, or allow pre-bundling the jar in a Docker image.
- Add more robust supervision (systemd/PM2) or replace WS console streaming with log file tailing.
