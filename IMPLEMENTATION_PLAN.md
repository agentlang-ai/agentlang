# Comprehensive Implementation Plan

## Vector Storage, SQLite Performance, and Production-Ready Knowledge System

---

## Executive Summary

This plan outlines the complete implementation of agent-level isolation for the knowledge graph system, performance improvements for SQLite batch operations, LanceDB integration fixes, and production-ready prompt updates. The implementation is organized into 7 phases with clear dependencies and expected outcomes.

---

## Current State Analysis

### What's Working ✅

1. **Neo4j Sync**: `syncAllContainersToNeo4j()` correctly clears Neo4j and rebuilds from SQLite on startup
2. **Container = Agent FQ Name**: Already implemented (e.g., "MyApp.Agent")
3. **Agent-Level Isolation**: `containerTag` is set to `agentFqName` in `getOrCreateSession()`
4. **Transaction Support**: `callInTransaction()` is available in batch operations

### Critical Issues Found 🔴

#### 1. LanceDB Issues

| Issue                                            | File                 | Line    | Impact                  |
| ------------------------------------------------ | -------------------- | ------- | ----------------------- |
| Only tenantId filtering, no agentId filtering    | `lancedb-store.ts`   | 105-106 | Cannot isolate by agent |
| SQL injection risk in tenant filtering           | `lancedb-store.ts`   | 106     | Security vulnerability  |
| Double storage: LanceDB + SQLite redundant       | `deduplicator.ts`    | 473-474 | Wasted storage          |
| Context builder uses full-text not vector search | `context-builder.ts` | 143-150 | Poor context quality    |

#### 2. SQLite Batch Insert Issues

| Issue                                     | File              | Line    | Impact                          |
| ----------------------------------------- | ----------------- | ------- | ------------------------------- |
| `batchCreateEntities` loops individually  | `service.ts`      | 655-681 | O(n) statements instead of O(1) |
| `batchCreateEdges` loops individually     | `service.ts`      | 714-735 | O(n) statements instead of O(1) |
| `createNewNode` called individually       | `deduplicator.ts` | 441-496 | Each entity = 1 INSERT          |
| No true bulk insert API at resolver level | `impl.ts`         | N/A     | TypeORM batch not leveraged     |

#### 3. Prompt Issues (Book/Story Assumptions)

| Issue                                            | File           | Line    | Impact                           |
| ------------------------------------------------ | -------------- | ------- | -------------------------------- |
| INVALID_ENTITY_NAMES includes "chapter", "book"  | `extractor.ts` | 254-264 | Blocks valid doc terms           |
| INVALID_PATTERNS includes chapter roman numerals | `extractor.ts` | 246-252 | Blocks valid patterns            |
| normalizeEntityType maps "character" → "Person"  | `extractor.ts` | 335-368 | Fiction-specific mapping         |
| TYPE_PRIORITY missing enterprise types           | `utils.ts`     | 4-12    | Missing: Customer, Product, etc. |

#### 4. Deduplicator LanceDB Integration

| Issue                                        | File              | Line    | Impact              |
| -------------------------------------------- | ----------------- | ------- | ------------------- |
| Stores embeddings in both LanceDB AND SQLite | `deduplicator.ts` | 472-473 | Redundant storage   |
| No LanceDB search in findSimilarNode         | `deduplicator.ts` | 272-313 | Uses full-text only |

---

## Implementation Phases

### Phase 1: Agent-Level Isolation Cleanup

**Objective**: Remove all user-level isolation remnants, ensure pure agent-level containers

#### Task 1.1: Audit and Remove userId References

- **File**: `src/runtime/knowledge/service.ts`
- **Lines**: 124, 143-144, 158-163
- **Change**: Remove `userId` from session queries where it's only used for lookup (keep for session creation)
- **Expected Outcome**: Sessions still per-user, but knowledge graph queries use only `containerTag` (agentFqName)
- **Dependencies**: None

#### Task 1.2: Update deduplicator container handling

- **File**: `src/runtime/knowledge/deduplicator.ts`
- **Lines**: 249-270, 272-313
- **Change**: Ensure all queries use `containerTag` consistently (already mostly correct)
- **Expected Outcome**: Deduplication works purely at agent level
- **Dependencies**: Task 1.1

