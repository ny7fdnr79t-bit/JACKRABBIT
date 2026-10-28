const { app, BrowserWindow, shell, Menu, dialog } = require('electron');
const fs = require('fs');
const path = require('path');

// Which CRM the app shows. Switch under the "CRM" menu; the choice is remembered.
const SITES = {
  live: { label: 'Live CRM', url: 'https://jackrabbit-psi.vercel.app' },
  preview: { label: 'Preview CRM (crm-nextjs)', url: 'https://jackrabbit-git-crm-nextjs-evan-3484.vercel.app' }
};

// Pages allowed inside the app's windows. Anything else opens in the default browser.
const IN_APP = [
  /^jackrabbit-psi\.vercel\.app$/,                 // the live CRM
  /^jackrabbit-[a-z0-9-]+-evan-3484\.vercel\.app$/, // the preview CRM and every build preview (your Vercel team only)
  /(^|\.)vercel\.com$/,                            // Vercel login, which previews ask for
  /\.supabase\.co$/,                               // CRM sign-in
  /^accounts\.google\.com$/, /^login\.microsoftonline\.com$/, /^login\.live\.com$/,
  /^github\.com$/                                  // Vercel login with GitHub
];
const inApp = url => { try { const u = new URL(url); return u.protocol === 'https:' && IN_APP.some(r => r.test(u.hostname)); } catch { return false; } };

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const load = () => { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } };
const save = s => { try { fs.writeFileSync(settingsFile(), JSON.stringify(s)); } catch {} };

let site = 'live';
let main = null;

function title(win, page) {
  const tag = site === 'preview' ? ' — Preview' : '';
  win.setTitle((page ? page + ' · ' : '') + 'Wastely CRM' + tag);
}

// Keeps a window's links in the app or sends them to the browser.
function guard(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Build previews and other CRM pages open in a new app window that shares the sign-ins.
    if (inApp(url)) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 860, backgroundColor: '#161826', titleBarStyle: 'hiddenInset' } };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', child => guard(child));
  win.webContents.on('will-navigate', (e, url) => { if (!inApp(url)) { e.preventDefault(); shell.openExternal(url); } });
  win.on('page-title-updated', (e, t) => { e.preventDefault(); title(win, t); });
  win.webContents.on('did-fail-load', (_e, code, _desc, url, isMain) => {
    if (!isMain || code === -3) return; // -3: navigation replaced by another, not a real failure
    win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#161826;color:#e9e9ed;font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><p>Can\'t reach Wastely CRM. Check your internet connection.</p>' +
      '<button onclick="location.href=' + JSON.stringify(url).replace(/"/g, '&quot;') + '" style="margin-top:12px;padding:8px 16px;background:none;color:#9184d9;border:1px solid #9184d9;border-radius:8px;cursor:pointer">Try again</button></div></body>'));
  });
}

function createWindow() {
  main = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    backgroundColor: '#161826',
    titleBarStyle: 'hiddenInset',
    webPreferences: { partition: 'persist:wastely', contextIsolation: true }
  });
  guard(main);
  title(main);
  main.loadURL(SITES[site].url);
  main.on('closed', () => { main = null; });
}

function switchTo(next) {
  if (next === site) return;
  site = next;
  save({ ...load(), site });
  buildMenu();
  if (!main) return createWindow();
  title(main);
  main.loadURL(SITES[site].url);
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    {
      label: 'CRM',
      submenu: [
        ...Object.entries(SITES).map(([key, s]) => ({ label: s.label, type: 'radio', checked: site === key, click: () => switchTo(key) })),
        { type: 'separator' },
        { label: 'Open in Browser', accelerator: 'CmdOrCtrl+Shift+O', click: w => shell.openExternal((w || main)?.webContents.getURL() || SITES[site].url) },
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: w => (w || main)?.webContents.navigationHistory.goBack() },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: w => (w || main)?.webContents.navigationHistory.goForward() }
      ]
    },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ label: 'About the CRM menu', click: () => dialog.showMessageBox({ message: 'Live CRM is what everyone uses. Preview CRM shows the new version being built. Build previews open in their own window when you click "Open preview" on the Builds screen.' }) }] }
  ]));
}

app.whenReady().then(() => {
  site = SITES[load().site] ? load().site : 'live';
  buildMenu();
  createWindow();
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
