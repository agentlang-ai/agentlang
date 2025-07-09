module servicenow

import "../../example/servicenow/resolver.js" as r

workflow getIncidents {
    await r.getIncidents(getIncidents.N)
}