#### Task 1.3: Update context-builder agent filtering

- **File**: `src/runtime/knowledge/context-builder.ts`
- **Lines**: 42-55, 161-199
- **Change**: Remove any user-specific filtering, ensure pure `containerTag` filtering
- **Expected Outcome**: Context retrieval is agent-isolated
- **Dependencies**: Task 1.2

---

### Phase 2: SQLite Batch Insert Performance

**Objective**: Implement true batch inserts using TypeORM's capabilities

#### Task 2.1: Create bulk insert helper in database.ts

- **File**: `src/runtime/resolvers/sqldb/database.ts`
- **New Function**: `insertRowsBulk(tableName, rows[], ctx)`
- **Implementation**: Use `repo.save(rows)` with transaction wrapping for true batch insert
- **Expected Outcome**: Single SQL INSERT statement for multiple rows
- **Dependencies**: None

#### Task 2.2: Refactor batchCreateEntities in service.ts

- **File**: `src/runtime/knowledge/service.ts`
- **Lines**: 629-690
- **Change**:

  ```typescript
  // OLD: Loops with individual parseAndEvaluateStatement
  for (const entity of entities) { await parseAndEvaluateStatement(...) }

  // NEW: Build all rows, single insertRowsBulk call
  const rows = entities.map(e => ({...}));
  await insertRowsBulk(tableName, rows, ctx);
  ```

- **Expected Outcome**: O(1) SQL statements for N entities
- **Dependencies**: Task 2.1

#### Task 2.3: Refactor batchCreateEdges in service.ts

- **File**: `src/runtime/knowledge/service.ts`
- **Lines**: 692-744
- **Change**: Same pattern as Task 2.2 - build row array, single bulk insert
- **Expected Outcome**: O(1) SQL statements for N edges
- **Dependencies**: Task 2.2

#### Task 2.4: Optimize deduplicator createNewNode

- **File**: `src/runtime/knowledge/deduplicator.ts`
- **Lines**: 441-496
- **Change**:
  - Add `createNewNodesBulk()` method for batch node creation
  - Keep `createNewNode` for single-node use cases
  - Use service's `batchCreateEntities` when processing multiple
- **Expected Outcome**: Document processing creates nodes in batches
- **Dependencies**: Task 2.3

---

### Phase 3: LanceDB Agent Filtering and Integration

**Objective**: Fix LanceDB to properly filter by agent, remove SQL injection risks

#### Task 3.1: Fix LanceDB search filter (SQL injection + agent support)

