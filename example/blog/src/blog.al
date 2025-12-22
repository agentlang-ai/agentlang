module Blog.Core

entity A {
    id Int @id
}

entity B {
    id Int @id
}

relationship AB between(A @as A, B @as B)

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    email Email,
    photo URL @optional,
    DOB DateTime @optional,
    @rbac [(roles: [manager], allow: [create])],
    @meta {"audit": true}
}

entity User {
    id UUID @id @default(uuid()),
    name String @indexed,
    @rbac [(roles: [manager], allow: [create]),
           (allow: [read], where: auth.user = this.id)],
    @meta {"fullTextSearch": "*"}
}

relationship UserProfile between (Blog.Core/User, Blog.Core/Profile) @one_one

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

@public event CreateUser extends Profile {
    name String
}

workflow CreateUser {
    {User {name CreateUser.name},
     UserProfile {Profile {email CreateUser.email}},
     UserPost {Post {title "hello, world"}}}
}

@public workflow FindUsersByName {
    {User {name? FindUsersByName.name}}
}

@public workflow CreateUserWithPosts {
    {User {name CreateUserWithPosts.name},
     UserPost [{Post {title CreateUserWithPosts.post1}},
                 {Post {title CreateUserWithPosts.post2}}],
     UserProfile {Profile {email CreateUserWithPosts.email}}}
}

@public event AddPost {
    userId String,
    title String,
    category String
}

workflow AddPost {
    {User {id? AddPost.userId},
     UserPost {Post {title AddPost.title},
               PostCategory {Category {description AddPost.category}}}}
}

@public workflow AddCategory {
    {Category {description AddCategory.description}}
}

@public workflow AddCategoryToPost {
    {Post {id? AddCategoryToPost.postId}} @as [post];
    {Category {id? AddCategoryToPost.catId}} @as [cat];
    {PostCategory {Post post, Category cat}}
}

@public workflow GetUserPosts {
    {User {id? GetUserPosts.userId},
     UserPost {Post? {}, PostCategory {Category? {}}}}
}

@public workflow FindUserProfile {
    {User {id? FindUserProfile.userId},
     UserProfile {Profile? {}}}
}

@public workflow FindUserProfileAndPosts {
    {User {id? FindUserProfileAndPosts.userId},
     UserProfile {Profile? {}},
     UserPost {Post? {}},
     @into {userName Blog.Core/User.name,
            userEmail Blog.Core/Profile.email,
            postTitle Blog.Core/Post.title}}
}

@public workflow UpdateUserName {
    {User {id? UpdateUserName.userId, name UpdateUserName.newName}}
}

@public workflow SearchUser {
    {User? SearchUser.q}
}

//{agentlang.auth/User {email "abc@cc.com", firstName "A", lastName "BC"}, @upsert}
//{agentlang.auth/AssignUserToRoleByEmail {email "abc@cc.com", roleName "manager"}}