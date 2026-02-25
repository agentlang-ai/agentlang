{
    "type": "#js process.env.STORE_TYPE || 'sqlite'",
    "dbname": "knowledge_service.db"
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
    "enabled": true
} @as auditTrail

{
    "host": "#js process.env.INTEGRATION_MANAGER_HOST || 'http://localhost:8085'",
    "connections": "#js ({google_drive: 'google-drive/oauth-config', onedrive: 'onedrive/oauth-config'})",
    "oauth": true
} @as integrations

{
    "store": store,
    "service": service,
    "auth": auth,
    "rbac": rbac,
    "auditTrail": auditTrail,
    "integrations": integrations
}
