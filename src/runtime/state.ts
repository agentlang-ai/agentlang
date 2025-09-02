import { z } from 'zod';

// Config validation schema
export const ConfigSchema = z.object({
  service: z
    .object({
      port: z.number(),
      host: z.string().optional(),
    })
    .default({
      port: 8080,
      host: 'localhost',
    }),
  store: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('postgres'),
        host: z.string().default('localhost'),
        username: z.string().default('postgres'),
        password: z.string().default('postgres'),
        dbname: z.string().default('postgres'),
        port: z.number().default(5432),
      }),
      z.object({
        type: z.literal('mysql'),
        host: z.string().default('localhost'),
        username: z.string().default('mysql'),
        password: z.string().default('mysql'),
        dbname: z.string().default('mysql'),
        port: z.number().default(3306),
      }),
      z.object({
        type: z.literal('sqlite'),
        dbname: z.string().optional(),
      }),
    ])
    .optional(),
  integrations: z
    .object({
      host: z.string(),
      username: z.string().optional(),
      password: z.string().optional(),
      connections: z.record(z.string(), z.string()),
    })
    .optional(),
  graphql: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),
  rbac: z
    .object({
      enabled: z.boolean().default(false),
      roles: z.array(z.string()).optional(),
    })
    .optional(),
  auth: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),
  auditTrail: z
    .object({
      enabled: z.boolean().default(false),
    })
    .optional(),
  authentication: z
    .discriminatedUnion('service', [
      z.object({
        service: z.literal('okta'),
        superuserEmail: z.string(),
        domain: z.string(),
        cookieDomain: z.string().optional(),
        authServer: z.string().default('default'),
        clientSecret: z.string(),
        apiToken: z.string(),
        scope: z.string().default('openid offline_access'),
        cookieTtlMs: z.number().default(1209600000),
        introspect: z.boolean().default(true),
        authorizeRedirectUrl: z.string(),
        clientUrl: z.string(),
        roleClaim: z.string().default('roles'),
        defaultRole: z.string().default('user'),
        clientId: z.string(),
      }),
      z.object({
        service: z.literal('cognito'),
        superuserEmail: z.string(),
        superuserPassword: z.string().optional(),
        isIdentityStore: z.boolean().default(false),
        userPoolId: z.string(),
        clientId: z.string(),
        whitelistEnabled: z.boolean().default(false),
        disableUserSessions: z.boolean().default(false),
      }),
    ])
    .optional(),
  openapi: z
    .array(
      z.object({
        specUrl: z.string(),
        baseUrl: z.string().optional(),
        name: z.string(),
      })
    )
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export let AppConfig: Config | undefined;

export function setAppConfig(config: Config): Config {
  AppConfig = config;
  return AppConfig;
}
