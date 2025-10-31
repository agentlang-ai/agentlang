module net.core

record NetworkProvisioningRequest {
    type @enum("DNS", "WLAN"),
    requestedBy String,
    CNAME String,
    IPAddress String
}

event doProvisionDNS {
    CNAME String,
    IPAddress String
}

entity DNSEntry {
    provisioningId UUID @id @default(uuid()),
    CNAME String @indexed,
    IPAddress String
}

workflow doProvisionDNS {
    {DNSEntry {
        CNAME doProvisionDNS.CNAME,
        IPAddress doProvisionDNS.IPAddress
    }}
}

event doProvisionWLAN {
    IPAddress String @id
}

entity WLANEntry {
    provisioningId UUID @id @default(uuid()),
    IPAddress String
}

workflow doProvisionWLAN {
    {WLANEntry {
        IPAddress doProvisionWLAN.IPAddress
    }}
}

event reportRequestFailed {
    requestedBy String
}

entity ProvisioningFailure {
    requestedBy String
}

workflow reportRequestFailed {
    {ProvisioningFailure {
        requestedBy reportRequestFailed.requestedBy
    }}
}

event markRequestCompleted {
    type @enum("DNS", "WLAN"),
    provisioningId String,
    requestedBy String
}

entity requestCompletedNotification {
    type @enum("DNS", "WLAN"),
    provisioningId String,
    requestedBy String
}

workflow markRequestCompleted {
    {requestCompletedNotification {
	type markRequestCompleted.type,
        provisioningId markRequestCompleted.provisioningId,
        requestedBy markRequestCompleted.requestedBy
    }}
}
        
agent provisionDNS {
    instruction "Provision DNS with ipaddress={{classifyNetworkProvisioningRequest.IPAddress}} and cname={{classifyNetworkProvisioningRequest.CNAME}}",
    tools [net.core/doProvisionDNS],
    scratch [provisioningId]
}

agent provisionWLAN {
    instruction "Using {{classifyNetworkProvisioningRequest.IPAddress}} as ipaddress, provision WLAN",
    tools [net.core/doProvisionWLAN],
    scratch [provisioningId]
}

agent reportFailure {
    instruction "Report the request as failed for {{classifyNetworkProvisioningRequest.requestedBy}}."
    tools [net.core/reportRequestFailed]
}

event validateProvisiongRequest extends agentlang/ValidationRequest {}

workflow validateProvisiongRequest {
    if (not(validateProvisiongRequest.data.requestedBy)) {
	{agentlang/ValidationResult {status "error", reason "requestedBy is required"}}
    } else if (not(validateProvisiongRequest.data.IPAddress)) {
	{agentlang/ValidationResult {status "error", reason "IPAddress is required"}}
    } else {
	{agentlang/ValidationResult {status "ok"}}
    }
}

agentlang/retry classifyRetry {
    attempts 3,
    backoff {
	strategy linear,
	delay 2,
	magnitude seconds,
	factor 2
    }
}

agent classifyNetworkProvisioningRequest {
    instruction "Analyse the network provisioning request and return its type and other relevant information.",
    responseSchema NetworkProvisioningRequest,
    validate net.core/validateProvisiongRequest,
    retry net.core/classifyRetry
}

agent markTicketAsDone {
    instruction "Use type={{classifyNetworkProvisioningRequest.type}}, requestedBy={{classifyNetworkProvisioningRequest.requestedBy}} and provisioningId={{provisioningId}} to mark the request as completed",
    tools [net.core/markRequestCompleted]
}
        
flow networkProvisioningRequestManager {
    classifyNetworkProvisioningRequest --> "type is DNS" provisionDNS
    classifyNetworkProvisioningRequest --> "type is WLAN" provisionWLAN
    provisionDNS --> markTicketAsDone
    provisionWLAN --> markTicketAsDone
    classifyNetworkProvisioningRequest --> "type is Other" reportFailure
}

@public agent networkProvisioningRequestManager {
    role "You are a network-provisioning request manager"
}
