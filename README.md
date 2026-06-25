# MCJAVASERVER

Scaffold for a Minecraft Java 1.26+/26.x (vanilla) server with a web frontend. The site allows the very first visitor to register (single initial admin). That admin can log in from any computer and control the server console, seed, chat commands via the web UI.

## Requirements
- Node.js 18+ (v26 tested)
- Java 17+ (to run the Minecraft server)
- Git

## Setup (local)
Run these commands from a terminal in the directory where you want the project.

1. Clone and enter the repo
- git clone https://github.com/NullBit9/MCJAVASERVER
- cd MCJAVASERVER

2. Install Node dependencies
- npm install

3. Download the vanilla Minecraft server JAR (recommended)
- Automated (recommended):
  - MC_VERSION="26.2" node scripts/setupServer.js
    - This will fetch the Mojang version manifest and download the server JAR for the requested version into `./minecraft/server.jar`. If `MC_VERSION` is omitted it will default to `1.26.2`.

- Manual: download the server JAR from the official Mojang page and place it into the repository:
  - https://www.minecraft.net/en-us/download/server
  - Create the folder (if missing) and move the file:
    - mkdir -p minecraft
    - mv /path/to/server.jar minecraft/server.jar

4. Verify files
- ls -l minecraft/server.jar
- java -version
- node -v

5. Start the web app
- npm start
- Open: http://localhost:3000
  - If you are the first visitor you'll see registration. After registering, log in and you can start/stop the server and send console commands from the web UI.

6. Start the Minecraft server (via the UI)
- Click "Start Server" in the admin UI — the Node process will spawn Java and run the server from `./minecraft`.
- Alternatively run directly:
  - cd minecraft
  - java -Xmx1G -jar server.jar nogui

Notes
- The setup script writes `minecraft/eula.txt` with `eula=true` by default. If you prefer to accept it manually, create that file yourself.
- Do NOT commit `minecraft/server.jar` to git. It's already ignored in `.gitignore`.

## Setup (for PaaS / Render builds)
If you deploy only the web UI to a PaaS such as Render you probably do not want the build step to download server.jar or try to spawn Java there. Recommended approach:
- In Render build settings you can set the Build Command to:
  - npm install --ignore-scripts
- Then set the Start Command to:
  - npm start
- Do not enable the `Start Server` action on the hosted web service. Instead run Minecraft on a separate VPS and control it remotely (RCON support can be added to this project if you want).

## Troubleshooting
- Error: `Cannot find module 'express'` — run `npm install` in the project root.
- Error: `server.jar not found at ./minecraft/server.jar` — run the setup script or place server.jar in `./minecraft/server.jar`.
- Native module build failures (bcrypt, sqlite3) — ensure you have the platform build tools installed (macOS: `xcode-select --install`; Windows: install Build Tools or use WSL).

## Next steps / Optional changes
- Add RCON support to control a remote server and safely host the web UI on a PaaS.
- Add `DOWNLOAD_SERVER=false` env var to skip the postinstall download on builds.

If you want me to add either of those now, tell me which and I will push the change.
