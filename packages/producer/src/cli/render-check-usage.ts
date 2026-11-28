/** The `clossys check --render` lines of `clossys check --help` (cli/args.ts USAGE) and of its own usage errors. */
export const RENDER_CHECK_USAGE = "Render: clossys check --render [--routes <file>] [--json] [--file] [--out <dir>] [--browser <path>] [--root <dir>]\n"
  + "  (Reviewer's rendered-output audit: captures each route of a built site in Chromium at 1280x800 and 375x812, saves each\n"
  + "  measured capture as HTML under --out (default clossys/.state/render/<stamp>/), and audits empty icons, glyphs that do not\n"
  + "  render as text, overflow past the viewport or out of a box, accessible names, Writer copy keys (data-copy) and data-slot\n"
  + "  attribution; every finding names its owning slot (nearest data-slot=\"<agent>/<slot>\") and agent. --routes names a\n"
  + "  clossys.render-routes/1 file (site: a built folder, origin: a loopback server, or preview: the file clossys preview writes\n"
  + "  beside its build); without it, the newest preview build's routes. Fails closed: no routes, zero captures, no browser\n"
  + "  or no build is RENDER: FAIL with its reason, never PASS. --file files one request per owning slot: kind fix --check\n"
  + "  check.render to a placed slot's agent, else kind report --about agent/<agent>. Gates no merge. Exit 0 PASS, 1 FAIL, 2 usage)";
