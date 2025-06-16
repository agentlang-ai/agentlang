import { evaluateAsEvent, Result, Environment } from '../interpreter.js';
import { logger } from '../logger.js';
import { Instance, RbacPermissionFlag } from '../module.js';
import { makeCoreModuleName } from '../util.js';
import { isSqlTrue } from '../resolvers/sqldb/dbutil.js';
import { AgentlangAuth, SessionInfo, UserInfo } from '../auth/interface.js';
import { CognitoAuth } from '../auth/cognito.js';

export const CoreAuthModuleName = makeCoreModuleName('auth');
export const AdminUserId = '00000000-0000-0000-0000-000000000000';

const moduleDef = `module ${CoreAuthModuleName}

import "./modules/auth.js" as Auth

entity User {
    id UUID @id @default(uuid()),
    email Email @unique @indexed,
    firstName String,
    lastName String
}

workflow CreateUser {
  {User {id CreateUser.id,
         email CreateUser.email,
         firstName CreateUser.firstName,
         lastName CreateUser.lastName}}
}

workflow FindUser {
  {User {id? FindUser.id}} as [user];
  user
}

workflow FindUserByEmail {
  {User {email? FindUser.email}} as [user];
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
    upsert {Role {name CreateRole.name}}
}

workflow FindRole {
    {Role {name? FindRole.name}} as [role];
    role
}

workflow AssignUserToRole {
    {User {id? AssignUserToRole.userId}} as [user];
    {Role {name? AssignUserToRole.roleName}} as [role];
    upsert {UserRole {User user, Role role}}
}

workflow FindUserRoles {
  {User {id? FindUserRoles.userId},
   UserRole {Role? {}}}
}

workflow CreatePermission {
     upsert {Permission {id CreatePermission.id,
                         resourceFqName CreatePermission.resourceFqName,
                         c CreatePermission.c,
                         r CreatePermission.r,
                         u CreatePermission.u,
                         d CreatePermission.d},
             RolePermission {Role {name? CreatePermission.roleName}}}
}

workflow AddPermissionToRole {
    {Role {name? AddPermissionToRole.roleName}} as role;
    {Permission {id? AddPermissionToRole.permissionId}} as perm;
    upsert {RolePermission {Role role, Permission perm}}
}

workflow FindRolePermissions {
    {Role {name? FindRolePermissions.role},
     RolePermission {Permission? {}}}
}

entity Session {
  id UUID @id,
  userId UUID @indexed,
  isActive Boolean
}

workflow CreateSession {
  {Session {id CreateSession.id, userId CreateSession.userId, isActive true}}
}

workflow FindSession {
  {Session {id? FindSession.id}} as [session];
  session
}

workflow FindUserSession {
  {Session {userId? FindUserSession.id}} as [session];
  session
}

workflow RemoveSession {
  purge {Session {id? RemoveSession.id}}
}

workflow SignUp {
  await Auth.signUpUser(SignUp.email, SignUp.password, SignUp.userData)
}

workflow login {
  await Auth.loginUser(login.email, login.password)
}
`;

export default moduleDef;

async function evalEvent(
  eventName: string,
  attrs: Array<any> | object,
  env: Environment
): Promise<Result> {
  return await evaluateAsEvent(CoreAuthModuleName, eventName, attrs, AdminUserId, env, true);
}

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

export async function findUser(id: string, env?: Environment): Promise<Result> {
  if (!env) {
    env = new Environment();
  }
  return await evalEvent(
    'FindUser',
    {
      id: id,
    },
    env
  );
}

export async function findUserByEmail(email: string, env?: Environment): Promise<Result> {
  if (!env) {
    env = new Environment();
  }
  return await evalEvent(
    'FindUserByEmail',
    {
      email: email,
    },
    env
  );
}

export async function ensureUser(email: string, firstName: string, lastName: string) {
  const env: Environment = new Environment();
  const user = await findUserByEmail(email, env);
  if (user) {
    return user;
  }
  return await env.callInTransaction(async () => {
    return await createUser(crypto.randomUUID(), email, firstName, lastName, env);
  });
}

export async function ensureUserSession(userId: string) {
  const env: Environment = new Environment();
  return await env.callInTransaction(async () => {
    const sess = await findUserSession(userId, env);
    if (sess) {
      await removeSession(sess.id, env);
    }
    return createSession(crypto.randomUUID(), userId, env);
  });
}

export async function createSession(id: string, userId: string, env: Environment): Promise<Result> {
  return await evalEvent(
    'CreateSession',
    {
      id: id,
      userId: userId,
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

export async function findUserSession(userId: string, env?: Environment): Promise<Result> {
  if (!env) {
    env = new Environment();
  }
  return await evalEvent(
    'FindUserSession',
    {
      userId: userId,
    },
    env
  );
}

export async function removeSession(id: string, env?: Environment): Promise<Result> {
  if (!env) {
    env = new Environment();
  }
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
    logger.error(`Failed to create role ${name} - ${reason}`);
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

export async function findUserRoles(userId: string, env: Environment): Promise<Result> {
  const result: any = await evalEvent('FindUserRoles', { userId: userId }, env);
  const inst: Instance | undefined = result ? (result[0] as Instance) : undefined;
  if (inst) {
    return inst.getRelatedInstances('UserRole');
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
  if (userId == AdminUserId) {
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

export type UnautInfo = {
  opr: string;
  entity: string;
};

function asUnauthMessage(obj: string | UnautInfo): string {
  if (typeof obj == 'string') {
    return obj;
  } else {
    return `User not authorised to perform '${obj.opr}' on ${obj.entity}`;
  }
}

export class UnauthorisedError extends Error {
  constructor(message?: string | UnautInfo, options?: ErrorOptions) {
    super(
      message ? asUnauthMessage(message) : 'User not authorised to perform this operation',
      options
    );
  }
}

const runtimeAuth: AgentlangAuth = new CognitoAuth();

export async function signUpUser(
  username: string,
  password: string,
  userData: object
): Promise<UserInfo> {
  let result: any;
  await runtimeAuth.signUp(
    username,
    password,
    new Map(Object.entries(userData)),
    (userInfo: UserInfo) => {
      result = userInfo;
    }
  );
  return result as UserInfo;
}

export async function loginUser(username: string, password: string): Promise<string> {
  let result: string = '';
  await runtimeAuth.login(username, password, (r: SessionInfo) => {
    result = r.authToken;
  });
  return result;
}
