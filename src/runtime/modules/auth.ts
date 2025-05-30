import { evaluateAsEvent, Result } from '../interpreter.js';
import { makeCoreModuleName } from '../util.js';

export const CoreAuthModuleName = makeCoreModuleName('auth');

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
    can_read Boolean,
    can_create Boolean,
    can_update Boolean,
    can_delete Boolean
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

workflow AddUserToRole {
    {User {id? AddUserToRole.userId}} as user;
    {Role {name? AddUserToRole.roleName}} as role;
    {UserRole {User user, Role role}}
}

workflow CreatePermission {
     upsert {Permission {id CreatePermission.id,
                        resourceFqName CreatePermission.resourceFqName,
                        can_create CreatePermission.c,
                        can_read CreatePermission.r,
                        can_update CreatePermission.u,
                        can_delete CreatePermission.d},
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
  await evaluateAsEvent(CoreAuthModuleName, eventName, attrs)
    .then((r: any) => (result = r))
    .catch((reason: any) => {
      console.log(reason);
    });
  return result;
}

export async function findRole(name: string): Promise<Result> {
  let result: any;
  await evalEvent('FindRole', { name: name }).then((r: any) => (result = r));
  return result;
}

export async function createRole(name: string) {
  await evalEvent('CreateRole', { name: name });
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
  });
}
