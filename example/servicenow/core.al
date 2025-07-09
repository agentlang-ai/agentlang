module servicenow

import "../../example/servicenow/resolver.js" as r

entity incident {
    sys_id String @id,
    data Any @optional
}

workflow getIncidents {
    {incident? {}}
}