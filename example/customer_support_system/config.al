{
 "type": "postgres",
 "host": "#js process.env.POSTGRES_HOST || 'localhost'",
 "username": "#js process.env.POSTGRES_USER || 'postgres'",
 "password": "#js process.env.POSTGRES_PASSWORD || 'postgres'",
 "dbname": "#js process.env.POSTGRES_DB || 'postgres'",
 "port": "#js parseInt(process.env.POSTGRES_PORT || '5432')"
} @as store

{
 "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
} @as service

{
 "store": store,
 "service": service
}
