import { Result, Environment, makeEventEvaluator } from '../interpreter.js';
import { logger } from '../logger.js';
import { Instance, makeInstance, newInstanceAttributes, RbacPermissionFlag } from '../module.js';
import { makeCoreModuleName } from '../util.js';
import { isSqlTrue } from '../resolvers/sqldb/dbutil.js';
import { AgentlangAuth, SessionInfo, UserInfo } from '../auth/interface.js';
import {
  ActiveSessionInfo,
  AdminUserId,
  BypassSession,
  isAuthEnabled,
  isRbacEnabled,
} from '../auth/defs.js';
import { isNodeEnv } from '../../utils/runtime.js';
import { CognitoAuth, getHttpStatusForError } from '../auth/cognito.js';
import {
  UnauthorisedError,
  UserNotFoundError,
  UserNotConfirmedError,
  PasswordResetRequiredError,
  TooManyRequestsError,
  InvalidParameterError,
  ExpiredCodeError,
  CodeMismatchError,
  BadRequestError,
} from '../defs.js';

export const CoreAuthModuleName = makeCoreModuleName('auth');

export default `module ${CoreAuthModuleName}

import "./modules/auth.js" @as Auth

entity User {
    id UUID @id @default(uuid()),
    email Email @unique @indexed,
    firstName String,
    lastName String,
    @rbac [(allow: [read, delete, update, create], where: auth.user = this.id)],
    @after {delete AfterDeleteUser}
}

workflow AfterDeleteUser {
  {RemoveUserSession {id AfterDeleteUser.User.id}}
}

workflow CreateUser {
  {User {id CreateUser.id,
         email CreateUser.email,
         firstName CreateUser.firstName,
         lastName CreateUser.lastName}}
}

workflow FindUser {
  {User {id? FindUser.id}} @as [user];
  user
}

workflow FindUserByEmail {
  {User {email? FindUserByEmail.email}} @as [user];
  user
}

entity Role {
    name String @id
}

relationship UserRole between (User, Role)

entity Permission {
    id String @id,
    resourceFqName String @indexed,
    c Boolean,
    r Boolean,
    u Boolean,
    d Boolean
}

relationship RolePermission between(Role, Permission)

workflow CreateRole {
    {Role {name CreateRole.name}, @upsert}
}

workflow FindRole {
    {Role {name? FindRole.name}} @as [role];
    role
}

workflow AssignUserToRole {
    {User {id? AssignUserToRole.userId}} @as [user];
    {Role {name? AssignUserToRole.roleName}} @as [role];
    {UserRole {User user, Role role}, @upsert}
}

workflow AssignUserToRoleByEmail {
    {User {email? AssignUserToRoleByEmail.email}} @as [user];
    {Role {name? AssignUserToRoleByEmail.roleName}} @as [role];
    {UserRole {User user, Role role}, @upsert}
}

workflow FindUserRoles {
  {User {id? FindUserRoles.userId},
   UserRole {Role? {}}}
}

workflow CreatePermission {
     {Permission {id CreatePermission.id,
                  resourceFqName CreatePermission.resourceFqName,
                  c CreatePermission.c,
                  r CreatePermission.r,
                  u CreatePermission.u,
                  d CreatePermission.d},
      RolePermission {Role {name? CreatePermission.roleName}},
      @upsert}
}

workflow AddPermissionToRole {
    {Role {name? AddPermissionToRole.roleName}} @as role;
    {Permission {id? AddPermissionToRole.permissionId}} @as perm;
    {RolePermission {Role role, Permission perm}, @upsert}
}

workflow FindRolePermissions {
    {Role {name? FindRolePermissions.role},
     RolePermission {Permission? {}}}
}

entity Session {
  id UUID @id,
  userId UUID @indexed,
  authToken String @optional,
  accessToken String @optional,
  refreshToken String @optional,
  isActive Boolean,
  @rbac [(allow: [read, delete, update, create], where: auth.user = this.userId)]
}


workflow CreateSession {
  {Session {id CreateSession.id, userId CreateSession.userId,
            authToken CreateSession.authToken,
            accessToken CreateSession.accessToken,
            refreshToken CreateSession.refreshToken,
            isActive true}}
}

workflow UpdateSession {
  {Session {id? UpdateSession.id,
            authToken UpdateSession.authToken,
            accessToken UpdateSession.accessToken,
            refreshToken UpdateSession.refreshToken,
            isActive true}, @upsert}
}

workflow FindSession {
  {Session {id? FindSession.id}} @as [session];
  session
}

workflow FindUserSession {
  {Session {userId? FindUserSession.userId}} @as [session];
  session
}

workflow RemoveSession {
  purge {Session {id? RemoveSession.id}}
}

workflow RemoveUserSession {
  {Session {userId? RemoveUserSession.id}} @as [session];
  purge {Session {id? session.id}}
}

workflow signup {
  await Auth.signUpUser(signup.email, signup.password, signup.userData)
}

workflow login {
  await Auth.loginUser(login.email, login.password)
}

workflow logout {
  await Auth.logoutUser()
}

workflow changePassword {
  await Auth.changePassword(changePassword.newPassword, changePassword.password)
}

workflow refreshToken {
  await Auth.refreshUserToken(refreshToken.refreshToken)
}

workflow getUser {
  await Auth.getUserInfo(getUser.userId)
}

workflow getUserByEmail {
  await Auth.getUserInfoByEmail(getUserByEmail.email)
}
`;

