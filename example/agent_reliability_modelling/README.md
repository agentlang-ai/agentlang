This example application demonstrates the Agentic Realiability Modelling features of Agentlang.

Run:

```shell copy
$ node ./bin/cli.js run example/agent_reliability_modelling
```

Make a few sample requests:

```shell copy
 curl -X POST http://localhost:8080/order.core/carOrderRequestManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "I want to order a luxury electric vehicle"}'
  
curl -X POST http://localhost:8080/order.core/carOrderRequestManager \
  -H 'Content-Type: application/json' \
  -d '{"message": "I need a diesel SUV with automatic transmission. preferred color is black"}'
```

The agent will automatically place orders based on your requests. To view the orders placed by the agent for electric vehicles and suvs,

```shell copy
curl http://localhost:8080/order.core/EV
curl http://localhost:8080/order.core/SUV
```
