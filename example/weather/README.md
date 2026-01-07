# Weather Forecast Example (Custom REST Resolver)

This example demonstrates how **Agentlang** can integrate with **external systems** by wiring entities to **custom resolvers**. Instead of persisting data locally, Agentlang can transparently fetch data from remote services—such as public APIs—while preserving a clean, declarative data model.

---

## Overview

In this sample application:

* A `Forecast` entity models a weather forecast request.
* The entity is bound to a **custom HTTP REST resolver**.
* When queried, the resolver calls the **Open-Meteo** public API and returns live weather data.
* From the client’s perspective, the interaction looks like a normal Agentlang entity query.

This pattern allows Agentlang to treat **external APIs as first-class data sources**.

---

## Module Definition

```agentlang
module weather.core

import "resolver.js" @as r

entity Forecast {
    latitude Decimal,
    longitude Decimal,
    days Integer @default(7)
}

resolver restResolver [weather.core/Forecast] {
    query r.queryForecast
}
```

### Key Points

* `Forecast` defines the **query parameters** (`latitude`, `longitude`, `days`).
* The `restResolver` binds the entity to a JavaScript resolver.
* The `query` handler is invoked whenever the entity is accessed via a GET request.

---

## Querying the Forecast Entity

Once the service is running, you can query the `Forecast` entity using the auto-generated REST endpoint:

```bash
curl "http://localhost:8080/weather.core/Forecast?latitude=52.52&longitude=13.41" | jq .
```

### Example Response

```json
{
  "current": {
    "time": "2022-01-01T15:00",
    "temperature_2m": 2.4,
    "wind_speed_10m": 11.9
  },
  "hourly": {
    "time": ["2022-07-01T00:00", "2022-07-01T01:00", "..."],
    "wind_speed_10m": [3.16, 3.02, 3.3, "..."],
    "temperature_2m": [13.7, 13.3, 12.8, "..."],
    "relative_humidity_2m": [82, 83, 86, "..."]
  }
}
```

The response is returned **directly from the external API**, without any transformation required by the client.

---

## Resolver Implementation

The resolver encapsulates all integration logic with the Open-Meteo service:

```javascript
// resolver.js
// HTTP REST resolver

export async function queryForecast(ctx, instance) {
  const lat = instance.getQueryValue('latitude');
  const long = instance.getQueryValue('longitude');

  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`;

  const response = await fetch(url, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' }
  });

  if (!response.ok) {
    throw new Error(`open-meteo call failed with status: ${response.status}`);
  }

  return await response.json();
}
```

### What the Resolver Does

* Extracts query parameters from the entity instance
* Constructs the Open-Meteo API request
* Executes the HTTP call
* Returns the API response directly to Agentlang

---

## Why This Matters

This example highlights several powerful Agentlang capabilities:

* **External system integration** via custom resolvers
* **Declarative API modeling** with zero boilerplate endpoints
* **Separation of concerns** between domain models and integration logic
* **Uniform access** to internal and external data sources

With resolvers, Agentlang allows developers to model **remote services as entities**, making them easy to compose with workflows, agents, joins, and aggregates—just like native data.

---

## Summary

Agentlang’s resolver mechanism turns external APIs into first-class citizens of your application model. Whether querying weather data, calling enterprise services, or integrating SaaS platforms, custom resolvers provide a clean, extensible bridge between Agentlang and the outside world.
