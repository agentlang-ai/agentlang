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
    lastLoginTime DateTime @default(now()),
    @rbac [(allow: [read, delete, update, create], where: auth.user = this.id)],
    @after {delete AfterDeleteUser}
}

workflow AfterDeleteUser {
  {RemoveUserSession {id AfterDeleteUser.User.id}}
}

@public workflow CreateUser {
  {User {id CreateUser.id,
         email CreateUser.email,
         firstName CreateUser.firstName,
         lastName CreateUser.lastName}}
}

workflow UpdateUserLastLogin {
  {User {email? UpdateUserLastLogin.email, lastLoginTime UpdateUserLastLogin.loginTime}}
}

@public workflow CreateUsers {
  for user in CreateUsers.users {
      {User {email? user.email}} @as [u];
      if (u) {
        {User {id? u.id,
               firstName user.firstName,
               lastName user.lastName}} 
         @as [um]
        um
      }
      else {
        {User {email user.email,
               firstName user.firstName,
               lastName user.lastName}}
         @as [um]
        {Role {name? user.role}}
         @as [r];
        if (r) {
          {UserRole {User um, Role r}}
        } else {
          {Role {name user.role}} @as [rnew]
          {UserRole {User um, Role rnew}}
        }
        um
      }
  }
}

@public workflow UpdateUser {
  {User {id UpdateUser.id,
         firstName UpdateUser.firstName,
         lastName UpdateUser.lastName}, @upsert}
}

@public workflow FindUser {
  {User {id? FindUser.id}} @as [user];
  user
}

