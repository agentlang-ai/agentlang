{
    chat.core/Config: {
        server: "https://my.chat",
        key: "333dwddsd7738"
    }
}

{
    "service": {
        "port": "#js parseInt(process.env.SERVICE_PORT || '8080')"
    },
        "store": {
            "type": "sqlite", "dbname": "cc.db"
    }
 }
