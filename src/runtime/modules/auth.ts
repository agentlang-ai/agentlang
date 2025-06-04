import { evaluateAsEvent, Result, Environment } from '../interpreter.js';
import { logger } from '../logger.js';
import { Instance, RbacPermissionFlag } from '../module.js';
import { makeCoreModuleName } from '../util.js';
import { isSqlTrue } from '../resolvers/sqldb/dbutil.js';

export const CoreAuthModuleName = makeCoreModuleName('auth');
export const AdminUserId = '00000000-0000-0000-0000-000000000000';

const moduleDef = `module ${CoreAuthModuleName}

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

workflow CreateUser {
    {User {email CreateUser.email,
           firstName CreateUser.firstName,
           lastName CreateUser.lastName}}
}

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
`;

export default moduleDef;

async function evalEvent(
  eventName: string,
  attrs: Array<any> | object,
  env: Environment
): Promise<Result> {
  let result: any;
  await evaluateAsEvent(CoreAuthModuleName, eventName, attrs, AdminUserId, env, true).then(
    (r: any) => (result = r)
  );
  return result;
}

export async function createUser(
  id: string,
  email: string,
  firstName: string,
  lastName: string,
  env: Environment
): Promise<Result> {
  let result: any;
  await evalEvent(
    'CreateUser',
    {
      id: id,
      email: email,
      firstName: firstName,
      lastName: lastName,
    },
    env
  ).then((r: any) => (result = r));
  return result;
}

export async function findRole(name: string, env: Environment): Promise<Result> {
  let result: any;
  await evalEvent('FindRole', { name: name }, env).then((r: any) => (result = r));
  return result;
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
  let result: any;
  await evalEvent('FindUserRoles', { userId: userId }, env).then((r: any) => (result = r));
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
  let result: any;
  await evalEvent('FindRolePermissions', { role: role }, env).then((r: any) => (result = r));
  return result;
}

async function updatePermissionCacheForRole(role: string, env: Environment) {
  let result: any;
  await findRolePermissions(role, env).then((r: any) => (result = r));
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
    let roles: any;
    await findUserRoles(userId, env).then((result: any) => {
      roles = result;
    });
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
    let result: boolean = false;
    await userHasPermissions(userId, resourceFqName, opr, env).then((r: boolean) => {
      result = r;
    });
    return result;
  }
  return f;
}

export const canUserCreate = canUserPerfom(CreateOperation);
export const canUserRead = canUserPerfom(ReadOperation);
export const canUserUpdate = canUserPerfom(UpdateOperation);
export const canUserDelete = canUserPerfom(DeleteOperation);

export class UnauthorisedError extends Error {
  constructor(message?: string, options?: ErrorOptions) {
    super(message ? message : 'User not authorised to perform this operation', options);
  }
}
