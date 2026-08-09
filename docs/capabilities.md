# Capability matrix

| Surface | Catalog | Live lab | Current limits |
|---|---:|---:|---|
| Repository files and Markdown | Yes | Read-only source viewer | Binary, generated, secret-named, and oversized paths record exclusion reasons |
| TypeScript and JavaScript exports | Yes | Built-in JavaScript or validated generated compute provider | Complex process, native, or secret-backed dependencies may remain blocked |
| React components | Yes | Storybook or validated generated loopback preview provider | Generated providers must pass a representative render probe |
| REST and OpenAPI | Yes | Repository service or validated generated request provider | Authentication requiring secrets remains blocked |
| SQL and application data | Yes | SQLite built-in or validated generated data provider | Containers and external databases require explicit trusted capabilities |
| SQL migrations and fixtures | Yes | Repository schema initializes an isolated lab database | Complex vendor-specific SQL may require a repository-owned setup recipe |
| Python and Go files | File-level | Repository commands only | Symbol extraction is a later Tree-sitter or SCIP adapter |
| Compose and containers | File-level | Trusted mode only | Not a default prerequisite |
| Repository mocks and fixtures | Path detection plus inferred contracts | Visible repository, declarative, or generated provenance | Generated mocks must remain inside the validated provider boundary |
| Lab continuity | Module navigation and browser reload | Server process lifetime | Reopen the module to reconnect after a reload; a server restart ends every unretained lab |

Catalog extraction is deterministic and does not spend Codex quota. Unresolved documentation is batched into one focused call. Missing runtime profiles are batched into one synthesis call and accepted only after a real probe. Warm commits normally require neither call. Tour generation remains one planning turn plus resumed module turns with at most one repair per module.
