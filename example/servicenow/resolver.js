import { encodeForBasicAuth } from '../../out/utils/http.js'
import { Resolver } from '../../out/runtime/resolvers/interface.js'
import { registerResolver, setResolver } from "../../out/runtime/resolvers/registry.js"
import { makeInstance, isInstanceOfType } from "../../out/runtime/module.js"

const instanceUrl = process.env['SERVICENOW_URL']
const username = process.env['SERVICENOW_USERNAME']
const password = process.env['SERVICENOW_PASSWORD']
const authorizationHeader = `Basic ${encodeForBasicAuth(username, password)}`

const standardHeaders = {
    'Authorization': authorizationHeader,
    'Content-Type': 'application/json' // Add other headers as needed
}

async function getIncidents(sysId, count) {
    const apiUrl = sysId ?
        `${instanceUrl}/api/now/table/incident/${sysId}` :
        `${instanceUrl}/api/now/table/incident?sysparm_limit=${count}`;
    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: standardHeaders
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} ${response.text} ${response.statusText}`);
        }

        const data = await response.json();
        return data.result
    } catch (error) {
        return { error: error.message };
    }
}

async function updateIncident(sysId, data) {
    const apiUrl = `${instanceUrl}/api/now/table/incident/${sysId}`
    try {
        const response = await fetch(apiUrl, {
            method: 'PUT',
            headers: standardHeaders,
            body: JSON.stringify(data),
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        return responseData;
    } catch (error) {
        return { error: error }
    }
}

function isIncident(obj) {
    return isInstanceOfType(obj, 'servicenow/incident')
}

function getSysId(inst) {
    return inst.lookup('sys_id')
}

function pathQueryValue(inst) {
    const p = inst.lookupQueryVal('__path__')
    if (p) {
        return p.split('/')[1]
    }
    return undefined
}

function asIncidentInstance(data) {
    return makeInstance('servicenow', 'incident', new Map().set('data', data).set('sys_id', data.sys_id))
}

class ServiceNowResolver extends Resolver {

    constructor(name) {
        super(name)
    }

    async updateInstance(inst, newAttrs) {
        if (isIncident(inst)) {
            return await updateIncident(getSysId(inst), newAttrs).map(asIncidentInstance)
        } else {
            throw new Error(`Cannot update instance ${inst}`)
        }
    }

    async queryInstances(inst, queryAll) {
        if (isIncident(inst)) {
            let r = await getIncidents(pathQueryValue(inst), queryAll ? 100 : 5)
            if (!(r instanceof Array)) {
                r = [r]
            }
            return r.map(asIncidentInstance)
        } else {
            return []
        }
    }
}

registerResolver('servicenow', () => { return new ServiceNowResolver("servicenow") })
setResolver('servicenow/incident', 'servicenow')