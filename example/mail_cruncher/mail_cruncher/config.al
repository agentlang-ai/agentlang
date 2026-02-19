{
  "agentlang": {
    "service": {
      "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
      "type": "sqlite",
      "dbname": "mail_cruncher.db"
    },
    "integrations": {
      "host": "#js (process.env.INTEGRATION_MANAGER_HOST || 'http://localhost:8085')",
      "connections": {
        "gmail": {
          "config": "gmail/gmail-oauth",
          "resolvers": ["gmail/gmail1", "gmail/gmail2", "gmail/gmail3", "gmail/gmail4", "gmail/gmail5", "gmail/gmail6"]
        }
      }
    }
  }
}
