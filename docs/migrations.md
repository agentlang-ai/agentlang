# Database Migrations

This guide covers how to manage database schema changes across different deployment modes,
and explains how the migration system works internally.

## Migration Workflow by Deployment Mode

### Development and Testing

In **dev** and **test** modes, schema changes are applied automatically.
TypeORM's `synchronize` flag is enabled, so any changes to entity definitions
are reflected in the database immediately when the app starts. No explicit
migration steps are needed.

```bash
# Dev mode — schema auto-syncs on startup
agentlang run app.al

# Test mode — same auto-sync behavior
NODE_ENV=test agentlang run app.al
```

### Production

In **production** mode (`NODE_ENV=production`), auto-sync is disabled.
Schema changes must go through explicit migration steps.

On startup, the runtime validates that the database schema matches the app model.
If there is a mismatch, the app refuses to start and reports the pending changes.

#### Initial schema setup

For a fresh database (e.g. first deploy to a new environment), use `initSchema`
to create all tables from scratch. This is a one-time operation.

```bash
agentlang initSchema app.al -c config.json
```

#### Step 1: Review pending migrations

When entity definitions change, review the pending schema changes before applying them:

```bash
agentlang runMigrations app.al -c config.json
```

This command:
- Computes the diff between the current entity definitions and the database schema
- Displays all pending SQL statements (numbered) so you can inspect them
- Runs a migration simulation to verify the SQL is safe
- **Does not modify the database**

Example output:
```
info: Pending migration queries:
info:   [1] ALTER TABLE "MyApp/Product" ADD "description" varchar
info:   [2] ALTER TABLE "MyApp/Product" ADD "price" double precision
info: Migration simulation passed.
info: Run `applyMigration` to apply these changes.
```

If the simulation detects problems, it reports errors and aborts.

#### Step 2: Apply the migration

After reviewing the output, apply the changes:

```bash
agentlang applyMigration app.al -c config.json
```

This command:
- Re-computes the schema diff (to capture the current state)
- Runs the simulation again as a safety check
- Saves the migration record (up and down queries) to the database
- Executes the migration SQL within a transaction

#### Undoing a migration

To roll back the last applied migration:

```bash
agentlang undoLastMigration app.al -c config.json
```

This executes the saved "down" queries to reverse the most recent migration.

#### Generating a migration without applying

To save a migration record without executing it:

```bash
agentlang generateMigration app.al -c config.json
```

This stores the up and down queries in the `agentlang/Migration` entity for
later reference or manual execution.

#### Recommended deploy sequence

```
1. Deploy new code (with updated entity definitions)
2. agentlang runMigrations app.al -c config.json    # review
3. agentlang applyMigration app.al -c config.json   # apply
4. Start the app in production mode
```

If step 4 is run before step 3, the app will refuse to start with a schema
mismatch error.

---

## How Migrations Work Internally

### Schema Diff

The migration system uses TypeORM's `SchemaBuilder` to compare the in-memory
entity definitions (derived from `.al` files) against the actual database schema.
The schema builder generates the SQL statements needed to bring the database
in sync — these are the "up" queries. It also generates the reverse statements
("down" queries) for rollback.

```
Entity definitions (.al files)
        |
        v
  TypeORM SchemaBuilder.log()
        |
        v
  upQueries[]   — SQL to apply changes
  downQueries[] — SQL to reverse changes
```

### Migration Simulation

Before any migration is applied, the system runs a simulation to verify
the SQL is safe and correct. The simulation strategy depends on the database:

#### PostgreSQL: Transaction-based simulation

For PostgreSQL, the simulation executes the migration queries inside a
real database transaction, then **rolls back**:

1. Start a transaction
2. Execute all migration queries against the actual database
3. Run `getSchemaDiff()` again to verify the schema has converged
   (i.e. no further changes are needed after applying)
4. Roll back the transaction — no permanent changes are made

This catches SQL errors, type mismatches, constraint violations, and
incomplete migrations that would leave the schema in a partially-migrated state.

#### Other databases: Dry-run validation

For databases that don't support transactional DDL rollback (e.g. SQLite),
the simulation performs a dry-run pass over the generated queries. Since the
user reviews all pending SQL in the review step (`runMigrations`), the dry-run
does not block on any particular SQL pattern — the user decides whether the
changes are safe to apply.

### Migration Storage

Migrations are stored in the database itself, in the `agentlang/Migration` entity:

| Field       | Type   | Description                          |
|-------------|--------|--------------------------------------|
| appVersion  | String | Primary key — the app version        |
| ups         | String | Forward migration SQL (joined by `;`) |
| downs       | String | Rollback SQL (joined by `;`)          |

Both `ups` and `downs` are stored as single strings with individual SQL statements
separated by `;\n\n`. Special characters are escaped for safe storage and restored
when the migration is loaded.

### Migration Execution

When a migration is applied (`applyMigration`), all SQL statements are executed
within a single database transaction. If any statement fails, the entire
transaction rolls back — no partial migrations are applied.

### Production Schema Validation

When the app starts in production mode, `validateSchemaInProd()` runs after
database initialization. It calls `getSchemaDiff()` to check for any pending
schema changes. If the database doesn't match the entity definitions, the app
throws an error and refuses to start. This ensures migrations are always applied
before the app serves traffic.

### CLI Commands Summary

| Command              | Mode               | Modifies DB? | Description                        |
|----------------------|--------------------|--------------|-------------------------------------|
| `run`                | DEV (default)      | Yes (sync)   | Run app, auto-sync schema           |
| `initSchema`         | INIT_SCHEMA        | Yes (sync)   | Create schema from scratch          |
| `runMigrations`      | RUN_MIGRATION      | No           | Review pending changes              |
| `applyMigration`     | APPLY_MIGRATION    | Yes          | Apply reviewed migration            |
| `undoLastMigration`  | UNDO_MIGRATION     | Yes          | Roll back last migration            |
| `generateMigration`  | GENERATE_MIGRATION | No (saves record) | Save migration without executing |
