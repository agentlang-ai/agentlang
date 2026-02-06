# Changelog

## [0.9.9](https://github.com/agentlang-ai/agentlang/compare/0.9.8...0.9.9) (2026-02-06)

### Changes

* stateless mode in agents (#566) ([573a3ee](https://github.com/agentlang-ai/agentlang/commit/573a3ee5c28ea3672883e5740a149031b86f5e7f)) - @muazzam0x48

---
## [0.9.8](https://github.com/agentlang-ai/agentlang/compare/0.9.7...0.9.8) (2026-02-06)

### Changes

* Add sqlite vec cdn, default embedding config and APIs for adding, removing documents (#569) ([e248864](https://github.com/agentlang-ai/agentlang/commit/e248864d0e64bb8b2fc909b7681677f93c5e5acf)) - @pratik

---
## [0.9.7](https://github.com/agentlang-ai/agentlang/compare/0.9.6...0.9.7) (2026-02-05)

### Changes

* Update package lock and pnpm lock ([9eaf647](https://github.com/agentlang-ai/agentlang/commit/9eaf647fb57972d770802c89a9d94c6e01fa07d7)) - @pratik
* Update tests ([66822de](https://github.com/agentlang-ai/agentlang/commit/66822de09324cffce4ce95f545e6946b80c2e659)) - @pratik
* Add new test ([1b55e83](https://github.com/agentlang-ai/agentlang/commit/1b55e83734bdf82acc098e3a912e5975d09253c8)) - @pratik
* Add support for pdf and markdown documents ([1f257ce](https://github.com/agentlang-ai/agentlang/commit/1f257ce3227c1d9335b7e090d58d04960d573263)) - @pratik
* Fix tests ([e797de4](https://github.com/agentlang-ai/agentlang/commit/e797de4f7a24e55b7cee96bd3719199d1f91047c)) - @pratik
* Fix tests ([6f4161a](https://github.com/agentlang-ai/agentlang/commit/6f4161ad4bd5132c85eca0530a8e11b46aaaf24a)) - @pratik
* Add pnpm lock file and fix lint ([222fc29](https://github.com/agentlang-ai/agentlang/commit/222fc29ef29ca49ac9ba4650060dd7821f990241)) - @pratik
* Add test ([6ed9359](https://github.com/agentlang-ai/agentlang/commit/6ed93590f9097ec4a9a152b240f32c22acf40663)) - @pratik
* Add Embedding Provider and support extension and chunking ([2fd7103](https://github.com/agentlang-ai/agentlang/commit/2fd71032c9b9375c6eecb903427d932f2a782f8f)) - @pratik
* Add sqlite-vec support and load extension ([ed76524](https://github.com/agentlang-ai/agentlang/commit/ed765243e691c177f76bcee6b92a973f5489addc)) - @pratik
* fix bogus agentlant-module update issue (#561) ([e60e284](https://github.com/agentlang-ai/agentlang/commit/e60e2842979476e6feee51486bb349f2804b6193)) - @vijayfractl
* publish.yml: fix better-sqlite3 bindings error (#564) ([358a1ff](https://github.com/agentlang-ai/agentlang/commit/358a1ff353c92ce88b001f4dcfd2963e6a96ccc5)) - @muazzam0x48

---
## [0.9.6](https://github.com/agentlang-ai/agentlang/compare/0.9.5...0.9.6) (2026-02-05)

### Changes

* cache dbtype. (#559) ([9f04119](https://github.com/agentlang-ai/agentlang/commit/9f04119a36654b9fe57b56c3cd57d8a697959bc7)) - @vijayfractl
* agent evaluator support (#557) ([32ffb00](https://github.com/agentlang-ai/agentlang/commit/32ffb009bd9a3b49119c338fef2f9712064a3949)) - @vijayfractl
* support role escalation (#555) ([2650fe4](https://github.com/agentlang-ai/agentlang/commit/2650fe4fe7029d75379d0bf2217187d1af6fa88d)) - @vijayfractl
* learner agents (#545) ([f2055a3](https://github.com/agentlang-ai/agentlang/commit/f2055a3b8811bc9e6abe6a768bb3f0687c242c05)) - @vijayfractl
* Tests failed on gpt-5.2 so, reverting to gpt-4o ([da3412f](https://github.com/agentlang-ai/agentlang/commit/da3412f350597376c84a171f04ec5b245a4019e0)) - @pratik
* Update default OpenAI model to gpt-5.2 ([c41d97b](https://github.com/agentlang-ai/agentlang/commit/c41d97b4c7577460674fc01ef258609b92be68c5)) - @pratik
* Update tests ([4dca2c0](https://github.com/agentlang-ai/agentlang/commit/4dca2c04511962a8141f93ee805022b3d08e6712)) - @pratik
* Rename OPENAI_API_KEY to AGENTLANG_OPENAI_KEY ([046e9f3](https://github.com/agentlang-ai/agentlang/commit/046e9f317db6fcd1cb55d616dcd53180f1f2dd76)) - @pratik
* Fix gitignore ([50c30d6](https://github.com/agentlang-ai/agentlang/commit/50c30d6182f284b784f40e5f43ad9e81a8d9bf60)) - @pratik
* Rename ANTHROPIC_API_KEY to AGENTLANG_ANTHROPIC_KEY ([58b18cd](https://github.com/agentlang-ai/agentlang/commit/58b18cda96066fde85b1e4f9f4616f13ff5b2c6a)) - @pratik
* Update gitignore ([5a8b6b0](https://github.com/agentlang-ai/agentlang/commit/5a8b6b0986b7aab49605cdc47206b7634fc624f7)) - @pratik
* check for undefined explicitly (#556) ([9cecb92](https://github.com/agentlang-ai/agentlang/commit/9cecb92e7944f53f41d2c981f2a930a659135ac3)) - @vijayfractl

---
## [0.9.5](https://github.com/agentlang-ai/agentlang/compare/0.9.4...0.9.5) (2026-01-27)

### Changes

* use other than 0000-... as default tennt/admin IDs (#553) ([fd599e3](https://github.com/agentlang-ai/agentlang/commit/fd599e31060e543b4ce8f617d5fe60d2716cf5b7)) - @muazzam0x48
* package.json: fix deprecated packages and warnings (#552) ([21357ed](https://github.com/agentlang-ai/agentlang/commit/21357edeab1a125a07f70b7ea3346a6496529bed)) - @muazzam0x48

---
## [0.9.4](https://github.com/agentlang-ai/agentlang/compare/0.9.3...0.9.4) (2026-01-26)

### Changes

* make user lastLoginTime optional (#550) ([763cde4](https://github.com/agentlang-ai/agentlang/commit/763cde44bd82d8d44fedded6908ace8031e49db1)) - @muazzam0x48

---
## [0.9.3](https://github.com/agentlang-ai/agentlang/compare/0.9.2...0.9.3) (2026-01-23)

### Changes

* chore: release 0.9.2 (#548) ([bb77503](https://github.com/agentlang-ai/agentlang/commit/bb775038ef6005d79ed89cad6aef6b1cf578cdd2)) - @github-actions[bot]

---
## [0.9.2](https://github.com/agentlang-ai/agentlang/compare/0.9.1...0.9.2) (2026-01-23)

### Changes

* auth: fix UpdatePermissionAssignment workflow (#547) ([4a22dfd](https://github.com/agentlang-ai/agentlang/commit/4a22dfd22480f7a34e4c10e3f197185301377be3)) - @muazzam0x48
* support tick-quoted strings (#543) ([609dde1](https://github.com/agentlang-ai/agentlang/commit/609dde121ed1b4551e4e9dac3adeadabb99275b0)) - @vijayfractl

---
## [0.9.1](https://github.com/agentlang-ai/agentlang/compare/0.9.0...0.9.1) (2026-01-21)

### Changes

* ignore mcp in browser ([e0ab3d3](https://github.com/agentlang-ai/agentlang/commit/e0ab3d338499306f06ae4ceb7ec6a07606d1ccf9)) - @vijay
* change mcp import path ([209a8bd](https://github.com/agentlang-ai/agentlang/commit/209a8bd156fd7fe52d8b7bc3909f81548cb0cb40)) - @vijay
* Support statements with aliases in flow-nodes. (#540) ([b9a196f](https://github.com/agentlang-ai/agentlang/commit/b9a196f52468377c2f5343b5068c66c5fa9ebf45)) - @vijayfractl
* Update package-lock ([dae269d](https://github.com/agentlang-ai/agentlang/commit/dae269d7d137533928ceff0a5c27399e37aa4098)) - @pratik
* Use proper agentlang comment format ([95d686d](https://github.com/agentlang-ai/agentlang/commit/95d686d21595e3443d7fe3941d2841c428013a95)) - @pratik
* Mcp client (#516) ([4d580e0](https://github.com/agentlang-ai/agentlang/commit/4d580e05ef9eb1fea216e4175534375261929a75)) - @vijayfractl
* Fix join queries with only aggregates (#534) ([27c8eb5](https://github.com/agentlang-ai/agentlang/commit/27c8eb562ed59aabdfa749cf0b71929314636367)) - @vijayfractl
* test for between-rel deletes, handle alias-binding precedence issue is if-else (#539) ([d88798f](https://github.com/agentlang-ai/agentlang/commit/d88798f755f1414c752ef5a9509a2025ddb9746d)) - @vijayfractl

---
## [0.9.0](https://github.com/agentlang-ai/agentlang/compare/0.8.10...0.9.0) (2026-01-19)

### Changes

* handle between-rel delete along with entities (#536) ([596189d](https://github.com/agentlang-ai/agentlang/commit/596189dd02ca77843f791273dbdcd19e31776f6d)) - @vijayfractl

---
## [0.8.10](https://github.com/agentlang-ai/agentlang/compare/0.8.8...0.8.10) (2026-01-19)

### Changes

* use safe base64 encode ([a3f8508](https://github.com/agentlang-ai/agentlang/commit/a3f8508c19fd9c3672e5bbffc9e8e64910d3017e)) - @muazzam
* fix user-attribute updates (#533) ([138eaaa](https://github.com/agentlang-ai/agentlang/commit/138eaaaad7246835e93bd33133e859cda49906a3)) - @vijayfractl
* fix custom agent event toString (#529) ([9fa773b](https://github.com/agentlang-ai/agentlang/commit/9fa773b113d18d9a9fe127cfdfc36e4204e5dac5)) - @vijayfractl
* avoid explicit agent invocation for patterns (#527) ([15c5498](https://github.com/agentlang-ai/agentlang/commit/15c549823a04b3f1738ab167c547c63e55fb0857)) - @vijayfractl
* support tenants in auth-layer (#514) ([5a6e635](https://github.com/agentlang-ai/agentlang/commit/5a6e635b8cad9d79e0f0c918f9fae4156bd30770)) - @vijayfractl

---
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