@public workflow FindUserByEmail {
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

@public workflow CreateRole {
    {Role {name CreateRole.name}, @upsert}
}

@public workflow FindRole {
    {Role {name? FindRole.name}} @as [role];
    role
}

@public workflow ListRoles {
    {Role? {}}
}

@public workflow ListUserRoles {
    if (ListUserRoles.Role and ListUserRoles.User) {
        {UserRole {User? ListUserRoles.User, Role? ListUserRoles.Role}}
    }
    else if (ListUserRoles.User) {
        {UserRole {User? ListUserRoles.User}}
    }
    else if (ListUserRoles.Role) {
        {UserRole {Role? ListUserRoles.Role}}
    }
    else {
        {UserRole? {}}
    }
}

@public workflow ListPermissions {
    {Permission? {}}
}

@public workflow ListRolePermissions {
    if (ListRolePermissions.Role and ListRolePermissions.Permission) {
        {RolePermission {Role? ListRolePermissions.Role, Permission? ListRolePermissions.Permission}}
    }
    else if (ListRolePermissions.Role) {
        {RolePermission {Role? ListRolePermissions.Role}}
    }
    else if (ListRolePermissions.Permission) {
        {RolePermission {Permission? ListRolePermissions.Permission}}
    }
    else {
        {RolePermission? {}}
    }
}

@public workflow AssignUserToRole {
    {User {id? AssignUserToRole.userId}} @as [user];
    {Role {name? AssignUserToRole.roleName}} @as [role];
    {UserRole {User user, Role role}, @upsert}
}

@public workflow AssignUserToRoleByEmail {
    {User {email? AssignUserToRoleByEmail.email}} @as [user];
    {Role {name? AssignUserToRoleByEmail.roleName}} @as [role];
    {UserRole {User user, Role role}, @upsert}
}

@public workflow FindUserRoles {
  {User {id? FindUserRoles.userId},
   UserRole {Role? {}}}
}

@public workflow CreatePermission {
     {Permission {id CreatePermission.id,
                  resourceFqName CreatePermission.resourceFqName,
                  c CreatePermission.c,
                  r CreatePermission.r,
                  u CreatePermission.u,
                  d CreatePermission.d},
      RolePermission {Role {name? CreatePermission.roleName}},
      @upsert}
}

@public workflow AddPermissionToRole {
    {Role {name? AddPermissionToRole.roleName}} @as [role];
    {Permission {id? AddPermissionToRole.permissionId}} @as [perm];
    {RolePermission {Role role, Permission perm}, @upsert}
}

@public workflow FindRolePermissions {
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

@public workflow CreateSession {
  {Session {id CreateSession.id, userId CreateSession.userId,
            authToken CreateSession.authToken,
            accessToken CreateSession.accessToken,
            refreshToken CreateSession.refreshToken,
            isActive true}}
}

@public workflow UpdateSession {
  {Session {id? UpdateSession.id,
            authToken UpdateSession.authToken,
            accessToken UpdateSession.accessToken,
            refreshToken UpdateSession.refreshToken,
            isActive true}, @upsert}
}

@public workflow FindSession {
  {Session {id? FindSession.id}} @as [session];
  session
}

@public workflow FindUserSession {
  {Session {userId? FindUserSession.userId}} @as [session];
  session
}

@public workflow RemoveSession {
  purge {Session {id? RemoveSession.id}}
}

@public workflow RemoveUserSession {
  {Session {userId? RemoveUserSession.id}} @as [session];
  purge {Session {id? session.id}}
}

@public workflow DeleteRole {
  purge {UserRole {Role? DeleteRole.name}}
  purge {Role {name? DeleteRole.name}}
}

@public workflow DeleteUserRole {
  purge {UserRole {User? DeleteUserRole.User, Role? DeleteUserRole.Role}}
}

@public workflow DeletePermission {
  purge {RolePermission {Permission? DeletePermission.id}}
  purge {Permission {id? DeletePermission.id}}
}

@public workflow DeleteRolePermission {
  purge {RolePermission {Role? DeleteRolePermission.Role, Permission? DeleteRolePermission.Permission}}
}

@public workflow UpdateRoleAssignment {
  {User {id? UpdateRoleAssignment.userId}} @as [user]
  {Role {name? UpdateRoleAssignment.roleName}} @as [role]
  if (user and role) {
    {UserRole {__path__? UpdateRoleAssignment.userRole, User user.__path__, Role role.__path__}}
  }
  else if (user) {
    {UserRole {__path__? UpdateRoleAssignment.userRole, User user.__path__}}
  }
  else if (role) {
    {UserRole {__path__? UpdateRoleAssignment.userRole, Role role.__path__}}
  }
}

@public workflow UpdatePermissionAssignment {
  {Role {name? UpdatePermissionAssignment.roleName}} @as [role]
  {Permission {id? UpdatePermissionAssignment.permissionId}} @as [permission]
  if (role and permission) {
    {RolePermission {__path__? UpdatePermissionAssignment.rolePermission, Permission? permission.__path__, Role role.__path__}}
  }
  else if (role) {
    {RolePermission {__path__? UpdatePermissionAssignment.rolePermission, Role role.__path__}}
  }
  else if (permission) {
    {RolePermission {__path__? UpdatePermissionAssignment.rolePermission, Permission? permission.__path__}}
  }
}

@public workflow UpdatePermission {
  if (UpdatePermission.resourceFqName and UpdatePermission.c != undefined and UpdatePermission.r != undefined and UpdatePermission.u != undefined and UpdatePermission.d != undefined) {
    {Permission {id? UpdatePermission.id,
                resourceFqName UpdatePermission.resourceFqName,
                c UpdatePermission.c,
                r UpdatePermission.r,
                u UpdatePermission.u,
                d UpdatePermission.d}
     }
  } else if (UpdatePermission.c != undefined and UpdatePermission.r != undefined and UpdatePermission.u != undefined and UpdatePermission.d != undefined) {
    {Permission {id? UpdatePermission.id,
                 c UpdatePermission.c,
                 r UpdatePermission.r,
                 u UpdatePermission.u,
                 d UpdatePermission.d}
    } 
  } else if (UpdatePermission.resourceFqName) {
    {Permission {id? UpdatePermission.id,
                resourceFqName UpdatePermission.resourceFqName}
    }
  }
}

@public workflow signup {
  await Auth.signUpUser(signup.firstName, signup.lastName, signup.email, signup.password, signup.userData)
}

@public workflow confirmSignup {
  await Auth.confirmSignupUser(confirmSignup.email, confirmSignup.confirmationCode)
}

@public workflow resendConfirmationCode {
  await Auth.resendConfirmationCodeUser(resendConfirmationCode.email)
}

@public workflow login {
  await Auth.loginUser(login.email, login.password)
}

@public workflow forgotPassword {
  await Auth.forgotPasswordUser(forgotPassword.email)
}

@public workflow confirmForgotPassword {
  await Auth.confirmForgotPasswordUser(
    confirmForgotPassword.email,
    confirmForgotPassword.confirmationCode,
    confirmForgotPassword.newPassword
  )
}

@public workflow logout {
  await Auth.logoutUser()
}

@public workflow changePassword {
  await Auth.changePassword(changePassword.newPassword, changePassword.password)
}

@public workflow refreshToken {
  await Auth.refreshUserToken(refreshToken.refreshToken)
}

@public workflow getUser {
  await Auth.getUserInfo(getUser.userId)
}

@public workflow getUserByEmail {
  await Auth.getUserInfoByEmail(getUserByEmail.email)
}

@public workflow inviteUser {
  await Auth.inviteUser(inviteUser.email, inviteUser.firstName, inviteUser.lastName, inviteUser.userData)
}


@public workflow acceptInvitation {
  await Auth.acceptInvitationUser(acceptInvitation.email, acceptInvitation.tempPassword, acceptInvitation.newPassword)
}

@public workflow callback {
  await Auth.callbackUser(callback.code)
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
      email: email.toLowerCase(),
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
      email: email.toLowerCase(),
    },
    env
  );
}

