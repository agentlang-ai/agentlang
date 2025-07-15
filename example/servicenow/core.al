module servicenow

import "../../example/servicenow/resolver.js" as r

entity incident {
    sys_id String @id,
    data Any @optional
}

event assignIncident {
    sys_id String,
    user Email
}

workflow assignIncident {
    r.assignIncident(assignIncident.sys_id, assignIncident.user)
}

workflow getIncidents {
    {incident? {}}
}

workflow onIncidents {
    {incidentManagerAgent {message onIncidents.data}}
}

agent incidentManagerAgent {
    instruction "Assign the incoming incident to one of ['jake@acme.com', 'tom@acme.com', 'sam@acme.com']",
    tools "servicenow"
}

resolver servicenow ["servicenow/incident"] {
    update r.updateInstance,
    query r.queryInstances,
    subscribe r.subs,
    onSubscription "servicenow/onIncidents"
}