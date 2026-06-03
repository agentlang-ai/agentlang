# Agentlang Error Codes

Every error Agentlang raises carries a stable `agentlangCode` (e.g. `AL_DB_UNIQUE_VIOLATION`).
HTTP responses return it in the body as `{ "code": "...", "message": "..." }`, and it is the key you
use to attach a [custom error message](../README.md#%EF%B8%8F-custom-error-messages).

```json
{ "code": "AL_DB_UNIQUE_VIOLATION", "message": "A record with this value already exists." }
```

Codes are created via `createCodedError(message, code)` (`src/runtime/errors/coded-error.ts`) or via the
typed error classes in `src/runtime/defs.ts`. Any error without an explicit code is reported as
`AL_RUNTIME_UNHANDLED`.

## Code families

| Prefix          | Area                                | Source                                       |
| --------------- | ----------------------------------- | -------------------------------------------- |
| `AL_DB_*`       | Database / persistence              | `src/runtime/resolvers/sqldb/`               |
| `AL_MOD_*`      | Schema / model / attribute checks   | `src/runtime/module.ts`                      |
| `AL_INT_*`      | Interpreter / runtime evaluation    | `src/runtime/interpreter.ts`                 |
| `AL_HTTP_*`     | HTTP layer                          | `src/api/http.ts`, `errors/http-error.ts`    |
| `AL_AUTH_*`     | Auth / JWT / session                | `src/runtime/modules/auth.ts`                |
| `AL_COGNITO_*`  | AWS Cognito identity provider       | `src/runtime/auth/cognito.ts`                |
| top-level `AL_*`| Generic HTTP / request errors       | `src/runtime/defs.ts`, `modules/ai.ts`       |

---

## HTTP status mapping

`httpStatusFromError` (`src/runtime/errors/http-error.ts`) chooses the status **first by error code**,
then by error class, otherwise `500`.

**By code:**

| Status | Codes |
| ------ | ----- |
| **409** Conflict | `AL_DB_UNIQUE_VIOLATION` |
| **400** Bad Request | `AL_DB_FOREIGN_KEY_VIOLATION`, `AL_DB_NOT_NULL_VIOLATION`, `AL_DB_CHECK_VIOLATION`, `AL_DB_INVALID_TYPE`, `AL_MOD_TYPE_MISMATCH`, `AL_MOD_INVALID_ATTR` |
| **503** Service Unavailable | `AL_DB_DEADLOCK`, `AL_DB_LOCK_WAIT_TIMEOUT`, `AL_DB_SERIALIZATION_FAILURE` |
| **500** Internal | `AL_DB_SYNTAX_ERROR`, `AL_DB_QUERY_FAILED` |

**By error class** (auth/Cognito codes inherit their status from the class they throw):

| Status | Class | Example codes |
| ------ | ----- | ------------- |
| **404** | `UserNotFoundError` | `AL_USER_NOT_FOUND`, `AL_COGNITO_USER_NOT_FOUND_EXCEPTION`, `AL_AUTH_EMAIL_NOT_REGISTERED` |
| **401** | `UnauthorisedError` | `AL_UNAUTHORIZED`, most `AL_AUTH_*`, `AL_HTTP_AUTH_REQUIRED` |
| **429** | `TooManyRequestsError` | `AL_TOO_MANY_REQUESTS`, `AL_COGNITO_TOO_MANY_REQUESTS`, `AL_COGNITO_LIMIT_EXCEEDED` |
| **400** | `BadRequestError` / `InvalidParameterError` | `AL_BAD_REQUEST`, `AL_INVALID_PARAMETER`, `AL_HTTP_CHILD_PATTERN_INVALID` |
| **400** | `ExpiredCodeError` / `CodeMismatchError` | `AL_EXPIRED_CODE`, `AL_CODE_MISMATCH`, `AL_COGNITO_EXPIRED_CODE_EX`, `AL_COGNITO_CODE_MISMATCH_EX` |
| **403** | `UserNotConfirmedError` / `PasswordResetRequiredError` | `AL_USER_NOT_CONFIRMED`, `AL_PASSWORD_RESET_REQUIRED`, `AL_COGNITO_USER_NOT_CONFIRMED_EX` |

**By message-text heuristic** (for plain coded errors, e.g. some `AL_COGNITO_*`):

- **503** if the message contains `temporarily unavailable`, `service error`, or `configuration error`.
- **500** if it contains `contact support`.
- **500** for everything else (`AL_RUNTIME_UNHANDLED`, `AL_INT_*`, most `AL_MOD_*`, `AL_DB_NOT_INITIALIZED`, `AL_AGENT_CANCELLED`, …).

---

## Generic / top-level codes

| Code | Meaning |
| ---- | ------- |
| `AL_RUNTIME_UNHANDLED` | Fallback for any error without an explicit Agentlang code. |
| `AL_BAD_REQUEST` | Malformed or invalid request. |
| `AL_UNAUTHORIZED` | User is not authorised to perform the operation. |
| `AL_USER_NOT_FOUND` | User does not exist. |
| `AL_USER_NOT_CONFIRMED` | Account not confirmed / pending email verification. |
| `AL_PASSWORD_RESET_REQUIRED` | A password reset is required for the account. |
| `AL_TOO_MANY_REQUESTS` | Rate limit exceeded; retry later. |
| `AL_INVALID_PARAMETER` | Invalid parameter(s) supplied. |
| `AL_EXPIRED_CODE` | Verification code has expired; request a new one. |
| `AL_CODE_MISMATCH` | Verification code is incorrect. |
| `AL_AGENT_CANCELLED` | AI agent execution was cancelled for the given chat. |

---

## `AL_DB_*` — Database

| Code | Meaning | HTTP |
| ---- | ------- | ---- |
| `AL_DB_UNIQUE_VIOLATION` | Unique constraint / duplicate key violation. | 409 |
| `AL_DB_FOREIGN_KEY_VIOLATION` | Foreign key constraint violation. | 400 |
| `AL_DB_NOT_NULL_VIOLATION` | A required (NOT NULL) column was missing. | 400 |
| `AL_DB_CHECK_VIOLATION` | CHECK constraint violation. | 400 |
| `AL_DB_INVALID_TYPE` | Invalid value/type for a column (bad text, datetime, numeric range — e.g. a non-UUID passed to a UUID column). | 400 |
| `AL_DB_DEADLOCK` | Transaction deadlock detected. | 503 |
| `AL_DB_SERIALIZATION_FAILURE` | Could not serialize transaction (serialization failure). | 503 |
| `AL_DB_LOCK_WAIT_TIMEOUT` | Lock wait timeout / could not obtain lock. | 503 |
| `AL_DB_SYNTAX_ERROR` | SQL syntax / parse error. | 500 |
| `AL_DB_QUERY_FAILED` | Generic query failure (fallback for unclassified DB errors). | 500 |
| `AL_DB_BETWEEN_ARRAY` | The `between` operator requires an array argument. | 500 |
| `AL_DB_NULL_OPERATOR` | Operator cannot be applied to SQL NULL. | 500 |
| `AL_DB_SELECT_INTO_MISSING` | SELECT-INTO pattern is missing. | 500 |
| `AL_DB_NOT_INITIALIZED` | Database not initialized. | 500 |
| `AL_DB_TXN_NOT_FOUND` | Transaction not found for the given id. | 500 |
| `AL_DB_NO_DATASOURCE` | No default datasource is initialized. | 500 |
| `AL_DB_SCHEMA_MISMATCH_PROD` | App model does not match DB schema in production; run migrations. | 500 |
| `AL_DB_MIGRATION_SIMULATION_FAILED` | Migration aborted because the simulation failed. | 500 |
| `AL_DB_UNSUPPORTED_TYPE` | Unsupported database type in config. | 500 |
| `AL_DB_UNSUPPORTED_TYPE_INIT` | Unsupported database type during initialization. | 500 |
| `AL_DB_INSERT_UNAUTHORIZED` | User not authorised to insert into the entity. | 500 |
| `AL_DB_BETWEEN_INSERT_UNAUTHORIZED` | User not authorised to insert the between-relationship. | 500 |

---

## `AL_MOD_*` — Schema / model

| Code | Meaning | HTTP |
| ---- | ------- | ---- |
| `AL_MOD_INVALID_ATTR` | An unknown/extra attribute was supplied for the entity. | 400 |
| `AL_MOD_TYPE_MISMATCH` | An attribute value failed type/shape validation (wrong type, array expected, invalid enum value, bad Path). | 400 |
| `AL_MOD_MODULE_NOT_FOUND` | Module not found. | 500 |
| `AL_MOD_ENTITY_NOT_FOUND` | Entity not found for the path. | 500 |
| `AL_MOD_ENTRY_NOT_FOUND` | Entry not found in the module. | 500 |
| `AL_MOD_NOT_A_RECORD` | The named item is not a record. | 500 |
| `AL_MOD_EVENT_NOT_FOUND` | Event not found in the module. | 500 |
| `AL_MOD_RECORD_NOT_FOUND` | Record not found in the module. | 500 |
| `AL_MOD_RELATIONSHIP_NOT_FOUND` | Relationship not found in the module. | 500 |

---

## `AL_INT_*` — Interpreter / runtime

| Code | Meaning |
| ---- | ------- |
| `AL_INT_USER_THROW` | An error raised by a user `throw` statement. |
| `AL_INT_NOT_AN_EVENT` | The value is not an event. |
| `AL_INT_NOT_EVENT_INSTANCE` | The value is not an event instance. |
| `AL_INT_INVALID_ENUM` | Invalid enum value for an attribute. |
| `AL_INT_ONEOF_REF_FETCH` | Failed to fetch the one-of reference for an attribute. |
| `AL_INT_QUERY_ATTR_FORBIDDEN` | A query attribute cannot be specified in this position. |
| `AL_INT_RELATIONSHIP_QUERY_EXPECTED` | Expected a query for a relationship. |
| `AL_INT_INTO_MUST_BE_QUERY` | A pattern with an `into` clause must be a query. |
| `AL_INT_INTO_WITH_ATTRS` | A query with `into` cannot also update attributes. |
| `AL_INT_CRUD_INIT_MAP_EXPECTED` | CRUD init expected a map after `@from`. |
| `AL_INT_CRUD_NO_SOURCE_MAP` | CRUD pattern does not specify a source map. |
| `AL_INT_FTS_FQN_REQUIRED` | Full-text search requires a fully-qualified name. |
| `AL_INT_FTS_QUERY_STRING` | Full-text-search query must be a string. |
| `AL_INT_DEDUCE_ENTRY_NAME` | Failed to deduce the entry name from the path. |
| `AL_INT_BAD_BINARY_OP` | Unrecognized binary operator. |
| `AL_INT_TXN_START_FAILED` | Failed to start a transaction for the entity. |
| `AL_INT_NO_HANDLERS_TO_POP` | No more handlers to pop (internal control-flow error). |
| `AL_INT_SUSPENSION_ID_NOT_SET` | SuspensionId is not set. |
| `AL_INT_SUSPENSION_CODE_EXTRACT` | Failed to extract the code for a suspension statement. |
| `AL_INT_DOC_FETCH_NODE_ONLY` | Document fetching is only available in Node.js. |
| `AL_INT_AGENT_NO_RESPONSE` | The AI agent failed to generate a response. |
| `AL_INT_AGENT_INTERNAL` | AI agent internal error (e.g. failed to validate the JSON response). |
| `AL_INT_FLOW_MAX_STEPS` | Flow execution exceeded the maximum step limit. |
| `AL_INT_FLOW_FATAL` | Fatal flow execution error. |
| `AL_INT_PREPOST_EVENT_FAILED` | A pre/post-event handler failed. |

---

## `AL_HTTP_*` — HTTP layer

| Code | Meaning | HTTP |
| ---- | ------- | ---- |
| `AL_HTTP_AUTH_REQUIRED` | Authorization is required for the entity route. | 401 |
| `AL_HTTP_CHILD_PATTERN_INVALID` | Invalid child pattern in the request path. | 400 |
| `AL_HTTP_HANDLER_EXCEPTION` | Reserved/documented Tier-1 HTTP handler-exception code (declared in the registry, not thrown directly). | — |

---

## `AL_AUTH_*` — Auth / JWT / session

| Code | Meaning |
| ---- | ------- |
| `AL_AUTH_NOT_INITIALIZED` | Auth subsystem is not initialized. |
| `AL_AUTH_EMAIL_NOT_REGISTERED` | Email is not registered with the identity provider. |
| `AL_AUTH_JWT_STRUCTURE_INVALID` | Invalid JWT token structure. |
| `AL_AUTH_JWT_MISSING_USER_ID` | JWT is missing a user identifier. |
| `AL_AUTH_JWT_USER_NOT_IN_DB` | JWT is valid but the user is not in the local database. |
| `AL_AUTH_JWT_VERIFY_WRAPPER` | Generic JWT verification failure. |
| `AL_AUTH_USER_NOT_ACTIVE_JWT` | User account is not active (JWT path). |
| `AL_AUTH_NO_SESSION_JWT` | No session found for the user (JWT path). |
| `AL_AUTH_USER_NOT_ACTIVE_SESSION` | User account is not active (session-token path). |
| `AL_AUTH_NO_ACTIVE_SESSION_TOKEN` | No active session for the user (session-token path). |
| `AL_AUTH_NO_ACTIVE_SESSION_CHANGE_PW` | No active session during a change-password request. |
| `AL_AUTH_SESSION_VERIFY_WRAPPER` | Generic session verification failure. |

---

## `AL_COGNITO_*` — AWS Cognito

These mirror AWS Cognito SDK exceptions and are surfaced when Cognito is the configured auth provider.
The HTTP status comes from the error class or message heuristic (see the mapping above) — most are 400/401/403/429,
service/config issues are 503.

**Authentication & credentials**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_AUTH_FAILED` | Generic authentication failure (NotAuthorized). |
| `AL_COGNITO_INVALID_PASSWORD` | Invalid password (NotAuthorized). |
| `AL_COGNITO_NOT_CONFIRMED_MSG` | Account not confirmed (NotAuthorized message). |
| `AL_COGNITO_USER_NOT_CONFIRMED_EX` | UserNotConfirmedException. |
| `AL_COGNITO_PASSWORD_RESET_REQUIRED_EX` | PasswordResetRequiredException. |
| `AL_COGNITO_TOO_MANY_REQUESTS` | TooManyRequestsException (rate limit). |
| `AL_COGNITO_TOO_MANY_FAILED_ATTEMPTS` | Too many failed login attempts. |
| `AL_COGNITO_LIMIT_EXCEEDED` | LimitExceededException. |
| `AL_COGNITO_INVALID_PARAMETER_EX` | InvalidParameterException. |
| `AL_COGNITO_EXPIRED_CODE_EX` | ExpiredCodeException (verification code expired). |
| `AL_COGNITO_CODE_MISMATCH_EX` | CodeMismatchException (verification code incorrect). |
| `AL_COGNITO_UNSUPPORTED_USER_STATE` | UnsupportedUserStateException. |

**Sign-up / accounts**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_USER_NOT_FOUND_EXCEPTION` | UserNotFoundException. |
| `AL_COGNITO_USERNAME_EXISTS` | UsernameExistsException (account already exists). |
| `AL_COGNITO_ALIAS_EXISTS` | AliasExistsException (email already in use). |
| `AL_COGNITO_INVALID_PASSWORD_FORMAT` | InvalidPasswordException (complexity requirements not met). |
| `AL_COGNITO_SIGNUP_HTTP_STATUS` | Sign-up failed with a non-success HTTP status. |
| `AL_COGNITO_USER_LAMBDA_VALIDATION` | UserLambdaValidationException. |
| `AL_COGNITO_USER_IMPORT_IN_PROGRESS` | UserImportInProgressException. |
| `AL_COGNITO_USER_NOT_FOUND_LOCAL_ID` | User (by id) not found in the local database. |
| `AL_COGNITO_USER_NOT_FOUND_LOCAL_EMAIL` | User (by email) not found in the local database. |

**MFA & challenges**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_MFA_REQUIRED` | MFA authentication required (SDK path). |
| `AL_COGNITO_MFA_REQUIRED_LOCAL` | MFA authentication required (local path). |
| `AL_COGNITO_MFA_NOT_FOUND` | MFAMethodNotFoundException. |
| `AL_COGNITO_ENABLE_SOFTWARE_TOKEN_MFA` | Software-token MFA setup required. |
| `AL_COGNITO_NEW_PASSWORD_REQUIRED_CHALLENGE` | New-password-required challenge (SDK path). |
| `AL_COGNITO_NEW_PASSWORD_REQUIRED_CHALLENGE_LOCAL` | New-password-required challenge (local path). |
| `AL_COGNITO_UNEXPECTED_CHALLENGE` | Unexpected Cognito challenge during auth. |
| `AL_COGNITO_LOGIN_NO_RESULT_SDK` | Login returned no result (SDK path). |
| `AL_COGNITO_LOGIN_NO_RESULT_LOCAL` | Login returned no result (local path). |

**Tokens**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_TOKEN_EXPIRED` | Token has expired. |
| `AL_COGNITO_TOKEN_INVALID` | Invalid token format. |
| `AL_COGNITO_TOKEN_NOT_YET_VALID` | Token is not yet valid (`nbf`). |
| `AL_COGNITO_TOKEN_AUDIENCE` | Token audience mismatch. |
| `AL_COGNITO_TOKEN_VERIFY_FAILED` | Generic token verification failure. |
| `AL_COGNITO_TOKEN_REFRESH_NO_RESULT` | Token refresh returned no AuthenticationResult. |
| `AL_COGNITO_REFRESH_NOT_AUTHORIZED` | Invalid or expired refresh token. |
| `AL_COGNITO_TOKEN_EXCHANGE_FAILED` | OAuth token exchange failed. |
| `AL_COGNITO_MISSING_TOKENS` | Missing required tokens in the response. |
| `AL_COGNITO_INVALID_JWT_PAYLOAD` | Invalid JWT payload. |
| `AL_COGNITO_EMAIL_MISSING_IN_ID` | Email not found in the ID-token attributes. |

**Invitations / OAuth**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_INVITE_HTTP_STATUS` | User invitation failed with a non-success HTTP status. |
| `AL_COGNITO_RESEND_USER_NOT_FOUND` | Resend invite: user not found. |
| `AL_COGNITO_RESEND_INVITE_HTTP_STATUS` | Resend invitation failed with a non-success HTTP status. |
| `AL_COGNITO_INVALID_OAUTH_FLOW` | InvalidOAuthFlowException. |
| `AL_COGNITO_SCOPE_MISSING` | ScopeDoesNotExistException (invalid scope). |
| `AL_COGNITO_CALLBACK_NODE_ONLY` | Callback auth is only supported in Node.js. |

**Service / configuration (typically 503)**

| Code | Meaning |
| ---- | ------- |
| `AL_COGNITO_INTERNAL_ERROR_EX` | InternalErrorException (service temporarily unavailable). |
| `AL_COGNITO_RESOURCE_NOT_FOUND_EX` | ResourceNotFoundException (configuration error). |
| `AL_COGNITO_CONFIG_KEY_MISSING` | A required Cognito config key is not set. |
| `AL_COGNITO_USER_POOL_NOT_INIT` | UserPool is not initialized. |
| `AL_COGNITO_INVALID_USER_POOL_CONFIG` | InvalidUserPoolConfigurationException. |
| `AL_COGNITO_USER_POOL_TAGGING` | UserPoolTaggingException. |
| `AL_COGNITO_INVALID_EMAIL_ROLE_POLICY` | InvalidEmailRoleAccessPolicyException. |
| `AL_COGNITO_INVALID_SMS_ROLE_POLICY` | InvalidSmsRoleAccessPolicyException. |
| `AL_COGNITO_INVALID_SMS_TRUST` | InvalidSmsRoleTrustRelationshipException. |
| `AL_COGNITO_INVALID_LAMBDA_RESPONSE` | InvalidLambdaResponseException. |
| `AL_COGNITO_UNEXPECTED_LAMBDA` | UnexpectedLambdaException. |
| `AL_COGNITO_CODE_DELIVERY_FAILURE` | CodeDeliveryFailureException (could not deliver code). |
| `AL_COGNITO_DUPLICATE_PROVIDER` | DuplicateProviderException. |
| `AL_COGNITO_GROUP_EXISTS` | GroupExistsException. |
| `AL_COGNITO_FORBIDDEN` | ForbiddenException. |
| `AL_COGNITO_PRECONDITION_NOT_MET` | PreconditionNotMetException. |
| `AL_COGNITO_UNHANDLED` | Unclassified Cognito error (sanitized message). |

---

> **Tip:** Any of these codes can be given a friendlier, app-specific message — globally or per entity —
> via the `agentlang/errorMessage` system entity. See
> [Custom Error Messages](../README.md#%EF%B8%8F-custom-error-messages).
