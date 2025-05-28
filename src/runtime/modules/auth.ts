const moduleDef = `module agentlang_auth

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
    id UUID @id @default(uuid()),
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
    {Role {name CreateRole.name}}
}

workflow AddUserToRole {
    {User {id? AddUserToRole.userId}} as user;
    {Role {name? AddUserToRole.roleName}} as role;
    {UserRole {User user, Role role}}
}

workflow CreatePermission {
    {Permission {can_create CreatePermission.c,
                 can_read CreatePermission.r,
                 can_update CreatePermission.u,
                 can_delete CreatePermission.d}}
}

workflow AddPermissionToRole {
    {Role {name? AddPermissionToRole.roleName}} as role;
    {Permission {id? AddPermissionToRole.permissionId}} as perm;
    {RolePermission {Role role, Permission perm}}
}`;

export default moduleDef;