const evalEvent = makeEventEvaluator(CoreAuthModuleName);

export async function createUser(
  id: string,
  email: string,
  firstName: string,
  lastName: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'CreateUser',
    {
      id: id,
      email: email,
      firstName: firstName,
      lastName: lastName,
    },
    env
  );
}

export async function findUser(id: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'FindUser',
    {
      id: id,
    },
    env
  );
}

export async function findUserByEmail(email: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'FindUserByEmail',
    {
      email: email,
    },
    env
  );
}

export async function ensureUser(
  email: string,
  firstName: string,
  lastName: string,
  env: Environment
) {
  const user = await findUserByEmail(email, env);
  if (user) {
    return user;
  }
  return await createUser(crypto.randomUUID(), email, firstName, lastName, env);
}

export async function ensureUserRoles(userid: string, userRoles: string[], env: Environment) {
  for (let i = 0; i < userRoles.length; ++i) {
    const role = userRoles[i];
    await createRole(role, env);
    await assignUserToRole(userid, role, env);
  }
}

export async function ensureUserSession(
  userId: string,
  token: string,
  accessToken: string,
  refreshToken: string,
  env: Environment
): Promise<Instance> {
  const sess: Instance = await findUserSession(userId, env);
  if (sess) {
    // Update existing session instead of deleting and recreating
    await updateSession(sess.lookup('id'), token, accessToken, refreshToken, env);
    // Return the updated session by finding it again
    return await findUserSession(userId, env);
  }
  const sessionId = crypto.randomUUID();
  await createSession(sessionId, userId, token, accessToken, refreshToken, env);
  // Return the created session by finding it
  return await findSession(sessionId, env);
}

export async function createSession(
  id: string,
  userId: string,
  token: string,
  accessToken: string,
  refreshToken: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'CreateSession',
    {
      id: id,
      userId: userId,
      authToken: token,
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    env
  );
}

export async function findSession(id: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'FindSession',
    {
      id: id,
    },
    env
  );
}

export async function findUserSession(userId: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'FindUserSession',
    {
      userId: userId,
    },
    env
  );
}

export async function updateSession(
  id: string,
  token: string,
  accessToken: string,
  refreshToken: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'UpdateSession',
    {
      id: id,
      authToken: token,
      accessToken: accessToken,
      refreshToken: refreshToken,
    },
    env
  );
}

export async function removeSession(id: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'RemoveSession',
    {
      id: id,
    },
    env
  );
}

export async function findRole(name: string, env: Environment): Promise<Result> {
  return await evalEvent('FindRole', { name: name }, env);
}

export async function createRole(name: string, env: Environment) {
  await evalEvent('CreateRole', { name: name }, env).catch((reason: any) => {
    logger.error(`Failed to create role '${name}' - ${reason}`);
  });
}

