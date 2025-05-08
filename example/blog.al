module Blog

// Ref: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations

entity Profile {
    id UUID @id @default(uuid()),
    address String @optional,
    email Email,
    photo URL,
    DOB DateTime @optional
}

entity User {
    id Int @id @default(autoincrement()),
    name String,
    profile Profile @between @unique,
    posts Post[]
}

entity Post {
    id Int @id @default(autoincrement()),
    title String
    author User @relation(fields: [authorId], references: [id])
    authorId Int
    categories Category @between // N-N between relationship
}

entity Category {
    id Int @id @default(autoincrement()),
    description String
}

workflow CreateUserWithPosts {
    {User {name "Sam",
           posts [{Post {"title" "Welcome to Agentlang!"}}
                  {Post {"title" "Design a basic model"}}],
           profile {Profile {"email" "sam@blog.org"}}}}
}

workflow FindUserWithPostsAndProfile {
    {User {id? FindUserWithPosts.userId}}
}

workflow FindUserWithoutPostsAndProfile {
    {User {id? FindUserWithPosts.userId}
     exclude [posts, profile]} 
     // `exclude` is a generic way to fetch a subset of attributes, 
     // we did not have this feature in older Agentlang.
}

workflow AddNewPostToUser {
    {User {id? AddNewPostToUser.userId
           posts+ {Post {"title" "Advanced workflows"}}}}
    // + appends to an array attribute. In the case of relationships,
    // the resolver may manage the "array" as a separate table.
}

workflow AddExistingPostToUser {
    {User {id? AddExistingPostToUser.userId
           posts+ {Post {id? AddExistingPostToUser.postId}}}}
}

workflow FindUserFromPost {
    {Post {id? FindUserFromPost.postId}} as post;
    post.User // return user instance
}