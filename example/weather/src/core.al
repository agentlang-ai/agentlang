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