export async function updateUser(
  userId: string,
  firstName: string,
  lastName: string,
  env: Environment
): Promise<Result> {
  return await evalEvent(
    'UpdateUser',
    {
      id: userId,
      firstName: firstName,
      lastName: lastName,
    },
    env
  );
}

export async function updateUserLastLogin(email: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'UpdateUserLastLogin',
    {
      email: email,
      loginTime: new Date().toISOString(),
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
  const user = await findUserByEmail(email.toLowerCase(), env);
  if (user) {
    const email = user.lookup('email');
    await updateUserLastLogin(email, env).catch((reason: any) => {
      logger.error(`Failed to update last login time for user ${email}: ${reason}`);

    // Update existing user with latest name information from ID token
    const userId = user.lookup('id');
    await updateUser(userId, firstName, lastName, env).catch((reason: any) => {
      logger.error(`Failed to update user ${userId} with latest name information: ${reason}`);
    });
    return user;
  }
  return await createUser(crypto.randomUUID(), email.toLowerCase(), firstName, lastName, env);
}

export async function ensureUserRoles(userid: string, userRoles: string[], env: Environment) {
  const currentRoles = await findUserRoles(userid, env);
  const currentRoleNames = currentRoles
    ?.map((role: Instance) => {
      const roleName = (role as Instance).attributes.get('name');
      return roleName && roleName !== '*' ? roleName : null;
    })
    .filter(Boolean);

  if (currentRoleNames.length > 0) {
    logger.info(
      `User ${userid} already has roles: ${currentRoleNames.join(', ')}, skipping role assignment.`
    );
    return;
  }

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
  await evalEvent(
    'AssignUserToRoleByEmail',
    { email: email.toLowerCase(), roleName: roleName },
    env
  ).catch((reason: any) => {
    logger.error(`Failed to assign user ${email} to role ${roleName} - ${reason}`);
    r = false;
  });
  return r;
}

let DefaultRoleInstance: Instance | undefined;

export async function findUserRoles(userId: string, env: Environment): Promise<Result> {
  const result: any = await evalEvent('FindUserRoles', { userId: userId }, env);
  const inst: Instance | undefined = result ? (result[0] as Instance) : undefined;
  if (inst) {
    let roles: Instance[] | undefined = inst.getRelatedInstances('UserRole');
    if (roles === undefined) {
      roles = [];
    }
    if (DefaultRoleInstance === undefined) {
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

const UserRoleCache: Map<string, string[] | null> = new Map();
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
  let userRoles: string[] | null | undefined = UserRoleCache.get(userId);
  if (!userRoles) {
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
    userRoles &&
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
  if (userRoles !== null) {
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
  firstName: string,
  lastName: string,
  username: string,
  password: string,
  userData: object,
  env: Environment
): Promise<UserInfo> {
  let result: any;
  try {
    await fetchAuthImpl().signUp(
      firstName,
      lastName,
      username.toLowerCase(),
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

export async function confirmSignupUser(
  username: string,
  confirmationCode: string,
  env: Environment
): Promise<Result> {
  try {
    await fetchAuthImpl().confirmSignup(username.toLowerCase(), confirmationCode, env);
    return {
      status: 'ok',
      message: 'User confirmed successfully',
    };
  } catch (err: any) {
    logger.error(`Confirm signup failed for ${username}: ${err.message}`);
    throw err; // Re-throw to preserve error type for HTTP status mapping
  }
}

export async function resendConfirmationCodeUser(
  username: string,
  env: Environment
): Promise<Result> {
  try {
    await fetchAuthImpl().resendConfirmationCode(username.toLowerCase(), env);
    return {
      status: 'ok',
      message: 'Confirmation code resent successfully',
    };
  } catch (err: any) {
    logger.error(`Resend confirmation code failed for ${username}: ${err.message}`);
    throw err; // Re-throw to preserve error type for HTTP status mapping
  }
}

export async function forgotPasswordUser(username: string, env: Environment): Promise<Result> {
  try {
    await fetchAuthImpl().forgotPassword(username.toLowerCase(), env);
    return { status: 'ok', message: 'Password reset code sent' };
  } catch (err: any) {
    logger.error(`Forgot password failed for ${username}: ${err.message}`);
    throw err;
  }
}

export async function confirmForgotPasswordUser(
  username: string,
  confirmationCode: string,
  newPassword: string,
  env: Environment
): Promise<Result> {
  try {
    await fetchAuthImpl().confirmForgotPassword(
      username.toLowerCase(),
      confirmationCode,
      newPassword,
      env
    );
    return { status: 'ok', message: 'Password has been reset' };
  } catch (err: any) {
    logger.error(`Confirm forgot password failed for ${username}: ${err.message}`);
    throw err;
  }
}

export async function loginUser(
  username: string,
  password: string,
  env: Environment
): Promise<string | object> {
  let result: string | object = '';
  try {
    await fetchAuthImpl().login(username.toLowerCase(), password, env, (r: SessionInfo) => {
      UserRoleCache.set(r.userId, null);
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

export async function callbackUser(code: string, env: Environment): Promise<string | object> {
  let result: string | object = '';
  try {
    await fetchAuthImpl().callback(code, env, (r: SessionInfo) => {
      UserRoleCache.set(r.userId, null);
      if (r.idToken && r.accessToken && r.refreshToken) {
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
        result = `${r.userId}/${r.sessionId}`;
      }
    });
    return result;
  } catch (err: any) {
    logger.error(`Callback failed for ${code}: ${err.message}`);
    throw err;
  }
}

async function logoutSession(userId: string, sess: Instance, env: Environment): Promise<Result> {
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
  return {
    status: 'ok',
    message: 'Logged out successfully',
  };
}

export async function logoutUser(env: Environment): Promise<Result> {
  const user = env.getActiveUser();
  const sess = await findUserSession(user, env);
  if (sess) {
    return await logoutSession(user, sess, env);
  }
  return {
    status: 'ok',
    message: 'Logged out successfully',
  };
}

export async function changePassword(
  newPassword: string,
  password: string,
  env: Environment
): Promise<Result> {
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
        localUser = await findUserByEmail(email.toLowerCase(), env);
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
      if (sess !== undefined) {
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
      return await fetchAuthImpl().getUserByEmail(email.toLowerCase(), env);
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

export async function inviteUser(
  email: string,
  firstName: string,
  lastName: string,
  userData: Map<string, any> | undefined,
  env: Environment
): Promise<object> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      let invitationInfo: any;
      await fetchAuthImpl().inviteUser(email, firstName, lastName, userData, env, (info: any) => {
        invitationInfo = info;
      });

      return {
        email: invitationInfo.email,
        firstName: invitationInfo.firstName,
        lastName: invitationInfo.lastName,
        invitationId: invitationInfo.invitationId,
        message: 'User invitation sent successfully',
      };
    } catch (err: any) {
      logger.error(`User invitation failed: ${err.message}`);
      throw err;
    }
  };
  if (needCommit) {
    return await env.callInTransaction(f);
  } else {
    return await f();
  }
}

export async function acceptInvitationUser(
  email: string,
  tempPassword: string,
  newPassword: string,
  env: Environment
): Promise<object> {
  const needCommit = env ? false : true;
  env = env ? env : new Environment();
  const f = async () => {
    try {
      await fetchAuthImpl().acceptInvitation(email, tempPassword, newPassword, env);
      return {
        email: email,
        message: 'Invitation accepted successfully',
      };
    } catch (err: any) {
      logger.error(`Accept invitation failed: ${err.message}`);
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
      (eventName == 'login' ||
        eventName == 'signup' ||
        eventName == 'confirmSignup' ||
        eventName == 'resendConfirmationCode' ||
        eventName == 'forgotPassword' ||
        eventName == 'confirmForgotPassword' ||
        eventName == 'refreshToken' ||
        eventName == 'acceptInvitation' ||
        eventName == 'callback');
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
