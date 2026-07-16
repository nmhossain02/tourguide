# Contributing

Use Node.js 24 LTS (22 or newer is supported), Git, and Corepack.

```bash
corepack pnpm install
corepack pnpm validate
```

Keep discovery bounded, preserve the committed-HEAD/local-change distinction, and add tests for every new runtime capability. Never add telemetry or hosted source upload to the default path. Security-sensitive changes should update `docs/threat-model.md`.

The conformance shape in `fixtures/polyglot-app` covers frontend, backend, data, containers, and inert infrastructure. Tests create isolated temporary Git repositories so they cannot modify the working checkout.