export async function createPermission(
  id: string,
  roleName: string,
  resourceFqName: string,
  c: boolean = false,
  r: boolean = false,
  u: boolean = false,
  d: boolean = false,
  env: Environment
) {
  await evalEvent(
    'CreatePermission',
    {
      id: id,
      roleName: roleName,
      resourceFqName: resourceFqName,
      c: c,
      r: r,
      u: u,
      d: d,
    },
    env
  ).catch((reason: any) => {
    logger.error(`Failed to create permission ${id} - ${reason}`);
  });
}

export async function assignUserToRole(
  userId: string,
  roleName: string,
  env: Environment
): Promise<boolean> {
  let r: boolean = true;
  await evalEvent('AssignUserToRole', { userId: userId, roleName: roleName }, env).catch(
    (reason: any) => {
      logger.error(`Failed to assign user ${userId} to role ${roleName} - ${reason}`);
      r = false;
    }
  );
  return r;
}

export async function assignUserToRoleByEmail(
  email: string,
  roleName: string,
  env: Environment
): Promise<boolean> {
  let r: boolean = true;
  await evalEvent('AssignUserToRoleByEmail', { email: email, roleName: roleName }, env).catch(
    (reason: any) => {
      logger.error(`Failed to assign user ${email} to role ${roleName} - ${reason}`);
      r = false;
    }
  );
  return r;
}

let DefaultRoleInstance: Instance | undefined;

export async function findUserRoles(userId: string, env: Environment): Promise<Result> {
  const result: any = await evalEvent('FindUserRoles', { userId: userId }, env);
  const inst: Instance | undefined = result ? (result[0] as Instance) : undefined;
  if (inst) {
    let roles: Instance[] | undefined = inst.getRelatedInstances('UserRole');
    if (roles == undefined) {
      roles = [];
    }
    if (DefaultRoleInstance == undefined) {
      DefaultRoleInstance = makeInstance(
        CoreAuthModuleName,
        'Role',
        newInstanceAttributes().set('name', '*')
      );
    }
    roles.push(DefaultRoleInstance);
    return roles;
  }
  return undefined;
}

type RbacPermission = {
  resourceFqName: string;
  c: boolean;
  r: boolean;
  u: boolean;
  d: boolean;
};

const UserRoleCache: Map<string, string[]> = new Map();
const RolePermissionsCache: Map<string, RbacPermission[]> = new Map();

async function findRolePermissions(role: string, env: Environment): Promise<Result> {
  return await evalEvent('FindRolePermissions', { role: role }, env);
}

async function updatePermissionCacheForRole(role: string, env: Environment) {
  const result: any = await findRolePermissions(role, env);
  if (result instanceof Array && result.length > 0) {
    const roleInst: Instance = result[0] as Instance;
    const permInsts: Instance[] | undefined = roleInst.getRelatedInstances('RolePermission');
    if (permInsts) {
      RolePermissionsCache.set(
        role,
        permInsts.map((inst: Instance) => {
          return inst.cast<RbacPermission>();
        })
      );
    }
  }
}

export async function userHasPermissions(
  userId: string,
  resourceFqName: string,
  perms: Set<RbacPermissionFlag>,
  env: Environment
): Promise<boolean> {
  if (userId == AdminUserId || !isRbacEnabled()) {
    return true;
  }
  let userRoles: string[] | undefined = UserRoleCache.get(userId);
  if (userRoles == undefined) {
    const roles: any = await findUserRoles(userId, env);
    userRoles = [];
    if (roles) {
      for (let i = 0; i < roles.length; ++i) {
        const r: Instance = roles[i] as Instance;
        const n: string = r.attributes.get('name');
        userRoles.push(n);
        if (!RolePermissionsCache.get(n)) {
          await updatePermissionCacheForRole(n, env);
        }
      }
    }
    UserRoleCache.set(userId, userRoles);
  }
  if (
    userRoles.find((role: string) => {
      return role === 'admin';
    })
  ) {
    return true;
  }
  const [c, r, u, d] = [
    perms.has(RbacPermissionFlag.CREATE),
    perms.has(RbacPermissionFlag.READ),
    perms.has(RbacPermissionFlag.UPDATE),
    perms.has(RbacPermissionFlag.DELETE),
  ];
  for (let i = 0; i < userRoles.length; ++i) {
    const permInsts: RbacPermission[] | undefined = RolePermissionsCache.get(userRoles[i]);
    if (permInsts) {
      if (
        permInsts.find((p: RbacPermission) => {
          return (
            p.resourceFqName == resourceFqName &&
            (c ? isSqlTrue(p.c) : true) &&
            (r ? isSqlTrue(p.r) : true) &&
            (u ? isSqlTrue(p.u) : true) &&
            (d ? isSqlTrue(p.d) : true)
          );
        })
      )
        return true;
    }
  }
  return false;
}

