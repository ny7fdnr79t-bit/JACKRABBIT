# Wastely CRM — Mac app

A window onto the CRM website, with its own sign-ins kept separate from Safari and Chrome.

## Install
Open `Wastely CRM-1.1.0-arm64.dmg` and drag **Wastely CRM** into Applications (replace the old one).
The first time, right-click the app → **Open** → **Open**. It isn't signed with an Apple Developer ID yet.

## The CRM menu
- **Live CRM**: jackrabbit-psi.vercel.app, what everyone uses.
- **Preview CRM**: the new version on the `crm-nextjs` branch. Previews are private to your Vercel account, so the first time, sign in to Vercel in the app window.
- **Open preview** links on the Builds screen open in their own app window.
- **Open in Browser** (⇧⌘O) opens the current page in your default browser.
The app remembers your choice.

## Build it
Requires Node.js.
```
npm install
npm run dist
```
The installer appears in `dist/`. After the new CRM goes live on the main site, change the two addresses in `SITES` at the top of `main.js` and rebuild.
