# Polyglot shop fixture

A deliberately small conformance repository shape with a React client and story, an OpenAPI-described Node service, JSON-callable business logic, SQLite migrations and fixtures, a visible mocked tax dependency, Compose runtime, and inert Terraform.

Run `npm run seed`, then `npm run dev`. The service reads `PORT` and `DATABASE_PATH`, defaults to loopback port 8000 and `shop.db`, and exposes `/health` plus `/api/orders`.

The frontend story is repository-owned metadata for the component viewer. `logic/orders.mjs` is directly callable by the function adapter. The API returns a labeled mock provenance field for its tax dependency.
