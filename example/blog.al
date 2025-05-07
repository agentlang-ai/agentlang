module Blog

// Ref: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations

entity Profile {
    id UUID (@id, @auto),
    address String @optional,
    email Email,
    photo URL,
    DOB DateTime @optional
}

entity User {
    id Int (@id, @auto),
    name String
    profile Profile (@between, @unique) // 1-1 relationship between user and profile
    posts Post[] @contains // 1-N contains relationship
}

entity Post {
    id Int (@id, @auto),
    title String
    categories Category @between // N-N between relationship
}

entity Category {
    id Int (@id, @auto),
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