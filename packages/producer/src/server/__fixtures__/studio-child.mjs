import { createServer } from "node:http";

const server = createServer((request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify({
    studio: true, path: request.url, method: request.method,
    headers: request.headers, origin: process.env.CLOSSYS_PRODUCER_ORIGIN,
  }));
});
server.listen(Number(process.env.PORT), process.env.HOSTNAME);
process.once("SIGTERM", () => server.close(() => process.exit(0)));