- **File**: `src/runtime/resolvers/vector/lancedb-store.ts`
- **Lines**: 93-122
- **Change**:

  ```typescript
  // OLD: SQL injection vulnerable
  query = query.where(`tenantId = '${tenantId}'`);

  // NEW: Parameterized + agent filtering
  async search(embedding, agentId?, tenantId?, limit=10) {
    let query = this.table.vectorSearch(embedding).limit(limit);
    const filters = [];
    if (agentId) filters.push(`agentId = '${agentId.replace(/'/g, "''")}'`); // Escape single quotes
    if (tenantId) filters.push(`tenantId = '${tenantId.replace(/'/g, "''")}'`);
    if (filters.length > 0) {
      query = query.where(filters.join(' AND '));
    }
  }
  ```

- **Expected Outcome**: Secure filtering with agent-level isolation
- **Dependencies**: None

#### Task 3.2: Update LanceDB schema to ensure agentId field

- **File**: `src/runtime/resolvers/vector/lancedb-store.ts`
- **Lines**: 30-44
- **Change**: Ensure `agentId` field exists in schema (already present, verify)
- **Expected Outcome**: Schema supports agent-level filtering
- **Dependencies**: Task 3.1

#### Task 3.3: Update vector store types interface

- **File**: `src/runtime/resolvers/vector/types.ts` (verify this file exists)
- **Change**: Update `search()` signature to include `agentId` parameter
- **Expected Outcome**: Type-safe agent filtering
- **Dependencies**: Task 3.2

#### Task 3.4: Update database.ts vector operations

- **File**: `src/runtime/resolvers/sqldb/database.ts`
- **Lines**: 587-637 (vectorStoreSearch)
- **Change**: Pass agentId to LanceDB store search
- **Expected Outcome**: Knowledge queries filter by agent
- **Dependencies**: Task 3.3

#### Task 3.5: Integrate LanceDB into context-builder

- **File**: `src/runtime/knowledge/context-builder.ts`
- **Lines**: 136-159 (vectorSearchNodes)
- **Change**: Use actual vector search via database.ts instead of full-text
- **Expected Outcome**: Semantic search for context building
- **Dependencies**: Task 3.4

#### Task 3.6: Update deduplicator to use LanceDB

- **File**: `src/runtime/knowledge/deduplicator.ts`
- **Lines**: 272-313 (findSimilarNode)
- **Change**: Add LanceDB vector search fallback for semantic similarity
- **Expected Outcome**: Semantic deduplication works via LanceDB
- **Dependencies**: Task 3.5

---

### Phase 4: Production-Ready Prompts

**Objective**: Remove book/story assumptions, focus on enterprise use cases

#### Task 4.1: Update INVALID_ENTITY_NAMES in extractor.ts

- **File**: `src/runtime/knowledge/extractor.ts`
- **Lines**: 254-264
- **Change**:
  ```typescript
  // REMOVE: 'chapter', 'chapters', 'volume', 'book'
  // KEEP: 'section', 'sections', 'page', 'pages', 'part' (these can be document terms)
  const INVALID_ENTITY_NAMES = new Set([
    // Removed: 'chapter', 'chapters', 'volume', 'book'
    'section', // Keep - could be legal doc section
    'sections',
    'page',
    'pages',
    'part', // Keep - could be contract part
  ]);
  ```
- **Expected Outcome**: Valid document terms not blocked
- **Dependencies**: None

#### Task 4.2: Update INVALID_ENTITY_PATTERNS

- **File**: `src/runtime/knowledge/extractor.ts`
- **Lines**: 246-252
- **Change**: Remove chapter roman numeral pattern
  ```typescript
  // REMOVE this line:
  // /^chapter\s+[ivxlcdm]+$/i, // Chapter I, Chapter IV, etc.
  ```
- **Expected Outcome**: Legal document chapters not rejected
- **Dependencies**: Task 4.1

#### Task 4.3: Update normalizeEntityType for enterprise

- **File**: `src/runtime/knowledge/extractor.ts`
- **Lines**: 335-368
- **Change**:

  ```typescript
  // REMOVE fiction-specific mappings:
  // case 'character': -> REMOVE (use default)
  // case 'animal': -> REMOVE
  // case 'creature': -> REMOVE
  // case 'setting': -> REMOVE

  // ADD enterprise mappings:
  case 'customer':
  case 'client':
    return 'Customer';
  case 'product':
  case 'service':
    return 'Product';
  case 'feature':
  case 'capability':
    return 'Feature';
  case 'contract':
  case 'agreement':
    return 'Contract';
  case 'policy':
    return 'Policy';
  case 'integration':
  case 'connector':
    return 'Integration';
  case 'vendor':
  case 'supplier':
    return 'Vendor';
  case 'team':
  case 'department':
    return 'Team';
  case 'system':
  case 'application':
  case 'platform':
    return 'System';
  ```

- **Expected Outcome**: Enterprise entity types properly normalized
- **Dependencies**: Task 4.2

#### Task 4.4: Update TYPE_PRIORITY for enterprise

- **File**: `src/runtime/knowledge/utils.ts`
- **Lines**: 4-12
- **Change**:
  ```typescript
  export const TYPE_PRIORITY: Record<string, number> = {
    Customer: 10, // Most important for business
    Contract: 9, // Legal documents
    Vendor: 9, // Business partners
    Product: 8, // What we sell
    System: 8, // Technical systems
    Integration: 8, // Connections
    Policy: 7, // Business rules
    Feature: 7, // Product capabilities
    Team: 7, // Internal organization
    Person: 6, // Individuals
    Organization: 5, // Companies
    Location: 5, // Places
    Event: 4, // Time-based
    Role: 3, // Job functions
    Concept: 1, // Abstract ideas
  };
  ```
- **Expected Outcome**: Business-critical entities prioritized
- **Dependencies**: Task 4.3

#### Task 4.5: Update prompts for enterprise focus

- **File**: `src/runtime/knowledge/prompts.ts`
- **Lines**: All
- **Changes**:
  - `ENTITY_EXTRACTION_PROMPT`: Already enterprise-focused ✓
  - `CONVERSATION_ENTITY_PROMPT`: Already enterprise-focused ✓
  - `MEGABATCH_ENTITY_PROMPT`: Already enterprise-focused ✓
  - `MEGABATCH_RELATIONSHIP_PROMPT`: Already enterprise-focused ✓
  - `FACT_EXTRACTION_PROMPT`: Already enterprise-focused ✓
  - `RELATIONSHIP_EXTRACTION_PROMPT`: Already enterprise-focused ✓
- **Expected Outcome**: Prompts already correct, verify no changes needed
- **Dependencies**: Task 4.4

---

### Phase 5: Neo4j Sync Verification

**Objective**: Verify Neo4j sync works correctly with agent-level containers

#### Task 5.1: Verify syncToNeo4j uses container correctly

- **File**: `src/runtime/knowledge/service.ts`
- **Lines**: 477-554
- **Verification**: Confirm `containerTag` is used for:
  - `clearContainer(containerTag)` line 486
  - Query filter `__tenant__` line 489
  - Edge sync filter line 526
- **Expected Outcome**: Neo4j sync is container-isolated
- **Dependencies**: Phase 1 complete

#### Task 5.2: Verify syncAllContainersToNeo4j rebuilds correctly

- **File**: `src/runtime/knowledge/service.ts`
- **Lines**: 561-595
- **Verification**: Confirm:
  - `clearAll()` called at line 566
  - Groups by `__tenant__` from all nodes line 580-583
  - Syncs each container tag line 589-591
- **Expected Outcome**: Full rebuild on startup works
- **Dependencies**: Task 5.1

#### Task 5.3: Document Neo4j sync behavior

- **File**: Add comments to `service.ts`
- **Lines**: 560-595
- **Change**: Add clear documentation that Neo4j is a derived view
- **Expected Outcome**: Clear documentation for future maintainers
- **Dependencies**: Task 5.2

---

### Phase 6: Test Updates

**Objective**: Update all tests for agent-level isolation

#### Task 6.1: Update memory.test.ts mock data

- **File**: `test/runtime/memory.test.ts`
- **Lines**: 57-82, 96-118, 134-148
- **Changes Needed**:
  - Remove any `userId` references from GraphNode mocks (already correct)
  - Verify `__tenant__` is used (not `containerTag` in mocks - both work)
  - Add enterprise entity type tests
- **Expected Outcome**: Tests pass with agent-level mocks
- **Dependencies**: Phase 4 complete

#### Task 6.2: Add batch insert performance tests

- **File**: `test/runtime/memory.test.ts` or new file
- **New Tests**:
  - Test that `batchCreateEntities` creates N entities with O(1) statements
  - Test that `batchCreateEdges` creates N edges with O(1) statements
  - Verify transaction rollback on failure
- **Expected Outcome**: Performance tests validate batch behavior
- **Dependencies**: Phase 2 complete

#### Task 6.3: Add LanceDB integration tests

- **File**: `test/runtime/memory.test.ts` or new file
- **New Tests**:
  - Test LanceDB agent filtering
  - Test vector search vs full-text
  - Test SQL injection protection
- **Expected Outcome**: LanceDB integration validated
- **Dependencies**: Phase 3 complete

#### Task 6.4: Update existing tests for enterprise types

- **File**: `test/runtime/memory.test.ts`
- **Lines**: 166-205 (Utility Functions)
- **Change**: Add tests for new TYPE_PRIORITY enterprise types
- **Expected Outcome**: Enterprise type priority tested
- **Dependencies**: Task 6.1

---

### Phase 7: Full Test Suite Verification

**Objective**: Run complete test suite, fix any regressions

#### Task 7.1: Run unit tests

- **Command**: `npm test -- test/runtime/memory.test.ts`
- **Expected Outcome**: All knowledge tests pass
- **Dependencies**: Phase 6 complete

#### Task 7.2: Run integration tests

- **Command**: `npm test`
- **Expected Outcome**: All tests pass, no regressions
- **Dependencies**: Task 7.1

#### Task 7.3: Performance validation

- **Manual Test**: Process large document (10k+ chars)
- **Expected Outcome**:
  - Document processing < 30 seconds
  - Batch inserts visible in logs
  - Memory usage stable
- **Dependencies**: Task 7.2

---

## File Change Summary

| File                 | Phase      | Lines      | Change Type                 |
| -------------------- | ---------- | ---------- | --------------------------- |
| `service.ts`         | 1, 2, 5    | 100+ lines | Refactor batch operations   |
| `deduplicator.ts`    | 1, 2, 3, 6 | 50+ lines  | Batch + LanceDB integration |
| `context-builder.ts` | 1, 3       | 30+ lines  | Vector search integration   |
| `lancedb-store.ts`   | 3          | 40+ lines  | Security + agent filtering  |
| `database.ts`        | 2, 3       | 30+ lines  | Bulk insert + vector search |
| `extractor.ts`       | 4          | 50+ lines  | Enterprise entity types     |
| `utils.ts`           | 4          | 10 lines   | TYPE_PRIORITY update        |
| `prompts.ts`         | 4          | 0 lines    | Verify (already correct)    |
| `memory.test.ts`     | 6          | 100+ lines | New tests + updates         |

---

## Critical Dependencies Chain

```
Phase 1 (Isolation)
  ↓
