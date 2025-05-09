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
}

// one-one
relationship UserProfile between (User, Profile, @one-one) {
    User.profile Profile,
    Profile.user Ref(User.id as userId)
}

entity Post {
    id Int @id @default(autoincrement()),
    title String
}

// one-many
relationship PostAuthor contains (User, Post) {
    User.posts Post[],
    Post.author Ref(User.id as authorId)
}

entity Category {
    id Int @id @default(autoincrement()),
    description String
}

// many-many
relationship PostCategory between (Post, Category) {
    Post.categories Category[],
    Category.posts Post[]
}

workflow CreateUserWithPosts {
    {User {name "Sam",
           posts [{Post {"title" "Welcome to Agentlang!"}}
                  {Post {"title" "Design a basic model"}}],
           profile {Profile {"email" "sam@blog.org"}}}}
}

workflow FindUserWithPostsAndProfile {
    {User {id? FindUserWithPosts.userId}
     include [posts, profile]}
}

workflow FindUserWithoutPostsAndProfile {
    {User {id? FindUserWithPosts.userId}}
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

// An explicit M-M relations with data-attributes.
relationship CategoriesOnPost between (Post, Category) {
    Post.categories CategoriesOnPost[],
    Category.posts CategoriesOnPosts[],
    post Post.id @id,
    category Category.id @id,
    assignedAt DateTime @default(now()),
    assignedBy String
}