const CreateOperation = new Set([RbacPermissionFlag.CREATE]);
const ReadOperation = new Set([RbacPermissionFlag.READ]);
const UpdateOperation = new Set([RbacPermissionFlag.UPDATE]);
const DeleteOperation = new Set([RbacPermissionFlag.DELETE]);

type PermCheckForUser = (
  userId: string,
  resourceFqName: string,
  env: Environment
) => Promise<boolean>;

function canUserPerfom(opr: Set<RbacPermissionFlag>): PermCheckForUser {
  // TODO: check parent hierarchy
  // TODO: cache permissions for user
  async function f(userId: string, resourceFqName: string, env: Environment): Promise<boolean> {
    if (userId == AdminUserId) {
      return true;
    }
    return await userHasPermissions(userId, resourceFqName, opr, env);
  }
  return f;
}

export const canUserCreate = canUserPerfom(CreateOperation);
export const canUserRead = canUserPerfom(ReadOperation);
export const canUserUpdate = canUserPerfom(UpdateOperation);
export const canUserDelete = canUserPerfom(DeleteOperation);

let runtimeAuth: AgentlangAuth | undefined;

if (isNodeEnv) {
  runtimeAuth = new CognitoAuth();
}

function fetchAuthImpl(): AgentlangAuth {
  if (runtimeAuth) {
    return runtimeAuth;
  } else {
    throw new Error('Auth not initialized');
  }
}
export async function signUpUser(
  username: string,
  password: string,
  userData: object,
  env: Environment
): Promise<UserInfo> {
  let result: any;
  try {
    await fetchAuthImpl().signUp(
      username,
      password,
      userData ? new Map(Object.entries(userData)) : undefined,
      env,
      (userInfo: UserInfo) => {
        result = userInfo;
      }
    );
    return result as UserInfo;
  } catch (err: any) {
    logger.error(`Signup failed for ${username}: ${err.message}`);
    throw err; // Re-throw to preserve error type for HTTP status mapping
  }
}

export async function loginUser(
  username: string,
  password: string,
  env: Environment
): Promise<string | object> {
  let result: string | object = '';
  try {
    await fetchAuthImpl().login(username, password, env, (r: SessionInfo) => {
      // Check if Cognito is configured by checking if we have the tokens
      if (r.idToken && r.accessToken && r.refreshToken) {
        // Return full token response for Cognito
        result = {
          id_token: r.idToken,
          access_token: r.accessToken,
          refresh_token: r.refreshToken,
          token_type: 'Bearer',
          expires_in: 3600,
          userId: r.userId,
          sessionId: r.sessionId,
        };
      } else {
        // Return string format for non-Cognito authentication
        result = `${r.userId}/${r.sessionId}`;
      }
    });
    return result;
  } catch (err: any) {
    logger.error(`Login failed for ${username}: ${err.message}`);
    throw err; // Re-throw to preserve error type for HTTP status mapping
  }
}

async function logoutSession(userId: string, sess: Instance, env: Environment): Promise<string> {
  const sessId = sess.lookup('id');
  const tok = sess.lookup('authToken');
  await fetchAuthImpl().logout(
    {
      sessionId: sessId,
      userId: userId,
      authToken: tok,
      idToken: tok,
      accessToken: sess.lookup('accessToken'),
      refreshToken: sess.lookup('refreshToken'),
    },
    env
  );
  await removeSession(sessId, env);
  return 'ok';
}

export async function logoutUser(env: Environment): Promise<string | undefined> {
  const user = env.getActiveUser();
  const sess = await findUserSession(user, env);
  if (sess) {
    return await logoutSession(user, sess, env);
  }
  return undefined;
}

