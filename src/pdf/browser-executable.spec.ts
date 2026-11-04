import { describe, expect, it, vi } from 'vitest';
import { resolvePdfBrowserExecutable } from './browser-executable.js';

const missingDownload = () => { throw new Error('Could not find Chrome'); };
const windows = { platform: 'win32' as const, env: {}, bundledPath: missingDownload };

describe('PDF browser selection', () => {
  it('honors and trims the configured executable before checking other browsers', async () => {
    const bundledPath = vi.fn(missingDownload);
    expect(await resolvePdfBrowserExecutable('  D:\\Browser\\chrome.exe  ', {
      ...windows, bundledPath, exists: path => path === 'D:\\Browser\\chrome.exe',
    })).toBe('D:\\Browser\\chrome.exe');
    expect(bundledPath).not.toHaveBeenCalled();
  });

  it('reports an invalid explicit path instead of silently ignoring configuration', async () => {
    await expect(resolvePdfBrowserExecutable('missing.exe', {
      ...windows, exists: path => path !== 'missing.exe',
    })).rejects.toThrow('PUPPETEER_EXECUTABLE_PATH does not exist');
  });

  it('prefers the existing Puppeteer download over system browsers', async () => {
    expect(await resolvePdfBrowserExecutable(undefined, {
      ...windows, bundledPath: async () => 'downloaded-chrome.exe', exists: () => true,
    })).toBe('downloaded-chrome.exe');
  });

  it('uses installed Chrome when the required Puppeteer download is missing', async () => {
    const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    expect(await resolvePdfBrowserExecutable(undefined, { ...windows, exists: path => path === chrome })).toBe(chrome);
  });

  it('falls back to installed Edge when a stale cached path and Chrome are absent', async () => {
    const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    expect(await resolvePdfBrowserExecutable('', { ...windows, bundledPath: () => 'stale.exe', exists: path => path === edge })).toBe(edge);
  });

  it('supports per-user Chrome and non-default Windows installation roots', async () => {
    const chrome = 'D:\\Profiles\\User\\Google\\Chrome\\Application\\chrome.exe';
    expect(await resolvePdfBrowserExecutable(undefined, {
      ...windows, env: { LOCALAPPDATA: 'D:\\Profiles\\User' }, exists: path => path === chrome,
    })).toBe(chrome);
  });

  it('discovers Chromium on Linux and Chrome on macOS', async () => {
    const linux = '/usr/bin/chromium';
    expect(await resolvePdfBrowserExecutable(undefined, { platform: 'linux', bundledPath: missingDownload, exists: path => path === linux })).toBe(linux);
    const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    expect(await resolvePdfBrowserExecutable(undefined, { platform: 'darwin', env: {}, bundledPath: missingDownload, exists: path => path === mac })).toBe(mac);
  });

  it('explains how to configure or install a browser when none is available', async () => {
    await expect(resolvePdfBrowserExecutable(undefined, { ...windows, exists: () => false })).rejects.toThrow('bunx puppeteer browsers install chrome');
  });
});
