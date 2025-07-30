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
    instruction "Assign the following incident to any one of the following emails: jake@acme.com, tom@acme.com, sam@acme.com. 
    For example, if the Incident sys_id is &quot;f12ca184735123002728660c4cf6a7ef&quot;, you may return {servicenow/assignIncident {sys_id &quot;f12ca184735123002728660c4cf6a7ef&quot;, user &quot;tom@acme.com&quot;}}",
    tools "servicenow/assignIncident"
}

resolver servicenow ["servicenow/incident"] {
    update r.updateInstance,
    query r.queryInstances,
    subscribe r.subs,
    onSubscription "servicenow/onIncidents"
}