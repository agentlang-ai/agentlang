module Blog

// Ref: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    email Email,
    photo URL @optional,
    DOB DateTime @optional
}

entity User {
    id UUID @id @default(uuid()),
    name String @indexed
}

relationship UserProfile between (User, Profile) @one_one

entity Post {
    id UUID @id @default(uuid()),
    title String
}

relationship UserPost contains (User, Post)

entity Category {
    id UUID @id @default(uuid()),
    description String
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
     UserPost {Post {title AddPost.title}}}
}

workflow GetUserPosts {
    {User {id? GetUserPosts.userId},
     UserPost {Post? {}}}
}

workflow FindUserProfile {
    {User {id? FindUserProfile.userId},
     UserProfile {Profile? {}}}
}