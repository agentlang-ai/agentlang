{
    "store": {
	"type": "sqlite",
	"dbname": "issues.db"
    },
    "service": {
	"port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    }
}
