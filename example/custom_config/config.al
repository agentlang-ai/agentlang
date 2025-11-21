{
    chat.core/Config: {
        server: "https://my.chat",
        key: "#js process.env.CHAT_SECRET" // or "#js readSecret(\"CHAT_SECRET\")"
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