export async function changePassword(
  newPassword: string,
  password: string,
  env: Environment
): Promise<string | undefined> {
  const user = env.getActiveUser();
  const sess = await findUserSession(user, env);
  if (sess) {
    const sessId = sess.lookup('id');
    const tok = sess.lookup('authToken');
    const sessInfo = {
      sessionId: sessId,
      userId: user,
      authToken: tok,
      idToken: tok,
      accessToken: sess.lookup('accessToken'),
      refreshToken: sess.lookup('refreshToken'),
    };
    if (await fetchAuthImpl().changePassword(sessInfo, newPassword, password, env)) {
      return await logoutSession(user, sess, env);
    } else {
      return undefined;
    }
  } else {
    throw new UnauthorisedError(`No active session for user ${user}`);
  }
}

export async function verifySession(token: string, env?: Environment): Promise<ActiveSessionInfo> {
  if (!isAuthEnabled()) return BypassSession;

  // Check if token is a JWT (Cognito ID token) or userId/sessionId format
  if (isJwtToken(token)) {
    return await verifyJwtToken(token, env);
  } else {
    return await verifySessionToken(token, env);
  }
}

function isJwtToken(token: string): boolean {
  // Simple JWT structure check - JWT tokens have 3 parts separated by dots
  return !!(token && typeof token === 'string' && token.split('.').length === 3);
}

