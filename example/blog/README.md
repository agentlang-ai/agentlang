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