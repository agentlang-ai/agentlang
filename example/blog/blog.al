module Blog

// Ref: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    email Email,
    photo URL @optional,
    DOB DateTime @optional,
    @rbac [(roles: [manager], allow: [create])]
}

entity User {
    id UUID @id @default(uuid()),
    name String @indexed,
    @rbac [(roles: [manager], allow: [create]),
           (allow: [read], where: auth.user = this.id)]
}

relationship UserProfile between (Blog/User, Blog/Profile) @one_one

entity Post {
    id UUID @id @default(uuid()),
    title String
}

relationship UserPost contains (User, Post)

entity Category {
    id UUID @id @default(uuid()),
    description String,
    @rbac [(roles: [manager], allow: [create])]
}

// many-many
relationship PostCategory between (Post, Category)

event CreateUser extends Profile {
    name String
}

workflow CreateUser {
    {User {name CreateUser.name},
     UserProfile {Profile {email CreateUser.email}},
     UserPost {Post {title "hello, world"}}}
}

workflow FindUsersByName {
    {User {name? FindUsersByName.name}}
}

workflow CreateUserWithPosts {
    {User {name CreateUserWithPosts.name},
     UserPost [{Post {title CreateUserWithPosts.post1}},
                 {Post {title CreateUserWithPosts.post2}}],
     UserProfile {Profile {email CreateUserWithPosts.email}}}
}

workflow AddPost {
    {User {id? AddPost.userId},
     UserPost {Post {title AddPost.title},
               PostCategory {Category {description AddPost.category}}}}
}

workflow AddCategory {
    {Category {description AddCategory.description}}
}

workflow AddCategoryToPost {
    {Post {id? AddCategoryToPost.postId}} as [post];
    {Category {id? AddCategoryToPost.catId}} as [cat];
    {PostCategory {Post post, Category cat}}
}

workflow GetUserPosts {
    {User {id? GetUserPosts.userId},
     UserPost {Post? {}, PostCategory {Category? {}}}}
}

workflow FindUserProfile {
    {User {id? FindUserProfile.userId},
     UserProfile {Profile? {}}}
}

workflow UpdateUserName {
    {User {id? UpdateUserName.userId, name UpdateUserName.newName}}
}

//upsert {agentlang_auth/User {email "abc@cc.com", firstName "A", lastName "BC"}}
//{agentlang_auth/AssignUserToRoleByEmail {email "abc@cc.com", roleName "manager"}}