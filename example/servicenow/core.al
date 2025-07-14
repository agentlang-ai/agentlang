module servicenow

import "../../example/servicenow/resolver.js" as r

entity incident {
    sys_id String @id,
    data Any @optional
}

workflow getIncidents {
    {incident? {}}
}

workflow onIncidents {
    console.log(onIncidents.data)
}

resolver servicenow ["servicenow/incident"] {
    update r.updateInstance,
    query r.queryInstances,
    subscribe r.subs,
    onSubscription "servicenow/onIncidents"
}