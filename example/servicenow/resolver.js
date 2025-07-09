import { encodeForBasicAuth } from '../../out/utils/http.js'

const instanceUrl = process.env['SERVICENOW_URL']
const username = process.env['SERVICENOW_USERNAME']
const password = process.env['SERVICENOW_PASSWORD']
const authorizationHeader = `Basic ${encodeForBasicAuth(username, password)}`

export async function getIncidents(count) {
    const apiUrl = `${instanceUrl}/api/now/table/incident?sysparm_limit=${count}`;
    console.log(apiUrl)
    console.log(authorizationHeader)
    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Authorization': authorizationHeader,
                'Content-Type': 'application/json' // Add other headers as needed
            }
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