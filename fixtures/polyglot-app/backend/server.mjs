import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";

const databasePath = process.env.DATABASE_PATH ?? "shop.db";
const port = Number(process.env.PORT ?? 8000);

createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") return response.end(JSON.stringify({ ok: true }));
  if (request.url === "/api/orders") {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    const orders = database.prepare("select id, total from orders order by id").all();
    database.close();
    return response.end(JSON.stringify({ orders, dependency: { tax: "declarative-mock" } }));
  }
  response.statusCode = 404;
  response.end(JSON.stringify({ error: "not found" }));
}).listen(port, "127.0.0.1");