Phase 2 (SQLite Batch) ←── Task 2.1 (bulk insert helper)
  ↓                      ↓
Task 2.2              Task 2.3
  ↓                      ↓
Task 2.4 ←────────────────┘
  ↓
Phase 3 (LanceDB) ←── Task 3.1 (security fix)
  ↓                   ↓
Task 3.2            Task 3.3
  ↓                   ↓
Task 3.4 ←────────────┘
  ↓
Task 3.5
  ↓
Task 3.6
  ↓
Phase 4 (Prompts) ←── Can run in parallel with 3
  ↓
Phase 5 (Neo4j Verify) ←── Can run with 4
  ↓
Phase 6 (Tests) ←── Requires 2, 3, 4 complete
  ↓
Phase 7 (Verification)
```

---

## Risk Mitigation

### Risk 1: Breaking Existing Knowledge Data

- **Mitigation**: Add migration/compat layer in deduplicator
- **Test**: Verify existing nodes still found by name

### Risk 2: LanceDB Performance Regression

- **Mitigation**: Keep SQLite as primary, LanceDB as secondary
- **Test**: Benchmark before/after vector search

### Risk 3: Batch Insert Transaction Failures

- **Mitigation**: Proper error handling with individual retry fallback
- **Test**: Simulate partial batch failure

### Risk 4: Agent Filtering Edge Cases

- **Mitigation**: Comprehensive test coverage for multi-agent scenarios
- **Test**: Multiple agents, same document, different users

---

## Success Criteria

1. ✅ Agent-level isolation: All knowledge scoped to `agentFqName`
2. ✅ Batch inserts: N entities/edges in O(1) SQL statements
3. ✅ LanceDB secure: No SQL injection, proper agent filtering
4. ✅ Enterprise prompts: No book/story assumptions, proper entity types
5. ✅ Neo4j sync: Full rebuild on startup, container-isolated
6. ✅ Tests pass: All existing + new tests pass
7. ✅ Performance: Document processing < 30s for 10k chars

---

## Estimated Effort

| Phase     | Tasks        | Estimated Hours |
| --------- | ------------ | --------------- |
| Phase 1   | 3 tasks      | 2 hours         |
| Phase 2   | 4 tasks      | 4 hours         |
| Phase 3   | 6 tasks      | 6 hours         |
| Phase 4   | 5 tasks      | 3 hours         |
| Phase 5   | 3 tasks      | 2 hours         |
| Phase 6   | 4 tasks      | 4 hours         |
| Phase 7   | 3 tasks      | 2 hours         |
| **Total** | **28 tasks** | **23 hours**    |

---

## Next Steps

1. **Immediate**: Start Phase 1, Task 1.1 (isolation cleanup)
2. **Parallel**: Phase 4 (prompts) can start immediately
3. **Review**: After Phase 2, review batch insert approach
4. **Integration**: Phase 3 requires careful LanceDB testing

---

_Document Version: 1.0_
_Created: 2025-02-19_
_Status: Ready for Implementation_
