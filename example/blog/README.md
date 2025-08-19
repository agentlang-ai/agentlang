Start the app:

```shell
$ node ./bin/cli.js run example/blog
```

Create a new User with blog-posts:

```shell
POST http://localhost:8080/Blog/CreateUserWithPosts

{"name": "Joe", "email": "joe@blog.com", "post1": "Good day", "post2": "Stay strong"}
```

Get User with Posts:

```shell
POST http://localhost:8080/Blog/GetUserPosts

{"userId": "<user-uuid>"}
```

To test with RBAC:

1. export RBAC_ENABLED=true
2. Create a new Cognito user and uncomment the last line in blog.al to enable rbac for that user.
3. Run the app and login:

```shell
POST http://localhost:8080/agentlang.auth/login

{"email": "<user-email>", "password": "<user-password>"}
```

This will return a new auth-token.

4. Make requests with the `Authorization` header set to `Bearer <token>`
