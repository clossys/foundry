import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export async function serve({ port = 0, directory = new URL("dist/", import.meta.url) } = {}) {
  const { routes, redirects } = JSON.parse(await readFile(new URL("routes.json", directory), "utf8"));
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, "http://localhost").pathname;
      const redirect = redirects.find(entry => entry.source === path);
      if (redirect) {
        response.writeHead(redirect.permanent ? 308 : 307, { location: redirect.destination });
        response.end();
        return;
      }
      const route = routes.find(entry => entry.path === path);
      const body = await readFile(new URL(route?.file ?? "not-found.html", directory));
      response.writeHead(route?.status ?? 404, { "content-type": route?.type ?? "text/html; charset=utf-8" });
      response.end(request.method === "HEAD" ? undefined : body);
    } catch {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("Unable to serve reference page.");
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", resolve); });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await serve({ port: Number(process.env.PORT ?? 4300) });
  console.log(`Marketing reference: http://127.0.0.1:${server.address().port}`);
}
