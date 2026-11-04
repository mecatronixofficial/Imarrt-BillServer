import { existsSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import puppeteer from 'puppeteer';

type BrowserEnvironment = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  exists?: (path: string) => boolean;
  bundledPath?: () => string | Promise<string>;
};

/** Prefer an explicit browser, then Puppeteer's download, then installed browsers. */
export async function resolvePdfBrowserExecutable(
  configuredPath?: string,
  options: BrowserEnvironment = {},
): Promise<string> {
  const exists = options.exists ?? existsSync;
  const explicit = configuredPath?.trim();
  if (explicit) {
    if (!exists(explicit)) {
      throw new Error('PUPPETEER_EXECUTABLE_PATH does not exist. Point it to an installed Chrome, Edge, or Chromium executable.');
    }
    return explicit;
  }

  try {
    const bundled = await (options.bundledPath ?? (() => puppeteer.executablePath()))();
    if (exists(bundled)) return bundled;
  } catch {
    // A missing or invalid Puppeteer download must not prevent discovery of
    // an installed browser that can generate PDFs without another download.
  }

  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  let candidates: string[];
  if (platform === 'win32') {
    const roots = [
      env.PROGRAMFILES ?? env.ProgramFiles ?? 'C:\\Program Files',
      env['PROGRAMFILES(X86)'] ?? env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
      env.LOCALAPPDATA,
    ].filter((root): root is string => Boolean(root));
    candidates = [
      ...roots.map(root => win32.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
      ...roots.map(root => win32.join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe')),
    ];
  } else if (platform === 'darwin') {
    const applications = ['/Applications', ...(env.HOME ? [posix.join(env.HOME, 'Applications')] : [])];
    candidates = applications.flatMap(root => [
      posix.join(root, 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
      posix.join(root, 'Microsoft Edge.app', 'Contents', 'MacOS', 'Microsoft Edge'),
      posix.join(root, 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    ]);
  } else {
    candidates = [
      '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome',
      '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium',
      '/opt/google/chrome/chrome', '/usr/bin/microsoft-edge-stable',
    ];
  }

  const installed = candidates.find(exists);
  if (installed) return installed;
  throw new Error(
    'No browser is available for PDF generation. Set PUPPETEER_EXECUTABLE_PATH to an installed Chrome, Edge, or Chromium executable, or run "bunx puppeteer browsers install chrome".',
  );
}
