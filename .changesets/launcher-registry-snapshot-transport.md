---
launcher: minor
---

The registry snapshot step reads each package's full registry document from the registry in the packed `package-scope.json` through Node's own `fetch`. The only headers this step sets are `accept` and `accept-encoding: identity`; Node's fetch adds its own default, non-credential headers. It sets no `Authorization` header, runs no npm CLI and reads no `.npmrc`. It asks for the body uncompressed, so when the server honours that, the 10 MiB cap and the recorded hash apply to the exact bytes received; otherwise they apply to the decoded body. It refuses redirects, stops reading a response once it passes 10 MiB (counting decoded bytes, if a server compresses anyway), and abandons a request after 30 seconds. A 404 is recorded as `not-found`; any other failure, status or non-JSON body writes no snapshot and exits `2` (#1178).
