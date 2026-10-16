# Wastely CRM — Mac app

## Build it (one time, ~5 min)
1. Install Node.js from https://nodejs.org (LTS).
2. Open Terminal, then:
   cd ~/Downloads/mac-app
   npm install
   npm run dist
3. Open `dist/Wastely CRM-1.0.0-universal.dmg` and drag Wastely CRM into Applications.

First launch: right-click the app → Open → Open (it isn't signed with an Apple Developer ID yet).

## Notes
- The app loads https://jackrabbit-psi.vercel.app, so every Vercel deploy updates it automatically. No rebuild needed.
- To change the URL (e.g. crm.wastely.ca), edit CRM_URL in main.js and rebuild.
- Data is stored inside the app, separate from Safari/Chrome.
- Try it without building: npm install, then npm start.
