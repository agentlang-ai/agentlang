# Changelog

## [0.8.8](https://github.com/agentlang-ai/agentlang/compare/0.8.7...0.8.8) (2026-01-14)

### Changes

* fix flow parsing for graph creation ([02e6605](https://github.com/agentlang-ai/agentlang/commit/02e660575a7afd0a36906926deac28ec75b7a2e8)) - @vijay

---
## [0.8.7](https://github.com/agentlang-ai/agentlang/compare/0.8.6...0.8.7) (2026-01-13)

### Changes

* handle null config (#523) ([344f7a5](https://github.com/agentlang-ai/agentlang/commit/344f7a5521b4e34056df1400ecde1763be7a65d1)) - @vijayfractl
* Quote aggregate colnames (#525) ([878dcab](https://github.com/agentlang-ai/agentlang/commit/878dcab1110171b1144e1b8f4c3ce0f73e8b3307)) - @vijayfractl
* Add empty "agentlang" config in test ([9990f50](https://github.com/agentlang-ai/agentlang/commit/9990f5045d3e94db5981f9829b2a45968b7de5bc)) - @pratik
* fix config format ([b79cc96](https://github.com/agentlang-ai/agentlang/commit/b79cc968f2f246f78c8ed499e9c9a2b9528f55e9)) - @vijay
* make agentlang config optional ([2207d7e](https://github.com/agentlang-ai/agentlang/commit/2207d7e10a5735ccf5144ea182d6cb774293d46c)) - @vijay
* Simplify the logic ([4c62937](https://github.com/agentlang-ai/agentlang/commit/4c629377d79f6e4f3c2e83ba858039488b969499)) - @pratik
* Fix parsing and fix tests ([ccdf529](https://github.com/agentlang-ai/agentlang/commit/ccdf529f5db86b6066f94e8af358c71c09908cfd)) - @pratik
* Update tests ([991b0cb](https://github.com/agentlang-ai/agentlang/commit/991b0cb9a7234db758bd56f7197e3bdacdaf547d)) - @pratik
* Cleanup use internal calls ([987d697](https://github.com/agentlang-ai/agentlang/commit/987d697c570d03c906156ecbd7a28cbb93a923f8)) - @pratik
* Remove duplicate processing use configFromObject ([ee873fa](https://github.com/agentlang-ai/agentlang/commit/ee873fa2cab477ed17d1c9fe4403d7fd3503587b)) - @pratik
* Better JSON config parser ([6d6f24f](https://github.com/agentlang-ai/agentlang/commit/6d6f24fd8e39d7634b9ce78a0c7b9c7b394d9cda)) - @pratik
* Update package-lock ([19252e1](https://github.com/agentlang-ai/agentlang/commit/19252e12a2609a13dbb07f80eb054ef85c403ba8)) - @pratik
* Support loading app config from config.al contents ([dde78d9](https://github.com/agentlang-ai/agentlang/commit/dde78d9c4424a89385df615d39b97c73acd47f55)) - @pratik
* duplicate names and definitions are allowed (#520) ([ab7a39d](https://github.com/agentlang-ai/agentlang/commit/ab7a39d163bdfaf89e367ea8eac692637b8eab15)) - @vijayfractl

---
## [0.8.6](https://github.com/agentlang-ai/agentlang/compare/0.8.5...0.8.6) (2026-01-09)

### Changes

* update between-rel endpoints (#518) ([6ea0eb8](https://github.com/agentlang-ai/agentlang/commit/6ea0eb8448b965a2cc37ce5d11940df948cde3d3)) - @vijayfractl

---
## [0.8.5](https://github.com/agentlang-ai/agentlang/compare/0.8.4...0.8.5) (2026-01-08)

### Changes

* Audit with diff (#515) ([5d2fdc1](https://github.com/agentlang-ai/agentlang/commit/5d2fdc108f54c72aeb40a99108ddce90129a34a9)) - @vijayfractl
* parse json objects to query patterns (#510) ([16e1ca5](https://github.com/agentlang-ai/agentlang/commit/16e1ca54d09fda6dbb54903f49abd80f4b1f2717)) - @vijayfractl
* External api demo (#512) ([e353032](https://github.com/agentlang-ai/agentlang/commit/e353032eb3eec3222910328718e7af3b4f9f7d52)) - @vijayfractl
* Write only secrets (#513) ([f022695](https://github.com/agentlang-ai/agentlang/commit/f0226954e00f1ed31c7e568688105e3ba15118fe)) - @vijayfractl
* addup total latency for parent monitors (#511) ([e49be4a](https://github.com/agentlang-ai/agentlang/commit/e49be4acd71f6afe73e3be91179a72334eb5e3cd)) - @vijayfractl

---
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
