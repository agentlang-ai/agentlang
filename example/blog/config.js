const config = {
  store: {
    type: 'postgres',
    host: process.env.POSTGRES_HOST || 'localhost',
    username: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'postgres',
    dbname: process.env.POSTGRES_DB || 'testdb'
  }
};

export default config;