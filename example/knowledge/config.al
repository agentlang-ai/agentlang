{
    "type": "postgres",
    "host": "#js process.env.POSTGRES_HOST || 'localhost'",
    "username": "#js process.env.POSTGRES_USER || 'postgres'",
    "password": "#js process.env.POSTGRES_PASSWORD || 'postgres'",
    "dbname": "#js process.env.POSTGRES_DB || 'testdb'",
    "port": "#js parseInt(process.env.POSTGRES_PORT || '5432')"
} @as store

{
    "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
} @as service

{
      "enabled": "#js process.env.AUTH_ENABLED === 'true'"
} @as auth

{
    "enabled": "#js process.env.RBAC_ENABLED === 'true'"
} @as rbac

{
    "enabled": "#js process.env.GRAPHQL_ENABLED === 'true'"
} @as graphql

{
    "enabled": "#js process.env.AUDIT_TRAIL_ENABLED === 'true'"
} @as auditTrail

{
	"store": store,
	"service": service,
	"auth": auth,
	"rbac": rbac,
	"graphql": graphql,
	"auditTrail": auditTrail
}
