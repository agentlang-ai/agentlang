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
    id Int @id @default(autoincrement()),
    name String
}

relationship UserProfile between (User, Profile) @one_one

entity Post {
    id Int @id @default(autoincrement()),
    title String
}

// one-many
relationship PostAuthor contains (User, Post)

entity Category {
    id Int @id @default(autoincrement()),
    description String
}

// many-many
relationship PostCategory between (Post, Category)

workflow CreateUserWithPosts {
    {User {name "Sam"},
     PostAuthor [{Post {title "Getting started in NodeJS"}},
                 {Post {title "Clojure Tutorial"}}],
     UserProfile {Profile {email "sam@blog.com"}}}
}