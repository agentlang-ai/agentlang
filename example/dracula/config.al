{
  "agentlang": {
    "service": {
        "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
    "store": {
        "type": "sqlite",
        "dbname": "dracula.db"
    },
    "vectorStore": {
      "type": "lancedb"
    },
    "knowledgeGraph": {
      "enabled": true,
      "neo4j": {
        "uri": "#js process.env.GRAPH_DB_URI || 'bolt://localhost:7687'",
        "user": "#js process.env.GRAPH_DB_USER || 'neo4j'",
        "password": "#js process.env.GRAPH_DB_PASSWORD || 'password'"
      }
    }
   }
}
