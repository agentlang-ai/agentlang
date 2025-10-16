module order.core

record BaseEV {
    bodyColor String,
    batteryPack @enum("59kwh", "79kwh"),
    charger @enum("11.2kw", "7.2kw")
}

entity EV extends BaseEV {
    id UUID @id @default(uuid()),
    segment @enum("economy", "luxury")
}

agent orderEV {
    instruction "Create an EV of segment {{segment}}, battery pack {{batteryPack}},
charger {{charger}} and color {{bodyColor}}",
    tools [order.core/EV]
}

record BaseSUV {
    bodyColor String,
    transmission @enum("manual", "automatic"),
    fuel @enum("diesel", "petrol"),
    torque @enum("330nm", "380nm")
}

entity SUV extends BaseSUV {
    id UUID @id @default(uuid()),
    segment @enum("economy", "luxury")
}

agent orderSUV {
    instruction "Create an EV of segment {{segment}}, transmission {{transmission}},
fule {{fuel}}, torque {{torque}} and color {{bodyColor}}",
    tools [order.core/SUV]
}

record CarOrderRequest {
    carType @enum("EV", "SUV"),
    bodyColor String,
    batteryPack String @optional,
    charger String @optional,
    transmission String @optional,
    fuel String @optional,
    torque String @optional,
    segment @enum("economy", "luxury")
}

agent analyseCarOrderRequest {
    instruction "Analyse the customer request for ordering a car and return the relevant information you are able to figure out",
    directives [{"if": "customer request contains references to electric vehicle, battery etc", "then": "carType: EV"},
		{"if": "request talks about mileage, fule-efficiency etc", "then": "carType: SUV"}]
    responseSchema CarOrderRequest
}

directive analyseCarOrderRequest.dir01 {
    "if": "the request for an electric vehicle does not contain battery-pack or charger specs",
    "then": "batteryPack: 79kwh, charger: 11.2kw"
}

directive analyseCarOrderRequest.dir02 {
    "if": "the request for an SUV does not specify transmission, fule or torque",
    "then": "transmission: manual, fuel: petrol, torque: 330nm"
}

directive analyseCarOrderRequest.dir03 {
    "if": "the request does not specify body color",
    "then": "bodyColor: white"
}

scenario analyseCarOrderRequest.scenario01 {
    "user": "I am looking for a high-end electric car. My favorite color is red",
    "ai": "{carType \"EV\", bodyColor \"red\", batteryPack \"79kwh\", charger \"11.2kw\", segment \"luxury\"}"
}

scenario analyseCarOrderRequest.scenario02 {
    "user": "I am looking for an affordable, fule-efficient SUV",
    "ai": "{carType \"SUV\", bodyColor \"white\", transmission \"manual\", fuel \"petrol\", torque \"330nm\"}"
}

decision classifyOrder {
    case (carType == "EV" and segment == "economy") {
        EconomyEV
    }

    case (carType == "EV" and segment == "luxury") {
        LuxuryEV
    }

    case (carType == "SUV" and segment == "economy") {
        EconomySUV
    }

    case (carType == "SUV" and segment == "luxury") {
        LuxurySUV
    }
}

flow carOrderRequestManager {
    analyseCarOrderRequest --> classifyOrder
    classifyOrder --> "EconomyEV" orderEV
    classifyOrder --> "LuxuryEV" orderEV
    classifyOrder --> "EconomySUV" orderSUV
    classifyOrder --> "LuxurySUV" orderSUV
}

@public agent carOrderRequestManager {
    role "You are an agent who analyses customer order requests for new cars and make appropriate orders"
}
