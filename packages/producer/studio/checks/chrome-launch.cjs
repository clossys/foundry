'use strict';

/**
 * The one browser launch every Playwright check uses: the Chrome already installed on this machine,
 * never a downloaded Playwright browser. First Playwright's `chrome` channel, then the executable named
 * by CLOSSYS_CHROME. When neither launches, it throws a NoBrowserError (exit 2, "BLOCKED no browser"):
 * a check that cannot open a browser never reports a pass.
 */
const BLOCKED_NO_BROWSER = 2;

class NoBrowserError extends Error {
  constructor(errors, attempts) {
    super(`BLOCKED no browser: ${attempts.join('; ')}`);
    this.name = 'NoBrowserError';
    this.code = 'BLOCKED_NO_BROWSER';
    this.exitCode = BLOCKED_NO_BROWSER;
    this.errors = errors;
  }
}

const firstLine = error => String(error instanceof Error ? error.message : error).split('\n')[0];

/** Launch the machine's Chrome with the caller's options; any caller `executablePath` or `channel` is ignored. */
async function launchChrome(options = {}, { playwright, env = process.env } = {}) {
  const { chromium } = playwright ?? require('playwright');
  const { executablePath: _path, channel: _channel, ...rest } = options;
  const base = { headless: true, ...rest };
  const errors = [], attempts = [];
  try { return await chromium.launch({ ...base, channel: 'chrome' }); }
  catch (error) { errors.push(error); attempts.push(`channel chrome: ${firstLine(error)}`); }
  if (env.CLOSSYS_CHROME) {
    try { return await chromium.launch({ ...base, executablePath: env.CLOSSYS_CHROME }); }
    catch (error) { errors.push(error); attempts.push(`CLOSSYS_CHROME ${env.CLOSSYS_CHROME}: ${firstLine(error)}`); }
  } else attempts.push('CLOSSYS_CHROME unset');
  throw new NoBrowserError(errors, attempts);
}

/** Exit code for a check's top-level failure: 2 when no browser could launch, else 1. */
const failureExitCode = error => (error?.code === 'BLOCKED_NO_BROWSER' ? BLOCKED_NO_BROWSER : 1);

module.exports = { BLOCKED_NO_BROWSER, NoBrowserError, launchChrome, failureExitCode };
