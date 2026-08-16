import http from "node:http";

const port = Number(process.env.PORT || 9119);
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString("utf8");
  response.setHeader("content-type", "application/json");
  if (request.url === "/health" || request.url === "/api/health") {
    response.end(JSON.stringify({ ok: true, fixture: "mybay-runtime" }));
    return;
  }
  if (["/chat", "/runs", "/webhook"].includes(request.url || "")) {
    response.end(JSON.stringify({ ok: true, path: request.url, body: body ? JSON.parse(body) : null }));
    return;
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ ok: false, error: "NOT_FOUND" }));
});

server.listen(port, "0.0.0.0");
