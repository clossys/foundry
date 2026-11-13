// R-ROUTES-PUBLISHED probe: a metadata route written by hand in the site template; no publication installs it.
export default function robots() {
  return { rules: [{ userAgent: "*", allow: "/" }] };
}
