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

// one-many
relationship PostAuthor contains (User, Post)

entity Category {
    id UUID @id @default(uuid()),
    description String
}

// many-many
relationship PostCategory between (Post, Category)

workflow CreateUser {
    {User {name CreateUser.name}} as u1;
    {User {name "vijay"}} as u2;
    [u2, u1]
}

workflow FindUsersByName {
    {User {name? FindUsersByName.name}}
}

workflow CreateUserWithPosts {
    {User {name "Sam"},
     PostAuthor [{Post {title "Getting started in NodeJS"}},
                 {Post {title "Clojure Tutorial"}}],
     UserProfile {Profile {email "sam@blog.com"}}}
}