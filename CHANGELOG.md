# Changelog

## [0.8.4](https://github.com/agentlang-ai/agentlang/compare/0.8.3...0.8.4) (2026-01-02)

### Changes

* Add fallback for `eval` to use indirect eval with globalThis ([2eef3c8](https://github.com/agentlang-ai/agentlang/commit/2eef3c888bb426c751623f822e8c389f22e8ab7c)) - @pratik

---
## [0.8.3](https://github.com/agentlang-ai/agentlang/compare/0.8.2...0.8.3) (2025-12-31)

### Changes

* Update action-setup to v4 for integration CI ([eed3666](https://github.com/agentlang-ai/agentlang/commit/eed3666150fb281a3ae386fa47180a2d1eeb5f2c)) - @pratik
* Don't set pnpm version on CI, it must use package.json version ([e5b89ce](https://github.com/agentlang-ai/agentlang/commit/e5b89ce29475a1fc01bf4c58723921f5289cd067)) - @pratik
* support retries spec in config.al (#503) ([f946bd7](https://github.com/agentlang-ai/agentlang/commit/f946bd7f12e2734fa4c145ced53b00d34bcb6aec)) - @vijayfractl
* Only read APP_CONFIG from node process ([960ae74](https://github.com/agentlang-ai/agentlang/commit/960ae74f7f0afda52bed6807e34acbf25d0418b3)) - @pratik
* update config root key to be of appName (#502) ([dd200c0](https://github.com/agentlang-ai/agentlang/commit/dd200c0e67a425585f00449989c43a366ee59359)) - @vijayfractl
* Persistent timer restarts (#497) ([cc5dea0](https://github.com/agentlang-ai/agentlang/commit/cc5dea0bd22ec888b9f85968542061cbafa1ef0f)) - @vijayfractl
* profilePicture fielld in agentlang.auth/user (#501) ([ea9451f](https://github.com/agentlang-ai/agentlang/commit/ea9451f46087583821dd661ac83d0b9cdf2b7715)) - @muazzam0x48
* Only run publish CI when release PR is merged ([d80ccfb](https://github.com/agentlang-ai/agentlang/commit/d80ccfbcb6967ba32067114b7c93deb71a2216cb)) - @pratik
* support import statement in syntax (#499) ([68cc8ef](https://github.com/agentlang-ai/agentlang/commit/68cc8ef4f3f34f1ee2abd3f930d0ab6e5ffb8baa)) - @vijayfractl
* Update versions for actions and also use `main` for PR head ([88e572b](https://github.com/agentlang-ai/agentlang/commit/88e572b41c8f37f8d99ff26ec31a872e38507515)) - @pratik

---
## [0.8.2](https://github.com/agentlang-ai/agentlang/compare/v0.7.9...v0.8.2) (2025-12-30)

### Changes

* support arbitrary functions in @default (#495) ([d419820](https://github.com/agentlang-ai/agentlang/commit/d419820)) - @vijayfractl
* Aggregate queries (#490) ([45eedca](https://github.com/agentlang-ai/agentlang/commit/45eedca)) - @vijayfractl
* support new config syntax (#493) ([09b4c44](https://github.com/agentlang-ai/agentlang/commit/09b4c44)) - @vijayfractl
* load app config from env vars (#494) ([cb07142](https://github.com/agentlang-ai/agentlang/commit/cb07142)) - @muazzam0x48

---

*This CHANGELOG is automatically generated based on git tags and commits. For the release process, see [RELEASE_PROCESS.md](.github/RELEASE_PROCESS.md)*