async function verifyJwtToken(token: string, env?: Environment): Promise<ActiveSessionInfo> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      // Validate JWT structure first
      if (!isJwtToken(token)) {
        throw new UnauthorisedError('Invalid JWT token structure');
      }

      // Verify the JWT token directly with Cognito
      await fetchAuthImpl().verifyToken(token, env);

      // Extract user information from JWT payload
      const parts = token.split('.');
      const payload = JSON.parse(atob(parts[1]));

      // Extract user ID from standard JWT claims (sub or cognito:username)
      const userId = payload.sub || payload['cognito:username'];
      const email = payload.email || payload['cognito:username'];

      if (!userId) {
        throw new UnauthorisedError('Invalid JWT token: missing user identifier');
      }

      let localUser = null;
      if (email) {
        localUser = await findUserByEmail(email, env);
      }

      if (!localUser && userId) {
        localUser = await findUser(userId, env);
      }

      if (!localUser) {
        logger.warn(
          `User not found in local database for JWT token. Email: ${email}, UserId: ${userId}`
        );
        throw new UnauthorisedError(`User not found in local database`);
      }

      // Use the local user's ID for consistency
      const localUserId = localUser.lookup('id');
      const sess = await findUserSession(localUserId, env);
      if (!sess) {
        throw new UnauthorisedError(`No session found for user ${email}, UserId: ${userId}`);
      }
      // For JWT tokens, we use the token itself as sessionId for tracking
      return { sessionId: sess.lookup('id'), userId: localUserId };
    } catch (err: any) {
      if (err instanceof UnauthorisedError) {
        throw err;
      }
      logger.error(`JWT token verification failed:`, {
        errorName: err.name,
        errorMessage: err.message,
      });
      throw new UnauthorisedError('JWT token verification failed');
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

async function verifySessionToken(token: string, env?: Environment): Promise<ActiveSessionInfo> {
  const parts = token.split('/');
  const sessId = parts[1];
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      const sess: Instance = await findSession(sessId, env);
      if (sess != undefined) {
        await fetchAuthImpl().verifyToken(sess.lookup('authToken'), env);
        return { sessionId: sessId, userId: parts[0] };
      } else {
        logger.warn(`No active session found for user '${parts[0]}'`);
        throw new UnauthorisedError(`No active session for user '${parts[0]}'`);
      }
    } catch (err: any) {
      if (err instanceof UnauthorisedError) {
        throw err;
      }
      // Log error details for debugging
      logger.error(`Session verification failed for user '${parts[0]}':`, {
        errorName: err.name,
        errorMessage: err.message,
        sessionId: sessId,
      });
      throw new UnauthorisedError('Session verification failed');
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

export async function getUserInfo(userId: string, env: Environment): Promise<UserInfo> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      return await fetchAuthImpl().getUser(userId, env);
    } catch (err: any) {
      logger.error(`Failed to get user info for ${userId}: ${err.message}`);
      throw err; // Re-throw to preserve error type
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

export async function getUserInfoByEmail(email: string, env: Environment): Promise<UserInfo> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      return await fetchAuthImpl().getUserByEmail(email, env);
    } catch (err: any) {
      logger.error(`Failed to get user info for email ${email}: ${err.message}`);
      throw err; // Re-throw to preserve error type
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

export async function refreshUserToken(refreshToken: string, env: Environment): Promise<object> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      const sessionInfo = await fetchAuthImpl().refreshToken(refreshToken, env);

      return {
        id_token: sessionInfo.idToken,
        access_token: sessionInfo.accessToken,
        refresh_token: sessionInfo.refreshToken,
        token_type: 'Bearer',
        expires_in: 3600,
        userId: sessionInfo.userId,
        sessionId: sessionInfo.sessionId,
      };
    } catch (err: any) {
      logger.error(`Token refresh failed: ${err.message}`);
      throw err;
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

export function requireAuth(moduleName: string, eventName: string): boolean {
  if (isAuthEnabled()) {
    const f =
      moduleName == CoreAuthModuleName &&
      (eventName == 'login' || eventName == 'signup' || eventName == 'refreshToken');
    return !f;
  } else {
    return false;
  }
}

// Export getHttpStatusForError for use in HTTP handlers
export { getHttpStatusForError };

// Helper function to create standardized error responses
export function createAuthErrorResponse(error: Error): {
  error: string;
  message: string;
  statusCode: number;
} {
  const statusCode = getHttpStatusForError(error);
  let errorType = 'AUTHENTICATION_ERROR';

  if (error instanceof UserNotFoundError) {
    errorType = 'USER_NOT_FOUND';
  } else if (error instanceof UnauthorisedError) {
    errorType = 'UNAUTHORIZED';
  } else if (error instanceof UserNotConfirmedError) {
    errorType = 'USER_NOT_CONFIRMED';
  } else if (error instanceof PasswordResetRequiredError) {
    errorType = 'PASSWORD_RESET_REQUIRED';
  } else if (error instanceof TooManyRequestsError) {
    errorType = 'TOO_MANY_REQUESTS';
  } else if (error instanceof InvalidParameterError) {
    errorType = 'INVALID_PARAMETER';
  } else if (error instanceof ExpiredCodeError) {
    errorType = 'EXPIRED_CODE';
  } else if (error instanceof CodeMismatchError) {
    errorType = 'CODE_MISMATCH';
  } else if (error instanceof BadRequestError) {
    errorType = 'BAD_REQUEST';
  }

  // Log error creation for debugging purposes
  logger.debug(`Creating auth error response:`, {
    errorType: errorType,
    statusCode: statusCode,
    originalError: error.name,
  });

  return {
    error: errorType,
    message: error.message,
    statusCode: statusCode,
  };
}

// Helper function to check if an error is a known auth error
export function isAuthError(error: any): boolean {
  return (
    error instanceof UnauthorisedError ||
    error instanceof UserNotFoundError ||
    error instanceof UserNotConfirmedError ||
    error instanceof PasswordResetRequiredError ||
    error instanceof TooManyRequestsError ||
    error instanceof InvalidParameterError ||
    error instanceof ExpiredCodeError ||
    error instanceof CodeMismatchError ||
    error instanceof BadRequestError
  );
}

// Helper function to sanitize error details before logging
export function sanitizeErrorForLogging(error: Error): {
  name: string;
  message: string;
  sanitizedMessage: string;
} {
  const sanitizedMessage = error.message
    .replace(/password/gi, '[REDACTED]')
    .replace(/token/gi, '[REDACTED]')
    .replace(/secret/gi, '[REDACTED]')
    .replace(/key/gi, '[REDACTED]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL_REDACTED]')
    .replace(/\b[A-Fa-f0-9]{32,}\b/g, '[TOKEN_REDACTED]')
    .replace(/\b\d{4,}\b/g, '[NUMBER_REDACTED]');

  return {
    name: error.name,
    message: error.message,
    sanitizedMessage: sanitizedMessage,
  };
}

// Helper function to determine if an error should be retried
export function isRetryableError(error: Error): boolean {
  // Only retry on certain types of errors
  return (
    error instanceof TooManyRequestsError ||
    (error.message
      ? error.message.includes('temporarily unavailable') ||
        error.message.includes('service error') ||
        error.message.includes('timeout')
      : false)
  );
}
