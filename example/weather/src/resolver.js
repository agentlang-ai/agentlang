// HTTP REST resolver

export async function queryForecast(ctx, instance) {
  const lat = instance.getQueryValue('latitude');
  const long = instance.getQueryValue('longitude');
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${long}&current=temperature_2m,wind_speed_10m&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`open-meteo call failed with status: ${response.status}`);
  }

  const responseData = await response.json();
  return responseData;
}
