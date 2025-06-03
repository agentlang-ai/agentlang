import { evaluateAsEvent, Result } from '../interpreter.js';
import { logger } from '../logger.js';
import { Instance, RbacPermissionFlag } from '../module.js';
import { makeCoreModuleName } from '../util.js';

export const CoreAuthModuleName = makeCoreModuleName('auth');
let AdminUserId: string | undefined;

const moduleDef = `module ${CoreAuthModuleName}

entity User {
    id UUID @id @default(uuid()),
    email Email @unique @indexed,
    firstName String,
    lastName String
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
    {User {id? AddUserToRole.userId}} as user;
    {Role {name? AddUserToRole.roleName}} as role;
    upsert {UserRole {User user, Role role}}
}

workflow FindUserRoles {
  {Role? {},
   UserRole {User {id? FindUserRoles.userId}}}
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

async function evalEvent(eventName: string, attrs: Array<any> | object): Promise<Result> {
  let result: any;
  await evaluateAsEvent(CoreAuthModuleName, eventName, attrs, undefined, true).then(
    (r: any) => (result = r)
  );
  return result;
}

export async function findRole(name: string): Promise<Result> {
  let result: any;
  await evalEvent('FindRole', { name: name }).then((r: any) => (result = r));
  return result;
}

export async function createRole(name: string) {
  await evalEvent('CreateRole', { name: name }).catch((reason: any) => {
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
  d: boolean = false
) {
  await evalEvent('CreatePermission', {
    id: id,
    roleName: roleName,
    resourceFqName: resourceFqName,
    c: c,
    r: r,
    u: u,
    d: d,
  }).catch((reason: any) => {
    logger.error(`Failed to create permission ${id} - ${reason}`);
  });
}

export async function assignUserToRole(userId: string, roleName: string) {
  await evalEvent('AssignUserToRole', { userId: userId, roleName: roleName }).catch(
    (reason: any) => {
      logger.error(`Failed to assign user ${userId} to role ${roleName} - ${reason}`);
    }
  );
}

export async function findUserRoles(userId: string): Promise<Result> {
  let result: any;
  await evalEvent('FindUserRoles', { userId: userId }).then((r: any) => (result = r));
  return result;
}

type RbacPermission = {
  resourceFqName: string;
  c: boolean;
  r: boolean;
  u: boolean;
  d: boolean;
};

function normalizePermissionInstance(inst: Instance): RbacPermission {
  return Object.fromEntries(inst.attributes) as RbacPermission;
}
const UserRoleCache: Map<string, string[]> = new Map();
const RolePermissionsCache: Map<string, RbacPermission[]> = new Map();

async function findRolePermissions(role: string): Promise<Result> {
  let result: any;
  await evalEvent('FindRolePermissions', { role: role }).then((r: any) => (result = r));
  return result;
}

async function updatePermissionCacheForRole(role: string) {
  let result: any;
  await findRolePermissions(role).then((r: any) => (result = r));
  RolePermissionsCache.set(role, result.map(normalizePermissionInstance));
}

export async function userHasPermissions(
  userId: string,
  resourceFqName: string,
  perms: Set<RbacPermissionFlag>
): Promise<boolean> {
  if (userId == AdminUserId) {
    return true;
  }
  let userRoles: string[] | undefined = UserRoleCache.get(userId);
  if (userRoles == undefined) {
    let roles: any;
    await findUserRoles(userId).then((result: any) => {
      roles = result;
    });
    userRoles = [];
    for (let i = 0; i < roles.length; ++i) {
      const r: Instance = roles[i] as Instance;
      const n: string = r.attributes.get('name');
      userRoles.push(n);
      if (!RolePermissionsCache.get(n)) {
        await updatePermissionCacheForRole(n);
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
          p.resourceFqName == resourceFqName &&
            (c ? p.c : true) &&
            (r ? p.r : true) &&
            (u ? p.u : true) &&
            (d ? p.d : true);
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

function canUserPerfom(opr: Set<RbacPermissionFlag>): Function {
  async function f(userId: string, resourceFqName: string): Promise<boolean> {
    let result: boolean = false;
    await userHasPermissions(userId, resourceFqName, opr).then((r: boolean) => {
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
