import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const database = new DatabaseSync(process.env.DATABASE_PATH ?? "shop.db");
database.exec(readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8"));
database.exec("insert or replace into orders (id, total) values (1, 25), (2, 40)");
database.close();
