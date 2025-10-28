{
  "store": {
    "type": "postgres",
    "host": "#js process.env.POSTGRES_HOST || 'localhost'",
    "username": "#js process.env.POSTGRES_USER || 'postgres'",
    "password": "#js process.env.POSTGRES_PASSWORD || 'postgres'",
    "dbname": "#js process.env.POSTGRES_DB || 'postgres'",
    "port": "#js parseInt(process.env.POSTGRES_PORT || '5432')"
  },
  "service": {
    "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
  }
}