export default {
  store: {
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    dbname: process.env.POSTGRES_DB || 'testdb',
    port: parseInt(process.env.POSTGRES_PORT || '5432')
  },
  service: {
    port: parseInt(process.env.SERVICE_PORT || '8080')
  },
  rbacEnabled: process.env.RBAC_ENABLED === 'true',
  graphql: {
    enabled: process.env.GRAPHQL_ENABLED === 'true'
  },
  auditTrail: {
    enabled: process.env.AUDIT_TRAIL_ENABLED === 'true'
  }
};