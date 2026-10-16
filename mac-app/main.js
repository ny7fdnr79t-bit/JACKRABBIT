const { app, BrowserWindow, shell, Menu } = require('electron');

const CRM_URL = 'https://jackrabbit-psi.vercel.app';

// Google / Microsoft sign-in goes through Supabase and must stay in the app
// window so the session cookie lands here, not in the default browser.
const SIGN_IN_HOSTS = [/\.supabase\.co$/, /^accounts\.google\.com$/, /^login\.microsoftonline\.com$/, /^login\.live\.com$/];
const isSignIn = url => { try { const h = new URL(url).hostname; return SIGN_IN_HOSTS.some(r => r.test(h)); } catch { return false; } };

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    title: 'Wastely CRM',
    backgroundColor: '#161826',
    titleBarStyle: 'hiddenInset',
    webPreferences: { partition: 'persist:wastely', contextIsolation: true }
  });
  win.loadURL(CRM_URL);
  // Open external links (Quo, Stripe, email) in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(CRM_URL)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(CRM_URL) && !isSignIn(url)) { e.preventDefault(); shell.openExternal(url); }
  });
  win.webContents.on('did-fail-load', () => {
    win.loadURL('data:text/html,' + encodeURIComponent(
      '<body style="background:#161826;color:#e9e9ed;font:15px -apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0">' +
      '<div style="text-align:center"><p>Can\'t reach Wastely CRM. Check your internet connection.</p>' +
      '<button onclick="location.href=\'' + CRM_URL + '\'" style="margin-top:12px;padding:8px 16px;background:none;color:#9184d9;border:1px solid #9184d9;border-radius:8px;cursor:pointer">Try again</button></div></body>'));
  });
}

Menu.setApplicationMenu(Menu.buildFromTemplate([
  { role: 'appMenu' }, { role: 'editMenu' },
  { label: 'View', submenu: [{ role: 'reload' }, { role: 'togglefullscreen' }, { type: 'separator' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }] },
  { role: 'windowMenu' }
]));

app.whenReady().then(createWindow);
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
